import { Ratelimit } from "@upstash/ratelimit";
import { getChatRedis } from "./_chat-telemetry.js";

const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const TTS_MODEL = "hexgrad/kokoro-82m";
const DEFAULT_VOICE = "af_nova";
const FALLBACK_VOICE = "af_heart";
const ALLOWED_VOICES = new Set([
  "af_nova",
  "af_heart",
  "af_bella",
  "af_sarah",
  "af_sky",
  "am_michael",
  "am_fenrir",
]);
const MAX_BODY_BYTES = 18_000;
const MAX_TEXT_CHARS = 2_800;
let limiterState;

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-FitCoach-Build");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "X-FitCoach-TTS-Model, X-FitCoach-Voice, X-Generation-Id"
  );
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function ipFor(req) {
  return (
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    String(req.headers["x-real-ip"] || "") ||
    String(req.socket?.remoteAddress || "unknown")
  );
}

function cleanText(value, limit = MAX_TEXT_CHARS) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/[*_#>`~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeSessionId(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return cleaned.length >= 8 ? cleaned : "anonymous-founder";
}

function getLimiters() {
  if (limiterState !== undefined) return limiterState;
  const redis = getChatRedis();
  limiterState = redis
    ? {
        ip: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(50, "10 m"),
          prefix: "fitcoach:tts:ip",
          analytics: false,
        }),
        session: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(42, "10 m"),
          prefix: "fitcoach:tts:session",
          analytics: false,
        }),
      }
    : null;
  return limiterState;
}

async function synthesize({ key, text, voice }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 38_000);
  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mmajeed7864.github.io/fitcoach-founder-test/",
        "X-Title": "FitCoach Nova Voice",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: text,
        voice,
        response_format: "mp3",
        speed: 1.02,
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      const errorPayload = await upstream.text().catch(() => "");
      throw new Error(
        `TTS_UPSTREAM_${upstream.status}:${errorPayload.slice(0, 180)}`
      );
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (!buffer.length) throw new Error("TTS_EMPTY_AUDIO");
    return {
      buffer,
      contentType: upstream.headers.get("content-type") || "audio/mpeg",
      generationId: upstream.headers.get("x-generation-id") || "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const origin = String(req.headers.origin || "");
  if (!ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
  }

  const text = cleanText(req.body?.text);
  if (!text) return res.status(400).json({ ok: false, error: "TEXT_REQUIRED" });

  const limiters = getLimiters();
  if (!limiters) {
    return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  }

  try {
    const sessionId = safeSessionId(req.body?.session_id);
    const [ipLimit, sessionLimit] = await Promise.all([
      limiters.ip.limit(ipFor(req)),
      limiters.session.limit(sessionId),
    ]);
    if (!ipLimit.success || !sessionLimit.success) {
      return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
    }
  } catch {
    return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  }

  const key = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) {
    return res.status(503).json({ ok: false, error: "TTS_PROVIDER_NOT_CONFIGURED" });
  }

  const requestedVoice = String(req.body?.voice || "").trim();
  const firstVoice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : DEFAULT_VOICE;
  const voices = firstVoice === FALLBACK_VOICE ? [firstVoice] : [firstVoice, FALLBACK_VOICE];

  let lastError;
  for (const voice of voices) {
    try {
      const audio = await synthesize({ key, text, voice });
      res.setHeader("Content-Type", audio.contentType);
      res.setHeader("Content-Length", String(audio.buffer.length));
      res.setHeader("X-FitCoach-TTS-Model", TTS_MODEL);
      res.setHeader("X-FitCoach-Voice", voice);
      if (audio.generationId) res.setHeader("X-Generation-Id", audio.generationId);
      return res.status(200).send(audio.buffer);
    } catch (error) {
      lastError = error;
      console.warn("[fitcoach-speech] voice route failed", {
        voice,
        error: String(error?.message || error).slice(0, 220),
      });
    }
  }

  console.error("[fitcoach-speech] all routes failed", {
    error: String(lastError?.message || lastError || "unknown").slice(0, 220),
  });
  return res.status(502).json({ ok: false, error: "TTS_REQUEST_FAILED" });
}
