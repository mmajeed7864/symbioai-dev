import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const FITCOACH_PLATFORM_VERSION = "2026-08-31.1";
export const FITCOACH_SYNC_CONSENT_POLICY = "sync_processing";
export const MAX_SYNC_STATE_BYTES = 1_500_000;
export const RECENT_AUTH_MAX_AGE_SECONDS = 10 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEVICE_PATTERN = /^[a-zA-Z0-9._:-]{8,120}$/;
const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value, max = 160) =>
  String(value || "")
    .trim()
    .slice(0, max);
const exactKeys = (value, allowed) =>
  isRecord(value) &&
  Object.keys(value).every((key) => allowed.includes(key)) &&
  allowed.every((key) => Object.hasOwn(value, key));

export class FitCoachPlatformError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = "FitCoachPlatformError";
    this.code = code;
    this.status = status;
  }
}

export function isAllowedPlatformOrigin(value) {
  const origin = clean(value, 300);
  // Native URLSession/OkHttp requests do not send an Origin header. Browser
  // callers do, and must match this explicit list.
  return !origin || ALLOWED_ORIGINS.has(origin);
}

export function setFitCoachPlatformCors(req, res, methods = "GET, PUT, POST, DELETE, OPTIONS") {
  const origin = clean(req?.headers?.origin, 300);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-FitCoach-Build, X-FitCoach-Device"
  );
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Origin, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function platformEnv(env = process.env) {
  const url = clean(env.SUPABASE_URL, 500).replace(/\/+$/, "");
  const secret = clean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, 8_000);
  if (!url || !secret) {
    throw new FitCoachPlatformError("ACCOUNT_STORAGE_NOT_CONFIGURED", 503);
  }
  return { url, secret };
}

function bearerToken(req) {
  const header = clean(req?.headers?.authorization, 10_000);
  if (!header.startsWith("Bearer ")) return "";
  const token = header.slice(7).trim();
  return token.length >= 32 && token.length <= 8_192 ? token : "";
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return {};
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function responseJson(response) {
  try {
    return typeof response?.json === "function" ? await response.json() : null;
  } catch {
    return null;
  }
}

function providerNames(user) {
  const fromMetadata = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers
    : [user?.app_metadata?.provider];
  const fromIdentities = Array.isArray(user?.identities)
    ? user.identities.map((identity) => identity?.provider)
    : [];
  return [
    ...new Set(
      [...fromMetadata, ...fromIdentities].map((value) => clean(value, 40)).filter(Boolean)
    ),
  ];
}

export async function authenticateFitCoachRequest(
  req,
  { fetchImpl = fetch, env = process.env } = {}
) {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: "AUTH_REQUIRED" };

  let config;
  try {
    config = platformEnv(env);
  } catch (error) {
    return { ok: false, status: error.status || 503, error: error.code || "AUTH_UNAVAILABLE" };
  }

  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.secret,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch {
    return { ok: false, status: 503, error: "AUTH_UNAVAILABLE" };
  }
  if (!response.ok) return { ok: false, status: 401, error: "AUTH_INVALID" };
  const user = await responseJson(response);
  if (!UUID_PATTERN.test(clean(user?.id, 80))) {
    return { ok: false, status: 401, error: "AUTH_INVALID" };
  }

  // Claims are consumed only after Supabase has validated the same bearer token.
  const claims = decodeJwtPayload(token);
  const authenticationTimes = [
    Number(claims.auth_time || 0),
    ...(Array.isArray(claims.amr) ? claims.amr.map((item) => Number(item?.timestamp || 0)) : []),
  ].filter((value) => Number.isFinite(value) && value > 0);
  // A refreshed access token can have a recent iat without a fresh login, so
  // access-token issuance time is deliberately not accepted as reauthentication.
  const issuedAt = authenticationTimes.length ? Math.max(...authenticationTimes) : 0;
  return {
    ok: true,
    subjectId: clean(user.id, 80),
    sessionId: clean(claims.session_id, 160),
    issuedAt: Number.isFinite(issuedAt) ? issuedAt : 0,
    providers: providerNames(user),
  };
}

export function hasRecentAuthentication(
  auth,
  { now = new Date(), maxAgeSeconds = RECENT_AUTH_MAX_AGE_SECONDS } = {}
) {
  const issuedAt = Number(auth?.issuedAt || 0);
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  return Boolean(
    auth?.ok &&
    issuedAt > 0 &&
    issuedAt <= nowSeconds + 60 &&
    nowSeconds - issuedAt <= maxAgeSeconds
  );
}

