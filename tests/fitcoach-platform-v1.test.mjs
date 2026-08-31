import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import {
  FitCoachPlatformError,
  authenticateFitCoachRequest,
  deleteFitCoachAccount,
  decryptFitCoachState,
  encryptFitCoachState,
  fitCoachStoreAccountBinding,
  hasRecentAuthentication,
  isAllowedFitCoachBuild,
  parseConsentRequest,
  parseSubscriptionRequest,
  parseSyncPutRequest,
  publicFitCoachPlatformConfig,
  verifyFitCoachSubscription,
} from "../api/_fitcoach-platform.js";
import { createFitCoachPlatformConfigHandler } from "../api/_fitcoach-platform-config-route-v1.js";
import { createFitCoachSubscriptionsHandler } from "../api/_fitcoach-subscriptions-route-v1.js";
import { createFitCoachPlatformRouter } from "../api/fitcoach-platform-v1.js";

const SUBJECT_ID = "a441b8f4-753e-4d93-9820-ae2cebe9e9dc";
const OTHER_SUBJECT_ID = "f8fbd578-4e08-4c3a-90ba-15b081ad6927";
const DATA_KEY = Buffer.alloc(32, 7).toString("base64");
const AUTH_TOKEN = makeJwt({
  role: "authenticated",
  auth_time: Math.floor(Date.now() / 1_000),
  session_id: "session-123456789",
});

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.${"s".repeat(43)}`;
}

function platformEnv(overrides = {}) {
  return {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_server_only_value",
    FITCOACH_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    FITCOACH_PUBLIC_SUPABASE_ANON_KEY: makeJwt({ role: "anon" }),
    FITCOACH_AUTH_PROVIDERS: "email,apple,google",
    FITCOACH_ACCOUNT_SYNC_ENABLED: "1",
    FITCOACH_DATA_ENCRYPTION_KEY_B64: DATA_KEY,
    FITCOACH_DATA_ENCRYPTION_KEY_VERSION: "v1",
    FITCOACH_SYNC_CONSENT_VERSION: "2026-08-31.1",
    ...overrides,
  };
}

function makeResponse() {
  return {
    body: null,
    ended: false,
    headers: {},
    statusCode: 200,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
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

test("encrypted sync state round-trips and is bound to the subject and envelope", () => {
  const env = platformEnv();
  const state = { workouts: [{ exercise: "squat", sets: 3 }], firstDay: true };
  const envelope = encryptFitCoachState(state, {
    subjectId: SUBJECT_ID,
    schemaVersion: 1,
    env,
    randomBytesImpl: () => Buffer.alloc(12, 9),
  });
  assert.deepEqual(decryptFitCoachState(envelope, { subjectId: SUBJECT_ID, env }), state);
  assert.equal(envelope.algorithm, "AES-256-GCM");
  assert.equal(envelope.plaintext_bytes, Buffer.byteLength(JSON.stringify(state)));

  assert.throws(
    () => decryptFitCoachState(envelope, { subjectId: OTHER_SUBJECT_ID, env }),
    (error) =>
      error instanceof FitCoachPlatformError && error.code === "ENCRYPTED_STATE_AUTH_FAILED"
  );
  assert.throws(
    () =>
      decryptFitCoachState(
        { ...envelope, ciphertext_b64: Buffer.from("tampered").toString("base64") },
        { subjectId: SUBJECT_ID, env }
      ),
    (error) =>
      error instanceof FitCoachPlatformError && error.code === "ENCRYPTED_STATE_AUTH_FAILED"
  );
  assert.throws(
    () => encryptFitCoachState(state, { subjectId: SUBJECT_ID, schemaVersion: 1, env: {} }),
    (error) =>
      error instanceof FitCoachPlatformError && error.code === "DATA_ENCRYPTION_NOT_CONFIGURED"
  );
});

test("encrypted state remains readable across an explicit server-side key rotation", () => {
  const oldKey = Buffer.alloc(32, 3).toString("base64");
  const newKey = Buffer.alloc(32, 4).toString("base64");
  const keyRing = JSON.stringify({ v1: oldKey, v2: newKey });
  const oldEnvelope = encryptFitCoachState(
    { revision: "old" },
    {
      subjectId: SUBJECT_ID,
      schemaVersion: 1,
      env: {
        FITCOACH_DATA_ENCRYPTION_KEYS_JSON: keyRing,
        FITCOACH_DATA_ENCRYPTION_KEY_VERSION: "v1",
      },
    }
  );
  const rotatedEnv = {
    FITCOACH_DATA_ENCRYPTION_KEYS_JSON: keyRing,
    FITCOACH_DATA_ENCRYPTION_KEY_VERSION: "v2",
  };
  assert.deepEqual(decryptFitCoachState(oldEnvelope, { subjectId: SUBJECT_ID, env: rotatedEnv }), {
    revision: "old",
  });
  const newEnvelope = encryptFitCoachState(
    { revision: "new" },
    {
      subjectId: SUBJECT_ID,
      schemaVersion: 1,
      env: rotatedEnv,
    }
  );
  assert.equal(newEnvelope.key_version, "v2");
});

test("sync and consent envelopes are exact, bounded, and versioned", () => {
  const parsed = parseSyncPutRequest({
    base_revision: 0,
    device_id: "ios-device-1234",
    schema_version: 1,
    state: { profile: { goal: "strength" } },
  });
  assert.equal(parsed.ok, true);
  assert.equal(parseSyncPutRequest({ ...parsed.request, extra: true }).ok, false);
  assert.equal(
    parseSyncPutRequest({ base_revision: 0, device_id: "short", schema_version: 1, state: {} }).ok,
    false
  );
  assert.equal(
    parseSyncPutRequest({
      base_revision: 0,
      device_id: "ios-device-1234",
      schema_version: 1,
      state: { oversized: "x".repeat(1_500_001) },
    }).error,
    "SYNC_STATE_TOO_LARGE"
  );
  assert.equal(
    parseSyncPutRequest({
      base_revision: "0",
      device_id: "ios-device-1234",
      schema_version: 1,
      state: {},
    }).error,
    "INVALID_SYNC_ENVELOPE"
  );

  assert.equal(
    parseConsentRequest({
      policy: "sync_processing",
      policy_version: "2026-08-31.1",
      decision: "accepted",
    }).ok,
    true
  );
  assert.equal(
    parseConsentRequest({
      policy: "sync_processing",
      policy_version: "latest",
      decision: "accepted",
    }).error,
    "INVALID_CONSENT_POLICY"
  );
  assert.equal(
    parseConsentRequest({
      policy: "sync_processing",
      policy_version: "2026-08-31.1",
      decision: 1,
    }).error,
    "INVALID_CONSENT_ENVELOPE"
  );
});

test("Supabase validates the bearer before identity is accepted", async () => {
  let calledUrl = "";
  let calledHeaders;
  const auth = await authenticateFitCoachRequest(
    { headers: { authorization: `Bearer ${AUTH_TOKEN}` } },
    {
      env: platformEnv(),
      fetchImpl: async (url, options) => {
        calledUrl = String(url);
        calledHeaders = options.headers;
        return {
          ok: true,
          json: async () => ({
            id: SUBJECT_ID,
            app_metadata: { providers: ["email"] },
            identities: [{ provider: "email" }],
          }),
        };
      },
    }
  );
  assert.equal(auth.ok, true);
  assert.equal(auth.subjectId, SUBJECT_ID);
  assert.deepEqual(auth.providers, ["email"]);
  assert.equal(hasRecentAuthentication(auth), true);
  assert.equal(calledUrl, "https://project.supabase.co/auth/v1/user");
  assert.equal(calledHeaders.Authorization, `Bearer ${AUTH_TOKEN}`);

  const refreshedOnly = { ok: true, issuedAt: 0 };
  assert.equal(hasRecentAuthentication(refreshedOnly), false);
});

test("account deletion fails closed for social identities until token revocation exists", async () => {
  let fetchCalled = false;
  await assert.rejects(
    deleteFitCoachAccount(
      {
        ok: true,
        subjectId: SUBJECT_ID,
        providers: ["apple"],
        sessionId: "session-123456789",
      },
      {
        env: platformEnv(),
        fetchImpl: async () => {
          fetchCalled = true;
          throw new Error("must not call storage");
        },
      }
    ),
    (error) => error.code === "SOCIAL_IDENTITY_REVOCATION_NOT_CONFIGURED"
  );
  assert.equal(fetchCalled, false);
});

test("public config is fail-closed and never returns service credentials", () => {
  const disabled = publicFitCoachPlatformConfig({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SECRET_KEY: "server-secret",
    FITCOACH_PUBLIC_SUPABASE_URL: "https://other-project.supabase.co",
    FITCOACH_PUBLIC_SUPABASE_ANON_KEY: "server-secret",
    FITCOACH_AUTH_PROVIDERS: "email",
  });
  assert.equal(disabled.auth.enabled, false);
  assert.equal(disabled.auth.anonKey, null);
  assert.equal(disabled.sync.available, false);
  assert.doesNotMatch(JSON.stringify(disabled), /server-secret/);

  const enabled = publicFitCoachPlatformConfig(platformEnv({ FDC_API_KEY: "private-usda-key" }));
  assert.equal(enabled.auth.enabled, true);
  assert.equal(enabled.sync.available, true);
  assert.equal(enabled.account.exportAvailable, true);
  assert.equal(enabled.account.socialIdentityDeletionAvailable, false);
  assert.equal(enabled.subscriptions.available, false);
  assert.equal(enabled.nutrition.usdaVerifiedSearch, true);
  assert.doesNotMatch(JSON.stringify(enabled), /private-usda-key|sb_secret_server_only_value/);
});

test("platform config route enforces origin and explicit client builds", async () => {
  const env = platformEnv({ FITCOACH_ALLOWED_CLIENT_BUILDS: "0.5.4,0.5.5" });
  const handler = createFitCoachPlatformConfigHandler({ env });
  const denied = makeResponse();
  await handler(
    { method: "GET", headers: { origin: "https://attacker.example", "x-fitcoach-build": "0.5.4" } },
    denied
  );
  assert.equal(denied.statusCode, 403);

  const stale = makeResponse();
  await handler(
    {
      method: "GET",
      headers: { origin: "https://mmajeed7864.github.io", "x-fitcoach-build": "0.5.3" },
    },
    stale
  );
  assert.equal(stale.statusCode, 426);

  const response = makeResponse();
  await handler(
    {
      method: "GET",
      headers: { origin: "https://mmajeed7864.github.io", "x-fitcoach-build": "0.5.4" },
    },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.config.auth.enabled, true);
  assert.equal(response.headers["access-control-allow-origin"], "https://mmajeed7864.github.io");
  assert.equal(isAllowedFitCoachBuild("0.5.4", env), true);
  assert.equal(isAllowedFitCoachBuild("0.5.3", env), false);
});

test("one public platform router dispatches every stable external contract", async () => {
  const calls = [];
  const handlers = Object.fromEntries(
    ["account", "config", "entitlements", "subscriptions", "sync"].map((route) => [
      route,
      async (_req, res) => {
        calls.push(route);
        return res.status(200).json({ ok: true, route });
      },
    ])
  );
  const router = createFitCoachPlatformRouter({ handlers });
  for (const route of Object.keys(handlers)) {
    const response = makeResponse();
    await router({ query: { fitcoach_route: route } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.route, route);
  }
  assert.deepEqual(calls, ["account", "config", "entitlements", "subscriptions", "sync"]);

  const missing = makeResponse();
  await router({ query: { fitcoach_route: "unknown" } }, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error, "FITCOACH_PLATFORM_ROUTE_NOT_FOUND");
});

test("subscription envelopes are platform-specific and never silently truncate tokens", () => {
  const apple = parseSubscriptionRequest({
    platform: "apple",
    product_id: "fitcoach.premium.monthly",
    transaction_id: "123456789012345",
  });
  assert.equal(apple.ok, true);
  assert.equal(apple.request.operation, "verify");
  assert.equal(apple.request.requestDigest.length, 64);

  const google = parseSubscriptionRequest({
    operation: "restore",
    platform: "google",
    product_id: "fitcoach.premium.monthly",
    purchase_token: "google-purchase-token-1234567890",
  });
  assert.equal(google.ok, true);
  assert.equal(google.request.operation, "restore");
  assert.equal(
    parseSubscriptionRequest({
      platform: "google",
      product_id: "fitcoach.premium.monthly",
      purchase_token: "x".repeat(4_001),
    }).error,
    "INVALID_SUBSCRIPTION_ENVELOPE"
  );
  assert.equal(
    parseSubscriptionRequest({
      platform: "apple",
      product_id: "fitcoach.premium.monthly",
      transaction_id: "123456789012345",
      purchase_token: "google-purchase-token-1234567890",
    }).error,
    "INVALID_APPLE_TRANSACTION"
  );
});

test("verified purchases must match product and signed-in account binding", async () => {
  const env = platformEnv({
    FITCOACH_APPLE_ISSUER_ID: "issuer",
    FITCOACH_APPLE_KEY_ID: "key",
    FITCOACH_APPLE_BUNDLE_ID: "com.symbio.fitcoach",
    FITCOACH_APPLE_PRIVATE_KEY_B64: "encoded-private-key",
    FITCOACH_SUBSCRIPTION_PRODUCT_IDS: "fitcoach.premium.monthly,fitcoach.premium.yearly",
  });
  const request = parseSubscriptionRequest({
    platform: "apple",
    product_id: "fitcoach.premium.monthly",
    transaction_id: "123456789012345",
  }).request;
  const binding = fitCoachStoreAccountBinding(SUBJECT_ID);
  const verified = await verifyFitCoachSubscription({ subjectId: SUBJECT_ID }, request, {
    env,
    verifiers: {
      apple: async () => ({
        verified: true,
        productId: "fitcoach.premium.monthly",
        accountBinding: binding.appleAppAccountToken,
        status: "active",
        eventId: "apple-provider-event-1234567890",
        eventType: "DID_RENEW",
        providerReference: "sensitive-provider-reference",
        expiresAt: "2099-09-30T00:00:00.000Z",
      }),
    },
  });
  assert.equal(verified.eventId.length, 64);
  assert.equal(verified.providerReferenceDigest.length, 64);
  assert.doesNotMatch(JSON.stringify(verified), /sensitive-provider-reference|123456789012345/);

  await assert.rejects(
    verifyFitCoachSubscription({ subjectId: SUBJECT_ID }, request, {
      env,
      verifiers: {
        apple: async () => ({
          verified: true,
          productId: "fitcoach.premium.yearly",
          accountBinding: binding.appleAppAccountToken,
        }),
      },
    }),
    (error) => error.code === "SUBSCRIPTION_PRODUCT_MISMATCH"
  );
  await assert.rejects(
    verifyFitCoachSubscription({ subjectId: SUBJECT_ID }, request, {
      env,
      verifiers: {
        apple: async () => ({
          verified: true,
          productId: "fitcoach.premium.monthly",
          accountBinding: OTHER_SUBJECT_ID,
        }),
      },
    }),
    (error) => error.code === "SUBSCRIPTION_ACCOUNT_MISMATCH"
  );
  await assert.rejects(
    verifyFitCoachSubscription({ subjectId: SUBJECT_ID }, request, {
      env,
      now: new Date("2026-08-31T00:00:00.000Z"),
      verifiers: {
        apple: async () => ({
          verified: true,
          productId: "fitcoach.premium.monthly",
          accountBinding: binding.appleAppAccountToken,
          status: "active",
          eventId: "apple-provider-event-1234567890",
          eventType: "DID_RENEW",
          providerReference: "provider-reference",
          expiresAt: "2026-08-30T00:00:00.000Z",
        }),
      },
    }),
    (error) => error.code === "SUBSCRIPTION_VERIFIER_INVALID_RESULT"
  );
});

test("subscription route fails closed without verifier setup and never echoes the receipt", async () => {
  const rawTransaction = "123456789012345";
  const env = platformEnv({ FITCOACH_ALLOWED_CLIENT_BUILDS: "0.5.4" });
  const handler = createFitCoachSubscriptionsHandler({
    env,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/auth\/v1\/user$/);
      return {
        ok: true,
        json: async () => ({ id: SUBJECT_ID, app_metadata: { providers: ["email"] } }),
      };
    },
  });
  const response = makeResponse();
  await handler(
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        origin: "https://mmajeed7864.github.io",
        "x-fitcoach-build": "0.5.4",
        "content-length": "150",
      },
      body: {
        platform: "apple",
        product_id: "fitcoach.premium.monthly",
        transaction_id: rawTransaction,
      },
    },
    response
  );
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "SUBSCRIPTION_VERIFIER_SETUP_REQUIRED");
  assert.equal(response.body.setupRequired, true);
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(rawTransaction));
});

test("successful subscription reconciliation stores only digests and returns server entitlements", async () => {
  const rawTransaction = "123456789012345";
  const env = platformEnv({
    FITCOACH_ALLOWED_CLIENT_BUILDS: "0.5.4",
    FITCOACH_APPLE_ISSUER_ID: "issuer",
    FITCOACH_APPLE_KEY_ID: "key",
    FITCOACH_APPLE_BUNDLE_ID: "com.symbio.fitcoach",
    FITCOACH_APPLE_PRIVATE_KEY_B64: "encoded-private-key",
    FITCOACH_SUBSCRIPTION_PRODUCT_IDS: "fitcoach.premium.monthly",
  });
  const requests = [];
  const handler = createFitCoachSubscriptionsHandler({
    env,
    verifiers: {
      apple: async ({ verificationToken }) => {
        assert.equal(verificationToken, rawTransaction);
        return {
          verified: true,
          productId: "fitcoach.premium.monthly",
          accountBinding: SUBJECT_ID,
          status: "active",
          eventId: "apple-provider-event-1234567890",
          eventType: "SUBSCRIBED",
          providerReference: "provider-reference-never-store-raw",
          expiresAt: "2099-09-30T00:00:00.000Z",
        };
      },
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/auth/v1/user")) {
        return {
          ok: true,
          json: async () => ({ id: SUBJECT_ID, app_metadata: { providers: ["email"] } }),
        };
      }
      if (String(url).includes("/rpc/fitcoach_apply_verified_entitlement")) {
        return { ok: true, json: async () => true };
      }
      if (String(url).includes("/fitcoach_entitlements?")) {
        return {
          ok: true,
          json: async () => [
            {
              source: "app_store",
              product_id: "fitcoach.premium.monthly",
              status: "active",
              expires_at: "2099-09-30T00:00:00.000Z",
              updated_at: "2026-08-31T00:00:00.000Z",
            },
          ],
        };
      }
      throw new Error(`unexpected request: ${url}`);
    },
  });
  const response = makeResponse();
  await handler(
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        origin: "https://mmajeed7864.github.io",
        "x-fitcoach-build": "0.5.4",
        "content-length": "150",
      },
      body: {
        operation: "reconcile",
        platform: "apple",
        product_id: "fitcoach.premium.monthly",
        transaction_id: rawTransaction,
      },
    },
    response
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.premium, true);
  assert.equal(response.body.operation, "reconcile");
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /123456789012345|provider-reference-never-store-raw/
  );

  const rpcRequest = requests.find((item) =>
    item.url.includes("fitcoach_apply_verified_entitlement")
  );
  const rpcBody = JSON.parse(rpcRequest.options.body);
  assert.equal(rpcBody.p_event_id.length, 64);
  assert.equal(rpcBody.p_provider_reference_digest.length, 64);
  assert.doesNotMatch(
    rpcRequest.options.body,
    /123456789012345|provider-reference-never-store-raw/
  );
});

test("database migration keeps account and billing tables server-only", async () => {
  const sql = await readFile(
    new URL("../supabase/fitcoach_platform_v1.sql", import.meta.url),
    "utf8"
  );
  for (const table of [
    "fitcoach_subjects",
    "fitcoach_consents",
    "fitcoach_sync_documents",
    "fitcoach_entitlements",
    "fitcoach_subscription_events",
    "fitcoach_deletion_tombstones",
  ]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`, "i"));
  }
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all).*\bto authenticated\b/i);
  assert.match(sql, /p_status = 'revoked'[\s\S]*delete from public\.fitcoach_sync_documents/i);
  assert.match(sql, /FITCOACH_SUBSCRIPTION_REPLAY_MISMATCH/);
  assert.doesNotMatch(sql, /\bpurchase_token\b|\btransaction_id\b/i);
});

