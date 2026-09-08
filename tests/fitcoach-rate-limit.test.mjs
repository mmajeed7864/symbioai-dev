import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  fitCoachClientNetwork,
  fitCoachRateLimitConfigured,
  limitFitCoachAccount,
  limitFitCoachIp,
} from "../api/_fitcoach-rate-limit.js";
import {
  authenticateFitCoachRequest,
  publicFitCoachPlatformConfig,
} from "../api/_fitcoach-platform.js";
import accountHandler from "../api/_fitcoach-account-route-v1.js";
import syncHandler from "../api/_fitcoach-sync-route-v1.js";
import entitlementsHandler from "../api/_fitcoach-entitlements-route-v1.js";
import { createFitCoachSubscriptionsHandler } from "../api/_fitcoach-subscriptions-route-v1.js";
import { createFitCoachPlatformRouter } from "../api/fitcoach-platform-v1.js";

const SUBJECT = "a441b8f4-753e-4d93-9820-ae2cebe9e9dc";
const OTHER_SUBJECT = "f8fbd578-4e08-4c3a-90ba-15b081ad6927";
const REDIS_URL = "https://test.upstash.io";
const env = {
  VERCEL: "1",
  UPSTASH_REDIS_REST_URL: REDIS_URL,
  UPSTASH_REDIS_REST_TOKEN: "test-only-redis-token",
  FITCOACH_RATE_LIMIT_SECRET: "test-only-secret-not-a-credential".repeat(2),
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEY: "test-only-server-key",
  FITCOACH_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  FITCOACH_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_only",
  FITCOACH_AUTH_PROVIDERS: "email",
  FITCOACH_ACCOUNT_SYNC_ENABLED: "1",
  FITCOACH_DATA_ENCRYPTION_KEY_B64: Buffer.alloc(32, 7).toString("base64"),
  FITCOACH_DATA_ENCRYPTION_KEY_VERSION: "v1",
  FITCOACH_SYNC_CONSENT_VERSION: "2026-08-31.1",
  FITCOACH_ALLOWED_CLIENT_BUILDS: "0.7.1",
};
const request = () => ({
  method: "GET",
  headers: {
    authorization: `Bearer ${"test-token-".repeat(8)}`,
    "x-fitcoach-build": "0.7.1",
    "x-vercel-forwarded-for": "198.51.100.9",
    origin: "https://mmajeed7864.github.io",
  },
  socket: { remoteAddress: "127.0.0.1" },
  body: { user_id: OTHER_SUBJECT, device_id: "attacker-controlled" },
});
const reply = (result) => ({ ok: true, json: async () => ({ result }) });
function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      return this;
    },
  };
}

test("only the configured trusted hop supplies an IP; malformed identities fail closed", () => {
  const req = request();
  assert.equal(fitCoachClientNetwork(req, env), "198.51.100.9");
  req.headers["x-forwarded-for"] = "192.0.2.1";
  assert.equal(fitCoachClientNetwork(req, {}), "127.0.0.1");
  for (const value of [
    undefined,
    ["192.0.2.1"],
    "192.0.2.1, 192.0.2.2",
    "garbage",
    "fe80::1%lo0",
  ]) {
    req.headers["x-vercel-forwarded-for"] = value;
    assert.equal(fitCoachClientNetwork(req, env), null);
  }
});

test("IPv6 aliases, privacy addresses, and IPv4-mapped forms cannot create separate buckets", () => {
  const req = request();
  for (const value of [
    "2001:db8:0:1:0:0:0:1",
    "2001:0DB8:0000:0001::abcd",
    "2001:db8:0:1:ffff::1234",
  ]) {
    req.headers["x-vercel-forwarded-for"] = value;
    assert.equal(fitCoachClientNetwork(req, env), "2001:db8:0:1::/64");
  }
  for (const value of ["::ffff:192.0.2.1", "::ffff:c000:201", "192.0.2.1"]) {
    req.headers["x-vercel-forwarded-for"] = value;
    assert.equal(fitCoachClientNetwork(req, env), "192.0.2.1");
  }
});