function safePublicSupabaseKey(value, serviceSecret = "") {
  const key = clean(value, 8_000);
  if (!key || key === serviceSecret || key.startsWith("sb_secret_")) return "";
  if (key.startsWith("sb_publishable_")) return key;
  const claims = decodeJwtPayload(key);
  return claims.role === "anon" ? key : "";
}

function safePublicSupabaseUrl(value) {
  const candidate = clean(value, 500).replace(/\/+$/, "");
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) {
      return url.origin;
    }
  } catch {
    // Fail closed below.
  }
  return "";
}

export function isAllowedFitCoachBuild(value, env = process.env) {
  const build = clean(value, 80);
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(build)) return false;
  const configured = clean(env.FITCOACH_ALLOWED_CLIENT_BUILDS, 500)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return !configured.length || configured.includes(build);
}

function appleVerifierCredentialsConfigured(env = process.env) {
  return [
    env.FITCOACH_APPLE_ISSUER_ID,
    env.FITCOACH_APPLE_KEY_ID,
    env.FITCOACH_APPLE_BUNDLE_ID,
    env.FITCOACH_APPLE_PRIVATE_KEY_B64,
  ].every((value) => Boolean(clean(value, 20_000)));
}

function googleVerifierCredentialsConfigured(env = process.env) {
  const packageName = clean(env.FITCOACH_GOOGLE_PLAY_PACKAGE_NAME, 240);
  const encoded = clean(env.FITCOACH_GOOGLE_SERVICE_ACCOUNT_JSON_B64, 20_000);
  if (!packageName || !encoded) return false;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    return Boolean(clean(parsed?.client_email, 500) && clean(parsed?.private_key, 20_000));
  } catch {
    return false;
  }
}

export function subscriptionVerifierReadiness(platform, env = process.env) {
  const credentialsConfigured =
    platform === "apple"
      ? appleVerifierCredentialsConfigured(env)
      : platform === "google"
        ? googleVerifierCredentialsConfigured(env)
        : false;
  // Credentials by themselves never unlock premium. A reviewed verifier
  // adapter must return a signed-store result and call the private entitlement
  // transition. No such adapter is shipped in this foundation slice.
  return {
    platform,
    credentialsConfigured,
    verifierDeployed: false,
    available: false,
    setupRequired: true,
  };
}

export function publicFitCoachPlatformConfig(env = process.env) {
  const serviceSecret = clean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, 8_000);
  const serverSupabaseUrl = safePublicSupabaseUrl(env.SUPABASE_URL);
  const configuredPublicUrl = safePublicSupabaseUrl(env.FITCOACH_PUBLIC_SUPABASE_URL);
  const supabaseUrl =
    configuredPublicUrl && configuredPublicUrl === serverSupabaseUrl ? configuredPublicUrl : "";
  const anonKey = safePublicSupabaseKey(env.FITCOACH_PUBLIC_SUPABASE_ANON_KEY, serviceSecret);
  const providers = clean(env.FITCOACH_AUTH_PROVIDERS, 120)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => ["email", "apple", "google"].includes(item));
  const authEnabled = Boolean(supabaseUrl && anonKey && providers.length);
  let storageConfigured = false;
  let encryptionConfigured = false;
  try {
    platformEnv(env);
    storageConfigured = true;
  } catch {}
  try {
    parseEncryptionKey(env);
    encryptionConfigured = true;
  } catch {}
  const consentVersion = clean(env.FITCOACH_SYNC_CONSENT_VERSION, 80);
  const syncAvailable = Boolean(
    env.FITCOACH_ACCOUNT_SYNC_ENABLED === "1" &&
    authEnabled &&
    storageConfigured &&
    encryptionConfigured &&
    /^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/.test(consentVersion)
  );
  const apple = subscriptionVerifierReadiness("apple", env);
  const google = subscriptionVerifierReadiness("google", env);
  return {
    platformVersion: FITCOACH_PLATFORM_VERSION,
    auth: {
      enabled: authEnabled,
      supabaseUrl: authEnabled ? supabaseUrl : null,
      anonKey: authEnabled ? anonKey : null,
      providers: authEnabled ? [...new Set(providers)] : [],
      optional: true,
    },
    sync: {
      available: syncAvailable,
      consentVersion: syncAvailable ? consentVersion : null,
      localModeAvailable: true,
      encryption: syncAvailable ? "AES-256-GCM" : null,
    },
    account: {
      exportAvailable: syncAvailable,
      deletionAvailable: Boolean(authEnabled && storageConfigured),
      entitlementsAvailable: Boolean(authEnabled && storageConfigured),
      socialIdentityDeletionAvailable: false,
    },
    subscriptions: {
      available: false,
      verificationContractReady: true,
      apple: { available: apple.available, setupRequired: apple.setupRequired },
      google: { available: google.available, setupRequired: google.setupRequired },
    },
    nutrition: {
      usdaVerifiedSearch: Boolean(clean(env.FDC_API_KEY, 240)),
      openFoodFactsFallback: true,
    },
  };
}

