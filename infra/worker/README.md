# Instant-teardown Worker

A tiny Cloudflare Worker that powers the **live site teardown** on `teardown.html` (and an
optional **speed-to-lead** auto-reply). It reuses the exact same scan engine as the CLI tools
(`tools/lib/scan-core.mjs`), so on-screen findings match what outreach generates.

The static site can't scan other sites from the browser (CORS), so this is the small bit of
server it needs. It's free-tier-friendly and stateless.

## Deploy (~5 min)

```bash
cd infra/worker
npx wrangler login          # one time
npx wrangler deploy         # prints https://symbio-scan.<you>.workers.dev
```

Then point the site at it — paste the URL into `src/_data/site.js`:

```js
scanApi: "https://symbio-scan.<you>.workers.dev",
```

…and `npm run build`. Until `scanApi` is set, `teardown.html` gracefully falls back to the
normal free-scan form, so nothing is broken pre-deploy.

## Endpoints

- `POST /api/scan` `{ "url": "example.com" }` → `{ ok, reachable, score, findings: [{title, fix}] }`
- `POST /api/lead` `{ "name", "email", "business", "need" }` → sends an instant auto-reply to the
  lead **if** the mail secrets are set; always returns `{ ok }`.

## Optional: speed-to-lead auto-reply

Set these so `/api/lead` sends an instant acknowledgment the moment a lead comes in:

```bash
# in infra/worker/wrangler.toml [vars]: LEAD_FROM, PHYSICAL_ADDRESS, ALLOWED_ORIGIN
npx wrangler secret put RESEND_API_KEY   # from resend.com (free tier)
npx wrangler secret put LEAD_BCC          # optional — copies you on each reply
```

`LEAD_FROM` must be an address on a domain you've verified in Resend (use your **sending
domain**, e.g. `ravi@trysymbioai.com` — not `symbioai.dev`). With no key set, the endpoint just
acknowledges and your existing lead pipeline still captures the lead.
