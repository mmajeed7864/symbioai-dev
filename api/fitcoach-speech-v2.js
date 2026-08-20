import { Ratelimit } from "@upstash/ratelimit";
import { getChatRedis } from "./_chat-telemetry.js";
import {
  FITCOACH_SPEECH_VERSION,
  buildElevenLabsRequest,
  parseSpeechRequest,
  reserveSpeechCharBudget,
  resolveVoiceProfile,
  safeSpeechSessionId,
} from "./_fitcoach-speech-v2.js";

const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const MAX_BODY_BYTES = 6_000;
const PROVIDER_TIMEOUT_MS = 12_000;
let protectionState;

function protection() {
  if (protectionState !== undefined) return protectionState;
  const redis = getChatRedis();
  protectionState = redis
    ? {
        ip: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(72, "10 m"),
          prefix: "fitcoach:speech-v2:ip",
          analytics: false,
        }),
        session: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(48, "10 m"),
          prefix: "fitcoach:speech-v2:session",
          analytics: false,
        }),
        redis,
      }
    : null;
  return protectionState;
}

function setCors(req, res) {
  const origin = String(req.headers?.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-FitCoach-Build");
  res.setHeader("Access-Control-Expose-Headers", "X-FitCoach-Voice-Provider, X-FitCoach-Voice-Profile, X-FitCoach-Speech-Version");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function ipFor(req) {
  return (
    String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim()
    || String(req.headers?.["x-real-ip"] || "")
    || String(req.socket?.remoteAddress || "unknown")
  );
}

async function streamBody(body, res) {
  if (!body?.getReader) throw new Error("VOICE_STREAM_UNAVAILABLE");
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) res.write(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const origin = String(req.headers?.origin || "");
  if (!ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
  }
  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
  }

  const parsed = parseSpeechRequest(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });

  const limiter = protection();
  if (!limiter) return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  try {
    const [ipLimit, sessionLimit] = await Promise.all([
      limiter.ip.limit(ipFor(req)),
      limiter.session.limit(safeSpeechSessionId(req.body?.session_id)),
    ]);
    if (!ipLimit.success || !sessionLimit.success) {
      return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
    }
  } catch {
    return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  }

  const apiKey = String(process.env.ELEVENLABS_API_KEY || "").trim();
  if (!apiKey) return res.status(503).json({ ok: false, error: "VOICE_PROVIDER_NOT_CONFIGURED" });

  try {
    const budget = await reserveSpeechCharBudget(limiter.redis, { chars: parsed.request.text.length });
    if (!budget.success) {
      res.setHeader("X-FitCoach-Voice-Limit", "monthly-char-budget");
      return res.status(429).json({ ok: false, error: "VOICE_MONTHLY_BUDGET_REACHED" });
    }
  } catch {
    return res.status(503).json({ ok: false, error: "VOICE_BUDGET_PROTECTION_UNAVAILABLE" });
  }

  const profile = resolveVoiceProfile(parsed.request);
  const upstream = buildElevenLabsRequest(parsed.request, profile, apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), PROVIDER_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(upstream.url, { ...upstream.options, signal: controller.signal });
  } catch {
    clearTimeout(timer);
    return res.status(502).json({ ok: false, error: "VOICE_PROVIDER_UNAVAILABLE" });
  }
  if (!response.ok || !response.body) {
    clearTimeout(timer);
    return res.status(502).json({ ok: false, error: "VOICE_PROVIDER_UNAVAILABLE" });
  }

  res.status(200);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("X-FitCoach-Voice-Provider", "elevenlabs");
  res.setHeader("X-FitCoach-Voice-Profile", profile.profile);
  res.setHeader("X-FitCoach-Speech-Version", FITCOACH_SPEECH_VERSION);
  try {
    await streamBody(response.body, res);
  } catch {
    if (!res.headersSent) return res.status(502).json({ ok: false, error: "VOICE_STREAM_UNAVAILABLE" });
    res.end();
  } finally {
    clearTimeout(timer);
  }
}
