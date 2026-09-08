// CORS is a browser transport policy, never proof of app identity or account
// ownership. Native localhost origins are shared by other installed apps too.
export const FITCOACH_BROWSER_ORIGINS = Object.freeze([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "capacitor://localhost", // Capacitor iOS default; bundled local assets.
  "https://localhost", // Capacitor Android default; no remote server.url.
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);
const allowedOrigins = new Set(FITCOACH_BROWSER_ORIGINS);

export function isAllowedFitCoachOrigin(origin, { allowMissing = false } = {}) {
  if (origin === undefined || origin === "") return allowMissing;
  // Match the serialized Origin exactly. Do not trim, truncate, parse away
  // credentials/paths/ports or coerce duplicate-header arrays into strings.
  return typeof origin === "string" && allowedOrigins.has(origin);
}

export function setFitCoachCors(
  req,
  res,
  {
    methods = "POST, OPTIONS",
    headers = "Content-Type, X-FitCoach-Build",
    exposedHeaders = "",
    vary = "Origin",
  } = {}
) {
  const origin = req?.headers?.origin;
  if (isAllowedFitCoachOrigin(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", headers);
  if (exposedHeaders) res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
  // Bearer authentication is explicit. Never enable ambient cross-origin cookies
  // or use a wildcard, including on errors and preflight responses.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", vary);
  res.setHeader("X-Content-Type-Options", "nosniff");
}
