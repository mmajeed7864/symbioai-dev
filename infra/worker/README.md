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
- `POST /api/lead` `{ "name", "email" or "phone", "business", "need" }` → notifies the team and,
  when configured, sends an instant auto-reply. It returns `ok: true` only after a team delivery is
  confirmed.

## Optional: speed-to-lead auto-reply

Set these so `/api/lead` sends an instant acknowledgment the moment a lead comes in:

```bash
# in infra/worker/wrangler.toml [vars]: LEAD_FROM, PHYSICAL_ADDRESS, ALLOWED_ORIGIN
npx wrangler secret put RESEND_API_KEY   # from resend.com (free tier)
npx wrangler secret put LEAD_BCC          # required for the auto-reply path; copies the team
```

`LEAD_FROM` must be an address on a domain you've verified in Resend (use your **sending
domain**, e.g. `ravi@trysymbioai.com` — not `symbioai.dev`). Without a confirmed Telegram or
Resend+BCC delivery, the endpoint returns a non-success status instead of claiming the lead arrived.

## Instant Telegram lead alerts (free — recommended)

The optional `/api/lead` route can send a Telegram alert when an integration posts a lead to it.
The production Symbio site currently sends form and chatbot leads through `/api/free-scan`; the
Worker remains responsible for instant teardown scans unless a client integration uses this route.

1. In Telegram, message **@BotFather** → `/newbot` → follow the prompts → copy the **bot token**.
2. Create a group (or use a DM), add your bot to it, send any message, then get the **chat id**:
   open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (groups are negative,
   e.g. `-1001234567890`).
3. Set the secrets and redeploy:
   ```bash
   cd infra/worker
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   npx wrangler deploy
   ```

That's it. Every scan/chat/teardown now pings your Telegram with the name, business, contact, and
what they need. (Requires `scanApi` set in `src/_data/site.js` so the site knows where to send —
the same Worker URL you already use for the teardown.)
