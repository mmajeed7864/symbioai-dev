import {
  FITCOACH_PLATFORM_VERSION,
  authenticateFitCoachRequest,
  isAllowedFitCoachBuild,
  isAllowedPlatformOrigin,
  loadFitCoachSyncState,
  parseSyncPutRequest,
  publicFitCoachPlatformConfig,
  publicPlatformError,
  saveFitCoachSyncState,
  setFitCoachPlatformCors,
} from "./_fitcoach-platform.js";

const MAX_REQUEST_BYTES = 1_600_000;

export default async function handler(req, res) {
  setFitCoachPlatformCors(req, res, "GET, PUT, OPTIONS");
  if (!isAllowedPlatformOrigin(req.headers?.origin)) {
    return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!new Set(["GET", "PUT"]).has(req.method)) {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  if (!isAllowedFitCoachBuild(req.headers?.["x-fitcoach-build"])) {
    return res.status(426).json({ ok: false, error: "CLIENT_BUILD_NOT_ALLOWED" });
  }
  if (!publicFitCoachPlatformConfig().sync.available) {
    return res.status(503).json({ ok: false, error: "ACCOUNT_SYNC_NOT_CONFIGURED" });
  }
  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
    return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
  }

  const auth = await authenticateFitCoachRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  try {
    if (req.method === "GET") {
      const sync = await loadFitCoachSyncState(auth.subjectId);
      return res.status(200).json({
        ok: true,
        ...sync,
        platformVersion: FITCOACH_PLATFORM_VERSION,
      });
    }

    const parsed = parseSyncPutRequest(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });
    const result = await saveFitCoachSyncState(auth.subjectId, parsed.request);
    return res.status(200).json({
      ok: true,
      ...result,
      platformVersion: FITCOACH_PLATFORM_VERSION,
    });
  } catch (error) {
    const visible = publicPlatformError(error);
    return res.status(visible.status).json({ ok: false, error: visible.error });
  }
}