function parseEncryptionKey(env = process.env, requestedVersion = "") {
  const activeVersion = clean(env.FITCOACH_DATA_ENCRYPTION_KEY_VERSION || "v1", 40);
  const version = clean(requestedVersion || activeVersion, 40);
  if (!/^[a-zA-Z0-9._-]{1,40}$/.test(activeVersion) || !/^[a-zA-Z0-9._-]{1,40}$/.test(version)) {
    throw new FitCoachPlatformError("DATA_ENCRYPTION_KEY_INVALID", 503);
  }
  const rawKeyRing =
    typeof env.FITCOACH_DATA_ENCRYPTION_KEYS_JSON === "string"
      ? env.FITCOACH_DATA_ENCRYPTION_KEYS_JSON.trim()
      : "";
  let encoded = "";
  if (rawKeyRing) {
    if (rawKeyRing.length > 20_000) {
      throw new FitCoachPlatformError("DATA_ENCRYPTION_KEY_INVALID", 503);
    }
    try {
      const parsed = JSON.parse(rawKeyRing);
      const entries = isRecord(parsed) ? Object.entries(parsed) : [];
      if (
        !entries.length ||
        entries.length > 10 ||
        entries.some(([key]) => !/^[a-zA-Z0-9._-]{1,40}$/.test(key))
      ) {
        throw new Error("invalid key ring");
      }
      encoded = clean(parsed[version], 500);
    } catch {
      throw new FitCoachPlatformError("DATA_ENCRYPTION_KEY_INVALID", 503);
    }
  } else {
    if (requestedVersion && version !== activeVersion) {
      throw new FitCoachPlatformError("DATA_ENCRYPTION_KEY_UNAVAILABLE", 503);
    }
    encoded = clean(env.FITCOACH_DATA_ENCRYPTION_KEY_B64, 500);
  }
  if (!encoded) throw new FitCoachPlatformError("DATA_ENCRYPTION_NOT_CONFIGURED", 503);
  const key = Buffer.from(encoded, "base64");
  if (
    key.length !== 32 ||
    key.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")
  ) {
    throw new FitCoachPlatformError("DATA_ENCRYPTION_KEY_INVALID", 503);
  }
  return {
    key,
    version,
  };
}

function subjectKey(masterKey, subjectId) {
  if (!UUID_PATTERN.test(clean(subjectId, 80))) {
    throw new FitCoachPlatformError("INVALID_SUBJECT", 400);
  }
  const salt = createHash("sha256").update(`fitcoach-subject:${subjectId}`).digest();
  return Buffer.from(
    hkdfSync(
      "sha256",
      masterKey,
      salt,
      Buffer.from("fitcoach-state-envelope:aes-256-gcm:v1", "utf8"),
      32
    )
  );
}

function envelopeAad(subjectId, schemaVersion, keyVersion) {
  return Buffer.from(
    `${FITCOACH_PLATFORM_VERSION}|${subjectId}|${schemaVersion}|${keyVersion}`,
    "utf8"
  );
}

