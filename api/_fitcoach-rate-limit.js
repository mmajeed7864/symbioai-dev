import { createHmac } from "node:crypto";
import { isIP } from "node:net";

// One expiring, atomic counter per bucket. Denied requests never extend the window.
const CONSUME_WINDOW = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl == -2 then
  redis.call('SET', KEYS[1], 1, 'PX', ARGV[2])
  return {1, tonumber(ARGV[2])}
end
local count = tonumber(redis.call('GET', KEYS[1]))
if ttl <= 0 or not count or count < 1 then
  return redis.error_reply('INVALID_LIMIT_BUCKET')
end
if count >= tonumber(ARGV[1]) then return {0, ttl} end
redis.call('INCR', KEYS[1])
return {1, ttl}
`;

const LIMITS = Object.freeze({
  ip: [120, 60_000],
  account: [120, 60_000],
  sync_read: [60, 60_000],
  sync_write: [30, 60_000],
  consent: [10, 600_000],
  export: [3, 900_000],
  delete: [3, 900_000],
  entitlements: [60, 60_000],
  subscription: [10, 600_000],
});

function limitConfig(env) {
  const pairs = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.SYMBIO_REDIS_REST_URL, env.SYMBIO_REDIS_REST_TOKEN],
  ];
  const [rawUrl, token] = pairs.find(([url, value]) => url || value) || [];
  const secret = env.FITCOACH_RATE_LIMIT_SECRET;
  if (typeof token !== "string" || !token.trim() || typeof secret !== "string") return null;
  if (Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 4_096) return null;
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return { url: url.origin, token, secret };
  } catch {
    return null;
  }
}

export function fitCoachRateLimitConfigured(env = process.env) {
  return Boolean(limitConfig(env));
}

export function fitCoachClientNetwork(req, env = process.env) {
  // Only Vercel's trusted hop may supply this header. Never trust arbitrary XFF,
  // a client/device ID, or a caller-provided subject as a rate-limit identity.
  const raw =
    env.VERCEL === "1" ? req?.headers?.["x-vercel-forwarded-for"] : req?.socket?.remoteAddress;
  if (typeof raw !== "string" || raw.includes("%")) return null;
  const value = raw.trim();
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const [left, right = ""] = canonical.split("::");
  const first = left ? left.split(":") : [];
  const last = right ? right.split(":") : [];
  const parts = [...first, ...Array(8 - first.length - last.length).fill("0"), ...last].map(
    (word) => parseInt(word, 16)
  );
  if (parts.slice(0, 5).every((word) => word === 0) && parts[5] === 0xffff) {
    return [parts[6] >> 8, parts[6] & 255, parts[7] >> 8, parts[7] & 255].join(".");
  }
  // IPv6 privacy-address rotation must not create a fresh bucket within a /64.
  return `${parts
    .slice(0, 4)
    .map((word) => word.toString(16))
    .join(":")}::/64`;
}

const unavailable = () => ({ ok: false, status: 503, error: "ABUSE_PROTECTION_UNAVAILABLE" });

async function consumeLimit(identity, scope, { env, fetchImpl }) {
  const config = limitConfig(env);
  if (!config) return { ok: false, status: 503, error: "ABUSE_PROTECTION_NOT_CONFIGURED" };
  if (!identity || !Object.hasOwn(LIMITS, scope)) return unavailable();
  const [limit, windowMs] = LIMITS[scope];
  const digest = createHmac("sha256", config.secret).update(`${scope}:${identity}`).digest("hex");
  const key = `fitcoach:abuse:v1:${scope}:${digest}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", CONSUME_WINDOW, "1", key, limit, windowMs]),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    const body = await response.json();
    const result = body?.result;
    if (
      body?.error ||
      !Array.isArray(result) ||
      result.length !== 2 ||
      ![0, 1].includes(result[0]) ||
      !Number.isInteger(result[1]) ||
      result[1] <= 0 ||
      result[1] > windowMs
    )
      return unavailable();
    return result[0] === 1
      ? { ok: true }
      : {
          ok: false,
          status: 429,
          error: "RATE_LIMITED",
          retryAfterSeconds: Math.ceil(result[1] / 1_000),
        };
  } catch {
    // Never fall back to process-local counters or leak provider errors/secrets.
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}

export function limitFitCoachIp(req, { env = process.env, fetchImpl = fetch } = {}) {
  return consumeLimit(fitCoachClientNetwork(req, env), "ip", { env, fetchImpl });
}

export function limitFitCoachAccount(
  subjectId,
  scope,
  { env = process.env, fetchImpl = fetch } = {}
) {
  // This function is called only after the subject is validated by Supabase.
  if (scope === "ip") return Promise.resolve(unavailable());
  return consumeLimit(subjectId.toLowerCase(), scope, { env, fetchImpl });
}

export function respondFitCoachAuthFailure(res, result) {
  if (result.status === 429) res.setHeader("Retry-After", String(result.retryAfterSeconds));
  return res.status(result.status).json({ ok: false, error: result.error });
}
