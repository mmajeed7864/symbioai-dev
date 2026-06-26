const {
  setCors,
  listFreeScans,
  verifySyncToken,
} = require("./_free-scan-shared");

module.exports = async function handler(req, res) {
  setCors(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  if (!verifySyncToken(req)) {
    res.status(401).json({ ok: false, error: "Unauthorized." });
    return;
  }

  try {
    const requests = await listFreeScans(req.query?.limit || 250);
    res.status(200).json({
      ok: true,
      requests,
      summary: {
        total: requests.length,
        new: requests.filter((item) => (item.status || "new") === "new").length,
      },
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error.message || "Free scan sync failed.",
    });
  }
};
