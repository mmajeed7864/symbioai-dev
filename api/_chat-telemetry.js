import { randomUUID, timingSafeEqual } from "node:crypto";

import { Redis } from "@upstash/redis";

import {
  hashValue,
  isAllowedOrigin,
  safeSessionId,
  scrubSensitiveMessages,
  truncateUtf8,
} from "./_chat-shared.js";

const METRIC_PREFIX = "symbio:chat:metrics";
const LEARNING_INDEX = "symbio:chat:learning:events";
const NEEDS_WORK_INDEX = "symbio:chat:learning:needs-work";
const LEARNING_EVENT_PREFIX = "symbio:chat:learning:event";
const LEARNING_TTL_SECONDS = 30 * 24 * 60 * 60;
const METRIC_TTL_SECONDS = 400 * 24 * 60 * 60;
const MAX_LEARNING_EVENTS = 250;
const MAX_NEEDS_WORK_EVENTS = 50;

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

function nonNegativeInteger(value) {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizeProviderUsage(payload) {
  const promptTokens = nonNegativeInteger(payload?.usage?.prompt_tokens);
  const completionTokens = nonNegativeInteger(payload?.usage?.completion_tokens);
  const rawCost = Number(payload?.usage?.cost);
  const costKnown = Number.isFinite(rawCost) && rawCost >= 0;
  const costUsd = costKnown ? rawCost : 0;

  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    costKnown,
    costUsd,
    costMicroUsd: Math.round(costUsd * 1_000_000),
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
  const [message] = scrubSensitiveMessages([{ role, content: String(value || "") }]);
  return truncateUtf8(
    String(message?.content || "")
      .replace(/\bhttps?:\/\/\S+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\S*/gi, "[link removed]")
      .replace(
        /\b\d{1,6}\s+(?:[a-z0-9.'-]+\s+){0,5}(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct|circle|cir|way)\b\.?/gi,
        "[address removed]"
      )
      .replace(/\bmy name is\s+[a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*){0,3}\b/gi, "my name is [removed]")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    maxBytes
  );
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
    sessionHash: normalizedSession ? hashValue(normalizedSession).slice(0, 32) : "",
    questionHash: hashValue(safeQuestion).slice(0, 32),
    answerHash: hashValue(safeAnswer).slice(0, 32),
    questionBytes: Buffer.byteLength(safeQuestion, "utf8"),
    answerBytes: Buffer.byteLength(safeAnswer, "utf8"),
    promptTokens: nonNegativeInteger(promptTokens),
    completionTokens: nonNegativeInteger(completionTokens),
    costMicroUsd: nonNegativeInteger(costMicroUsd),
    costKnown: Boolean(costKnown),
    feedback: "",
    reviewStatus: "pending",
  };
}

export async function storeLearningEvent(redis, input) {
  if (!redis) return null;
  const event = buildLearningEvent(input);
  if (!event.questionBytes || !event.answerBytes) return null;

  const pipeline = redis.pipeline();
  pipeline.set(learningEventKey(event.id), event, { ex: LEARNING_TTL_SECONDS });
  pipeline.lpush(LEARNING_INDEX, event.id);
  pipeline.ltrim(LEARNING_INDEX, 0, MAX_LEARNING_EVENTS - 1);
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
    return { ok: true, status: 200, feedback: event.feedback, duplicate: true };
  }

  const updated = {
    ...event,
    feedback: normalizedFeedback,
    feedbackAt: new Date().toISOString(),
    ...(normalizedFeedback === "needs_work" && shareSample
      ? {
          question: safeLearningText("user", question, 700),
          answer: safeLearningText("assistant", answer, 1000),
          sampleSharedAt: new Date().toISOString(),
        }
      : {}),
  };
  const pipeline = redis.pipeline();
  pipeline.set(key, updated, { ex: LEARNING_TTL_SECONDS });
  if (normalizedFeedback === "needs_work") {
    pipeline.lpush(NEEDS_WORK_INDEX, safeEventId);
    pipeline.ltrim(NEEDS_WORK_INDEX, 0, MAX_NEEDS_WORK_EVENTS - 1);
    pipeline.expire(NEEDS_WORK_INDEX, LEARNING_TTL_SECONDS);
  }
  await pipeline.exec();

  await recordChatMetric(redis, {
    kind: normalizedFeedback === "helpful" ? "feedbackHelpful" : "feedbackNeedsWork",
    model: event.model,
    countRequest: false,
  });

  return { ok: true, status: 200, feedback: normalizedFeedback, duplicate: false };
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
  const keys = metricKeysForDate(now);
  const safeLimit = Math.max(1, Math.min(nonNegativeInteger(recentLimit) || 8, 20));

  const [dayRaw, monthRaw, learningCount, needsWorkCount, needsWorkIds] = await Promise.all([
    redis.hgetall(keys.day),
    redis.hgetall(keys.month),
    redis.llen(LEARNING_INDEX),
    redis.llen(NEEDS_WORK_INDEX),
    redis.lrange(NEEDS_WORK_INDEX, 0, safeLimit - 1),
  ]);
  const needsWorkEvents = await learningEventsForIds(redis, needsWorkIds || []);

  return {
    today: normalizeMetricHash(dayRaw, keys.dayLabel),
    month: normalizeMetricHash(monthRaw, keys.monthLabel),
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
  for (const event of events) {
    pipeline.set(
      learningEventKey(event.id),
      {
        ...event,
        reviewStatus: "reviewed",
        reviewedAt: new Date().toISOString(),
        reviewId: String(reviewId || "").slice(0, 80),
      },
      { ex: LEARNING_TTL_SECONDS }
    );
    pipeline.lrem(NEEDS_WORK_INDEX, 0, event.id);
    updatedCount += 1;
  }
  if (updatedCount) await pipeline.exec();
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