test("invalid configuration never contacts the provider or advertises account data availability", async () => {
  for (const overrides of [
    { FITCOACH_RATE_LIMIT_SECRET: "" },
    { FITCOACH_RATE_LIMIT_SECRET: "short" },
    { UPSTASH_REDIS_REST_URL: "http://test.upstash.io" },
    { UPSTASH_REDIS_REST_URL: "https://user:password@test.upstash.io" },
    { UPSTASH_REDIS_REST_URL: "https://test.upstash.io/?token=bad" },
    { UPSTASH_REDIS_REST_TOKEN: "" },
  ]) {
    const config = { ...env, ...overrides };
    assert.equal(fitCoachRateLimitConfigured(config), false);
    const result = await limitFitCoachIp(request(), {
      env: config,
      fetchImpl: () => assert.fail("unconfigured provider must not be called"),
    });
    assert.equal(result.status, 503);
    const capabilities = publicFitCoachPlatformConfig(config);
    assert.equal(capabilities.sync.available, false);
    assert.equal(capabilities.account.deletionAvailable, false);
    assert.equal(capabilities.account.entitlementsAvailable, false);
    assert.equal(capabilities.auth.enabled, true); // optional sign-in is a separate capability
    assert.doesNotMatch(
      JSON.stringify(capabilities),
      /test-only-secret|test-only-redis|test-only-server/
    );
  }
});

test("matching Redis URL/token aliases work without mixing credentials between providers", () => {
  for (const prefix of ["KV_REST_API", "SYMBIO_REDIS_REST"]) {
    const config = {
      ...env,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    };
    config[`${prefix}_URL`] = REDIS_URL;
    config[`${prefix}_TOKEN`] = "test-only-redis-token";
    assert.equal(fitCoachRateLimitConfigured(config), true);
    config.UPSTASH_REDIS_REST_URL = REDIS_URL;
    assert.equal(fitCoachRateLimitConfigured(config), false);
  }
});

test("atomic request has an expiry and only HMAC pseudonyms; 429 reports remaining window", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return reply([0, 12_001]);
  };
  const result = await limitFitCoachAccount(SUBJECT, "export", { env, fetchImpl });
  assert.deepEqual(result, {
    ok: false,
    status: 429,
    error: "RATE_LIMITED",
    retryAfterSeconds: 13,
  });
  const call = calls[0];
  const command = JSON.parse(call.options.body);
  assert.equal(call.url, REDIS_URL);
  assert.equal(call.options.redirect, "error");
  assert.equal(call.options.cache, "no-store");
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], "1");
  assert.deepEqual(command.slice(4), [3, 900_000]);
  const digest = createHmac("sha256", env.FITCOACH_RATE_LIMIT_SECRET)
    .update(`export:${SUBJECT}`)
    .digest("hex");
  assert.equal(command[3], `fitcoach:abuse:v1:export:${digest}`);
  assert.doesNotMatch(
    call.options.body,
    new RegExp(`${SUBJECT}|${OTHER_SUBJECT}|198.51.100.9|attacker-controlled`)
  );
  assert.match(command[1], /if count >= tonumber\(ARGV\[1\]\) then return \{0, ttl\} end/);
  assert.match(command[1], /'PX', ARGV\[2\]/);
});

test("unknown scopes and untrusted identities fail closed without a shared anonymous bucket", async () => {
  const fetchImpl = () => assert.fail("must not send a provider request");
  for (const scope of ["ip", "constructor", "__proto__", "made_up"]) {
    assert.equal((await limitFitCoachAccount(SUBJECT, scope, { env, fetchImpl })).status, 503);
  }
  assert.equal((await limitFitCoachIp({ headers: {} }, { env, fetchImpl })).status, 503);
});

test("provider errors and malformed counters never fail open or echo credentials", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error(env.UPSTASH_REDIS_REST_TOKEN);
    },
    async () => ({ ok: false }),
    async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad JSON");
      },
    }),
    async () => ({ ok: true, json: async () => ({ error: "provider error", result: [1, 500] }) }),
    ...[null, [true, 500], [1, 0], [1, -1], [1, 60_001], [1, "500"], [1, 500, 0]].map(
      (value) => async () => reply(value)
    ),
  ]) {
    assert.deepEqual(await limitFitCoachIp(request(), { env, fetchImpl }), {
      ok: false,
      status: 503,
      error: "ABUSE_PROTECTION_UNAVAILABLE",
    });
  }
});

