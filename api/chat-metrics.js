import { Ratelimit } from "@upstash/ratelimit";

import {
  DEFAULT_CHAT_PROVIDER,
  hashValue,
  normalizeChatProvider,
} from "./_chat-shared.js";
import {
  getChatMetrics,
  getChatRedis,
  isMetricsAuthorized,
  markLearningEventsReviewed,
  metricKeysForDate,
  monthlyBudgetSettings,
  reconcileMonthlyBudget,
  recordChatMetric,
} from "./_chat-telemetry.js";

let metricsLimiter;
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const PROVIDER_USAGE_CACHE_PREFIX = "symbio:chat:provider-key-usage:v2";

function setHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Vary", "Authorization");
}

function getMetricsLimiter(redis) {
  if (!metricsLimiter) {
    metricsLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      prefix: "symbio:chat:metrics-access",
      analytics: false,
    });
  }
  return metricsLimiter;
}

function authorized(req) {
  return isMetricsAuthorized(
    req.headers.authorization,
    process.env.SYMBIO_COMMAND_CENTER_TOKEN
  );
}

function requestIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeProviderKeyUsage(payload, now = new Date()) {
  const data = payload?.data;
  if (!data || typeof data !== "object") return null;
  const usageMonthlyUsd = nonNegativeNumber(data.usage_monthly);
  const usageUsd = nonNegativeNumber(data.usage);
  const limitUsd = nonNegativeNumber(data.limit);
  const limitRemainingUsd = nonNegativeNumber(data.limit_remaining);
  if (usageMonthlyUsd === null && usageUsd === null) return null;
  return {
    available: true,
    usageMonthlyUsd: usageMonthlyUsd ?? usageUsd,
    usageUsd,
    limitUsd,
    limitRemainingUsd,
    limitReset: String(data.limit_reset || ""),
    usageMonth: metricKeysForDate(now).monthLabel,
    checkedAt: new Date().toISOString(),
  };
}

async function providerKeyUsage(redis, now = new Date()) {
  const provider = normalizeChatProvider(
    process.env.SYMBIO_CHAT_PROVIDER || DEFAULT_CHAT_PROVIDER
  );
  if (provider !== "openrouter") {
    return {
      available: false,
      provider: provider || "unknown",
      error:
        "Direct provider usage is tracked from response tokens in the local budget ledger.",
    };
  }

  const usageMonth = metricKeysForDate(now).monthLabel;
  const cacheKey = `${PROVIDER_USAGE_CACHE_PREFIX}:${usageMonth}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached && typeof cached === "object" && cached.available) return cached;

  const apiKey = process.env.OPENROUTER_CHAT_API_KEY;
  if (!apiKey) return { available: false, error: "Provider key is not configured." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(OPENROUTER_KEY_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "HTTP-Referer": "https://symbioai.dev",
        "X-Title": "Symbio AI Cost Reconciliation",
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    const normalized = response.ok ? normalizeProviderKeyUsage(payload, now) : null;
    if (!normalized) {
      return { available: false, error: `Provider usage returned HTTP ${response.status}.` };
    }
    await redis.set(cacheKey, normalized, { ex: 15 * 60 }).catch(() => {});
    return normalized;
  } catch {
    return { available: false, error: "Provider usage reconciliation is unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  setHeaders(res);

  if (!process.env.SYMBIO_COMMAND_CENTER_TOKEN) {
    res.status(503).json({ ok: false, error: "Metrics access is not configured." });
    return;
  }

  const redis = getChatRedis();
  if (!redis) {
    res.status(503).json({ ok: false, error: "Chat storage is unavailable." });
    return;
  }
  try {
    const access = await getMetricsLimiter(redis).limit(
      hashValue(requestIp(req)).slice(0, 24)
    );
    if (!access.success) {
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil(((Number(access.reset) || Date.now()) - Date.now()) / 1000)))
      );
      res.status(429).json({ ok: false, error: "Metrics are being refreshed too quickly." });
      return;
    }
  } catch {
    res.status(503).json({ ok: false, error: "Metrics protection is unavailable." });
    return;
  }
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized." });
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
    const now = new Date();
    const monthLabel = metricKeysForDate(now).monthLabel;
    const trackedMetrics = await getChatMetrics(redis, { now });
    const providerUsage = await providerKeyUsage(redis, now);
    const varianceBeforeReconciliation = providerUsage.available
      ? Number((providerUsage.usageMonthlyUsd - trackedMetrics.month.costUsd).toFixed(6))
      : null;
    if (providerUsage.available) {
      if (providerUsage.usageMonth === monthLabel) {
        await reconcileMonthlyBudget(redis, providerUsage.usageMonthlyUsd, {
          at: now,
        }).catch(() => {});
      }
    }
    const metrics = await getChatMetrics(redis, { now });
    const cap = monthlyBudgetSettings().budgetUsd;
    const committed = Number(metrics.month.committedCostUsd || metrics.month.costUsd || 0);
    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      model: metrics.month.model || metrics.today.model || "",
      budgetUsd: cap,
      budgetCommittedUsd: committed,
      budgetPercent: cap ? Math.min(100, (committed / cap) * 100) : 0,
      providerUsage: {
        ...providerUsage,
        varianceUsd: varianceBeforeReconciliation,
      },
      ...metrics,
    });
  } catch {
    res.status(503).json({ ok: false, error: "Metrics are temporarily unavailable." });
  }
}
