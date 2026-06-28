# Launch checklist — the 3 switches that turn the machine on

Everything in this repo is built and automated. Three things require your real-world accounts
or info — they can't be faked (a dead Stripe link, a fake legal address, or a non-existent
sending domain would each do real harm). Here's exactly how to flip each one. Budget ~1 hour of
setup plus a 2–3 week domain warm-up that runs in the background.

---

## 1. Physical mailing address (unblocks outreach) — ~15 min

CAN-SPAM requires a **real postal address** in every outreach email. Hermes deliberately
**blocks** email generation until you set one, so you can't accidentally send without it.

You don't want your home address on cold emails. Get a low-cost **virtual business address /
mailbox** (e.g. Stable, iPostal1, Anytime Mailbox, or a USPS PO Box — ~$10–30/mo or less). It
gives you a real street/box address you can publish.

Then set it (one line) in `tools/outreach.config.json`:

```json
"physicalAddress": "Symbio AI, 1234 Telegraph Ave Ste 100, Oakland, CA 94612",
```

Verify it's unblocked:

```bash
npm run hermes -- report        # the address checkbox flips to [x]
```

---

## 2. Stripe self-serve checkout — ~20 min

Create **Payment Links** in your Stripe Dashboard (Products → Payment Links), then paste them in
with one command — no editing code.

**Packages** (`buy.html`) — one-time payments:

| key | Product name | Price | Type |
| --- | --- | --- | --- |
| `speed-fix` | Site speed & mobile fix | $499 | one-time |
| `website-7-days` | Website in 7 days | $1,500 | one-time |
| `booking-system` | Booking + lead system | $1,200 | one-time |
| `ai-assistant` | AI assistant install (setup) | $900 | one-time |

**AI assistant plans** (`widget.html`) — **recurring (monthly)**:

| key | Product name | Price | Type |
| --- | --- | --- | --- |
| `widget-starter` | AI Assistant — Starter | $49 / month | recurring |
| `widget-growth` | AI Assistant — Growth | $99 / month | recurring |
| `widget-pro` | AI Assistant — Pro | $149 / month | recurring |
| `care-essential` | Website Care — Essential | $99 / month | recurring |
| `care-growth` | Website Care — Growth | $199 / month | recurring |
| `care-pro` | Website Care — Pro | $299 / month | recurring |

Paste them all (drop the ones you're not ready for):

```bash
npm run set-stripe -- \
  speed-fix=https://buy.stripe.com/xxx \
  website-7-days=https://buy.stripe.com/xxx \
  booking-system=https://buy.stripe.com/xxx \
  ai-assistant=https://buy.stripe.com/xxx \
  widget-starter=https://buy.stripe.com/xxx \
  widget-growth=https://buy.stripe.com/xxx \
  widget-pro=https://buy.stripe.com/xxx

npm run build      # regenerate dist/, then redeploy
```

Any link you leave empty keeps a **graceful fallback** (the button routes to the free scan /
intake form), so there are never dead buttons — ship partial and fill the rest later.

---

## 3. Warmed sending domain (deliverability) — ~20 min setup + 2–3 weeks warm-up

**Never send cold email from `symbioai.dev`** — it can torch your real domain's reputation. Use a
separate domain just for outreach.

1. **Buy a lookalike domain**, e.g. `trysymbioai.com` or `getsymbioai.com` (~$10/yr). Point it
   (a redirect) at `symbioai.dev` so clicks land on your real site.
2. **Create 1–3 sending mailboxes**, e.g. `ravi@trysymbioai.com`.
3. **Set DNS auth** (your email host gives you the exact values):
   - **SPF** — `TXT` record: `v=spf1 include:<your-provider> ~all`
   - **DKIM** — the `CNAME`/`TXT` keys your provider generates
   - **DMARC** — `TXT` at `_dmarc`: `v=DMARC1; p=none; rua=mailto:you@trysymbioai.com`
4. **Connect to a cold-email tool** — Smartlead, Instantly, or Saleshandy — and turn on
   **warm-up**. Let it run **2–3 weeks** before real sending. Cap ~**30–50 emails/inbox/day**.
5. When warm, generate and send:

```bash
npm run hermes -- outreach --in leads.csv   # writes tools/hermes/out/outreach.csv
# import that CSV into Smartlead/Instantly, map {{subject}} + {{email_body}}, send
```

---

## After launch — the loop that runs itself

```bash
# record what comes back (Hermes learns from this and favours winning variants)
npm run hermes -- log --email owner@biz.com --replied
npm run hermes -- log --email chef@bistro.com --booked
npm run hermes -- learn        # update which subject lines / CTAs win
npm run hermes -- report       # funnel dashboard
```

- **Inbound:** the 18 programmatic SEO pages pull traffic; enrich the 12 city pages with a local
  case study/testimonial, then flip `INDEX_TIER_B = true` in `src/_data/landingPages.js` to
  index them.
- **Self-serve:** `buy.html` (packages) and `widget.html` (monthly AI assistant) close deals
  with no call.
- **Outreach:** Hermes generates, you send from the warmed domain, log outcomes, it improves.
- **Recurring:** every build client → a `widget.html` monthly plan ($49–$149/mo) = compounding
  MRR at near-zero marginal cost.

A weekly GitHub Action (`.github/workflows/hermes.yml`) keeps the whole site building + linting
and refreshes the report, so nothing silently breaks.
