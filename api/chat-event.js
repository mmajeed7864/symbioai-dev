import { Ratelimit } from "@upstash/ratelimit";

import {
  DEFAULT_CHAT_PROVIDER,
  MAX_REQUEST_BYTES,
  configuredChatModel,
  hashValue,
  isAllowedOrigin,
  normalizeChatProvider,
  safeSessionId,
} from "./_chat-shared.js";
import {
  getChatRedis,
  recordChatMetric,
  setChatCors,
  storeLearningEvent,
} from "./_chat-telemetry.js";

let eventLimiters;

function hasAllowedOrigin(req) {
  const origin = String(req.headers.origin || "");
  return Boolean(origin) && isAllowedOrigin(origin);
}

function requestIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getEventLimiters(redis) {
  if (!eventLimiters) {
    eventLimiters = {
      ip: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, "10 m"),
        prefix: "symbio:chat:event-ip",
        analytics: false,
      }),
      session: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, "10 m"),
        prefix: "symbio:chat:event-session",
        analytics: false,
      }),
    };
  }
  return eventLimiters;
}

export default async function handler(req, res) {
  setChatCors(req, res);

  if (!hasAllowedOrigin(req)) {
    res.status(403).json({ ok: false, error: "Origin not allowed." });
    return;
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    res.status(413).json({ ok: false, error: "Request is too large." });
    return;
  }

  const redis = getChatRedis();
  if (!redis) {
    res.status(503).json({ ok: false, error: "Assistant telemetry is unavailable." });
    return;
  }

  const question = String(req.body?.question || "").trim().slice(0, 1600);
  const answer = String(req.body?.answer || "").trim().slice(0, 1800);
  const sessionId = String(req.body?.sessionId || "");
  if (!question || !answer) {
    res.status(400).json({ ok: false, error: "Question and answer are required." });
    return;
  }

  const provider = normalizeChatProvider(
    process.env.SYMBIO_CHAT_PROVIDER || DEFAULT_CHAT_PROVIDER
  );
  const model = configuredChatModel(process.env, provider);
  try {
    const limiters = getEventLimiters(redis);
    const normalizedSession = safeSessionId(sessionId) || "invalid-session";
    const [ipLimit, sessionLimit] = await Promise.all([
      limiters.ip.limit(hashValue(requestIp(req)).slice(0, 24)),
      limiters.session.limit(hashValue(normalizedSession).slice(0, 24)),
    ]);
    if (!ipLimit.success || !sessionLimit.success) {
      const resetAt = Math.max(
        Number(ipLimit.reset) || Date.now() + 60000,
        Number(sessionLimit.reset) || Date.now() + 60000
      );
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)))
      );
      res.status(429).json({ ok: false, error: "Please wait before sending more chat events." });
      return;
    }

    const [event] = await Promise.all([
      storeLearningEvent(redis, {
        question,
        answer,
        sessionId,
        source: "deterministic",
        model,
        costKnown: true,
      }),
      recordChatMetric(redis, {
        kind: "deterministic",
        model,
      }),
    ]);
    res.status(200).json({ ok: true, messageId: event?.id || "" });
  } catch {
    res.status(503).json({ ok: false, error: "Assistant telemetry is unavailable." });
  }
}
