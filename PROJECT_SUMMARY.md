# Symbio AI — What we built (partner summary)

_A plain-English overview of the automated growth system added to the site. For Mohammed & Ravi._

## The big picture

We turned the website from a brochure into a **mostly self-running growth machine**: it pulls in
leads, converts them without a sales call, closes them with self-serve checkout, turns clients
into recurring revenue, and runs outreach that **gets smarter over time** — all built on our
existing site with no monthly software bills (the new tooling is plain code, zero dependencies).

The goal: reach buyers **without cold-calling** and get to a profitable month (target: end of
July). Everything below is built, tested, and on the branch in **Pull Request #5**.

## The funnel, end to end

**1. Attract (inbound, runs itself)**
- **30 SEO landing pages** targeting "web design / AI / booking for [industry]" across 6 industries
  (dentists, restaurants, law firms, real estate, fitness, nonprofits) plus 12 Bay-Area city pages.
  Each has unique, genuine content (not spam), proper Google structured data, and a sitemap — built
  to rank over the coming weeks and bring in free traffic.
- **Instant teardown page** — a visitor pastes their website link and immediately sees the top 3
  things costing them leads, with the fix for each. It uses our own audit tech as a lead magnet.

**2. Convert (no sales call needed)**
- **Packages page** — fixed-price offers (site speed fix $499, website in 7 days $1,500, booking
  system $1,200, AI assistant $900) people can just buy.
- **Speed-to-lead follow-up** — the moment a lead comes in, an automatic 4-message sequence goes out
  (instant reply + timed follow-ups), so no lead goes cold while we're busy.

**3. Close (self-serve checkout)**
- Stripe "Buy" buttons on the packages page. Until we add our Stripe links, buttons safely fall back
  to the contact form — nothing is ever broken.

**4. Recurring revenue (the profit engine)**
- **AI assistant plans** — sell our chat widget as a monthly service ($49 / $99 / $149) + setup.
- **Website care plans** — keep clients' sites running for $99 / $199 / $299 a month.
- Both are near-pure-margin and compound: every client we land can become monthly income.

**5. Outreach that improves itself — "Hermes"**
- Hermes scans a list of local businesses with weak sites, writes a personalized email for each
  (pointing out 3 real fixes), and **A/B tests subject lines and pitches** — automatically shifting
  toward whichever ones actually get replies as we log results. It's legally careful: it won't send
  without a real mailing address and it honors unsubscribes.

**Plus, to scale and speed things up:**
- **Automated prospect sourcing** — build a ready-to-email list of local businesses (with their
  emails) from Google Maps data or any export, in one command.
- **Conversion tracking** — flip on privacy-friendly analytics by setting one value; it tracks
  leads, teardowns, and checkout clicks automatically so we can see what's working.
- **Client-site generator** — spin up a full one-page client website from a short config file in
  seconds (our design, their brand, the AI chat widget built in) — so delivery is fast and we can
  take on more clients with the same two people.

## What's done vs. what's left

**Done (built, tested, in the PR):** all of the above — the SEO pages, instant teardown, packages
page, AI-assistant page, care-plans page, the Hermes outreach + learning engine, the follow-up
sequences, a one-command tool to paste in our Stripe links, and a weekly automated health-check.
An independent review of the whole thing flagged 18 issues (including legal/compliance and SEO
risks) — **all fixed.**

**Left to flip on (needs our accounts/info — can't be faked):**
1. **A business mailing address** — get a cheap virtual mailbox (~$10–30/mo), then paste it into one
   config file. (Required by anti-spam law before any outreach sends.)
2. **Stripe payment links** — create them in our Stripe account, then one command pastes them in.
3. **A separate "sending" domain** (e.g. trysymbioai.com) warmed up for ~2–3 weeks for cold email,
   so we never risk our main domain's reputation.

Step-by-step instructions for all three are in **`LAUNCH.md`**.

## How it runs once live

We send outreach from the warmed domain → log replies/bookings → Hermes learns what works and
improves the next batch. Meanwhile the SEO pages and teardown pull in inbound, the packages and
plans close deals with no call, and care/widget plans build monthly recurring income. A weekly
automated check keeps the whole site building and reports the funnel.

## Where things live (for editing later)

- Marketing pages: `src/*.njk` (buy, widget, care, teardown, the `grow-*` SEO pages)
- All prices, plans, and packages: `src/_data/site.js`
- Outreach + learning engine: `tools/hermes/` (run with `npm run hermes -- …`)
- Prospect sourcing: `npm run source` · Client-site generator: `npm run new-client`
- Instant-teardown backend: `infra/worker/`
- Go-live steps: `LAUNCH.md` · Strategy: `GROWTH_PLAYBOOK.md`

## Bottom line

The machine is built. Three quick setup steps (address, Stripe, sending domain) turn it on — then
it largely runs and improves itself. The fastest path to a profitable month: do those three, send
the first outreach batch, and convert a handful of the replies.
