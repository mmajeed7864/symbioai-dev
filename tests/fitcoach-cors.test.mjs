import assert from "node:assert/strict";
import test from "node:test";
import {
  FITCOACH_BROWSER_ORIGINS,
  isAllowedFitCoachOrigin,
  setFitCoachCors,
} from "../api/_fitcoach-cors.js";
import {
  isAllowedPlatformOrigin,
  publicFitCoachPlatformConfig,
} from "../api/_fitcoach-platform.js";
import { createFitCoachPlatformConfigHandler } from "../api/_fitcoach-platform-config-route-v1.js";
import account from "../api/_fitcoach-account-route-v1.js";
import sync from "../api/_fitcoach-sync-route-v1.js";
import entitlements from "../api/_fitcoach-entitlements-route-v1.js";
import { createFitCoachSubscriptionsHandler } from "../api/_fitcoach-subscriptions-route-v1.js";
import { createFitCoachPlatformRouter } from "../api/fitcoach-platform-v1.js";
import coach from "../api/fitcoach-chat-v3.js";
import speech from "../api/fitcoach-speech-v2.js";

const config = createFitCoachPlatformConfigHandler({ env: {} });
const subscriptions = createFitCoachSubscriptionsHandler({ env: {} });
const routes = [
  ["config", config, "GET, OPTIONS"],
  ["account", account, "GET, POST, DELETE, OPTIONS"],
  ["sync", sync, "GET, PUT, OPTIONS"],
  ["entitlements", entitlements, "GET, OPTIONS"],
  ["subscriptions", subscriptions, "POST, OPTIONS"],
  ["coach and nutrition", coach, "POST, OPTIONS"],
  ["speech", speech, "POST, OPTIONS"],
];
function response() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    ended: false,
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
      this.ended = true;
      return this;
    },
  };
}
function envFor(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}
function assertNoAmbientCredentials(res) {
  assert.equal(res.headers["access-control-allow-credentials"], undefined);
  assert.notEqual(res.headers["access-control-allow-origin"], "*");
  assert.match(res.headers["cache-control"], /no-store/u);
  assert.match(res.headers.vary, /Origin/u);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
}

for (const origin of FITCOACH_BROWSER_ORIGINS) {
  test(`all seven active route families accept exact preflight origin ${origin}`, async (t) => {
    let network = 0;
    t.mock.method(globalThis, "fetch", async () => {
      network++;
      throw new Error("No provider work in preflight");
    });
    assert.equal(isAllowedFitCoachOrigin(origin), true);
    for (const [name, handler, methods] of routes) {
      const res = response();
      await handler({ method: "OPTIONS", headers: { origin } }, res);
      assert.equal(res.statusCode, 204, name);
      assert.equal(res.ended, true, name);
      assert.equal(res.headers["access-control-allow-origin"], origin, name);
      assert.equal(res.headers["access-control-allow-methods"], methods, name);
      assert.match(res.headers["access-control-allow-headers"], /Content-Type, X-FitCoach-Build/u);
      assertNoAmbientCredentials(res);
    }
    assert.equal(network, 0);
  });
}

test("malformed, opaque and lookalike origins are rejected, not normalized", async () => {
  for (const origin of [
    "null",
    null,
    " ",
    " capacitor://localhost",
    "capacitor://localhost ",
    "https://localhost/",
    "https://localhost:443",
    "https://localhost:4173",
    "http://localhost",
    "capacitor://localhost:8080",
    "capacitor://localhost.evil.test",
    "capacitor://user@localhost",
    "https://localhost@evil.test",
    "https://symbioai.dev.evil.test",
    "https://localhost, https://symbioai.dev",
    "https://localhost\r\nX-Evil: yes",
    ["https://localhost"],
    {},
    0,
  ]) {
    assert.equal(isAllowedFitCoachOrigin(origin), false, String(origin));
    assert.equal(isAllowedPlatformOrigin(origin), false, String(origin));
    for (const [name, handler] of routes) {
      for (const method of ["OPTIONS", "POST"]) {
        const res = response();
        await handler({ method, headers: { origin }, body: {} }, res);
        assert.equal(res.statusCode, 403, name);
        assert.equal(res.body.error, "ORIGIN_NOT_ALLOWED", name);
        assert.equal(res.headers["access-control-allow-origin"], undefined, name);
        assertNoAmbientCredentials(res);
      }
    }
  }
});