function serializedState(state) {
  if (!isRecord(state)) throw new FitCoachPlatformError("INVALID_SYNC_STATE", 400);
  let serialized;
  try {
    serialized = JSON.stringify(state);
  } catch {
    throw new FitCoachPlatformError("INVALID_SYNC_STATE", 400);
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (!bytes || bytes > MAX_SYNC_STATE_BYTES) {
    throw new FitCoachPlatformError("SYNC_STATE_TOO_LARGE", 413);
  }
  return { serialized, bytes };
}

export function encryptFitCoachState(
  state,
  { subjectId, schemaVersion, env = process.env, randomBytesImpl = randomBytes } = {}
) {
  const safeSchemaVersion = Number(schemaVersion);
  if (!Number.isInteger(safeSchemaVersion) || safeSchemaVersion < 1 || safeSchemaVersion > 100) {
    throw new FitCoachPlatformError("INVALID_SCHEMA_VERSION", 400);
  }
  const { serialized, bytes } = serializedState(state);
  const { key: masterKey, version: keyVersion } = parseEncryptionKey(env);
  const key = subjectKey(masterKey, subjectId);
  const nonce = Buffer.from(randomBytesImpl(12));
  if (nonce.length !== 12) throw new FitCoachPlatformError("ENCRYPTION_NONCE_FAILED", 500);
  const aad = envelopeAad(subjectId, safeSchemaVersion, keyVersion);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: "AES-256-GCM",
    key_version: keyVersion,
    schema_version: safeSchemaVersion,
    nonce_b64: nonce.toString("base64"),
    ciphertext_b64: ciphertext.toString("base64"),
    auth_tag_b64: authTag.toString("base64"),
    plaintext_digest: createHash("sha256").update(serialized).digest("hex"),
    plaintext_bytes: bytes,
  };
}

export function decryptFitCoachState(envelope, { subjectId, env = process.env } = {}) {
  if (!isRecord(envelope) || envelope.algorithm !== "AES-256-GCM") {
    throw new FitCoachPlatformError("INVALID_ENCRYPTED_STATE", 500);
  }
  const keyVersion = clean(envelope.key_version, 40);
  const { key: masterKey } = parseEncryptionKey(env, keyVersion);
  const schemaVersion = Number(envelope.schema_version);
  const nonce = Buffer.from(clean(envelope.nonce_b64, 200), "base64");
  const ciphertext = Buffer.from(
    clean(envelope.ciphertext_b64, MAX_SYNC_STATE_BYTES * 2 + 1_000),
    "base64"
  );
  const authTag = Buffer.from(clean(envelope.auth_tag_b64, 200), "base64");
  if (
    !keyVersion ||
    !Number.isInteger(schemaVersion) ||
    nonce.length !== 12 ||
    authTag.length !== 16 ||
    !ciphertext.length
  ) {
    throw new FitCoachPlatformError("INVALID_ENCRYPTED_STATE", 500);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", subjectKey(masterKey, subjectId), nonce);
    decipher.setAAD(envelopeAad(subjectId, schemaVersion, keyVersion));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8"
    );
    const expectedDigest = Buffer.from(clean(envelope.plaintext_digest, 64), "hex");
    const actualDigest = createHash("sha256").update(plaintext).digest();
    if (
      expectedDigest.length !== actualDigest.length ||
      !timingSafeEqual(expectedDigest, actualDigest)
    ) {
      throw new Error("digest mismatch");
    }
    const state = JSON.parse(plaintext);
    if (!isRecord(state)) throw new Error("invalid state");
    return state;
  } catch {
    throw new FitCoachPlatformError("ENCRYPTED_STATE_AUTH_FAILED", 500);
  }
}

export function parseSyncPutRequest(input) {
  if (!exactKeys(input, ["base_revision", "device_id", "schema_version", "state"])) {
    return { ok: false, status: 400, error: "INVALID_SYNC_ENVELOPE" };
  }
  if (
    typeof input.base_revision !== "number" ||
    typeof input.schema_version !== "number" ||
    typeof input.device_id !== "string"
  ) {
    return { ok: false, status: 400, error: "INVALID_SYNC_ENVELOPE" };
  }
  const baseRevision = Number(input.base_revision);
  const schemaVersion = Number(input.schema_version);
  const deviceId = clean(input.device_id, 120);
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    return { ok: false, status: 400, error: "INVALID_BASE_REVISION" };
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 100) {
    return { ok: false, status: 400, error: "INVALID_SCHEMA_VERSION" };
  }
  if (!DEVICE_PATTERN.test(deviceId) || !isRecord(input.state)) {
    return { ok: false, status: 400, error: "INVALID_SYNC_ENVELOPE" };
  }
  try {
    serializedState(input.state);
  } catch (error) {
    return { ok: false, status: error.status || 400, error: error.code || "INVALID_SYNC_STATE" };
  }
  return {
    ok: true,
    request: { baseRevision, deviceId, schemaVersion, state: input.state },
  };
}

