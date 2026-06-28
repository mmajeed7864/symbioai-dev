# Symbio AI — tools

Internal automation that backs the [growth playbook](../GROWTH_PLAYBOOK.md). These live
under `tools/` and are **not** part of the published site — Eleventy only processes `src/`, so
nothing here ships to `dist/`.

**What's here**

- **`hermes/`** — the autonomous growth engine: outreach + an A/B learning loop that improves
  with use, plus a speed-to-lead `nurture` sequence and reporting. See
  [`hermes/README.md`](hermes/README.md). Start here.
- **`audit-outreach.mjs`** — the simple one-shot outreach generator (no learning loop).
- **`prospect-source.mjs`** — build a Hermes-ready `leads.csv` from the Google Places API or an
  existing export, with best-effort email enrichment. `npm run source`.
- **`new-client.mjs`** + **`client-template/`** — generate a deployable one-page client site from
  a JSON config (reuses the design system + AI widget). `npm run new-client`.
- **`set-stripe.mjs`** — paste Stripe Payment Links into the site by key. `npm run set-stripe`.
- **`lib/scan-core.mjs`** — the pure (no-Node) scan engine shared by the CLIs and the Worker.
- **`lib/outreach-core.mjs`** — the shared finding/email engine the outreach tools use.

> **Analytics** (not a script): set `analyticsDomain` in `src/_data/site.js` to your domain to
> enable cookieless Plausible analytics. Conversion events (`Lead`, `Teardown`, `CheckoutClick`,
> `PackageClick`, `WidgetLead`) then fire automatically from `main.js`. Off by default.

## 3. Prospect sourcing — `prospect-source.mjs`

```bash
# A) live, from Google Places (needs a key; costs per request):
npm run source -- --query "dentists in Fremont, CA" --niche dentist --key $GOOGLE_PLACES_KEY --out leads.csv
# B) normalize an existing export (Apify / Maps scrape / purchased list):
npm run source -- --in raw.csv --niche dentist --out leads.csv
```

For each business with a website it fetches the homepage and extracts a contact email. Output
columns feed Hermes directly. Respect the Places API terms and local law on email outreach.

## 4. Client-site generator — `new-client.mjs`

```bash
npm run new-client -- --config tools/client-template/example.json
# → clients-out/<slug>/  (index.html + assets, ready to deploy)
```

Fill a JSON (name, accent, services, about, contact, widget) and get a deployable one-page site
that reuses the Symbio design system in the client's colour, with the AI widget configured for
them. Turns each build into "edit a config, run a command." See `client-template/example.json`.

---

## 1. Audit-first outreach generator — `audit-outreach.mjs`

> For the self-improving version with A/B learning and reporting, use **Hermes**
> (`tools/hermes/`). This one is the plain, one-shot generator; both share
> `tools/lib/outreach-core.mjs`.

Turns a list of local businesses into ready-to-send, personalized cold emails. For each
prospect it runs a lightweight "scan" of their site, picks the **3 most compelling fixes**, and
writes a CAN-SPAM-compliant email that leads with those findings. This is Engine 1 of the
playbook — outreach that uses your own product (the free scan) as the hook, with no calling.

**Requirements:** Node 18+ (uses built-in `fetch`). No npm install needed — zero dependencies.

### Run it

```bash
# uses the sample list and the default config
npm run outreach

# or point it at your own list / options
node tools/audit-outreach.mjs --in leads.csv --out tools/out/run1.csv --limit 200
```

Flags: `--in` (CSV or JSON), `--out`, `--config`, `--limit`, `--concurrency` (default 4),
`--timeout` (ms, default 12000), `--delay` (ms between fetches per worker, default 250).

### Input format

A CSV (or JSON array) with these columns — only `email` is needed to actually send, the rest
sharpen personalization:

| column       | example                  | used for                          |
| ------------ | ------------------------ | --------------------------------- |
| `business`   | Bright Smile Dental      | greeting + subject line           |
| `website`    | https://brightsmile.com  | the scan (omit if they have none) |
| `email`      | owner@brightsmile.com    | the send                          |
| `first_name` | Dana                     | "Hi Dana," (falls back to "there")|
| `city`       | Fremont                  | local relevance                   |
| `niche`      | dentist                  | "I work with dentists and …"      |

See `prospects.sample.csv`. Build real lists from Google Maps / Google Business Profile data
(Apollo, a Maps scraper, or a purchased local-business list) — target niches that pay and tend
to have weak sites: dentists, contractors/trades, salons & med-spas, restaurants, gyms, law &
clinics, real estate, churches & nonprofits.

### What the scan checks

HTTPS · mobile viewport · page title · meta description · online booking · instant lead
capture (chat/forms) · load time · page weight. Missing-site and unreachable-site prospects get
their own tailored pitch.

### Output

Writes `tools/out/outreach.csv` **and** `tools/out/outreach.json`. Columns: `email`,
`first_name`, `company`, `website`, `city`, `niche`, `finding_1..3`, `subject`, `email_body`,
`status`. Import the CSV into your cold-email tool and map `{{subject}}` and `{{email_body}}`
(or build your own sequence from the `finding_*` columns).

### Before you send — deliverability + the law

- **Send from a SEPARATE, WARMED domain** (e.g. `trysymbioai.com`), never `symbioai.dev`. Set
  SPF, DKIM, DMARC; cap ~30–50/inbox/day. Tools: Smartlead, Instantly, Saleshandy, Woodpecker.
- **CAN-SPAM (US):** every commercial email needs a real physical postal address, a working
  opt-out, and honest from/subject lines. Set `physicalAddress` and `unsubscribeLine` in
  `outreach.config.json` — the defaults are placeholders.
- This tool **generates** emails; it does not send them. Sending, warmup, and unsubscribe
  handling are your cold-email platform's job.

### `outreach.config.json`

Your sender identity, injected into every email:

```json
{
  "fromName": "Ravi",
  "company": "Symbio AI",
  "serviceLine": "I build fast websites, booking systems, and AI assistants for local businesses.",
  "websiteUrl": "https://symbioai.dev",
  "physicalAddress": "Symbio AI — <add your real mailing address>, <City, ST ZIP>",
  "unsubscribeLine": "Not relevant? Reply 'unsubscribe' and you won't hear from me again.",
  "cta": "Want the full one-page teardown (free, no obligation)? Just reply \"send it\"."
}
```

---

## 2. Wiring up self-serve checkout (the Packages page)

The new **Packages** page (`src/buy.njk`, lives at `buy.html`) lets people buy a fixed-price
package without a call. Each package is defined in `src/_data/site.js` under `packages`, with a
`checkoutUrl` field. To go live:

1. In **Stripe → Payment Links**, create one link per package (set the price + collect the
   customer's email; optionally add custom fields or a post-payment redirect to `buy.html#intake`).
2. Paste each `https://buy.stripe.com/...` URL into the matching package's `checkoutUrl` in
   `src/_data/site.js`.
3. `npm run build` and redeploy `dist/`.

Until a `checkoutUrl` is set, that package's button gracefully falls back to the on-page intake
form (so there are never dead buttons — you can ship the page before Stripe is wired up). The
intake form reuses the existing site-wide lead handler (POST → mailto fallback), so paid or
not, project details reach your inbox.
