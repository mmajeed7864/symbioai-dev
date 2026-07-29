import { Ratelimit } from "@upstash/ratelimit";

import {
  CHAT_PROMPT_VERSION,
  DEFAULT_CHAT_PROVIDER,
  DEFAULT_CHAT_MODEL,
  MAX_REQUEST_BYTES,
  buildChatProviderBody,
  cacheKeyForMessages,
  cleanModelReply,
  configuredChatModel,
  containsSensitiveInput,
  hashValue,
  isAllowedOrigin,
  isBusinessConversation,
  normalizeChatProvider,
  normalizeMessages,
  safeSessionId,
  sensitiveTypesInText,
  scrubSensitiveMessages,
} from "./_chat-shared.js";
import {
  getChatRedis,
  markBudgetReservationDispatched,
  normalizeProviderUsage,
  recordChatMetric,
  reserveMonthlyBudget,
  settleMonthlyBudget,
  storeLearningEvent,
} from "./_chat-telemetry.js";

const PROVIDER_URLS = Object.freeze({
  deepseek: "https://api.deepseek.com/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
});
const CACHE_SECONDS = 15 * 60;
const DEFAULT_DAILY_LIMIT = 75;
const TELEMETRY_WAIT_MS = 400;
const OUT_OF_SCOPE_REPLY =
  "I can help with Symbio AI services and practical business improvements such as websites, booking, chatbots, voice agents, apps, dashboards, leads, and workflow automation. What are you trying to improve in your business?";
const BUDGET_FALLBACK_REPLY =
  "Live AI answers are temporarily paused, but you can still use Free scan or Talk to a founder and share the business problem you want solved. We will point you toward the smallest useful option.";

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
  const count = await redis.eval(
    `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return count
`,
    [key],
    ["172800"]
  );
  const limit = positiveInteger(process.env.SYMBIO_CHAT_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
  const normalizedCount = Number(count) || 0;
  return {
    success: normalizedCount <= limit,
    remaining: Math.max(0, limit - normalizedCount),
  };
}

async function bestEffortTelemetry(label, task, waitMs = TELEMETRY_WAIT_MS) {
  let timeout;
  const handled = Promise.resolve()
    .then(task)
    .then((value) => ({ ok: true, value }))
    .catch((error) => {
      console.warn(`[symbio-chat] ${label} dropped`, {
        error: String(error?.message || error || "unknown").slice(0, 160),
      });
      return { ok: false, value: null };
    });
  const timedOut = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ ok: false, value: null, timedOut: true }), waitMs);
  });
  const result = await Promise.race([handled, timedOut]);
  clearTimeout(timeout);
  if (result.timedOut) {
    console.warn(`[symbio-chat] ${label} exceeded ${waitMs}ms`);
  }
  return result.value;
}

function providerApiKey(provider) {
  return provider === "deepseek"
    ? process.env.DEEPSEEK_API_KEY
    : process.env.OPENROUTER_CHAT_API_KEY;
}

