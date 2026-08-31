import accountHandler from "./_fitcoach-account-route-v1.js";
import entitlementsHandler from "./_fitcoach-entitlements-route-v1.js";
import configHandler from "./_fitcoach-platform-config-route-v1.js";
import subscriptionsHandler from "./_fitcoach-subscriptions-route-v1.js";
import syncHandler from "./_fitcoach-sync-route-v1.js";

const DEFAULT_HANDLERS = Object.freeze({
  account: accountHandler,
  config: configHandler,
  entitlements: entitlementsHandler,
  subscriptions: subscriptionsHandler,
  sync: syncHandler,
});

export function createFitCoachPlatformRouter({ handlers = DEFAULT_HANDLERS } = {}) {
  return async function fitCoachPlatformRouter(req, res) {
    const routeValue = Array.isArray(req.query?.fitcoach_route)
      ? req.query.fitcoach_route[0]
      : req.query?.fitcoach_route;
    const route = String(routeValue || "").trim();
    const selected = handlers[route];
    if (typeof selected !== "function") {
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(404).json({ ok: false, error: "FITCOACH_PLATFORM_ROUTE_NOT_FOUND" });
    }
    return selected(req, res);
  };
}

export default createFitCoachPlatformRouter();
