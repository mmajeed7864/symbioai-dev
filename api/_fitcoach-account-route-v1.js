import {
  FITCOACH_PLATFORM_VERSION,
  authenticateFitCoachRequest,
  buildFitCoachExport,
  deleteFitCoachAccount,
  hasRecentAuthentication,
  isAllowedFitCoachBuild,
  isAllowedPlatformOrigin,
  parseConsentRequest,
  publicFitCoachPlatformConfig,
  publicPlatformError,
  recordFitCoachConsent,
  setFitCoachPlatformCors,
} from "./_fitcoach-platform.js";

const MAX_REQUEST_BYTES = 4_000;

export default async function handler(req, res) {
  setFitCoachPlatformCors(req, res, "GET, POST, DELETE, OPTIONS");
  if (!isAllowedPlatformOrigin(req.headers?.origin)) {
    return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!new Set(["GET", "POST", "DELETE"]).has(req.method)) {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  if (!isAllowedFitCoachBuild(req.headers?.["x-fitcoach-build"])) {
    return res.status(426).json({ ok: false, error: "CLIENT_BUILD_NOT_ALLOWED" });
  }
  const capabilities = publicFitCoachPlatformConfig();
  if (req.method === "POST" && !capabilities.sync.available) {
    return res.status(503).json({ ok: false, error: "ACCOUNT_SYNC_NOT_CONFIGURED" });
  }
  if (req.method === "GET" && !capabilities.account.exportAvailable) {
    return res.status(503).json({ ok: false, error: "ACCOUNT_EXPORT_NOT_CONFIGURED" });
  }
  if (req.method === "DELETE" && !capabilities.account.deletionAvailable) {
    return res.status(503).json({ ok: false, error: "ACCOUNT_DELETION_NOT_CONFIGURED" });
  }
  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
    return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
  }

  const auth = await authenticateFitCoachRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  try {
    if (req.method === "POST") {
      const parsed = parseConsentRequest(req.body);
      if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });
      if (parsed.request.policyVersion !== process.env.FITCOACH_SYNC_CONSENT_VERSION) {
        return res.status(409).json({ ok: false, error: "CONSENT_VERSION_NOT_CURRENT" });
      }
      const consent = await recordFitCoachConsent(auth.subjectId, parsed.request);
      return res
        .status(200)
        .json({ ok: true, consent, platformVersion: FITCOACH_PLATFORM_VERSION });
    }

    if (!hasRecentAuthentication(auth)) {
      return res.status(401).json({ ok: false, error: "RECENT_AUTH_REQUIRED" });
    }
    if (req.method === "GET") {
      const portable = await buildFitCoachExport(auth.subjectId);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=fitcoach-export-${new Date().toISOString().slice(0, 10)}.json`
      );
      return res.status(200).json({ ok: true, export: portable });
    }

    if (
      !req.body ||
      Object.keys(req.body).length !== 1 ||
      req.body.confirmation !== "DELETE MY FITCOACH ACCOUNT"
    ) {
      return res.status(400).json({ ok: false, error: "DELETE_CONFIRMATION_REQUIRED" });
    }
    const result = await deleteFitCoachAccount(auth);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const visible = publicPlatformError(error);
    return res.status(visible.status).json({ ok: false, error: visible.error });
  }
}
