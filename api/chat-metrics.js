import {
  getChatMetrics,
  getChatRedis,
  isMetricsAuthorized,
  markLearningEventsReviewed,
  recordChatMetric,
} from "./_chat-telemetry.js";

function setHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Authorization");
}

function budgetUsd() {
  const parsed = Number(process.env.SYMBIO_CHAT_MONTHLY_BUDGET_USD || 5);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function authorized(req) {
  return isMetricsAuthorized(
    req.headers.authorization,
    process.env.SYMBIO_COMMAND_CENTER_TOKEN
  );
}

export default async function handler(req, res) {
  setHeaders(res);

  if (!process.env.SYMBIO_COMMAND_CENTER_TOKEN) {
    res.status(503).json({ ok: false, error: "Metrics access is not configured." });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized." });
    return;
  }

  const redis = getChatRedis();
  if (!redis) {
    res.status(503).json({ ok: false, error: "Chat storage is unavailable." });
    return;
  }

  if (req.method === "POST") {
    if (req.body?.action !== "mark-reviewed") {
      res.status(400).json({ ok: false, error: "Unknown metrics action." });
      return;
    }
    try {
      const reviewed = await markLearningEventsReviewed(
        redis,
        req.body?.eventIds,
        req.body?.reviewId
      );
      if (reviewed) {
        await recordChatMetric(redis, {
          kind: "hermesReview",
          countRequest: false,
        });
      }
      res.status(200).json({ ok: true, reviewed });
    } catch {
      res.status(503).json({ ok: false, error: "Review status could not be saved." });
    }
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const metrics = await getChatMetrics(redis);
    const cap = budgetUsd();
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      model: metrics.month.model || metrics.today.model || "",
      budgetUsd: cap,
      budgetPercent: cap ? Math.min(100, (metrics.month.costUsd / cap) * 100) : 0,
      ...metrics,
    });
  } catch {
    res.status(503).json({ ok: false, error: "Metrics are temporarily unavailable." });
  }
}
