# Permanent Free Scan Intake

Cloudflare is no longer part of the production design.

## Permanent Flow

1. `symbioai.dev/scan.html` posts to the same-domain Vercel function: `/api/free-scan`.
2. Vercel stores the request in Supabase first.
3. Vercel sends an email alert through Resend.
4. Vercel sends SMS alerts through Twilio.
5. Olympus pulls saved leads from `/api/free-scans` with a private bearer token and mirrors them into Atlas as `P0 - inbound free scan (reply first)`.

This means the lead is captured even if Mohammed's laptop, Olympus server, or any tunnel is offline.

## Supabase Setup

Run `supabase/free_scan_requests.sql` in the Supabase SQL editor.

Required Vercel environment variables:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_FREE_SCAN_TABLE=free_scan_requests
OLYMPUS_REMOTE_FREE_SCAN_TOKEN=make_a_long_random_private_token
```

## Email Alerts

Recommended sender:

```env
ALERT_EMAIL_FROM=Symbio AI <freescan@symbioai.dev>
ALERT_EMAIL_TO=symbioaiiii@gmail.com
RESEND_API_KEY=your_resend_api_key
```

The sender domain must be verified in Resend.

## SMS Alerts

```env
SMS_TO=+15105857136,+19255978128
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+1_your_twilio_number
```

If Twilio is in trial mode, Mohammed and Ravi's numbers must be verified recipients.

## Olympus Sync

Set these in the Olympus environment:

```env
OLYMPUS_REMOTE_FREE_SCAN_API=https://www.symbioai.dev/api/free-scans
OLYMPUS_REMOTE_FREE_SCAN_TOKEN=the_same_private_token_from_vercel
```

When Olympus loads `/api/free-scans`, it will pull permanent Supabase leads and upsert them into Atlas.
