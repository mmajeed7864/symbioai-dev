import { Ratelimit } from "@upstash/ratelimit";

import {
  DEFAULT_CHAT_MODEL,
  MAX_REQUEST_BYTES,
  buildOpenRouterBody,
  cacheKeyForMessages,
  cleanModelReply,
  containsSensitiveInput,
  hashValue,
  isAllowedOrigin,
  normalizeMessages,
  safeSessionId,
  scrubSensitiveMessages,
} from "./_chat-shared.js";
import {
  getChatRedis,
  normalizeProviderUsage,
  recordChatMetric,
  storeLearningEvent,
} from "./_chat-telemetry.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CACHE_SECONDS = 15 * 60;
const DEFAULT_DAILY_LIMIT = 75;

let redisState;

function getRedisState() {
  if (redisState !== undefined) return redisState;

  const redis = getChatRedis();
  if (!redis) {
    redisState = null;
    return redisState;
  }

  redisState = {
    redis,
    ipLimiter: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "10 m"),
      prefix: "symbio:chat:ip",
      analytics: false,
    }),
    sessionLimiter: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(8, "10 m"),
      prefix: "symbio:chat:session",
      analytics: false,
    }),
  };
  return redisState;
}

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Origin");
}

function requestIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function dailyKey() {
  return `symbio:chat:daily:${new Date().toISOString().slice(0, 10)}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function takeDailyAllowance(redis) {
  const key = dailyKey();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 172800);
  const limit = positiveInteger(process.env.SYMBIO_CHAT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
  return { success: count <= limit, remaining: Math.max(0, limit - count) };
}

async function fetchOpenRouter(body, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    return await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://symbioai.dev",
        "X-Title": "Symbio AI Website Assistant",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
}

function latestUserQuestion(messages) {
  return (
    [...messages]
      .reverse()
      .find(({ role }) => role === "user")
      ?.content?.trim() || ""
  );
}

async function recordProviderError(state, model) {
  try {
    await recordChatMetric(state.redis, {
      kind: "providerError",
      model,
    });
  } catch {
    // Telemetry must never replace the customer-facing error response.
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const origin = req.headers.origin || "";
  if (!origin || !isAllowedOrigin(origin)) {
    res.status(403).json({ ok: false, error: "Origin not allowed." });
    return;
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    res.status(413).json({ ok: false, error: "Request is too large." });
    return;
  }

  if (process.env.SYMBIO_CHAT_ENABLED !== "1") {
    res.status(503).json({ ok: false, error: "Assistant fallback is unavailable." });
    return;
  }

  const apiKey = process.env.OPENROUTER_CHAT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ ok: false, error: "Assistant fallback is unavailable." });
    return;
  }

  const state = getRedisState();
  if (!state) {
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }

  const messages = normalizeMessages(req.body?.messages);
  if (!messages.length) {
    res.status(400).json({ ok: false, error: "A valid user message is required." });
    return;
  }

  if (containsSensitiveInput([messages.at(-1)])) {
    res.status(200).json({
      ok: true,
      reply:
        "For your privacy, I did not send that email address or phone number to the AI assistant. Please use Free scan or Talk to a founder when you want to share contact details. You can keep asking general business questions here without personal contact information.",
      source: "privacy",
    });
    return;
  }

  const modelMessages = scrubSensitiveMessages(messages);

  const ipId = hashValue(requestIp(req)).slice(0, 24);
  const sessionId =
    safeSessionId(req.body?.sessionId) ||
    hashValue(`${ipId}:${req.headers["user-agent"] || "unknown"}`).slice(0, 24);

  let ipLimit;
  let sessionLimit;
  try {
    [ipLimit, sessionLimit] = await Promise.all([
      state.ipLimiter.limit(ipId),
      state.sessionLimiter.limit(sessionId),
    ]);
  } catch {
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }

  if (!ipLimit.success || !sessionLimit.success) {
    const resetAt = Math.max(
      Number(ipLimit.reset) || Date.now() + 60000,
      Number(sessionLimit.reset) || Date.now() + 60000
    );
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
    res.status(429).json({ ok: false, error: "Please wait before asking another question." });
    return;
  }

  const answerKey = cacheKeyForMessages(modelMessages);
  try {
    const cached = await state.redis.get(answerKey);
    if (typeof cached === "string" && cached) {
      let learningEvent = null;
      try {
        [learningEvent] = await Promise.all([
          storeLearningEvent(state.redis, {
            question: latestUserQuestion(modelMessages),
            answer: cached,
            sessionId,
            source: "cache",
            model: String(process.env.OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL).trim(),
            costKnown: true,
          }),
          recordChatMetric(state.redis, {
            kind: "cache",
            model: String(process.env.OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL).trim(),
          }),
        ]);
      } catch {
        // A telemetry failure must not hide a valid cached answer.
      }
      res.status(200).json({
        ok: true,
        reply: cached,
        source: "cache",
        messageId: learningEvent?.id || "",
      });
      return;
    }
  } catch {
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }

  let daily;
  try {
    daily = await takeDailyAllowance(state.redis);
  } catch {
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }

  if (!daily.success) {
    res.status(429).json({ ok: false, error: "The assistant reached today's usage limit." });
    return;
  }

  const model = String(process.env.OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL).trim();
  let providerResponse;
  try {
    providerResponse = await fetchOpenRouter(buildOpenRouterBody(modelMessages, model), apiKey);
  } catch {
    await recordProviderError(state, model);
    res.status(502).json({ ok: false, error: "The assistant could not answer right now." });
    return;
  }

  const payload = await providerResponse.json().catch(() => null);
  if (!providerResponse.ok) {
    console.warn("[symbio-chat] provider request failed", {
      model,
      status: providerResponse.status,
    });
    await recordProviderError(state, model);
    res.status(502).json({ ok: false, error: "The assistant could not answer right now." });
    return;
  }

  const reply = cleanModelReply(responseText(payload));
  if (!reply) {
    await recordProviderError(state, model);
    res.status(502).json({ ok: false, error: "The assistant returned an empty answer." });
    return;
  }

  const usage = normalizeProviderUsage(payload);
  let learningEvent = null;
  try {
    const results = await Promise.all([
      state.redis.set(answerKey, reply, { ex: CACHE_SECONDS }),
      recordChatMetric(state.redis, {
        kind: "model",
        model,
        ...usage,
      }),
      storeLearningEvent(state.redis, {
        question: latestUserQuestion(modelMessages),
        answer: reply,
        sessionId,
        source: "model",
        model,
        ...usage,
      }),
    ]);
    learningEvent = results[2];
  } catch {
    // Cache and telemetry failures must not hide a valid provider answer.
  }

  console.info(
    JSON.stringify({
      level: "info",
      message: "symbio chat answer generated",
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costKnown ? usage.costUsd : null,
      remainingToday: daily.remaining,
    })
  );

  res.status(200).json({
    ok: true,
    reply,
    source: "model",
    messageId: learningEvent?.id || "",
  });
}
