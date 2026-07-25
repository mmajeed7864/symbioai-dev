import { Ratelimit } from "@upstash/ratelimit";

import {
  MAX_REQUEST_BYTES,
  hashValue,
  isAllowedOrigin,
  safeSessionId,
} from "./_chat-shared.js";
import {
  addLearningFeedback,
  getChatRedis,
  setChatCors,
} from "./_chat-telemetry.js";

let feedbackLimiters;

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

function getFeedbackLimiters(redis) {
  if (!feedbackLimiters) {
    feedbackLimiters = {
      ip: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, "10 m"),
        prefix: "symbio:chat:feedback-ip",
        analytics: false,
      }),
      session: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(12, "10 m"),
        prefix: "symbio:chat:feedback-session",
        analytics: false,
      }),
    };
  }
  return feedbackLimiters;
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
    res.status(503).json({ ok: false, error: "Feedback is unavailable." });
    return;
  }

  try {
    const limiters = getFeedbackLimiters(redis);
    const sessionId = safeSessionId(req.body?.sessionId) || "invalid-session";
    const [ipLimit, sessionLimit] = await Promise.all([
      limiters.ip.limit(hashValue(requestIp(req)).slice(0, 24)),
      limiters.session.limit(hashValue(sessionId).slice(0, 24)),
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
      res.status(429).json({ ok: false, error: "Please wait before sending more feedback." });
      return;
    }

    const result = await addLearningFeedback(redis, {
      eventId: req.body?.messageId,
      sessionId: req.body?.sessionId,
      feedback: req.body?.feedback,
      question: req.body?.question,
      answer: req.body?.answer,
      shareSample: req.body?.shareSample === true,
    });
    res.status(result.status || 200).json({
      ok: result.ok,
      feedback: result.feedback || "",
      duplicate: Boolean(result.duplicate),
      sampleAccepted: Boolean(result.sampleAccepted),
      ...(result.ok ? {} : { error: result.error || "Feedback was not saved." }),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Feedback is unavailable." });
  }
}