test("provider timeout aborts the request and fails closed", async () => {
  const started = Date.now();
  const result = await limitFitCoachIp(request(), {
    env,
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  assert.equal(result.status, 503);
  assert.ok(Date.now() - started >= 2_900);
  assert.ok(Date.now() - started < 6_000);
});

test("IP limit runs before token validation; invalid auth never consumes an account bucket", async () => {
  const blockedCalls = [];
  const result = await authenticateFitCoachRequest(request(), {
    env,
    fetchImpl: async (url) => {
      blockedCalls.push(url);
      return reply([0, 10_000]);
    },
  });
  assert.equal(result.status, 429);
  assert.deepEqual(blockedCalls, [REDIS_URL]);
  const invalidCalls = [];
  const invalid = await authenticateFitCoachRequest(request(), {
    env,
    fetchImpl: async (url) => {
      invalidCalls.push(url);
      return url === REDIS_URL ? reply([1, 60_000]) : { ok: false };
    },
  });
  assert.equal(invalid.status, 401);
  assert.equal(invalidCalls.length, 2);
});

test("validated subject controls the account bucket, not token claims, body or device headers", async () => {
  const buckets = [];
  const fetchImpl = async (url, options) => {
    if (url === REDIS_URL) {
      const command = JSON.parse(options.body);
      buckets.push(command[3]);
      return reply([1, command[5]]);
    }
    return { ok: true, json: async () => ({ id: SUBJECT }) };
  };
  for (const id of ["device-first", "device-second"]) {
    const req = request();
    req.headers["x-fitcoach-device"] = id;
    req.headers.authorization = `Bearer ${id.repeat(8)}`;
    assert.equal(
      (await authenticateFitCoachRequest(req, { env, fetchImpl, rateLimitScope: "sync_write" })).ok,
      true
    );
  }
  assert.equal(buckets[0], buckets[2]);
  assert.equal(buckets[1], buckets[3]);
  assert.match(buckets[1], /:sync_write:/);
});

test("all data routes stop before database access, preserve CORS/no-store, and return Retry-After", async (t) => {
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url === REDIS_URL) {
      const command = JSON.parse(options.body);
      return reply([command[3].includes(":ip:") ? 1 : 0, 5_001]);
    }
    assert.equal(
      url,
      "https://project.supabase.co/auth/v1/user",
      "database access after a denied limit"
    );
    return { ok: true, json: async () => ({ id: SUBJECT }) };
  });
  const subscriptions = createFitCoachSubscriptionsHandler({ env, fetchImpl: globalThis.fetch });
  for (const [handler, method, scope] of [
    [syncHandler, "GET", "sync_read"],
    [syncHandler, "PUT", "sync_write"],
    [accountHandler, "GET", "export"],
    [accountHandler, "POST", "consent"],
    [accountHandler, "DELETE", "delete"],
    [entitlementsHandler, "GET", "entitlements"],
    [subscriptions, "POST", "subscription"],
  ]) {
    calls.length = 0;
    const req = request();
    req.method = method;
    const res = response();
    await handler(req, res);
    assert.equal(res.statusCode, 429, scope);
    assert.deepEqual(res.body, { ok: false, error: "RATE_LIMITED" });
    assert.equal(res.headers["retry-after"], "6");
    assert.equal(res.headers["access-control-expose-headers"], "Retry-After");
    assert.equal(res.headers["access-control-allow-origin"], req.headers.origin);
    assert.match(res.headers["cache-control"], /no-store/);
    assert.equal(calls.length, 3);
    assert.ok(JSON.parse(calls[2].options.body)[3].includes(`:${scope}:`));
    const preflight = response();
    await handler({ method: "OPTIONS", headers: { origin: req.headers.origin } }, preflight);
    assert.equal(preflight.statusCode, 204);
    assert.equal(calls.length, 3);
  }
  // Calling the consolidated URL directly still reaches the same protected handler.
  const req = { ...request(), query: { fitcoach_route: "sync" } };
  const res = response();
  await createFitCoachPlatformRouter()(req, res);
  assert.equal(res.statusCode, 429);
});