test("missing Origin remains explicit only for platform native/server clients", async () => {
  for (const origin of [undefined, ""]) {
    assert.equal(isAllowedFitCoachOrigin(origin), false);
    assert.equal(isAllowedPlatformOrigin(origin), true);
    const res = response();
    await config({ method: "GET", headers: { origin, "x-fitcoach-build": "0.7.3" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.config.auth.enabled, false);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
    for (const handler of [coach, speech]) {
      const denied = response();
      await handler({ method: "POST", headers: { origin }, body: {} }, denied);
      assert.equal(denied.statusCode, 403);
    }
  }
});

test("native config is readable without enabling accounts or subscriptions", async () => {
  const before = publicFitCoachPlatformConfig({});
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    const res = response();
    await config({ method: "GET", headers: { origin, "x-fitcoach-build": "0.7.3" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.config, before);
    assert.equal(res.body.config.auth.enabled, false);
    assert.equal(res.body.config.sync.available, false);
    assert.equal(res.body.config.subscriptions.available, false);
    assert.equal(res.headers["access-control-allow-origin"], origin);
  }
});

test("native data routes retain build gates and CORS on errors", async () => {
  for (const [name, handler, method] of [
    ["config", config, "GET"],
    ["account", account, "GET"],
    ["sync", sync, "PUT"],
    ["entitlements", entitlements, "GET"],
    ["subscriptions", subscriptions, "POST"],
  ]) {
    const res = response();
    await handler({ method, headers: { origin: "capacitor://localhost" } }, res);
    assert.equal(res.statusCode, 426, name);
    assert.equal(res.body.error, "CLIENT_BUILD_NOT_ALLOWED", name);
    assert.equal(res.headers["access-control-allow-origin"], "capacitor://localhost", name);
    assert.equal(res.headers["access-control-expose-headers"], "Retry-After", name);
    assert.match(res.headers["access-control-allow-headers"], /Authorization/u);
    assertNoAmbientCredentials(res);
  }
});

test("native origin alone never authorizes account, sync or purchase operations", async (t) => {
  const env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "test-only-server-secret",
    FITCOACH_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    FITCOACH_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_test_fixture",
    FITCOACH_AUTH_PROVIDERS: "email",
    FITCOACH_ACCOUNT_SYNC_ENABLED: "1",
    FITCOACH_DATA_ENCRYPTION_KEY_B64: Buffer.alloc(32, 5).toString("base64"),
    FITCOACH_DATA_ENCRYPTION_KEYS_JSON: "",
    FITCOACH_DATA_ENCRYPTION_KEY_VERSION: "v1",
    FITCOACH_SYNC_CONSENT_VERSION: "2026-08-31.1",
    FITCOACH_ALLOWED_CLIENT_BUILDS: "0.7.3",
    UPSTASH_REDIS_REST_URL: "https://test.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "test-only-redis-token",
    FITCOACH_RATE_LIMIT_SECRET: "test-only-rate-limit-secret".repeat(3),
  };
  envFor(t, env);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Unauthenticated request reached network");
  });
  const purchase = createFitCoachSubscriptionsHandler({ env, fetchImpl: globalThis.fetch });
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    for (const [handler, method] of [
      [account, "GET"],
      [account, "DELETE"],
      [account, "POST"],
      [sync, "GET"],
      [sync, "PUT"],
      [entitlements, "GET"],
      [purchase, "POST"],
    ]) {
      const res = response();
      await handler({ method, headers: { origin, "x-fitcoach-build": "0.7.3" }, body: {} }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, "AUTH_REQUIRED");
      assert.equal(res.headers["access-control-allow-origin"], origin);
    }
  }
  assert.equal(calls, 0);
});

test("native coach, nutrition and speech keep validation ahead of provider work", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("Invalid body reached provider");
  });
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    for (const [handler, body] of [
      [coach, {}],
      [coach, { action: "barcode_lookup" }],
      [speech, {}],
    ]) {
      const res = response();
      await handler({ method: "POST", headers: { origin }, body }, res);
      assert.equal(res.statusCode, 400);
      assert.notEqual(res.body.error, "ORIGIN_NOT_ALLOWED");
      assert.equal(res.headers["access-control-allow-origin"], origin);
      assertNoAmbientCredentials(res);
    }
  }
  assert.equal(calls, 0);
});

test("native speech exposes only existing voice metadata and platform exposes Retry-After", async () => {
  const res = response();
  await speech({ method: "OPTIONS", headers: { origin: "capacitor://localhost" } }, res);
  assert.equal(
    res.headers["access-control-expose-headers"],
    "X-FitCoach-Voice-Provider, X-FitCoach-Voice-Profile, X-FitCoach-Speech-Version"
  );
  const platform = response();
  await config({ method: "OPTIONS", headers: { origin: "capacitor://localhost" } }, platform);
  assert.equal(platform.headers["access-control-expose-headers"], "Retry-After");
});

test("consolidated platform router uses the same native policy", async () => {
  const router = createFitCoachPlatformRouter();
  for (const route of ["config", "account", "sync", "entitlements", "subscriptions"]) {
    const res = response();
    await router(
      {
        method: "OPTIONS",
        headers: { origin: "https://localhost" },
        query: { fitcoach_route: route },
      },
      res
    );
    assert.equal(res.statusCode, 204, route);
    assert.equal(res.headers["access-control-allow-origin"], "https://localhost", route);
  }
});

test("header writer never invents or reflects an untrusted origin", () => {
  for (const origin of [undefined, "", "null", "https://not-allowed.invalid"]) {
    const res = response();
    setFitCoachCors({ headers: { origin } }, res);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
    assertNoAmbientCredentials(res);
  }
});
