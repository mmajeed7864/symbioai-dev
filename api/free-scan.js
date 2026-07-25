import {
  hasValidLeadContact,
  isValidEmail,
  isValidPhone,
  normalizePayload,
  sendNotifications,
  setCors,
  upsertFreeScan,
} from "./_free-scan-shared.js";

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
  let storageError = "";
  try {
    stored = await upsertFreeScan(payload, req);
  } catch (error) {
    storageError = error.message || "Free scan storage failed.";
  }

  const notifications = await sendNotifications(payload);
  const notificationOk = notifications.some((event) => event.ok);

  if (stored || notificationOk) {
    res.status(200).json({
      ok: true,
      message: stored
        ? "Free scan captured permanently."
        : "Free scan alert sent, but permanent storage needs attention.",
      request: stored?.scan || payload,
      notifications,
      storage: stored ? { ok: true } : { ok: false, error: storageError },
    });
    return;
  }

  res.status(503).json({
    ok: false,
    error: storageError || "Free scan notification and storage are not configured.",
    notifications,
    action: "Configure Supabase storage or Telegram notification env vars before relying on this endpoint.",
  });
}