export function parseConsentRequest(input) {
  if (!exactKeys(input, ["decision", "policy", "policy_version"])) {
    return { ok: false, status: 400, error: "INVALID_CONSENT_ENVELOPE" };
  }
  if (
    ![input.decision, input.policy, input.policy_version].every(
      (value) => typeof value === "string"
    )
  ) {
    return { ok: false, status: 400, error: "INVALID_CONSENT_ENVELOPE" };
  }
  const policy = clean(input.policy, 80);
  const policyVersion = clean(input.policy_version, 80);
  const decision = clean(input.decision, 20);
  if (
    policy !== FITCOACH_SYNC_CONSENT_POLICY ||
    !/^\d{4}-\d{2}-\d{2}(?:\.\d+)?$/.test(policyVersion)
  ) {
    return { ok: false, status: 400, error: "INVALID_CONSENT_POLICY" };
  }
  if (!new Set(["accepted", "revoked"]).has(decision)) {
    return { ok: false, status: 400, error: "INVALID_CONSENT_DECISION" };
  }
  return { ok: true, request: { policy, policyVersion, decision } };
}

export function parseSubscriptionRequest(input) {
  if (!isRecord(input)) return { ok: false, status: 400, error: "INVALID_SUBSCRIPTION_ENVELOPE" };
  const allowed = new Set([
    "operation",
    "platform",
    "product_id",
    "purchase_token",
    "transaction_id",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    return { ok: false, status: 400, error: "INVALID_SUBSCRIPTION_ENVELOPE" };
  }
  const platformValue = input.platform;
  const operationValue = input.operation === undefined ? "verify" : input.operation;
  const productValue = input.product_id;
  const transactionValue = input.transaction_id === undefined ? "" : input.transaction_id;
  const purchaseValue = input.purchase_token === undefined ? "" : input.purchase_token;
  if (
    ![platformValue, operationValue, productValue, transactionValue, purchaseValue].every(
      (value) => typeof value === "string"
    )
  ) {
    return { ok: false, status: 400, error: "INVALID_SUBSCRIPTION_ENVELOPE" };
  }
  if (
    platformValue.length > 20 ||
    operationValue.length > 20 ||
    productValue.length > 160 ||
    transactionValue.length > 180 ||
    purchaseValue.length > 4_000
  ) {
    return { ok: false, status: 400, error: "INVALID_SUBSCRIPTION_ENVELOPE" };
  }
  const platform = clean(platformValue, 20);
  const operation = clean(operationValue, 20);
  const productId = clean(productValue, 160);
  const transactionId = clean(transactionValue, 180);
  const purchaseToken = clean(purchaseValue, 4_000);
  if (
    !["apple", "google"].includes(platform) ||
    !["verify", "restore", "reconcile"].includes(operation) ||
    !/^[a-zA-Z0-9._-]{3,160}$/.test(productId)
  ) {
    return { ok: false, status: 400, error: "INVALID_SUBSCRIPTION_ENVELOPE" };
  }
  if (platform === "apple" && (!/^\d{6,180}$/.test(transactionId) || purchaseToken)) {
    return { ok: false, status: 400, error: "INVALID_APPLE_TRANSACTION" };
  }
  if (
    platform === "google" &&
    (transactionId || !/^[a-zA-Z0-9._~+\/-]{20,4000}$/.test(purchaseToken))
  ) {
    return { ok: false, status: 400, error: "INVALID_GOOGLE_PURCHASE_TOKEN" };
  }
  return {
    ok: true,
    request: {
      platform,
      operation,
      productId,
      verificationToken: platform === "apple" ? transactionId : purchaseToken,
      requestDigest: createHash("sha256")
        .update(
          `${platform}|${operation}|${productId}|${platform === "apple" ? transactionId : purchaseToken}`
        )
        .digest("hex"),
    },
  };
}

export function fitCoachStoreAccountBinding(subjectId) {
  if (!UUID_PATTERN.test(clean(subjectId, 80))) {
    throw new FitCoachPlatformError("INVALID_SUBJECT", 400);
  }
  const normalizedSubjectId = subjectId.toLowerCase();
  return {
    appleAppAccountToken: normalizedSubjectId,
    googleObfuscatedAccountId: createHash("sha256")
      .update(`fitcoach-store-account-v1:${normalizedSubjectId}`)
      .digest("hex"),
  };
}

export async function verifyFitCoachSubscription(
  auth,
  request,
  { verifiers = {}, env = process.env, now = new Date() } = {}
) {
  const readiness = subscriptionVerifierReadiness(request.platform, env);
  const verifier = verifiers?.[request.platform];
  if (!readiness.credentialsConfigured || typeof verifier !== "function") {
    throw new FitCoachPlatformError("SUBSCRIPTION_VERIFIER_SETUP_REQUIRED", 503);
  }
  const allowedProducts = clean(env.FITCOACH_SUBSCRIPTION_PRODUCT_IDS, 2_000)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[a-zA-Z0-9._-]{3,160}$/.test(item));
  if (!allowedProducts.length) {
    throw new FitCoachPlatformError("SUBSCRIPTION_VERIFIER_SETUP_REQUIRED", 503);
  }
  if (!allowedProducts.includes(request.productId)) {
    throw new FitCoachPlatformError("SUBSCRIPTION_PRODUCT_NOT_ALLOWED", 403);
  }
  const result = await verifier({
    subjectId: auth.subjectId,
    operation: request.operation,
    productId: request.productId,
    verificationToken: request.verificationToken,
  });
  if (!isRecord(result) || result.verified !== true) {
    throw new FitCoachPlatformError("SUBSCRIPTION_NOT_VERIFIED", 403);
  }
  if (clean(result.productId, 160) !== request.productId) {
    throw new FitCoachPlatformError("SUBSCRIPTION_PRODUCT_MISMATCH", 403);
  }
  const expectedBinding = fitCoachStoreAccountBinding(auth.subjectId);
  const trustedBinding = clean(result.accountBinding, 180).toLowerCase();
  const expectedStoreBinding =
    request.platform === "apple"
      ? expectedBinding.appleAppAccountToken
      : expectedBinding.googleObfuscatedAccountId;
  if (!trustedBinding || trustedBinding !== expectedStoreBinding) {
    throw new FitCoachPlatformError("SUBSCRIPTION_ACCOUNT_MISMATCH", 403);
  }
  const source = request.platform === "apple" ? "app_store" : "play_store";
  const status = clean(result.status, 40);
  const eventId = clean(result.eventId, 180);
  const providerReference = clean(result.providerReference, 4_000);
  if (
    !new Set(["active", "grace", "paused", "expired", "revoked"]).has(status) ||
    eventId.length < 16 ||
    !providerReference
  ) {
    throw new FitCoachPlatformError("SUBSCRIPTION_VERIFIER_INVALID_RESULT", 502);
  }
  const expiresAt = result.expiresAt ? new Date(result.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new FitCoachPlatformError("SUBSCRIPTION_VERIFIER_INVALID_RESULT", 502);
  }
  if (
    ["active", "grace", "paused"].includes(status) &&
    (!expiresAt || expiresAt.getTime() <= now.getTime())
  ) {
    throw new FitCoachPlatformError("SUBSCRIPTION_VERIFIER_INVALID_RESULT", 502);
  }
  return {
    source,
    status,
    eventId: createHash("sha256").update(`${source}:${eventId}`).digest("hex"),
    eventType: clean(result.eventType || request.operation, 100),
    productId: request.productId,
    expiresAt: expiresAt?.toISOString() || null,
    providerReferenceDigest: createHash("sha256").update(providerReference).digest("hex"),
    payloadDigest: createHash("sha256")
      .update(
        JSON.stringify({
          source,
          status,
          eventId,
          productId: request.productId,
          expiresAt: expiresAt?.toISOString() || null,
        })
      )
      .digest("hex"),
  };
}

