const {
  setCors,
  normalizePayload,
  upsertFreeScan,
  sendNotifications,
} = require("./_free-scan-shared");

module.exports = async function handler(req, res) {
  setCors(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const payload = normalizePayload(req.body || {});
  if (!payload.name || !payload.email) {
    res.status(400).json({ ok: false, error: "Name and email are required." });
    return;
  }

  try {
    const stored = await upsertFreeScan(payload, req);
    const notifications = await sendNotifications(payload);
    res.status(200).json({
      ok: true,
      message: "Free scan captured permanently.",
      request: stored.scan,
      notifications,
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error.message || "Free scan storage failed.",
      action: "Configure Supabase storage before making this endpoint live.",
    });
  }
};
