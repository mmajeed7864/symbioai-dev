# FitCoach account, sync, and store platform v1

Status: production-honest foundation. The API, encrypted schema, consent gate, export/deletion
contract, and store-verification state machine are implemented. They remain unavailable until the
reviewed Supabase migration and exact server configuration below are deployed. No client receipt
can unlock premium by itself.

## Public capability discovery

`GET /api/fitcoach-platform-config-v1` requires `X-FitCoach-Build: <semver>`. It returns only:

- the explicitly configured Supabase project URL and anon/publishable key;
- enabled sign-in providers;
- boolean account, sync, nutrition, and subscription capabilities;
- the exact sync-consent version when sync is available.

It never returns the Supabase service role, data-encryption keys, nutrition keys, or store
credentials. The public Supabase URL must exactly match the server-side Supabase URL. An anon key
that matches the service secret, has a service-role JWT claim, or uses an `sb_secret_` prefix is
rejected. Set `FITCOACH_ALLOWED_CLIENT_BUILDS` to a comma-separated allow-list to reject stale
clients; without it, a syntactically valid semantic version is still required.

The five stable platform URLs are rewritten to one public `fitcoach-platform-v1` serverless router;
their handlers remain underscore-prefixed internal modules. This preserves the external contracts
while keeping the Vercel deployment at its 12-function plan limit. The retired
`/api/fitcoach-transcribe` URL is likewise rewritten to the existing retired-route function and
continues to return the explicit no-store `410` response.

## Authentication and encrypted sync

The client authenticates with Supabase Auth, then sends the resulting access token to the FitCoach
API as a bearer token. The API validates that token with Supabase before accepting its subject ID.
It does not accept an email address, profile ID, or user ID from the request body.

Routes:

- `GET /api/fitcoach-sync-v1`: return the latest portable state and revision.
- `PUT /api/fitcoach-sync-v1`: compare-and-swap `{base_revision, device_id, schema_version, state}`.
- `POST /api/fitcoach-account-v1`: append the exact sync-processing consent decision.
- `GET /api/fitcoach-account-v1`: export state, consent history, and entitlements after recent
  authentication.
- `DELETE /api/fitcoach-account-v1`: purge FitCoach rows and the Supabase Auth account after recent
  authentication and exact `{confirmation:"DELETE MY FITCOACH ACCOUNT"}`.
- `GET /api/fitcoach-entitlements-v1`: return server-derived subscription status.

Every route is no-store, origin bounded for browser clients, accepts native requests without an
Origin header, and requires the client-build header. Sync writes require the latest accepted
`sync_processing` consent at exactly `FITCOACH_SYNC_CONSENT_VERSION`. A later revocation blocks
new sync writes. Writes use database compare-and-swap revisions so two devices cannot silently
overwrite one another.

### Distributed abuse protection

Authenticated account routes consume an IP/network bucket **before** calling Supabase Auth, then
an operation-specific account bucket **after** Supabase validates the subject. Changing a device
ID, bearer token, request body, or API alias cannot reset the account bucket. On Vercel only the
platform-supplied `x-vercel-forwarded-for` header is trusted; outside Vercel only the socket address
is used. Unrecognized deployment/proxy setups must be reviewed instead of trusting arbitrary
forwarded headers. IPv4-mapped IPv6 addresses normalize to IPv4; IPv6 addresses share a /64 bucket.

Limits use atomic Redis Lua counters with expiring fixed windows starting at the first request:

| Bucket                                             | Requests |     Window |
| -------------------------------------------------- | -------: | ---------: |
| Shared IP/network, across protected routes         |      120 |   1 minute |
| Sync read, per account                             |       60 |   1 minute |
| Sync write, per account                            |       30 |   1 minute |
| Consent, per account                               |       10 | 10 minutes |
| Export, per account                                |        3 | 15 minutes |
| Deletion, per account                              |        3 | 15 minutes |
| Entitlements, per account                          |       60 |   1 minute |
| Subscription verify/restore/reconcile, per account |       10 | 10 minutes |
| Other authenticated helpers, per account           |      120 |   1 minute |

These are not sliding windows: requests can burst across a window boundary. A denied attempt
does not extend the window. Shared gym/school networks also share the IP budget; validate these
conservative starting limits with representative staging traffic before launch.

`429 RATE_LIMITED` includes a CORS-exposed `Retry-After` header in seconds and a no-store response.
Clients must honor this delay, use jittered backoff, preserve unsynced local changes, and never
automatically retry account deletion or receipt submission as an unbounded loop. An unavailable,
malformed, or timed-out limiter returns 503 instead of falling back to process-local counters.
The Redis timeout is three seconds per check. Account data capabilities stay unavailable if the
limiter is not configured; optional sign-in remains a separate capability. Configuration readiness
does not claim that Redis, Supabase, or a purchase verifier has passed live health checks.

