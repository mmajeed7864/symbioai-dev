# FitCoach native request boundary

## Contract

`api/_fitcoach-cors.js` owns the exact browser-origin allowlist shared by coach
(including nutrition actions), speech, account, sync, entitlements, purchase
verification and public configuration routes.

Alongside the existing website and local preview addresses it accepts:

- `capacitor://localhost`: the bundled iOS WebView's default origin.
- `https://localhost`: the bundled Android WebView's default origin.

These match the [Capacitor server defaults](https://capacitorjs.com/docs/config).
Do not add a production remote `server.url`, insecure mixed-content setting or
wildcard just to make a failed request succeed. If the app intentionally changes
its configured scheme or hostname, update the explicit contract and tests together.

The origin is matched literally, without trimming, URL parsing, prefix matching
or coercion. Opaque `null`, lookalike hosts, unexpected ports, paths, userinfo and
duplicate-header arrays are rejected. Unknown origins receive 403 on preflight
and actual requests; no matching allow-origin header is returned. Allowed origins
receive matching headers on successful and error responses, including build,
authentication and validation errors.

CORS is **not authentication or app identity**. Other installed apps may also use
localhost origins, and non-browser clients can supply an Origin header. Account
authentication, recent-auth checks, consent, build gates, encryption, account/IP
limits, provider budgets and store verification remain independent requirements.
No wildcard or ambient cross-origin cookie credentials are enabled. Platform
routes retain their existing explicit missing-Origin policy for native/server
clients; coach and speech still require an allowed Origin. Existing per-route
methods, allowed headers and exposed response metadata are preserved.

## Verification

Run the targeted unit and real HTTP checks:

```sh
node --test --test-concurrency=1 tests/fitcoach-cors.test.mjs tests/fitcoach-cors-http.test.mjs
```

The HTTP fixture imports the real production handlers; configuration alone uses
an empty environment. It binds only to 127.0.0.1, rejects credentials, cookies,
non-config platform routes and meaningful request payloads, and records only
method, path, origin and status. No account, nutrition, AI or speech provider
request is needed for these tests.

For browser verification, start it with:

```sh
node tests/integration/fitcoach-cors-http.mjs 4173
```

Open `http://localhost:4173/` in an isolated browser and make cross-origin requests
to `http://127.0.0.1:4173/api/…` with `Content-Type: application/json`,
`X-FitCoach-Build: 0.7.3` and `credentials: omit`. Configuration GET should be
readable with HTTP 200 and accounts/sync disabled. Coach and speech POST with the
exact body `{}` should be readable with HTTP 400 validation errors. They must not
be mistaken for successful AI or voice generation. Inspect browser-generated
OPTIONS and actual requests, then stop the fixture with Ctrl-C.

On 2026-09-08, isolated Chrome passed this real-browser path without recorded
page errors. A separate macOS WKWebView probe with a registered `capacitor` scheme
also read all three responses from `capacitor://localhost`; the same probe using
`capacitor://untrusted.localhost` could read none. This verifies WebKit's CORS
enforcement, **not** a compiled/signed Capacitor app, an iPhone, Android WebView,
ATS/TLS behavior, microphone/audio routing or live authenticated provider flows.

Before this change, live HTTPS preflight checks against `symbioai.dev` confirmed
the website origin worked, while both native origins failed: public config
returned 403 and coach/speech returned 204 without the necessary allow-origin
header. Local passing tests do not mean that production has been updated.

## Release follow-through

After deployment, repeat HTTPS preflight and harmless validation requests against
the deployed API, then exercise actual native builds on iPhone and Android. Use
staging accounts to test authenticated sync, consent, export/deletion, nutrition
and subscription verification separately. Keep release gates closed until those
flows and real-device behavior have their own evidence.
