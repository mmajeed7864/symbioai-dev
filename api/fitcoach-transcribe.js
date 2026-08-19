import { Ratelimit } from "@upstash/ratelimit";
import { getChatRedis } from "./_chat-telemetry.js";

const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const MAX_BASE64_CHARS = 3_200_000;
const ALLOWED_FORMATS = new Set(["webm", "wav", "mp3", "m4a", "mp4", "ogg"]);
let limiter;

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-FitCoach-Build");
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

function getLimiter() {
  if (limiter !== undefined) return limiter;
  const redis = getChatRedis();
  limiter = redis
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(18, "10 m"),
        prefix: "fitcoach:founder:voice",
        analytics: false,
      })
    : null;
  return limiter;
}

function cleanFormat(value) {
  const format = String(value || "webm").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ALLOWED_FORMATS.has(format) ? format : "webm";
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const origin = String(req.headers.origin || "");
  if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });

  const audio = String(req.body?.audio || "");
  if (!audio || audio.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/=]+$/.test(audio)) {
    return res.status(400).json({ ok: false, error: "INVALID_AUDIO" });
  }

  const rateLimiter = getLimiter();
  if (!rateLimiter) return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  const limited = await rateLimiter.limit(ipFor(req));
  if (!limited.success) return res.status(429).json({ ok: false, error: "RATE_LIMITED" });

  const key = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "TRANSCRIPTION_PROVIDER_NOT_CONFIGURED" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mmajeed7864.github.io/fitcoach-founder-test/",
        "X-Title": "FitCoach Founder Voice",
      },
      body: JSON.stringify({
        model: "qwen/qwen3-asr-flash-2026-02-10",
        input_audio: {
          data: audio,
          format: cleanFormat(req.body?.format),
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[fitcoach-transcribe] upstream error", {
        status: response.status,
        error: String(payload?.error?.message || payload?.message || "unknown").slice(0, 180),
      });
      return res.status(502).json({ ok: false, error: "TRANSCRIPTION_FAILED" });
    }
    const text = String(payload?.text || payload?.transcript || "").trim().slice(0, 4_000);
    if (!text) return res.status(502).json({ ok: false, error: "EMPTY_TRANSCRIPT" });
    return res.status(200).json({
      ok: true,
      text,
      model: "qwen/qwen3-asr-flash-2026-02-10",
      build: String(req.headers["x-fitcoach-build"] || "unknown").slice(0, 80),
    });
  } catch (error) {
    console.error("[fitcoach-transcribe] request failed", {
      error: String(error?.message || error).slice(0, 180),
    });
    return res.status(502).json({ ok: false, error: "TRANSCRIPTION_FAILED" });
  } finally {
    clearTimeout(timeout);
  }
}
