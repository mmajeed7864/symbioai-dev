import {
  FITCOACH_PLATFORM_VERSION,
  authenticateFitCoachRequest,
  isAllowedFitCoachBuild,
  isAllowedPlatformOrigin,
  loadFitCoachEntitlements,
  publicFitCoachPlatformConfig,
  publicPlatformError,
  setFitCoachPlatformCors,
} from "./_fitcoach-platform.js";

export default async function handler(req, res) {
  setFitCoachPlatformCors(req, res, "GET, OPTIONS");
  if (!isAllowedPlatformOrigin(req.headers?.origin)) {
    return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
  }
  if (!isAllowedFitCoachBuild(req.headers?.["x-fitcoach-build"])) {
    return res.status(426).json({ ok: false, error: "CLIENT_BUILD_NOT_ALLOWED" });
  }
  if (!publicFitCoachPlatformConfig().account.entitlementsAvailable) {
    return res.status(503).json({ ok: false, error: "ENTITLEMENTS_NOT_CONFIGURED" });
  }
  const auth = await authenticateFitCoachRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  try {
    const entitlements = await loadFitCoachEntitlements(auth.subjectId);
    return res.status(200).json({
      ok: true,
      entitlements,
      premium: entitlements.some((item) => item.active),
      platformVersion: FITCOACH_PLATFORM_VERSION,
    });
  } catch (error) {
    const visible = publicPlatformError(error);
    return res.status(visible.status).json({ ok: false, error: visible.error });
  }
}
