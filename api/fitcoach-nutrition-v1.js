import { Ratelimit } from "@upstash/ratelimit";
import { getChatRedis } from "./_chat-telemetry.js";
import {
  FITCOACH_NUTRITION_VERSION,
  lookupBarcodeNutrition,
  parseNutritionRequest,
  safeNutritionSessionId,
  searchNutritionFoods,
  unavailableVisionNutritionEstimate,
} from "./_fitcoach-nutrition-v1.js";

const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const MAX_BODY_BYTES = 8_000;
let limiterState;

function protection() {
  if (limiterState !== undefined) return limiterState;
  const redis = getChatRedis();
  limiterState = redis
    ? {
        ip: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(24, "10 m"),
          prefix: "fitcoach:nutrition-v1:ip",
          analytics: false,
        }),
        session: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(18, "10 m"),
          prefix: "fitcoach:nutrition-v1:session",
          analytics: false,
        }),
      }
    : null;
  return limiterState;
}

function setCors(req, res) {
  const origin = String(req.headers?.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-FitCoach-Build");
  res.setHeader("Access-Control-Expose-Headers", "X-FitCoach-Nutrition-Version");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-FitCoach-Nutrition-Version", FITCOACH_NUTRITION_VERSION);
}

function ipFor(req) {
  return (
    String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim()
    || String(req.headers?.["x-real-ip"] || "")
    || String(req.socket?.remoteAddress || "unknown")
  );
}

function statusForError(error) {
  if (error === "FOOD_NOT_FOUND") return 404;
  if (error === "VISION_PROVIDER_NOT_CONFIGURED") return 503;
  if (error === "NUTRITION_PROVIDER_UNAVAILABLE") return 502;
  return 400;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const origin = String(req.headers?.origin || "");
  if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });

  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
  }

  const parsed = parseNutritionRequest(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });

  const limiter = protection();
  if (!limiter) return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  try {
    const [ipLimit, sessionLimit] = await Promise.all([
      limiter.ip.limit(ipFor(req)),
      limiter.session.limit(safeNutritionSessionId(req.body?.session_id)),
    ]);
    if (!ipLimit.success || !sessionLimit.success) return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
  } catch {
    return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  }

  let result;
  if (parsed.request.action === "barcode_lookup") {
    result = await lookupBarcodeNutrition(parsed.request.barcode);
  } else if (parsed.request.action === "text_search") {
    result = await searchNutritionFoods(parsed.request.query);
  } else {
    result = unavailableVisionNutritionEstimate();
  }

  if (!result.ok) return res.status(statusForError(result.error)).json({ ok: false, error: result.error, detail: result.detail });
  return res.status(200).json({
    ok: true,
    action: parsed.request.action,
    provider: "open_food_facts",
    nutrition_version: FITCOACH_NUTRITION_VERSION,
    food: result.food || null,
    foods: result.foods || [],
  });
}
