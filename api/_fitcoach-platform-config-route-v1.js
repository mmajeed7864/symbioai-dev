import {
  isAllowedFitCoachBuild,
  isAllowedPlatformOrigin,
  publicFitCoachPlatformConfig,
  setFitCoachPlatformCors,
} from "./_fitcoach-platform.js";

export function createFitCoachPlatformConfigHandler({ env = process.env } = {}) {
  return async function handler(req, res) {
    setFitCoachPlatformCors(req, res, "GET, OPTIONS");
    if (!isAllowedPlatformOrigin(req.headers?.origin)) {
      return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });
    }
    if (!isAllowedFitCoachBuild(req.headers?.["x-fitcoach-build"], env)) {
      return res.status(426).json({ ok: false, error: "CLIENT_BUILD_NOT_ALLOWED" });
    }
    return res.status(200).json({ ok: true, config: publicFitCoachPlatformConfig(env) });
  };
}

export default createFitCoachPlatformConfigHandler();
