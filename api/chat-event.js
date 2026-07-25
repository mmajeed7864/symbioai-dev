import { DEFAULT_CHAT_MODEL, MAX_REQUEST_BYTES, isAllowedOrigin } from "./_chat-shared.js";
import {
  getChatRedis,
  recordChatMetric,
  setChatCors,
  storeLearningEvent,
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

  const model = String(process.env.OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL).trim();
  try {
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
