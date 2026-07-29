import { randomUUID, timingSafeEqual } from "node:crypto";

import { Redis } from "@upstash/redis";

import {
  CHAT_PROMPT_VERSION,
  hashValue,
  isAllowedOrigin,
  safeSessionId,
  sensitiveTypesInText,
  scrubSensitiveMessages,
  truncateUtf8,
} from "./_chat-shared.js";

const METRIC_PREFIX = "symbio:chat:metrics";
const LEARNING_INDEX = "symbio:chat:learning:events:v2";
const NEEDS_WORK_INDEX = "symbio:chat:learning:needs-work:v2";
const LEARNING_EVENT_PREFIX = "symbio:chat:learning:event";
const LEARNING_TTL_SECONDS = 30 * 24 * 60 * 60;
const METRIC_TTL_SECONDS = 400 * 24 * 60 * 60;
const MAX_LEARNING_EVENTS = 250;
const MAX_NEEDS_WORK_EVENTS = 50;
const DEFAULT_MONTHLY_BUDGET_USD = 5;
const DEFAULT_CALL_RESERVATION_USD = 0.01;
const FEEDBACK_WINDOW_SECONDS = 24 * 60 * 60;
const BUDGET_RESERVATION_TTL_SECONDS = 5 * 60;

function retentionSecondsRemaining(createdAt, nowMs = Date.now()) {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) return 0;
  return Math.max(
    0,
    Math.ceil((createdAtMs + LEARNING_TTL_SECONDS * 1000 - nowMs) / 1000)
  );
}

const RESERVE_BUDGET_LUA = `
local expired = redis.call("ZRANGEBYSCORE", KEYS[3], "-inf", ARGV[6])
for _, reservationId in ipairs(expired) do
  local field = "reservation:" .. reservationId
  local staleAmount = tonumber(redis.call("HGET", KEYS[1], field) or "0")
  local staleStatus = redis.call("HGET", KEYS[1], "reservation-status:" .. reservationId)
  local currentReserved = tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "0")
  if staleAmount > 0 and currentReserved > 0 then
    redis.call("HINCRBY", KEYS[1], "reservedMicroUsd", -math.min(staleAmount, currentReserved))
  end
  if staleAmount > 0 and staleStatus == "dispatched" then
    redis.call("HINCRBY", KEYS[1], "spentMicroUsd", staleAmount)
  end
  redis.call("HDEL", KEYS[1], field, "reservation-status:" .. reservationId)
  redis.call("ZREM", KEYS[3], reservationId)
end
local spentValue = redis.call("HGET", KEYS[1], "spentMicroUsd")
local spent = tonumber(spentValue or redis.call("HGET", KEYS[2], "costMicroUsd") or "0")
local reserved = tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "0")
local budget = tonumber(ARGV[1])
local amount = tonumber(ARGV[2])
if not spentValue and spent > 0 then
  redis.call("HSET", KEYS[1], "spentMicroUsd", spent)
end
if spent + reserved + amount > budget then
  return {0, spent, reserved}
end
redis.call("HINCRBY", KEYS[1], "reservedMicroUsd", amount)
redis.call("HSET", KEYS[1], "reservation:" .. ARGV[5], amount)
redis.call("HSET", KEYS[1], "reservation-status:" .. ARGV[5], "reserved")
redis.call("ZADD", KEYS[3], ARGV[7], ARGV[5])
redis.call("HSET", KEYS[1], "budgetMicroUsd", budget, "lastUpdated", ARGV[3])
redis.call("EXPIRE", KEYS[1], ARGV[4])
redis.call("EXPIRE", KEYS[3], ARGV[4])
return {1, spent, reserved + amount}
`;

