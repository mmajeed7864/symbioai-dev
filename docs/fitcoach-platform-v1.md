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
back explicitly to Open Food Facts. Results identify their source and per-100g basis. Barcode
lookup remains Open Food Facts. If every configured provider fails, the API reports
`NUTRITION_PROVIDER_UNAVAILABLE`; it never invents a verified result. Photo recognition remains
unavailable until a reviewed vision provider is configured.

## Server variables

Public-by-design values:

- `FITCOACH_PUBLIC_SUPABASE_URL`
- `FITCOACH_PUBLIC_SUPABASE_ANON_KEY`
- `FITCOACH_AUTH_PROVIDERS=email,apple,google`
- `FITCOACH_ALLOWED_CLIENT_BUILDS=0.5.4`

Server secrets and gates:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
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
6. Add authenticated per-account/IP rate limits for sync, export, deletion, and store verification;
   the current bounded contracts do not claim that production abuse protection is complete.
7. Run the full repository test, build, lint, secret-scan, and dependency-audit gates, then verify
   the live endpoints and database transitions. A passing deployment alone does not prove these
   integrations are configured.
