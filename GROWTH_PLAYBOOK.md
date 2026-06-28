# Symbio AI — Growth & Automation Playbook

_How to reach buyers without cold-calling, automate as much as possible, and get to a
profitable month fast._

> **Context this is built on:** Symbio AI is a two-founder studio (Mohammed & Ravi) selling
> **websites (~under $2k), custom apps (from $2,500), and AI agents/automation (from $900)**
> to local businesses, nonprofits, schools, and creators. The funnel is **free scan → quote →
> build**. You already own an embeddable AI chat widget (`src/assets/js/symbio-widget.js`) and
> a static [Eleventy](https://www.11ty.dev/) site that's trivially programmable.

---

## 0) The honest reframe

You have near-zero overhead, so "profitable by end of next month" really means **close 2–4
small projects**. At your prices, that's a profitable month — you do **not** need a marketing
machine, you need ~30–80 qualified conversations and a way to convert a handful of them.

Two things follow:

1. **For next-month cash**, the winners are _semi_-automated targeted outreach (using your own
   product as the hook) + productized offers people can buy **without a sales call**. Don't
   wait on a perfectly autonomous funnel.
2. **For durable margin**, build the compounding, fully-automatable channels in parallel
   (recurring widget revenue + programmatic SEO). They pay off in weeks-to-months, not days.

There's a real tension between "fully automate everything" and "be profitable in 4 weeks."
This plan does the fast, human-light things first and lets the fully-automated channels warm
up underneath.

---

## Engine 1 — Audit-first automated outreach (no calling) ⭐ best fit

This weaponizes the thing you _already sell_: the **free scan**. A personalized audit gets far
higher reply rates than generic cold email, and the whole thing is ~80% automatable. Humans
only touch replies.

**The pipeline:**

1. **Build a list** of local businesses with weak or missing websites — your ideal buyers.
   Niches that pay and routinely have bad sites: dentists/orthodontists, contractors &
   trades, salons/med-spas, restaurants, law & clinics, gyms, real-estate, churches &
   nonprofits. Source via Google Maps / Google Business Profile data (e.g. Apollo, a Maps
   scraper, or a paid local-business list).
2. **Auto-run a scan** on each: Lighthouse / PageSpeed score, mobile check, "no online
   booking?", "no chat/lead capture?", a screenshot. Generate **3 specific findings** + a
   one-line fix for each.
3. **Send a personalized email** — _"I ran a 90-second teardown of [business]'s site and found
   3 quick wins (mobile speed, no booking, no after-hours capture). Want the fix list?"_ Attach
   or link the audit. Use a cold-email tool with auto follow-ups.
4. **Reply → book → close.** Only this step is manual.

**Tooling (2026):** send from a **separate domain** (e.g. `trysymbioai.com`), never your main
domain. Warm it up, set SPF/DKIM/DMARC, cap ~30–50/inbox/day. Good options:
[Smartlead](https://www.salesforge.ai/blog/cold-email-software) and
[Instantly](https://www.hypergen.io/blog/best-cold-email-software) (best-in-class warmup &
deliverability), [Saleshandy](https://www.saleshandy.com/blog/cold-email-software/) (best
value, ~$36/mo, unlimited inboxes), or [Woodpecker](https://www.emailtooltester.com/en/blog/best-email-outreach-tools/)
(agency favorite). **Deliverability is the #1 failure mode** — a separate, warmed domain is
non-negotiable or you torch your real one.

**Legal:** US B2B cold email is allowed under CAN-SPAM if you use a real physical address, a
working opt-out, accurate "from"/subject lines, and honor unsubscribes. No deception.

**Rough math:** 1,000 audit emails → ~3–8% reply → 30–80 conversations → close 2–5 projects at
$900–$2k. That alone is a profitable month.

---

## Engine 2 — Productize so people buy without a call (self-serve)

The top productized studios (DesignJoy, etc.) **show price openly and require no sales call** —
the website _is_ the checkout. You already have pricing tiers; add real checkout + an intake
form so any lead (inbound or from Engine 1) can buy now.

- Package 2–4 **fixed-price offers**, e.g.
  - **Website in 7 days — $1,500** (flat)
  - **AI chat assistant install — $900 setup** (+ monthly, see Engine 3)
  - **Booking + lead system — $1,200**
  - **Site speed/mobile fix — $499** (the natural yes after an Engine 1 audit)
- Wire up **Stripe Payment Links / Checkout** (no backend needed — works with your static
  site) + a **customizable intake form** so project details are captured at purchase, killing
  back-and-forth.
- Keep the free scan as the soft entry, but let confident buyers **skip straight to "Buy."**

Transparent pricing + a buy button is the single biggest lever for closing **without** talking
to anyone. ([why this works](https://nanoglobals.com/productized-service-websites/))

---

## Engine 3 — Recurring revenue from the widget (the real "automated profit")

You already built `symbio-widget.js`. This is your highest-margin, most-automatable asset:
**build once, sell to many, near-zero marginal cost.**

- Sell it as a productized monthly service: **"AI assistant on your site — $49–$149/mo"**, with
  a **$300–$900 one-time setup**. (2026 market: SMB chatbot tools run $6–$50/mo; managed/custom
  installs sit higher — your done-for-you + lead delivery justifies the premium.
  [pricing context](https://www.tidio.com/blog/chatbot-pricing/))
- The monthly covers hosting, the AI calls, lead delivery, and tweaks. **10 clients × $99/mo ≈
  $1k MRR** with almost no ongoing work — that's predictable profit, not project whack-a-mole.
- Every website you ship should include the widget by default; converting a build client to a
  monthly plan is the easiest upsell you have.

This is where "profitable with full automation" actually lives long-term: recurring + automated
+ high margin.

---

## Engine 4 — Go where buyers already search (inbound, zero outreach)

- **Upwork + Fiverr productized gigs:** _"Add an AI chatbot to your website," "Website in a
  week," "Speed up & mobile-fix my site."_ Buyers come to **you** — fastest path to first
  dollars with no outreach. ([more channels](https://www.saleshandy.com/blog/how-to-get-clients-for-web-development/))
- **Google Business Profile** for Symbio AI → rank for "web designer near me" / "AI chatbot for
  business." Free, local, inbound.
- **Reddit / Nextdoor / niche FB groups:** answer "I need a website / my site is slow"
  questions with genuine help + a link. Low effort, compounding trust.

---

## Engine 5 — Programmatic SEO on your Eleventy site (compounding, fully automatable)

This is your most "full automation" inbound channel and it's **native to your stack**. Eleventy
[pagination](https://www.11ty.dev/docs/pagination/) can generate hundreds of pages from one
template + a data file:

- Pages for **{service × niche × city}**: _"AI chatbot for dentists in Fremont," "Website
  redesign for nonprofits in the Bay Area," "Booking system for salons in San Jose."_
- One `src/_data/` JSON drives a single `.njk` template → 200+ targeted landing pages, each a
  conversion path to your scan/checkout. Build once; it ranks over weeks and feeds Engines 2–3
  for free.

I can scaffold this directly in this repo.

---

## Engine 6 — Referrals & partnerships (cheap, no cold-calling)

- **Referral fee (10–20%)** to anyone who sends a paying client.
- **Partner with adjacent freelancers** who serve the same SMBs but don't build sites —
  photographers, marketers, bookkeepers, signage/print shops. They have the relationships; you
  have the build.
- **"Built by Symbio AI"** footer link on every site you ship = passive, permanent lead gen.

---

## What NOT to do for a 4-week profitability deadline

- **Don't pour cash into paid ads yet.** Slow to dial in, burns money, risky against a
  deadline. Revisit once you have a converting offer + testimonials.
- **Don't build a full SaaS platform this month.** Sell the _service_ version of the widget
  now; productize into self-serve SaaS later.
- **Don't blast cold email from your main domain.** Separate, warmed sending domain or nothing.

---

## The 30-day plan

**Week 1 — Set the table**
- Buy + warm a sending domain (`trysymbioai.com`); set SPF/DKIM/DMARC.
- Add 3–4 productized packages + **Stripe Payment Links** + intake form to the site (Engine 2).
- List 2 Upwork/Fiverr gigs; claim Google Business Profile (Engines 4).
- Build the scan/audit script (Engine 1).

**Week 2 — Turn it on**
- Scrape ~500 local businesses with weak sites; start sending 30–50 personalized audit
  emails/day (Engine 1).
- Scaffold programmatic SEO pages (Engine 5).

**Week 3 — Convert**
- Work follow-ups + replies → book → **close**. Ship fast (your "launch in days" promise).
- Offer the $499 speed/mobile fix as the easy first yes from audits.

**Week 4 — Compound**
- Upsell every build client to a **$99/mo widget plan** (Engine 3).
- Ask every client for a **referral + a testimonial** (your Reviews page wants real proof).

**Target:** Engine 1 (2–5 small projects) + a few marketplace/inbound deals + first monthly
plans = a clearly profitable July, with SEO and recurring revenue compounding into August.

---

## What's now built in this repo ✅

- **Self-serve checkout (Engine 2)** — `buy.html` (Packages): 4 fixed-price packages with
  Stripe Payment Link buttons (data-driven in `src/_data/site.js`) + an intake form. Add your
  Stripe links and it's live. _Wiring: `tools/README.md`._
- **Audit-first outreach (Engine 1)** — `tools/audit-outreach.mjs`: scans prospect sites, finds
  the 3 best talking points, writes CAN-SPAM-compliant personalized emails to CSV for
  Smartlead/Instantly. `npm run outreach`.
- **Programmatic SEO (Engine 5)** — 30 penalty-safe landing pages (18 service×niche + 12 curated
  city pages) at `/grow-*.html`, with a hub + 3 service hubs, full JSON-LD, canonical tags,
  `sitemap.xml`, and `robots.txt`. Generated from `src/_data/{landingPages,cells,cities,niches}.js`.
- **Hermes — the autonomous growth engine** — `tools/hermes/`: orchestrates outreach with an A/B
  **learning loop** (a bandit that shifts toward the subject lines/CTAs that get replies), logs
  outcomes, and reports the funnel. A weekly GitHub Action keeps the site building and refreshes
  the dashboard. `npm run hermes -- run --in leads.csv`. _See `tools/hermes/README.md`._

### Still worth building next
- A self-serve **widget landing page** that sells the AI assistant as a monthly plan (Engine 3).
- Real **case studies + testimonials** wired onto the matching `/grow-*` pages — the single
  biggest lever for turning the city pages from "indexed" into "ranking + converting".