export async function applyVerifiedFitCoachEntitlement(
  subjectId,
  verified,
  { fetchImpl = fetch, env = process.env } = {}
) {
  const data = await supabaseAdminRequest("/rest/v1/rpc/fitcoach_apply_verified_entitlement", {
    method: "POST",
    fetchImpl,
    env,
    body: {
      p_subject_id: subjectId,
      p_event_id: verified.eventId,
      p_source: verified.source,
      p_event_type: verified.eventType,
      p_product_id: verified.productId,
      p_status: verified.status,
      p_provider_reference_digest: verified.providerReferenceDigest,
      p_payload_digest: verified.payloadDigest,
      p_expires_at: verified.expiresAt,
    },
  });
  return data === true || (Array.isArray(data) && data[0] === true);
}

async function supabaseAdminRequest(
  path,
  { method = "GET", body, fetchImpl = fetch, env = process.env, prefer = "" } = {}
) {
  const config = platformEnv(env);
  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, `${config.url}${path}`, {
      method,
      headers: {
        apikey: config.secret,
        Authorization: `Bearer ${config.secret}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new FitCoachPlatformError("ACCOUNT_STORAGE_UNAVAILABLE", 503);
  }
  const data = response.status === 204 ? null : await responseJson(response);
  if (!response.ok) {
    const providerMessage = clean(data?.message || data?.hint, 160);
    if (providerMessage.includes("FITCOACH_SYNC_CONFLICT")) {
      throw new FitCoachPlatformError("SYNC_CONFLICT", 409);
    }
    if (providerMessage.includes("FITCOACH_SYNC_CONSENT_REQUIRED")) {
      throw new FitCoachPlatformError("SYNC_CONSENT_REQUIRED", 403);
    }
    if (providerMessage.includes("FITCOACH_ACCOUNT_DELETED")) {
      throw new FitCoachPlatformError("ACCOUNT_DELETED", 410);
    }
    if (providerMessage.includes("FITCOACH_SUBSCRIPTION_REPLAY_MISMATCH")) {
      throw new FitCoachPlatformError("SUBSCRIPTION_REPLAY_MISMATCH", 409);
    }
    throw new FitCoachPlatformError("ACCOUNT_STORAGE_UNAVAILABLE", 503);
  }
  return data;
}

export async function loadFitCoachSyncState(
  subjectId,
  { fetchImpl = fetch, env = process.env } = {}
) {
  const params = new URLSearchParams({
    subject_id: `eq.${subjectId}`,
    document_type: "eq.state",
    select:
      "revision,schema_version,algorithm,key_version,nonce_b64,ciphertext_b64,auth_tag_b64,plaintext_digest,plaintext_bytes,updated_at",
    limit: "1",
  });
  const data = await supabaseAdminRequest(`/rest/v1/fitcoach_sync_documents?${params}`, {
    fetchImpl,
    env,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { revision: 0, schemaVersion: null, state: null, updatedAt: null };
  const state = decryptFitCoachState(row, { subjectId, env });
  return {
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    state,
    updatedAt: clean(row.updated_at, 60),
  };
}

export async function saveFitCoachSyncState(
  subjectId,
  request,
  { fetchImpl = fetch, env = process.env, randomBytesImpl = randomBytes } = {}
) {
  const envelope = encryptFitCoachState(request.state, {
    subjectId,
    schemaVersion: request.schemaVersion,
    env,
    randomBytesImpl,
  });
  const data = await supabaseAdminRequest("/rest/v1/rpc/fitcoach_put_sync_document", {
    method: "POST",
    fetchImpl,
    env,
    body: {
      p_subject_id: subjectId,
      p_document_type: "state",
      p_base_revision: request.baseRevision,
      p_device_id: request.deviceId,
      p_consent_version: clean(env.FITCOACH_SYNC_CONSENT_VERSION || "", 80),
      p_schema_version: envelope.schema_version,
      p_algorithm: envelope.algorithm,
      p_key_version: envelope.key_version,
      p_nonce_b64: envelope.nonce_b64,
      p_ciphertext_b64: envelope.ciphertext_b64,
      p_auth_tag_b64: envelope.auth_tag_b64,
      p_plaintext_digest: envelope.plaintext_digest,
      p_plaintext_bytes: envelope.plaintext_bytes,
    },
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!Number.isSafeInteger(Number(row?.revision)) || Number(row.revision) < 1) {
    throw new FitCoachPlatformError("ACCOUNT_STORAGE_UNAVAILABLE", 503);
  }
  return { revision: Number(row.revision), updatedAt: clean(row.updated_at, 60) };
}

export async function recordFitCoachConsent(
  subjectId,
  request,
  { fetchImpl = fetch, env = process.env } = {}
) {
  const data = await supabaseAdminRequest("/rest/v1/rpc/fitcoach_record_consent", {
    method: "POST",
    fetchImpl,
    env,
    body: {
      p_subject_id: subjectId,
      p_policy: request.policy,
      p_policy_version: request.policyVersion,
      p_status: request.decision,
    },
  });
  const row = Array.isArray(data) ? data[0] : data;
  return {
    policy: clean(row?.policy || request.policy, 80),
    policyVersion: clean(row?.policy_version || request.policyVersion, 80),
    status: clean(row?.status || request.decision, 20),
    decidedAt: clean(row?.decided_at, 60),
  };
}

export async function loadFitCoachEntitlements(
  subjectId,
  { fetchImpl = fetch, env = process.env, now = new Date() } = {}
) {
  const params = new URLSearchParams({
    subject_id: `eq.${subjectId}`,
    select: "source,product_id,status,expires_at,updated_at",
    order: "updated_at.desc",
    limit: "20",
  });
  const data = await supabaseAdminRequest(`/rest/v1/fitcoach_entitlements?${params}`, {
    fetchImpl,
    env,
  });
  const nowMs = now.getTime();
  return (Array.isArray(data) ? data : []).map((row) => {
    const expiresAt = clean(row?.expires_at, 60) || null;
    const providerStatus = clean(row?.status, 40);
    const active =
      ["active", "grace"].includes(providerStatus) &&
      Boolean(expiresAt && new Date(expiresAt).getTime() > nowMs);
    return {
      source: clean(row?.source, 40),
      productId: clean(row?.product_id, 160),
      status: providerStatus,
      active,
      expiresAt,
      updatedAt: clean(row?.updated_at, 60),
    };
  });
}

async function loadAccountRows(path, options) {
  const data = await supabaseAdminRequest(path, options);
  return Array.isArray(data) ? data : [];
}

export async function buildFitCoachExport(
  subjectId,
  { fetchImpl = fetch, env = process.env, now = new Date() } = {}
) {
  const [sync, consents, entitlements] = await Promise.all([
    loadFitCoachSyncState(subjectId, { fetchImpl, env }),
    loadAccountRows(
      `/rest/v1/fitcoach_consents?${new URLSearchParams({
        subject_id: `eq.${subjectId}`,
        select: "policy,policy_version,status,decided_at",
        order: "decided_at.asc",
      })}`,
      { fetchImpl, env }
    ),
    loadFitCoachEntitlements(subjectId, { fetchImpl, env, now }),
  ]);
  return {
    format: "fitcoach-portable-export-v1",
    generatedAt: now.toISOString(),
    platformVersion: FITCOACH_PLATFORM_VERSION,
    syncRevision: sync.revision,
    schemaVersion: sync.schemaVersion,
    state: sync.state,
    consents: consents.map((row) => ({
      policy: clean(row?.policy, 80),
      policyVersion: clean(row?.policy_version, 80),
      status: clean(row?.status, 20),
      decidedAt: clean(row?.decided_at, 60),
    })),
    entitlements,
  };
}

export async function deleteFitCoachAccount(auth, { fetchImpl = fetch, env = process.env } = {}) {
  const socialProviders = (auth?.providers || []).filter(
    (provider) => !["email", "phone"].includes(provider)
  );
  if (socialProviders.length) {
    // Apple requires provider-token revocation. Do not claim deletion is
    // complete until a reviewed revocation adapter exists for every identity.
    throw new FitCoachPlatformError("SOCIAL_IDENTITY_REVOCATION_NOT_CONFIGURED", 503);
  }
  await supabaseAdminRequest("/rest/v1/rpc/fitcoach_request_account_deletion", {
    method: "POST",
    fetchImpl,
    env,
    body: {
      p_subject_id: auth.subjectId,
      p_request_id: createHash("sha256")
        .update(`${auth.subjectId}:${auth.sessionId}:${Date.now()}`)
        .digest("hex"),
    },
  });
  await supabaseAdminRequest(`/auth/v1/admin/users/${encodeURIComponent(auth.subjectId)}`, {
    method: "DELETE",
    fetchImpl,
    env,
  });
  return { deleted: true };
}

export function publicPlatformError(error) {
  if (error instanceof FitCoachPlatformError) {
    return { status: error.status, error: error.code };
  }
  return { status: 500, error: "PLATFORM_ERROR" };
}