const SETTLE_BUDGET_LUA = `
local field = "reservation:" .. ARGV[1]
local reservationAmount = tonumber(redis.call("HGET", KEYS[1], field) or "0")
local reserved = tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "0")
if reservationAmount <= 0 then
  local spent = tonumber(redis.call("HGET", KEYS[1], "spentMicroUsd") or "0")
  return {spent, reserved, 0}
end
local release = math.min(reserved, reservationAmount)
local actual = tonumber(ARGV[2])
if release > 0 then
  redis.call("HINCRBY", KEYS[1], "reservedMicroUsd", -release)
end
redis.call("HDEL", KEYS[1], field, "reservation-status:" .. ARGV[1])
redis.call("ZREM", KEYS[2], ARGV[1])
if actual > 0 then
  redis.call("HINCRBY", KEYS[1], "spentMicroUsd", actual)
end
redis.call("HSET", KEYS[1], "lastUpdated", ARGV[3], "model", ARGV[4], "lastProviderCostMicroUsd", actual)
redis.call("EXPIRE", KEYS[1], ARGV[5])
redis.call("EXPIRE", KEYS[2], ARGV[5])
local spent = tonumber(redis.call("HGET", KEYS[1], "spentMicroUsd") or "0")
local remainingReserved = tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "0")
return {spent, remainingReserved, 1}
`;

const REAP_BUDGET_RESERVATIONS_LUA = `
local expired = redis.call("ZRANGEBYSCORE", KEYS[2], "-inf", ARGV[1])
for _, reservationId in ipairs(expired) do
  local field = "reservation:" .. reservationId
  local staleAmount = tonumber(redis.call("HGET", KEYS[1], field) or "0")
  local staleStatus = redis.call("HGET", KEYS[1], "reservation-status:" .. reservationId)
  local currentReserved = tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "0")
  if staleAmount > 0 and currentReserved > 0 then
    redis.call("HINCRBY", KEYS[1], "reservedMicroUsd", -math.min(staleAmount, currentReserved))
  end
  if staleAmount > 0 and staleStatus == "dispatched" then
    redis.call("HINCRBY", KEYS[1], "spentMicroUsd", staleAmount)
  end
  redis.call("HDEL", KEYS[1], field, "reservation-status:" .. reservationId)
  redis.call("ZREM", KEYS[2], reservationId)
end
return tonumber(redis.call("HGET", KEYS[1], "reservedMicroUsd") or "0")
`;

const MARK_BUDGET_DISPATCHED_LUA = `
local field = "reservation:" .. ARGV[1]
if not redis.call("HGET", KEYS[1], field) then
  return 0
end
redis.call("HSET", KEYS[1], "reservation-status:" .. ARGV[1], "dispatched", "lastUpdated", ARGV[2])
redis.call("EXPIRE", KEYS[1], ARGV[3])
return 1
`;

const RECONCILE_BUDGET_LUA = `
local current = tonumber(redis.call("HGET", KEYS[1], "spentMicroUsd") or "0")
local observed = tonumber(ARGV[1])
if observed > current then
  redis.call("HSET", KEYS[1], "spentMicroUsd", observed)
  current = observed
end
redis.call("HSET", KEYS[1], "budgetMicroUsd", ARGV[2], "reconciledAt", ARGV[3], "lastUpdated", ARGV[3])
redis.call("EXPIRE", KEYS[1], ARGV[4])
return current
`;

let redisClient;

