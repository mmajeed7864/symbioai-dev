import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CACHE_SECONDS = 15 * 60;
const DEFAULT_DAILY_LIMIT = 75;

let redisState;

function getRedisState() {
  if (redisState !== undefined) return redisState;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.SYMBIO_REDIS_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.SYMBIO_REDIS_REST_TOKEN;

  if (!url || !token) {
    redisState = null;
    return redisState;
  }

  const redis = new Redis({ url, token });
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
  if (origin && !isAllowedOrigin(origin)) {
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
      res.status(200).json({ ok: true, reply: cached, source: "cache" });
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
    res.status(502).json({ ok: false, error: "The assistant could not answer right now." });
    return;
  }

  const payload = await providerResponse.json().catch(() => null);
  if (!providerResponse.ok) {
    console.warn("[symbio-chat] provider request failed", {
      model,
      status: providerResponse.status,
    });
    res.status(502).json({ ok: false, error: "The assistant could not answer right now." });
    return;
  }

  const reply = cleanModelReply(responseText(payload));
  if (!reply) {
    res.status(502).json({ ok: false, error: "The assistant returned an empty answer." });
    return;
  }

  try {
    await state.redis.set(answerKey, reply, { ex: CACHE_SECONDS });
  } catch {
    // A cache failure must not hide a valid provider answer.
  }

  console.info("[symbio-chat] answer generated", {
    model,
    promptTokens: payload?.usage?.prompt_tokens || null,
    completionTokens: payload?.usage?.completion_tokens || null,
    costUsd: Number(payload?.usage?.cost) || null,
    remainingToday: daily.remaining,
  });

  res.status(200).json({ ok: true, reply, source: "model" });
}
