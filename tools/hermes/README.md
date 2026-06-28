# Hermes — Symbio AI's autonomous growth engine

Hermes ties the growth system together and **gets better the more you use it**. It scans
prospects, writes personalized outreach, runs an A/B **learning loop** that shifts toward the
subject lines and CTAs that actually get replies, and reports the whole funnel.

It's honest about its limits: Hermes **generates** outreach and learns from outcomes **you
record** — it does not send email (sending belongs in your warmed cold-email tool) and it can't
learn from data you don't log.

Pure Node, zero dependencies (Node 18+). Shares the scan/email engine with `audit-outreach.mjs`
via `tools/lib/outreach-core.mjs`.

---

## The loop

```
 prospects.csv ──▶ hermes outreach ──▶ batch CSV (per-row A/B variant)
                        │                     │
                        ▼                     ▼  (you send from Smartlead/Instantly)
                   ledger.json  ◀── hermes log --replied / --booked
                        │
                        ▼
                   hermes learn ──▶ variant win-rates ──▶ next batch favours winners
                        │
                        ▼
                   hermes report ──▶ REPORT.md (funnel dashboard)
```

## Commands

```bash
# 1. Generate a batch. Each prospect is assigned an A/B variant by the bandit.
npm run hermes -- outreach --in leads.csv         # → tools/hermes/out/outreach.csv (+ .json)

# 2. Send from your warmed domain (Smartlead/Instantly), then record what comes back:
npm run hermes -- log --email owner@biz.com --replied
npm run hermes -- log --email chef@bistro.com --booked        # booked implies replied
npm run hermes -- log --email someone@x.com --unsub

# 3. Re-tally win-rates (updates variants.json) and see the leaderboard:
npm run hermes -- learn

# 4. Funnel dashboard (writes tools/hermes/REPORT.md):
npm run hermes -- report

# Or run a full cycle:
npm run hermes -- run --in leads.csv
```

(`npm run hermes -- <cmd>` — the `--` passes args through npm. Or call
`node tools/hermes/hermes.mjs <cmd>` directly.)

## How the "ever-improving" part works

`tools/hermes/variants.json` holds the A/B variants (subject-line template + CTA). When you run
`outreach`, Hermes picks a variant per prospect with an **epsilon-greedy bandit**:

- With probability `epsilon` (default 0.2) it **explores** — picks a random variant.
- Otherwise it **exploits** — picks the variant with the best **Laplace-smoothed reply rate**
  `(replies + 1) / (sends + 2)`. Smoothing means untried variants start optimistic (~0.5) and
  still get tried; ties break toward the less-sent variant so coverage stays even.

Every assignment is written to `ledger.json` (a "queued" send). When you `log` a reply/booking,
`learn` re-tallies per-variant stats, and the next `outreach` shifts toward the winners. Add or
edit variants freely in `variants.json` — new ones enter the rotation automatically.

> Rankings are noisy under ~30 sends — `learn` says so. Keep logging before trusting them.

## Built-in guardrails

- **Honors unsubscribes.** Any email you've logged with `--unsub` is suppressed on every future
  `outreach` run (status `suppressed-unsub`, no email generated) — CAN-SPAM compliance.
- **Dedupes by email.** The same address is never queued twice in one run (avoids double-emailing
  and keeps the learning counts honest).
- **Blocks fake-address sends.** Until `physicalAddress` in `tools/outreach.config.json` is a real
  postal address, `outreach` emits non-sendable `blocked-no-address` placeholders, not emails.
- **Scanner is sandboxed.** The site scan refuses non-http(s) URLs and private/loopback/metadata
  hosts.

## Files

| file | what | committed? |
| --- | --- | --- |
| `hermes.mjs` | the CLI | yes |
| `variants.json` | A/B variants + running tallies | yes (seed, zeroed) |
| `ledger.example.json` | shows the ledger shape | yes |
| `ledger.json` | your real outcomes (prospect PII) | **gitignored** |
| `out/` | generated batches | **gitignored** |
| `REPORT.md` | generated dashboard | **gitignored** |

## Automation (CI)

`.github/workflows/hermes.yml` runs a weekly **growth heartbeat**: it rebuilds the site
(including the 30+ programmatic-SEO pages) and lints — so the generated matrix can never
silently break a deploy — then refreshes the Hermes report (REPORT.md) as an artifact. Outreach
generation is **not** run in CI (it produces prospect PII); run it locally. CI never sends email.

## The human-only switches

Hermes automates everything up to three things only you can set, all flagged in the report:

1. A real mailing address + opt-out line in `tools/outreach.config.json` (CAN-SPAM).
2. Stripe Payment Links in `src/_data/site.js` packages (self-serve checkout).
3. A separate, **warmed** sending domain in your cold-email tool (deliverability).