async function fetchProvider(provider, body, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  const openRouterHeaders =
    provider === "openrouter"
      ? {
          "HTTP-Referer": "https://symbioai.dev",
          "X-Title": "Symbio AI Website Assistant",
        }
      : {};
  try {
    return await fetch(PROVIDER_URLS[provider], {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...openRouterHeaders,
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
  return bestEffortTelemetry("provider error telemetry", () =>
    recordChatMetric(state.redis, {
      kind: "providerError",
      model,
    })
  );
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

  const provider = normalizeChatProvider(
    process.env.SYMBIO_CHAT_PROVIDER || DEFAULT_CHAT_PROVIDER
  );
  if (!provider) {
    res.status(503).json({ ok: false, error: "Assistant provider is not configured." });
    return;
  }

  const apiKey = providerApiKey(provider);
  if (!apiKey) {
    res.status(503).json({ ok: false, error: "Assistant fallback is unavailable." });
    return;
  }

  const state = getRedisState();
  if (!state) {
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }

  const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const rawLatestUserMessage = rawMessages
    .filter((message) => message?.role === "user")
    .at(-1);
  if (
    rawLatestUserMessage &&
    containsSensitiveInput([{ content: String(rawLatestUserMessage.content || "") }])
  ) {
    res.status(200).json({
      ok: true,
      reply:
        "For your privacy, I did not send that personal, contact, payment, address, or credential information to the AI assistant. Please use Free scan or Talk to a founder when you want to share details with a person. You can keep asking general business questions here without sensitive information.",
      source: "privacy",
    });
    return;
  }

  const messages = normalizeMessages(rawMessages);
  if (!messages.length) {
    res.status(400).json({ ok: false, error: "A valid user message is required." });
    return;
  }

  const modelMessages = scrubSensitiveMessages(messages);
  const residualSensitiveTypes = modelMessages.flatMap(({ content }) =>
    sensitiveTypesInText(content)
  );
  if (residualSensitiveTypes.length) {
    console.warn("[symbio-chat] model input redaction residual blocked", {
      types: [...new Set(residualSensitiveTypes)],
      contentHash: hashValue(modelMessages.map(({ content }) => content).join("|")).slice(0, 16),
    });
    res.status(200).json({
      ok: true,
      reply:
        "For your privacy, I did not send that sensitive information to the AI assistant. Please remove personal, payment, address, or credential details and ask the general business question again.",
      source: "privacy",
    });
    return;
  }

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

  const model = configuredChatModel(process.env, provider) || DEFAULT_CHAT_MODEL;

  if (!isBusinessConversation(modelMessages)) {
    const learningEvent = await bestEffortTelemetry("out-of-scope learning telemetry", async () => {
      const [event] = await Promise.all([
        storeLearningEvent(state.redis, {
          question: latestUserQuestion(modelMessages),
          answer: OUT_OF_SCOPE_REPLY,
          sessionId,
          source: "deterministic",
          model,
          costKnown: true,
        }),
        recordChatMetric(state.redis, {
          kind: "deterministic",
          model,
        }),
      ]);
      return event;
    });
    res.status(200).json({
      ok: true,
      reply: OUT_OF_SCOPE_REPLY,
      source: "deterministic",
      messageId: learningEvent?.id || "",
    });
    return;
  }

  const answerKey = cacheKeyForMessages(modelMessages);
  try {
    const cached = await state.redis.get(answerKey);
    if (typeof cached === "string" && cached) {
      const learningEvent = await bestEffortTelemetry("cache learning telemetry", async () => {
        const [event] = await Promise.all([
          storeLearningEvent(state.redis, {
            question: latestUserQuestion(modelMessages),
            answer: cached,
            sessionId,
            source: "cache",
            model,
            costKnown: true,
          }),
          recordChatMetric(state.redis, {
            kind: "cache",
            model,
          }),
        ]);
        return event;
      });
      res.status(200).json({
        ok: true,
        reply: cached,
        source: "cache",
        messageId: learningEvent?.id || "",
      });
      return;
    }
  } catch (error) {
    console.warn("[symbio-chat] cache read failed; continuing with protected model path", {
      error: String(error?.message || error || "unknown").slice(0, 160),
    });
  }

  let budgetReservation;
  try {
    budgetReservation = await reserveMonthlyBudget(state.redis);
  } catch {
    res.status(503).json({ ok: false, error: "Assistant budget protection is unavailable." });
    return;
  }

  if (!budgetReservation.success) {
    const learningEvent = await bestEffortTelemetry("budget fallback telemetry", async () => {
      const [event] = await Promise.all([
        storeLearningEvent(state.redis, {
          question: latestUserQuestion(modelMessages),
          answer: BUDGET_FALLBACK_REPLY,
          sessionId,
          source: "deterministic",
          model,
          costKnown: true,
        }),
        recordChatMetric(state.redis, {
          kind: "deterministic",
          model,
        }),
      ]);
      return event;
    });
    res.status(200).json({
      ok: true,
      reply: BUDGET_FALLBACK_REPLY,
      source: "budget",
      messageId: learningEvent?.id || "",
    });
    return;
  }

  let daily;
  try {
    daily = await takeDailyAllowance(state.redis);
  } catch {
    await bestEffortTelemetry("budget reservation release", () =>
      settleMonthlyBudget(state.redis, budgetReservation, { model })
    );
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }

  if (!daily.success) {
    await bestEffortTelemetry("budget reservation release", () =>
      settleMonthlyBudget(state.redis, budgetReservation, { model })
    );
    res.status(429).json({ ok: false, error: "The assistant reached today's usage limit." });
    return;
  }

  let providerResponse;
  try {
    const markedDispatched = await markBudgetReservationDispatched(
      state.redis,
      budgetReservation
    );
    if (!markedDispatched) throw new Error("Budget reservation expired before dispatch.");
  } catch {
    await bestEffortTelemetry("budget reservation release", () =>
      settleMonthlyBudget(state.redis, budgetReservation, { model })
    );
    res.status(503).json({ ok: false, error: "Assistant protection is unavailable." });
    return;
  }
  try {
    providerResponse = await fetchProvider(
      provider,
      buildChatProviderBody(modelMessages, { provider, model }),
      apiKey
    );
  } catch {
    await Promise.all([
      bestEffortTelemetry("conservative budget settlement", () =>
        settleMonthlyBudget(state.redis, budgetReservation, {
          actualCostMicroUsd: budgetReservation.reservationMicroUsd,
          model,
        })
      ),
      recordProviderError(state, model),
    ]);
    res.status(502).json({ ok: false, error: "The assistant could not answer right now." });
    return;
  }

  const payload = await providerResponse.json().catch(() => null);
  const usage = normalizeProviderUsage(payload, { provider, model });
  const chargedCostMicroUsd = usage.costKnown
    ? usage.costMicroUsd
    : budgetReservation.reservationMicroUsd;
  await bestEffortTelemetry("budget settlement", () =>
    settleMonthlyBudget(state.redis, budgetReservation, {
      actualCostMicroUsd: chargedCostMicroUsd,
      model,
    })
  );
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

  const usageForTelemetry = {
    ...usage,
    costMicroUsd: chargedCostMicroUsd,
  };
  const learningEvent = await bestEffortTelemetry("answer telemetry", async () => {
    const results = await Promise.all([
      state.redis.set(answerKey, reply, { ex: CACHE_SECONDS }),
      recordChatMetric(state.redis, {
        kind: "model",
        model,
        ...usageForTelemetry,
      }),
      storeLearningEvent(state.redis, {
        question: latestUserQuestion(modelMessages),
        answer: reply,
        sessionId,
        source: "model",
        model,
        promptVersion: CHAT_PROMPT_VERSION,
        ...usageForTelemetry,
      }),
    ]);
    return results[2];
  });

  console.info(
    JSON.stringify({
      level: "info",
      message: "symbio chat answer generated",
      provider,
      model,
      promptVersion: CHAT_PROMPT_VERSION,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costKnown ? usage.costUsd : null,
      chargedCostMicroUsd,
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