export function getChatRedis() {
  if (redisClient !== undefined) return redisClient;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.SYMBIO_REDIS_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.SYMBIO_REDIS_REST_TOKEN;

  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

export function metricKeysForDate(value = new Date()) {
  const iso = value.toISOString();
  return {
    day: `${METRIC_PREFIX}:day:${iso.slice(0, 10)}`,
    month: `${METRIC_PREFIX}:month:${iso.slice(0, 7)}`,
    dayLabel: iso.slice(0, 10),
    monthLabel: iso.slice(0, 7),
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function monthlyBudgetSettings({
  budgetUsd = process.env.SYMBIO_CHAT_MONTHLY_BUDGET_USD,
  reservationUsd = process.env.SYMBIO_CHAT_MAX_CALL_USD,
} = {}) {
  const normalizedBudgetUsd = positiveNumber(budgetUsd, DEFAULT_MONTHLY_BUDGET_USD);
  const normalizedReservationUsd = Math.min(
    normalizedBudgetUsd,
    positiveNumber(reservationUsd, DEFAULT_CALL_RESERVATION_USD)
  );
  return {
    budgetUsd: normalizedBudgetUsd,
    budgetMicroUsd: Math.round(normalizedBudgetUsd * 1_000_000),
    reservationUsd: normalizedReservationUsd,
    reservationMicroUsd: Math.max(1, Math.round(normalizedReservationUsd * 1_000_000)),
  };
}

export function monthlyBudgetKey(value = new Date()) {
  return `${METRIC_PREFIX}:budget:${value.toISOString().slice(0, 7)}`;
}

function monthlyBudgetReservationKey(value = new Date()) {
  return `${monthlyBudgetKey(value)}:reservations`;
}

export async function reserveMonthlyBudget(redis, { at = new Date() } = {}) {
  if (!redis) throw new Error("Chat storage is unavailable.");
  const settings = monthlyBudgetSettings();
  const key = monthlyBudgetKey(at);
  const reservationKey = monthlyBudgetReservationKey(at);
  const reservationId = randomUUID();
  const nowMs = at.getTime();
  const metricKey = metricKeysForDate(at).month;
  const result = await redis.eval(
    RESERVE_BUDGET_LUA,
    [key, metricKey, reservationKey],
    [
      String(settings.budgetMicroUsd),
      String(settings.reservationMicroUsd),
      at.toISOString(),
      String(METRIC_TTL_SECONDS),
      reservationId,
      String(nowMs),
      String(nowMs + BUDGET_RESERVATION_TTL_SECONDS * 1000),
    ]
  );
  const values = Array.isArray(result) ? result : [];
  return {
    success: Number(values[0]) === 1,
    key,
    reservationKey,
    reservationId,
    ...settings,
    spentMicroUsd: nonNegativeInteger(values[1]),
    reservedMicroUsd: nonNegativeInteger(values[2]),
  };
}

export async function settleMonthlyBudget(
  redis,
  reservation,
  { actualCostMicroUsd = 0, model = "", at = new Date() } = {}
) {
  if (
    !redis ||
    !reservation?.key ||
    !reservation?.reservationKey ||
    !reservation?.reservationId
  ) {
    return null;
  }
  const result = await redis.eval(
    SETTLE_BUDGET_LUA,
    [reservation.key, reservation.reservationKey],
    [
      reservation.reservationId,
      String(nonNegativeInteger(actualCostMicroUsd)),
      at.toISOString(),
      String(model || "").slice(0, 100),
      String(METRIC_TTL_SECONDS),
    ]
  );
  const values = Array.isArray(result) ? result : [];
  return {
    spentMicroUsd: nonNegativeInteger(values[0]),
    reservedMicroUsd: nonNegativeInteger(values[1]),
    settled: Number(values[2]) === 1,
  };
}

export async function markBudgetReservationDispatched(
  redis,
  reservation,
  { at = new Date() } = {}
) {
  if (!redis || !reservation?.key || !reservation?.reservationId) return false;
  return (
    Number(
      await redis.eval(
        MARK_BUDGET_DISPATCHED_LUA,
        [reservation.key],
        [
          reservation.reservationId,
          at.toISOString(),
          String(METRIC_TTL_SECONDS),
        ]
      )
    ) === 1
  );
}

async function reapMonthlyBudgetReservations(redis, at = new Date()) {
  if (!redis) return 0;
  return nonNegativeInteger(
    await redis.eval(
      REAP_BUDGET_RESERVATIONS_LUA,
      [monthlyBudgetKey(at), monthlyBudgetReservationKey(at)],
      [String(at.getTime())]
    )
  );
}

export async function reconcileMonthlyBudget(
  redis,
  observedCostUsd,
  { at = new Date() } = {}
) {
  if (!redis) return null;
  const observed = Number(observedCostUsd);
  if (!Number.isFinite(observed) || observed < 0) return null;
  const settings = monthlyBudgetSettings();
  const observedMicroUsd =
    observed > 0 ? Math.max(1, Math.ceil(observed * 1_000_000)) : 0;
  const spentMicroUsd = await redis.eval(
    RECONCILE_BUDGET_LUA,
    [monthlyBudgetKey(at)],
    [
      String(observedMicroUsd),
      String(settings.budgetMicroUsd),
      at.toISOString(),
      String(METRIC_TTL_SECONDS),
    ]
  );
  return {
    observedMicroUsd,
    spentMicroUsd: nonNegativeInteger(spentMicroUsd),
  };
}

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

const DEEPSEEK_PRICING_USD_PER_MILLION = Object.freeze({
  "deepseek-v4-flash": {
    promptCacheHit: 0.0028,
    promptCacheMiss: 0.14,
    completion: 0.28,
  },
  "deepseek-v4-pro": {
    promptCacheHit: 0.003625,
    promptCacheMiss: 0.435,
    completion: 0.87,
  },
});

function estimateDeepSeekCostMicroUsd(usage, model) {
  const rates = DEEPSEEK_PRICING_USD_PER_MILLION[String(model || "").trim()];
  if (!rates || !usage || typeof usage !== "object") return null;

  const hasTokenUsage = [
    "prompt_tokens",
    "completion_tokens",
    "prompt_cache_hit_tokens",
    "prompt_cache_miss_tokens",
  ].some((field) => usage[field] !== null && usage[field] !== undefined);
  if (!hasTokenUsage) return null;

  const promptTokens = nonNegativeInteger(usage.prompt_tokens);
  const completionTokens = nonNegativeInteger(usage.completion_tokens);
  const cacheHitTokens = nonNegativeInteger(usage.prompt_cache_hit_tokens);
  const reportedCacheMissTokens = nonNegativeInteger(usage.prompt_cache_miss_tokens);
  const cacheMissTokens =
    usage.prompt_cache_miss_tokens !== null &&
    usage.prompt_cache_miss_tokens !== undefined
      ? reportedCacheMissTokens
      : Math.max(0, promptTokens - cacheHitTokens);
  const estimatedMicroUsd =
    cacheHitTokens * rates.promptCacheHit +
    cacheMissTokens * rates.promptCacheMiss +
    completionTokens * rates.completion;

  return estimatedMicroUsd > 0 ? Math.max(1, Math.ceil(estimatedMicroUsd)) : 0;
}

export function normalizeProviderUsage(payload, { provider = "", model = "" } = {}) {
  const promptTokens = nonNegativeInteger(payload?.usage?.prompt_tokens);
  const completionTokens = nonNegativeInteger(payload?.usage?.completion_tokens);
  const sourceCost = payload?.usage?.cost;
  const rawCost = Number(sourceCost);
  const providerReportedCost =
    sourceCost !== null &&
    sourceCost !== undefined &&
    sourceCost !== "" &&
    Number.isFinite(rawCost) &&
    rawCost >= 0;
  const estimatedCostMicroUsd =
    !providerReportedCost && provider === "deepseek"
      ? estimateDeepSeekCostMicroUsd(payload?.usage, model)
      : null;
  const costKnown = providerReportedCost || estimatedCostMicroUsd !== null;
  const costMicroUsd = providerReportedCost
    ? rawCost > 0
      ? Math.max(1, Math.ceil(rawCost * 1_000_000))
      : 0
    : estimatedCostMicroUsd || 0;
  const costUsd = costMicroUsd / 1_000_000;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costKnown,
    costUsd,
    costMicroUsd,
    costBasis: providerReportedCost
      ? "provider-reported"
      : estimatedCostMicroUsd !== null
        ? "provider-token-estimate"
        : "conservative-reservation",
  };
}

function metricFieldForKind(kind) {
  return (
    {
      model: "modelCalls",
      cache: "cacheHits",
      deterministic: "deterministicReplies",
      providerError: "providerErrors",
      feedbackHelpful: "feedbackHelpful",
      feedbackNeedsWork: "feedbackNeedsWork",
      hermesReview: "hermesReviews",
    }[kind] || ""
  );
}

export async function recordChatMetric(
  redis,
  {
    kind,
    model = "",
    promptTokens = 0,
    completionTokens = 0,
    costMicroUsd = 0,
    costKnown = true,
    countRequest = true,
    at = new Date(),
  }
) {
  if (!redis) return;

  const keys = metricKeysForDate(at);
  const field = metricFieldForKind(kind);
  const pipeline = redis.pipeline();

  for (const key of [keys.day, keys.month]) {
    if (countRequest) pipeline.hincrby(key, "requests", 1);
    if (field) pipeline.hincrby(key, field, 1);
    if (promptTokens) pipeline.hincrby(key, "promptTokens", nonNegativeInteger(promptTokens));
    if (completionTokens) {
      pipeline.hincrby(key, "completionTokens", nonNegativeInteger(completionTokens));
    }
    if (costMicroUsd) {
      pipeline.hincrby(key, "costMicroUsd", nonNegativeInteger(costMicroUsd));
    }
    if (kind === "model" && !costKnown) pipeline.hincrby(key, "unknownCostCalls", 1);
    pipeline.hset(key, {
      lastUpdated: at.toISOString(),
      ...(model ? { model } : {}),
    });
    pipeline.expire(key, METRIC_TTL_SECONDS);
  }

  await pipeline.exec();
}

function learningEventKey(eventId) {
  return `${LEARNING_EVENT_PREFIX}:${eventId}`;
}

function safeLearningText(role, value, maxBytes) {
  const raw = String(value || "");
  if (sensitiveTypesInText(raw).length) return "[sensitive content removed]";
  const [message] = scrubSensitiveMessages([{ role, content: raw }]);
  const sanitized = truncateUtf8(
    String(message?.content || "")
      .replace(/\bhttps?:\/\/\S+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\S*/gi, "[link removed]")
      .replace(
        /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|circle|cir|way)\b\.?/gi,
        "[address removed]"
      )
      .replace(/\bmy name is\s+[a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3}\b/gi, "my name is [removed]")
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[sensitive number removed]")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    maxBytes
  );
  const residualTypes = sensitiveTypesInText(sanitized);
  if (residualTypes.length) {
    console.warn("[symbio-chat] learning redaction residual blocked", {
      types: [...new Set(residualTypes)],
      contentHash: hashValue(sanitized).slice(0, 16),
    });
    return "[sensitive content removed]";
  }
  return sanitized;
}

export function buildLearningEvent({
  question,
  answer,
  sessionId,
  source,
  model = "",
  promptTokens = 0,
  completionTokens = 0,
  costMicroUsd = 0,
  costKnown = true,
  costBasis = "",
  promptVersion = CHAT_PROMPT_VERSION,
  at = new Date(),
}) {
  const normalizedSession = safeSessionId(sessionId);
  const normalizedSource = ["model", "cache", "deterministic"].includes(source)
    ? source
    : "model";
  const safeQuestion = safeLearningText("user", question, 700);
  const safeAnswer = safeLearningText("assistant", answer, 1000);

  return {
    id: randomUUID(),
    createdAt: at.toISOString(),
    source: normalizedSource,
    model: String(model || "").slice(0, 100),
    promptVersion: String(promptVersion || "").slice(0, 40),
    sessionHash: normalizedSession ? hashValue(normalizedSession).slice(0, 32) : "",
    questionHash: hashValue(safeQuestion).slice(0, 32),
    answerHash: hashValue(safeAnswer).slice(0, 32),
    questionBytes: Buffer.byteLength(safeQuestion, "utf8"),
    answerBytes: Buffer.byteLength(safeAnswer, "utf8"),
    promptTokens: nonNegativeInteger(promptTokens),
    completionTokens: nonNegativeInteger(completionTokens),
    costMicroUsd: nonNegativeInteger(costMicroUsd),
    costKnown: Boolean(costKnown),
    pricingSnapshot: {
      basis:
        String(costBasis || "").slice(0, 40) ||
        (costKnown ? "provider-reported" : "conservative-reservation"),
      promptTokens: nonNegativeInteger(promptTokens),
      completionTokens: nonNegativeInteger(completionTokens),
      costMicroUsd: nonNegativeInteger(costMicroUsd),
      effectiveUsdPerMillionTokens:
        nonNegativeInteger(promptTokens) + nonNegativeInteger(completionTokens) > 0
          ? Number(
              (
                nonNegativeInteger(costMicroUsd) /
                (nonNegativeInteger(promptTokens) + nonNegativeInteger(completionTokens))
              ).toFixed(6)
            )
          : 0,
    },
    feedback: "",
    reviewStatus: "pending",
  };
}

export async function storeLearningEvent(redis, input) {
  if (!redis) return null;
  const event = buildLearningEvent(input);
  if (!event.questionBytes || !event.answerBytes) return null;

  const timestamp = Date.parse(event.createdAt) || Date.now();
  const cutoff = timestamp - LEARNING_TTL_SECONDS * 1000;
  const pipeline = redis.pipeline();
  pipeline.set(learningEventKey(event.id), event, { ex: LEARNING_TTL_SECONDS });
  pipeline.zadd(LEARNING_INDEX, { score: timestamp, member: event.id });
  pipeline.zremrangebyscore(LEARNING_INDEX, 0, cutoff);
  pipeline.zremrangebyrank(LEARNING_INDEX, 0, -(MAX_LEARNING_EVENTS + 1));
  pipeline.expire(LEARNING_INDEX, LEARNING_TTL_SECONDS);
  await pipeline.exec();
  return event;
}

export function normalizeFeedback(value) {
  if (value === "helpful") return "helpful";
  if (value === "needs_work") return "needs_work";
  return "";
}

export async function addLearningFeedback(
  redis,
  { eventId, sessionId, feedback, question = "", answer = "", shareSample = false }
) {
  const safeEventId = String(eventId || "").trim();
  const normalizedFeedback = normalizeFeedback(feedback);
  const normalizedSession = safeSessionId(sessionId);

  if (
    !redis ||
    !/^[a-f0-9-]{36}$/i.test(safeEventId) ||
    !normalizedSession ||
    !normalizedFeedback
  ) {
    return { ok: false, status: 400, error: "Invalid feedback request." };
  }

  const key = learningEventKey(safeEventId);
  const event = await redis.get(key);
  if (!event || typeof event !== "object") {
    return { ok: false, status: 404, error: "Chat response not found." };
  }

  const sessionHash = hashValue(normalizedSession).slice(0, 32);
  if (!event.sessionHash || event.sessionHash !== sessionHash) {
    return { ok: false, status: 403, error: "Feedback does not match this chat." };
  }

  if (event.feedback) {
    return {
      ok: true,
      status: 200,
      feedback: event.feedback,
      duplicate: true,
      sampleAccepted: Boolean(event.question && event.answer),
    };
  }

  const createdAt = Date.parse(event.createdAt);
  if (
    !Number.isFinite(createdAt) ||
    Date.now() - createdAt > FEEDBACK_WINDOW_SECONDS * 1000
  ) {
    return { ok: false, status: 410, error: "Feedback for this answer has expired." };
  }

  const lockKey = `${key}:feedback-lock`;
  const lock = await redis.set(lockKey, "1", { nx: true, ex: 300 });
  if (!lock) {
    const existing = await redis.get(key);
    if (existing?.feedback) {
      return {
        ok: true,
        status: 200,
        feedback: existing.feedback,
        duplicate: true,
        sampleAccepted: Boolean(existing.question && existing.answer),
      };
    }
    return { ok: false, status: 409, error: "Feedback is already being saved." };
  }

  const safeQuestion = safeLearningText("user", question, 700);
  const safeAnswer = safeLearningText("assistant", answer, 1000);
  const sampleMatches =
    shareSample &&
    event.source !== "deterministic" &&
    safeQuestion !== "[sensitive content removed]" &&
    safeAnswer !== "[sensitive content removed]" &&
    hashValue(safeQuestion).slice(0, 32) === event.questionHash &&
    hashValue(safeAnswer).slice(0, 32) === event.answerHash;
  const updated = {
    ...event,
    feedback: normalizedFeedback,
    feedbackAt: new Date().toISOString(),
    ...(normalizedFeedback === "needs_work" && sampleMatches
      ? {
          question: safeQuestion,
          answer: safeAnswer,
          sampleSharedAt: new Date().toISOString(),
        }
      : {}),
  };
  const pipeline = redis.pipeline();
  const remainingRetentionSeconds = retentionSecondsRemaining(event.createdAt);
  if (!remainingRetentionSeconds) {
    return { ok: false, status: 410, error: "Feedback for this answer has expired." };
  }
  pipeline.set(key, updated, { ex: remainingRetentionSeconds });
  if (normalizedFeedback === "needs_work" && sampleMatches) {
    const timestamp = Date.now();
    const cutoff = timestamp - LEARNING_TTL_SECONDS * 1000;
    pipeline.zadd(NEEDS_WORK_INDEX, { score: timestamp, member: safeEventId });
    pipeline.zremrangebyscore(NEEDS_WORK_INDEX, 0, cutoff);
    pipeline.zremrangebyrank(NEEDS_WORK_INDEX, 0, -(MAX_NEEDS_WORK_EVENTS + 1));
    pipeline.expire(NEEDS_WORK_INDEX, LEARNING_TTL_SECONDS);
  }
  await pipeline.exec();

  try {
    await recordChatMetric(redis, {
      kind: normalizedFeedback === "helpful" ? "feedbackHelpful" : "feedbackNeedsWork",
      model: event.model,
      countRequest: false,
    });
  } catch {
    // The feedback vote is already saved; aggregate telemetry may catch up later.
  }

  return {
    ok: true,
    status: 200,
    feedback: normalizedFeedback,
    duplicate: false,
    sampleAccepted: Boolean(normalizedFeedback === "needs_work" && sampleMatches),
  };
}

function numericMetric(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMetricHash(raw, period) {
  const value = raw && typeof raw === "object" ? raw : {};
  const costMicroUsd = numericMetric(value.costMicroUsd);
  return {
    period,
    requests: numericMetric(value.requests),
    modelCalls: numericMetric(value.modelCalls),
    cacheHits: numericMetric(value.cacheHits),
    deterministicReplies: numericMetric(value.deterministicReplies),
    providerErrors: numericMetric(value.providerErrors),
    promptTokens: numericMetric(value.promptTokens),
    completionTokens: numericMetric(value.completionTokens),
    totalTokens:
      numericMetric(value.promptTokens) + numericMetric(value.completionTokens),
    costMicroUsd,
    costUsd: costMicroUsd / 1_000_000,
    unknownCostCalls: numericMetric(value.unknownCostCalls),
    feedbackHelpful: numericMetric(value.feedbackHelpful),
    feedbackNeedsWork: numericMetric(value.feedbackNeedsWork),
    hermesReviews: numericMetric(value.hermesReviews),
    model: String(value.model || ""),
    lastUpdated: String(value.lastUpdated || ""),
  };
}

async function learningEventsForIds(redis, ids) {
  const events = await Promise.all(
    ids.map(async (id) => {
      const value = await redis.get(learningEventKey(id));
      return value && typeof value === "object" ? value : null;
    })
  );
  return events.filter(Boolean);
}

export async function getChatMetrics(redis, { now = new Date(), recentLimit = 8 } = {}) {
  if (!redis) throw new Error("Chat storage is unavailable.");
  await reapMonthlyBudgetReservations(redis, now);
  const keys = metricKeysForDate(now);
  const budgetKey = monthlyBudgetKey(now);
  const budgetSettings = monthlyBudgetSettings();
  const safeLimit = Math.max(1, Math.min(nonNegativeInteger(recentLimit) || 8, 20));
  const cutoff = now.getTime() - LEARNING_TTL_SECONDS * 1000;

  await Promise.all([
    redis.zremrangebyscore(LEARNING_INDEX, 0, cutoff),
    redis.zremrangebyscore(NEEDS_WORK_INDEX, 0, cutoff),
  ]);

  const [dayRaw, monthRaw, budgetRaw, learningCount, needsWorkCount, needsWorkIds] =
    await Promise.all([
      redis.hgetall(keys.day),
      redis.hgetall(keys.month),
      redis.hgetall(budgetKey),
      redis.zcard(LEARNING_INDEX),
      redis.zcard(NEEDS_WORK_INDEX),
      redis.zrange(NEEDS_WORK_INDEX, 0, safeLimit - 1, { rev: true }),
    ]);
  const needsWorkEvents = await learningEventsForIds(redis, needsWorkIds || []);
  const today = normalizeMetricHash(dayRaw, keys.dayLabel);
  const month = normalizeMetricHash(monthRaw, keys.monthLabel);
  const hasBudgetLedger =
    budgetRaw &&
    typeof budgetRaw === "object" &&
    Object.keys(budgetRaw).length > 0;
  const budgetSpentMicroUsd = hasBudgetLedger
    ? numericMetric(budgetRaw?.spentMicroUsd)
    : month.costMicroUsd;
  const budgetReservedMicroUsd = numericMetric(budgetRaw?.reservedMicroUsd);
  if (hasBudgetLedger) {
    month.costMicroUsd = budgetSpentMicroUsd;
    month.costUsd = budgetSpentMicroUsd / 1_000_000;
  }
  month.reservedMicroUsd = budgetReservedMicroUsd;
  month.reservedUsd = budgetReservedMicroUsd / 1_000_000;
  month.committedCostUsd =
    (budgetSpentMicroUsd + budgetReservedMicroUsd) / 1_000_000;
  month.budgetUsd = budgetSettings.budgetUsd;
  month.budgetEnforced = true;

  return {
    today,
    month,
    learning: {
      storedEvents: numericMetric(learningCount),
      needsWorkQueued: numericMetric(needsWorkCount),
      retentionDays: 30,
      recentNeedsWork: needsWorkEvents.map((event) => ({
        id: event.id,
        createdAt: event.createdAt,
        source: event.source,
        model: event.model,
        question: String(event.question || ""),
        answer: String(event.answer || ""),
        feedback: event.feedback,
        reviewStatus: event.reviewStatus,
        costUsd: numericMetric(event.costMicroUsd) / 1_000_000,
      })),
    },
  };
}

export async function markLearningEventsReviewed(redis, eventIds, reviewId = "") {
  if (!redis || !Array.isArray(eventIds)) return 0;
  const safeIds = [...new Set(eventIds)]
    .map((value) => String(value || "").trim())
    .filter((value) => /^[a-f0-9-]{36}$/i.test(value))
    .slice(0, 20);
  if (!safeIds.length) return 0;

  const events = await learningEventsForIds(redis, safeIds);
  const pipeline = redis.pipeline();
  let updatedCount = 0;
  let operationCount = 0;
  const now = Date.now();
  for (const event of events) {
    const remainingRetentionSeconds = retentionSecondsRemaining(event.createdAt, now);
    if (!remainingRetentionSeconds) {
      pipeline.zrem(NEEDS_WORK_INDEX, event.id);
      operationCount += 1;
      continue;
    }
    pipeline.set(
      learningEventKey(event.id),
      {
        ...event,
        reviewStatus: "reviewed",
        reviewedAt: new Date().toISOString(),
        reviewId: String(reviewId || "").slice(0, 80),
      },
      { ex: remainingRetentionSeconds }
    );
    pipeline.zrem(NEEDS_WORK_INDEX, event.id);
    updatedCount += 1;
    operationCount += 2;
  }
  if (operationCount) await pipeline.exec();
  return updatedCount;
}

export function isMetricsAuthorized(headerValue, expectedSecret) {
  const presented = String(headerValue || "").replace(/^Bearer\s+/i, "");
  const expected = String(expectedSecret || "");
  if (!presented || !expected) return false;
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function setChatCors(req, res, methods = "POST, OPTIONS") {
  const origin = req.headers.origin || "";
  if (origin && isAllowedOrigin(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
}
