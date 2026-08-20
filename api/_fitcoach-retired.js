const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function setHeaders(req, res) {
  const origin = String(req.headers?.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-FitCoach-Build");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

export function createRetiredFitCoachHandler({ endpoint, replacement = null }) {
  return function retiredFitCoachHandler(req, res) {
    setHeaders(req, res);
    if (req.method === "OPTIONS") return res.status(204).end();

    const origin = String(req.headers?.origin || "");
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
    }

    return res.status(410).json({
      ok: false,
      error: "FITCOACH_LEGACY_ENDPOINT_RETIRED",
      endpoint,
      replacement,
    });
  };
}
