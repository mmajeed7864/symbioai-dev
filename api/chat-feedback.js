import { MAX_REQUEST_BYTES, isAllowedOrigin } from "./_chat-shared.js";
import {
  addLearningFeedback,
  getChatRedis,
  setChatCors,
} from "./_chat-telemetry.js";

function hasAllowedOrigin(req) {
  const origin = String(req.headers.origin || "");
  return Boolean(origin) && isAllowedOrigin(origin);
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
      ...(result.ok ? {} : { error: result.error || "Feedback was not saved." }),
    });
  } catch {
    res.status(503).json({ ok: false, error: "Feedback is unavailable." });
  }
}
