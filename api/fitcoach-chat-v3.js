import { Ratelimit } from "@upstash/ratelimit";
import {
  getChatRedis,
  markBudgetReservationDispatched,
  normalizeProviderUsage,
  reserveMonthlyBudget,
  settleMonthlyBudget,
} from "./_chat-telemetry.js";
import {
  FITCOACH_RENDERER_VERSION,
  createProviderRoutes,
  deterministicTrainerReply,
  generateCoachReply,
  parseCoachRequest,
  safeCoachSessionId,
} from "./_fitcoach-coach-v3.js";
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
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const MAX_BODY_BYTES = 24_000;
const NUTRITION_ACTIONS = new Set(["barcode_lookup", "text_search", "vision_estimate"]);
let protectionState;

function getProtection() {
  if (protectionState !== undefined) return protectionState;
  const redis = getChatRedis();
  protectionState = redis
    ? {
        redis,
        ip: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(45, "10 m"),
          prefix: "fitcoach:v3:ip",
          analytics: false,
        }),
        session: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(36, "10 m"),
          prefix: "fitcoach:v3:session",
          analytics: false,
        }),
      }
    : null;
  return protectionState;
}

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

function buildLabel(req) {
  return String(req.headers["x-fitcoach-build"] || "unknown")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
}

function resultBody(request, result, req) {
  return {
    ...result,
    approved_action: request.context.approved_action,
    style: request.style,
    response_depth: request.responseDepth,
    safety_intercepted: false,
    speak_allowed: true,
    renderer_version: FITCOACH_RENDERER_VERSION,
    build: buildLabel(req),
  };
}

function localBudgetReply(request, req, reason) {
  return resultBody(request, {
    ok: true,
    reply: deterministicTrainerReply(request, reason),
    provider: "deterministic-copy",
    model: FITCOACH_RENDERER_VERSION,
    usage: null,
    fallback_used: true,
    fallback_reason: reason,
    attempts: 0,
    request_hash: null,
  }, req);
}

async function settleSafely(redis, reservation, options) {
  try {
    await settleMonthlyBudget(redis, reservation, options);
  } catch (error) {
    console.warn("[fitcoach-chat-v3] budget settlement failed", {
      error_code: String(error?.message || "unknown").slice(0, 80),
    });
  }
}

function nutritionStatusForError(error) {
  if (error === "FOOD_NOT_FOUND") return 404;
  if (error === "VISION_PROVIDER_NOT_CONFIGURED") return 503;
  if (error === "NUTRITION_PROVIDER_UNAVAILABLE") return 502;
  return 400;
}

async function enforceProtection(req, res, protection, sessionId) {
  if (!protection) {
    res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
    return false;
  }
  try {
    const [ipLimit, sessionLimit] = await Promise.all([
      protection.ip.limit(ipFor(req)),
      protection.session.limit(sessionId),
    ]);
    if (!ipLimit.success || !sessionLimit.success) {
      res.status(429).json({ ok: false, error: "RATE_LIMITED" });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
    return false;
  }
}

async function handleNutritionRequest(req, res) {
  const parsed = parseNutritionRequest(req.body);
  if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });

  const protection = getProtection();
  if (!(await enforceProtection(req, res, protection, safeNutritionSessionId(req.body?.session_id)))) return undefined;

  let result;
  if (parsed.request.action === "barcode_lookup") {
    result = await lookupBarcodeNutrition(parsed.request.barcode);
  } else if (parsed.request.action === "text_search") {
    result = await searchNutritionFoods(parsed.request.query);
  } else {
    result = unavailableVisionNutritionEstimate();
  }

  if (!result.ok) {
    return res.status(nutritionStatusForError(result.error)).json({
      ok: false,
      error: result.error,
      detail: result.detail,
      nutrition_version: FITCOACH_NUTRITION_VERSION,
    });
  }
  return res.status(200).json({
    ok: true,
    action: parsed.request.action,
    provider: "open_food_facts",
    nutrition_version: FITCOACH_NUTRITION_VERSION,
    food: result.food || null,
    foods: result.foods || [],
    build: buildLabel(req),
  });
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
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
  }

  if (NUTRITION_ACTIONS.has(String(req.body?.action || ""))) {
    return handleNutritionRequest(req, res);
  }

  const parsed = parseCoachRequest(req.body);
  if (!parsed.ok) {
    return res.status(parsed.status).json({ ok: false, error: parsed.error });
  }
  if (parsed.intercepted) {
    return res.status(200).json({
      ok: true,
      reply: parsed.reply,
      approved_action: null,
      provider: "deterministic-safety",
      model: "none",
      style: parsed.request.style,
      response_depth: parsed.request.responseDepth,
      disposition: parsed.disposition,
      safety_intercepted: true,
      speak_allowed: false,
      fallback_used: false,
      attempts: 0,
      renderer_version: FITCOACH_RENDERER_VERSION,
      build: buildLabel(req),
    });
  }

  const protection = getProtection();
  if (!(await enforceProtection(req, res, protection, safeCoachSessionId(req.body?.session_id)))) return undefined;

  const externalRoutes = createProviderRoutes();
  if (!externalRoutes.length) {
    return res.status(200).json(localBudgetReply(parsed.request, req, "provider_not_configured"));
  }

  let reservation;
  try {
    reservation = await reserveMonthlyBudget(protection.redis);
  } catch {
    return res.status(200).json(localBudgetReply(parsed.request, req, "budget_protection_unavailable"));
  }
  if (!reservation.success) {
    return res.status(200).json(localBudgetReply(parsed.request, req, "monthly_budget_reached"));
  }
  try {
    const dispatched = await markBudgetReservationDispatched(protection.redis, reservation);
    if (!dispatched) {
      await settleSafely(protection.redis, reservation, { model: "not-dispatched" });
      return res.status(200).json(localBudgetReply(parsed.request, req, "budget_dispatch_expired"));
    }
  } catch {
    await settleSafely(protection.redis, reservation, { model: "not-dispatched" });
    return res.status(200).json(localBudgetReply(parsed.request, req, "budget_protection_unavailable"));
  }

  let result;
  try {
    result = await generateCoachReply(parsed.request, {
      onAttempt(event) {
        // Metadata only: never prompts, replies, sessions, profiles, or chat text.
        console.info("[fitcoach-chat-v3] provider attempt", event);
      },
    });
  } catch {
    await settleSafely(protection.redis, reservation, {
      actualCostMicroUsd: reservation.reservationMicroUsd,
      model: "provider-error",
    });
    return res.status(200).json(localBudgetReply(parsed.request, req, "provider_error"));
  }

  const usage = normalizeProviderUsage(
    { usage: result.usage || {} },
    { provider: result.provider, model: result.model }
  );
  const chargedCostMicroUsd = result.provider === "deterministic-copy" || !usage.costKnown
    ? reservation.reservationMicroUsd
    : usage.costMicroUsd;
  await settleSafely(protection.redis, reservation, {
    actualCostMicroUsd: chargedCostMicroUsd,
    model: result.model,
  });

  return res.status(200).json(resultBody(parsed.request, result, req));
}
