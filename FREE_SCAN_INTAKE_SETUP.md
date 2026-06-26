# Permanent Free Scan Intake

The live site must not depend on a temporary `trycloudflare.com` tunnel. Use a permanent Cloudflare Worker as the public intake bridge.

## Flow

1. `symbioai.dev/scan.html` posts to `https://api.symbioai.dev/api/free-scan`.
2. Cloudflare Worker saves the lead in KV first, so the lead is captured even if Mohammed's laptop is offline.
3. Worker sends an email alert to `symbioaiiii@gmail.com`.
4. Worker sends SMS alerts to Mohammed and Ravi through Twilio.
5. Olympus dashboard syncs from the Worker using `OLYMPUS_REMOTE_FREE_SCAN_API` and `OLYMPUS_REMOTE_FREE_SCAN_TOKEN`, then mirrors leads into Atlas as `P0 - inbound free scan (reply first)`.

## Deploy Worker

```powershell
cd tmp/symbioai-dev-live
copy cloudflare\wrangler.toml.example wrangler.toml
npm install -D wrangler
npx wrangler login
npx wrangler kv namespace create FREE_SCAN_KV
```

Paste the returned KV namespace id into `wrangler.toml`.

Set secrets:

```powershell
npx wrangler secret put SYNC_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put TWILIO_FROM_NUMBER
```

Deploy:

```powershell
npx wrangler deploy
```

## Olympus Sync Env

Add these to Mohammed's Olympus env file:

```env
OLYMPUS_REMOTE_FREE_SCAN_API=https://api.symbioai.dev/api/free-scans
OLYMPUS_REMOTE_FREE_SCAN_TOKEN=the_same_SYNC_SECRET_used_in_worker
```

When Olympus refreshes `/api/free-scans`, it will pull remote leads and upsert them into Atlas.

## SMS Setup Requirements

Use Twilio:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER` in E.164 format, for example `+15551234567`
- Recipient numbers:
  - Mohammed: `+15105857136`
  - Ravi: `+19255978128`

If the Twilio account is still in trial mode, both recipient numbers must be verified in Twilio before SMS will send.

## Email Setup Requirements

Use Resend:

- `RESEND_API_KEY`
- `ALERT_EMAIL_TO=symbioaiiii@gmail.com`
- `ALERT_EMAIL_FROM=Symbio AI <alerts@symbioai.dev>`

`alerts@symbioai.dev` must be a verified sender/domain in Resend. During early testing, Resend's temporary sender can be used if the account allows it.