test("Vercel keeps all external platform URLs while staying within the 12-function limit", async () => {
  const apiDirectory = new URL("../api/", import.meta.url);
  const publicFunctions = (await readdir(apiDirectory)).filter(
    (file) => file.endsWith(".js") && !file.startsWith("_")
  );
  assert.equal(publicFunctions.length, 12);
  assert.equal(publicFunctions.includes("fitcoach-platform-v1.js"), true);
  assert.equal(publicFunctions.includes("fitcoach-transcribe.js"), false);

  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrites = new Map(config.rewrites.map((item) => [item.source, item.destination]));
  assert.equal(
    rewrites.get("/api/fitcoach-platform-config-v1"),
    "/api/fitcoach-platform-v1?fitcoach_route=config"
  );
  assert.equal(
    rewrites.get("/api/fitcoach-sync-v1"),
    "/api/fitcoach-platform-v1?fitcoach_route=sync"
  );
  assert.equal(
    rewrites.get("/api/fitcoach-account-v1"),
    "/api/fitcoach-platform-v1?fitcoach_route=account"
  );
  assert.equal(
    rewrites.get("/api/fitcoach-entitlements-v1"),
    "/api/fitcoach-platform-v1?fitcoach_route=entitlements"
  );
  assert.equal(
    rewrites.get("/api/fitcoach-subscriptions-v1"),
    "/api/fitcoach-platform-v1?fitcoach_route=subscriptions"
  );
  assert.equal(
    rewrites.get("/api/fitcoach-transcribe"),
    "/api/fitcoach-chat?fitcoach_retired=transcribe"
  );
});