Redis stores only operation-scoped HMAC pseudonyms and counters, not raw IPs, account UUIDs,
tokens, workout data, or receipts. Pseudonyms are not anonymous data: include this processor and
purpose in the privacy/retention review. Buckets expire after at most 15 minutes; provider backups,
access logs, and retention require separate review. Use a dedicated random server-side
`FITCOACH_RATE_LIMIT_SECRET` of at least 32 bytes; rotating it resets counters and should not be
used to bypass active limits. Do not reuse the account encryption key.

The implementation uses one atomic EVAL command per check, shared across function instances.
No additional public Vercel function is created. Redis must support EVAL, PTTL, GET, SET/PX, and
INCR. Configure a matched REST URL/token pair using the same precedence as the existing API:
`UPSTASH_REDIS_REST_*`, `KV_REST_API_*`, or `SYMBIO_REDIS_REST_*`. A partial higher-priority pair
fails closed; credentials are never mixed across pairs. This protects FitCoach account API
operations, not Supabase's own sign-up/login endpoints; those still need provider-side controls.

References: [Vercel trusted request headers](https://vercel.com/docs/headers/request-headers),
[Upstash Redis REST command API](https://upstash.com/docs/redis/features/restapi).

### Real Redis regression gate

`npm run test:fitcoach:redis` requires a real `redis-server` executable on PATH or the absolute
path in `FITCOACH_TEST_REDIS_SERVER`. Missing Redis is a failure, not a skipped passing check.
The dedicated GitHub workflow builds Redis 7.2.16 from its pinned upstream archive and verifies
its SHA-256 against the [upstream hash list](https://github.com/redis/redis-hashes/blob/master/README).
No additional application dependency or hosted storage is installed.

The fixture starts its own temporary server with TCP disabled, an owner-only Unix socket,
32 MiB memory limit and disk persistence disabled. It only removes the private temporary
directory it created, and only terminates that child process. Production Redis URLs, tokens,
data and environment files are never used. The production-generated EVAL command and arguments
run unchanged through the test transport; Redis itself executes the Lua, counters and clock.
This checks the atomic semantics described by the [Redis Lua documentation](https://redis.io/docs/latest/develop/interact/programmability/eval-intro/).

The suite proves exact shared allowances across independent concurrent connections, all operation
budgets and initial TTLs, non-extending denials, actual expiry/reset, normalized IP/account aliases,
account/scope separation, invalid/immortal bucket rejection and failure when the real socket is lost.
The expiry test deliberately shortens one private test key to 250 ms; original configured TTLs are
asserted separately. It does not wait every full 15-minute window.

This is stronger than a simulated Redis result, but it is not hosted Upstash/Redis staging proof:
HTTPS, provider authentication, regional replicas, production proxy headers, provider backup
retention and actual Supabase/database/device journeys must still be verified before activation.
Production limiter behavior and configured quotas are unchanged by this test-only addition.

State is encrypted by the API before it reaches Postgres using per-account HKDF-derived
AES-256-GCM keys, a random nonce, authenticated envelope metadata, and a plaintext digest. This is
encryption at the application layer, not end-to-end encryption: the FitCoach API can decrypt state
for sync/export. Keep the key ring in the encrypted hosting environment and out of client builds,
Git, logs, and screenshots.

For safe key rotation, configure `FITCOACH_DATA_ENCRYPTION_KEYS_JSON` as a JSON object whose values
are 32-byte base64 keys, then select the write key with `FITCOACH_DATA_ENCRYPTION_KEY_VERSION`.
Keep older keys present until every stored document has been read and rewritten under the new key.
The single-key `FITCOACH_DATA_ENCRYPTION_KEY_B64` variable remains a bootstrap option.

Apply `supabase/fitcoach_platform_v1.sql` only to the reviewed Supabase project after a schema
backup. Its tables keep direct browser access revoked; only service-role RPCs can write decrypted
account operations. RLS remains enabled as defense in depth.

## Store subscriptions and restore

`POST /api/fitcoach-subscriptions-v1` accepts one bounded request:

```json
{
  "operation": "verify",
  "platform": "apple",
  "product_id": "fitcoach.premium.monthly",
  "transaction_id": "123456789012345"
}
```

For Google Play, send `purchase_token` instead of `transaction_id`. `operation` may be `verify`,
`restore`, or `reconcile`; all three follow the same server verification path. The default route
returns `503 SUBSCRIPTION_VERIFIER_SETUP_REQUIRED`. That response is intentional until a reviewed
Apple App Store Server API or Google Play Developer API adapter and its credentials are deployed.

A verifier must prove all of the following before the private entitlement transition runs:

- the store signed/returned the transaction and its status;
- the verified product ID exactly matches the requested product;
- the purchase is bound to the authenticated FitCoach subject (`appAccountToken` on Apple or the
  deterministic obfuscated account ID on Google);
- the event is new or safely replayed.

Raw transaction IDs, purchase tokens, and provider references are never written to FitCoach
tables or returned to the client. Only SHA-256 digests and normalized entitlement state are stored.
An idempotent event ledger makes restore, reconciliation, App Store Server Notifications, and
Google real-time developer notifications converge on the same state transition. Native clients
must continue to use Apple/Google in-app purchase APIs for digital subscriptions; a web checkout
must not be substituted in the store builds without store-policy review.

Account deletion currently fails closed for Apple/Google social identities until token-revocation
adapters are reviewed. This prevents the UI from claiming deletion is complete when a provider
credential remains live.

## Verified nutrition providers

Text search uses USDA FoodData Central first when `FDC_API_KEY` is present server-side and falls
back explicitly to the Open Food Facts Search-a-licious POST API. The query stays out of the URL,
and the request asks for only the bounded product and nutrient fields required by FitCoach. Results
identify their source and per-100g basis. Barcode lookup remains Open Food Facts. Food requests
must declare `user_provided_food_lookup`; the API rejects synthetic and cross-purpose labels. If
every configured provider fails, the API reports
`NUTRITION_PROVIDER_UNAVAILABLE`; it never invents a verified result. Photo recognition remains
unavailable until a reviewed vision provider is configured.

The legacy Open Food Facts `/cgi/search.pl` endpoint is not used. It is a legacy full-text API and
can return a temporary 503 even while the dedicated Search-a-licious service is healthy.

## Server variables

Public-by-design values:

- `FITCOACH_PUBLIC_SUPABASE_URL`
- `FITCOACH_PUBLIC_SUPABASE_ANON_KEY`
- `FITCOACH_AUTH_PROVIDERS=email,apple,google`
- `FITCOACH_ALLOWED_CLIENT_BUILDS=0.5.4`

Server secrets and gates:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the matched aliases above)
- `FITCOACH_RATE_LIMIT_SECRET` (independent random secret, at least 32 bytes)
- `FITCOACH_ACCOUNT_SYNC_ENABLED=1`
- `FITCOACH_SYNC_CONSENT_VERSION=2026-08-31.1`
- `FITCOACH_DATA_ENCRYPTION_KEYS_JSON` and `FITCOACH_DATA_ENCRYPTION_KEY_VERSION`
- `FDC_API_KEY`
- `FITCOACH_SUBSCRIPTION_PRODUCT_IDS=fitcoach.premium.monthly,fitcoach.premium.yearly`
- Apple verifier: `FITCOACH_APPLE_ISSUER_ID`, `FITCOACH_APPLE_KEY_ID`,
  `FITCOACH_APPLE_BUNDLE_ID`, `FITCOACH_APPLE_PRIVATE_KEY_B64`
- Google verifier: `FITCOACH_GOOGLE_PLAY_PACKAGE_NAME`,
  `FITCOACH_GOOGLE_SERVICE_ACCOUNT_JSON_B64`

Credentials alone do not advertise subscriptions as available. The reviewed verifier code must
also be deployed. Do not place any server secret in the static PWA or native app bundle.

## Release gates

Before enabling accounts or premium in a public build:

1. Apply and review the migration in a non-production Supabase project, then exercise consent,
   conflict, export, deletion, and restore with real devices.
2. Configure a custom SMTP sender and abuse controls for Supabase Auth; test email verification,
   password recovery, Apple/Google sign-in, and provider revocation.
3. Add and independently test the official Apple and Google verifier adapters plus notification
   webhooks. A `setup_required` response must keep premium locked.
4. Publish matching privacy, youth, retention, export, and deletion policies. Do not onboard users
   under the allowed age for the chosen launch regions without the required parental-consent flow.
5. Back up Postgres and the encryption key ring, document rotation/recovery ownership, and prove a
   restore in staging.
6. Configure and exercise the implemented per-account/IP limits against real staging Redis and
   concurrent function instances. Prove bounded traffic, TTL expiry, network/provider outages,
   CORS Retry-After handling, and mobile sync backoff without lost local edits. Mocked transport
   tests do not establish live distributed/concurrency behavior or production readiness.
7. Run the full repository test, build, lint, secret-scan, and dependency-audit gates, then verify
   the live endpoints and database transitions. A passing deployment alone does not prove these
   integrations are configured.
