import {
  FITCOACH_PLATFORM_VERSION,
  applyVerifiedFitCoachEntitlement,
  authenticateFitCoachRequest,
  isAllowedFitCoachBuild,
  isAllowedPlatformOrigin,
  loadFitCoachEntitlements,
  parseSubscriptionRequest,
  publicFitCoachPlatformConfig,
  publicPlatformError,
  setFitCoachPlatformCors,
  verifyFitCoachSubscription,
} from "./_fitcoach-platform.js";

const MAX_REQUEST_BYTES = 8_192;

export function createFitCoachSubscriptionsHandler({
  env = process.env,
  fetchImpl = fetch,
  verifiers = {},
} = {}) {
  return async function handler(req, res) {
    setFitCoachPlatformCors(req, res, "POST, OPTIONS");
    if (!isAllowedPlatformOrigin(req.headers?.origin)) {
      return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }
    if (!isAllowedFitCoachBuild(req.headers?.["x-fitcoach-build"], env)) {
      return res.status(426).json({ ok: false, error: "CLIENT_BUILD_NOT_ALLOWED" });
    }
    if (!publicFitCoachPlatformConfig(env).auth.enabled) {
      return res.status(503).json({ ok: false, error: "ACCOUNT_AUTH_NOT_CONFIGURED" });
    }
    const contentLength = Number(req.headers?.["content-length"] || 0);
    if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
      return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });
    }

    const auth = await authenticateFitCoachRequest(req, { fetchImpl, env });
    if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

    const parsed = parseSubscriptionRequest(req.body);
    if (!parsed.ok) return res.status(parsed.status).json({ ok: false, error: parsed.error });

    try {
      const verified = await verifyFitCoachSubscription(auth, parsed.request, { verifiers, env });
      const applied = await applyVerifiedFitCoachEntitlement(auth.subjectId, verified, {
        fetchImpl,
        env,
      });
      const entitlements = await loadFitCoachEntitlements(auth.subjectId, { fetchImpl, env });
      return res.status(200).json({
        ok: true,
        operation: parsed.request.operation,
        platform: parsed.request.platform,
        reconciled: true,
        replayedEvent: !applied,
        verification_id: verified.eventId,
        premium: entitlements.some((item) => item.active),
        entitlements,
        platformVersion: FITCOACH_PLATFORM_VERSION,
      });
    } catch (error) {
      const visible = publicPlatformError(error);
      return res.status(visible.status).json({
        ok: false,
        error: visible.error,
        ...(visible.error === "SUBSCRIPTION_VERIFIER_SETUP_REQUIRED"
          ? { setupRequired: true, platform: parsed.request.platform }
          : {}),
      });
    }
  };
}

export default createFitCoachSubscriptionsHandler();
