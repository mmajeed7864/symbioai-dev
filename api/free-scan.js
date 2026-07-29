import { Ratelimit } from "@upstash/ratelimit";

import { hashValue } from "./_chat-shared.js";
import { getChatRedis } from "./_chat-telemetry.js";
import {
  hasValidLeadContact,
  hasAllowedFreeScanOrigin,
  isValidEmail,
  isValidPhone,
  normalizePayload,
  publicNotificationSummary,
  sendNotifications,
  setCors,
  upsertFreeScan,
} from "./_free-scan-shared.js";

let freeScanLimiter;

function requestIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getFreeScanLimiter(redis) {
  if (!freeScanLimiter) {
    freeScanLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "symbio:free-scan:ip",
      analytics: false,
    });
  }
  return freeScanLimiter;
}

export default async function handler(req, res) {
  setCors(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  if (!hasAllowedFreeScanOrigin(req)) {
    res.status(403).json({ ok: false, error: "Origin not allowed." });
    return;
  }

  const contentType = String(req.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    res.status(415).json({ ok: false, error: "Content-Type must be application/json." });
    return;
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > 50000) {
    res.status(413).json({ ok: false, error: "Request is too large." });
    return;
  }

  const payload = normalizePayload(req.body || {});
  if (payload._gotcha) {
    res.status(200).json({ ok: true, message: "Request received." });
    return;
  }

  const redis = getChatRedis();
  if (!redis) {
    res.status(503).json({ ok: false, error: "Free scan protection is unavailable." });
    return;
  }
  try {
    const limit = await getFreeScanLimiter(redis).limit(
      hashValue(requestIp(req)).slice(0, 24)
    );
    if (!limit.success) {
      const resetAt = Number(limit.reset) || Date.now() + 60000;
      res.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)))
      );
      res.status(429).json({
        ok: false,
        error: "Too many free-scan requests. Please wait and try again.",
      });
      return;
    }
  } catch {
    res.status(503).json({ ok: false, error: "Free scan protection is unavailable." });
    return;
  }

  if (!payload.name || !hasValidLeadContact(payload)) {
    res.status(400).json({ ok: false, error: "Name and a valid email or phone are required." });
    return;
  }
  if (payload.email && !isValidEmail(payload.email)) {
    res.status(400).json({ ok: false, error: "Enter a valid email address." });
    return;
  }
  if (payload.phone && !isValidPhone(payload.phone)) {
    res.status(400).json({ ok: false, error: "Enter a valid phone number." });
    return;
  }

  let stored = null;
  try {
    stored = await upsertFreeScan(payload, req);
  } catch {}

  const notifications = await sendNotifications(payload);
  const notificationOk = notifications.some((event) => event.ok);
  const delivery = publicNotificationSummary(notifications);

  if (stored || notificationOk) {
    res.status(200).json({
      ok: true,
      message: stored
        ? "Free scan captured permanently."
        : "Free scan alert sent, but permanent storage needs attention.",
      requestId: stored?.scan?.id || payload.id,
      delivery,
      storage: { ok: Boolean(stored) },
    });
    return;
  }

  res.status(503).json({
    ok: false,
    error: "Free scan delivery is temporarily unavailable. Please use email or phone.",
    delivery,
  });
}
