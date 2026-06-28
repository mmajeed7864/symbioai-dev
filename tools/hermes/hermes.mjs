#!/usr/bin/env node
/**
 * Hermes — Symbio AI's autonomous growth engine.
 * =============================================================================
 * The messenger god, turned growth loop. Hermes ties the pieces of
 * GROWTH_PLAYBOOK.md together and gets BETTER over time:
 *
 *   hermes outreach --in <csv>   Scan prospects + write personalized emails,
 *                                assigning each an A/B variant via a bandit that
 *                                favours subject lines/CTAs that actually reply.
 *   hermes log --email <e> ...   Record an outcome (--replied / --booked / --unsub).
 *   hermes learn                 Re-tally the ledger -> update variant win-rates.
 *   hermes report                Print + write the funnel dashboard (REPORT.md).
 *   hermes run --in <csv>        outreach -> report in one go.
 *
 * It is honest about its limits: Hermes generates outreach and learns from
 * outcomes you record; it does not send email (that belongs in your warmed
 * cold-email tool), it honours unsubscribes, and it refuses to produce sendable
 * bodies until a real physical address is set (CAN-SPAM).
 *
 * Pure Node, zero deps (Node 18+). Reuses tools/lib/outreach-core.mjs.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { argv, exit } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig, loadProspects, processProspect, runPool, toCsv,
  businessOf, firstNameOf, normalizeUrl, addressIsPlaceholder, renderTemplate, DEFAULT_UA,
} from "../lib/outreach-core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VARIANTS_PATH = path.join(HERE, "variants.json");
const SEQUENCES_PATH = path.join(HERE, "sequences.json");
const MARKETING_PATH = path.join(HERE, "marketing.json");
const LEDGER_PATH = path.join(HERE, "ledger.json");
const REPORT_PATH = path.join(HERE, "REPORT.md");
const OUT_DIR = path.join(HERE, "out");
const CONFIG_PATH = "tools/outreach.config.json";

/* ---- args ------------------------------------------------------------ */
function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i += 1;
      }
    } else positional.push(a);
  }
  return { cmd: positional[0], flags };
}

/* ---- json io --------------------------------------------------------- */
async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
const writeJson = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + "\n", "utf8");

const DEFAULT_VARIANTS = {
  epsilon: 0.2,
  variants: [
    { id: "wins", subjectTemplate: "{biz}: {n} quick wins on your site", cta: 'Want the full one-page teardown (free, no obligation)? Just reply "send it".' },
    { id: "noticed", subjectTemplate: "noticed something on {biz}'s site", cta: "Reply 'yes' and I'll send the 3 fixes — free, takes me five minutes." },
    { id: "question", subjectTemplate: "quick question about {biz}", cta: "Worth a 10-minute look? Reply and I'll send a short teardown." },
    { id: "niche", subjectTemplate: "{niche} sites that book more work", cta: "Want me to point out the top 3 fixes on your site? Just reply." },
  ],
};

// Returns { cfg, malformed }. malformed=true means variants.json exists but
// could not be parsed — callers must NOT overwrite it (don't clobber the file).
async function loadVariants() {
  let raw;
  try {
    raw = await readFile(VARIANTS_PATH, "utf8");
  } catch {
    return { cfg: DEFAULT_VARIANTS, malformed: false }; // missing → defaults are fine to write
  }
  try {
    const v = JSON.parse(raw);
    if (v && Array.isArray(v.variants)) return { cfg: v, malformed: false };
    return { cfg: DEFAULT_VARIANTS, malformed: true };
  } catch {
    return { cfg: DEFAULT_VARIANTS, malformed: true };
  }
}

const DEFAULT_SEQUENCE = {
  steps: [
    { id: "instant", delayDays: 0, subjectTemplate: "Thanks {first} — here's what happens next", bodyTemplate: "Hi {first},\n\nThanks for reaching out about {biz} — got it. A real person will reply within one business day.\n\nWant to see options now? {bookLink}" },
    { id: "followup-1", delayDays: 2, subjectTemplate: "did you still want that scan, {first}?", bodyTemplate: "Hi {first},\n\nCircling back on {biz} — want the short teardown? Reply 'yes' and I'll send it, no obligation. {bookLink}" },
  ],
};

async function loadSequence() {
  const s = await readJson(SEQUENCES_PATH, null);
  return s && Array.isArray(s.steps) && s.steps.length ? s : DEFAULT_SEQUENCE;
}

/* ---- the bandit ------------------------------------------------------ */
// Laplace-smoothed reply rate so untried variants start optimistic (~0.5) and
// get explored; epsilon-greedy adds forced exploration.
function variantScore(stats) {
  return ((stats.replies || 0) + 1) / ((stats.sends || 0) + 2);
}

function statsFromLedger(ledger, variantId) {
  const rows = ledger.filter((r) => r.variantId === variantId);
  return {
    sends: rows.length,
    replies: rows.filter((r) => r.replied).length,
    booked: rows.filter((r) => r.booked).length,
  };
}

// Choose over a LIVE stats map (callers reserve picks by bumping sends), so
// assignment within one run still explores under any concurrency.
function chooseVariant(variants, statsMap, epsilon) {
  if (Math.random() < epsilon) return variants[Math.floor(Math.random() * variants.length)];
  const scored = variants.map((v) => ({ v, s: statsMap[v.id] || { sends: 0, replies: 0 } }));
  scored.sort((a, b) => variantScore(b.s) - variantScore(a.s) || a.s.sends - b.s.sends);
  return scored[0].v;
}

/* ---- commands -------------------------------------------------------- */
async function cmdOutreach(flags) {
  const inPath = flags.in || "tools/prospects.sample.csv";
  const limit = flags.limit ? parseInt(flags.limit, 10) : Infinity;
  const concurrency = Math.max(1, parseInt(flags.concurrency || "4", 10));
  const timeout = parseInt(flags.timeout || "12000", 10);
  const delay = parseInt(flags.delay || "250", 10);

  const cfg = await loadConfig(CONFIG_PATH);
  const blocked = addressIsPlaceholder(cfg);
  if (blocked) {
    console.warn("\n⚠️  PHYSICAL ADDRESS NOT SET in tools/outreach.config.json.");
    console.warn("   Generating BLOCKED placeholders only — set a real postal address before sending (CAN-SPAM).\n");
  }

  const { cfg: variantsCfg } = await loadVariants();
  const eps = flags.epsilon != null ? parseFloat(flags.epsilon) : variantsCfg.epsilon;
  const ledger = await readJson(LEDGER_PATH, []);
  const prospects = await loadProspects(inPath, limit);
  if (!prospects.length) {
    console.error(`Hermes: no prospects in ${inPath} (columns: business, website, email, first_name, city, niche)`);
    exit(1);
  }

  // Suppress unsubscribed contacts, and dedupe by email (never email one address twice).
  const unsub = new Set(ledger.filter((r) => r.unsub).map((r) => (r.email || "").toLowerCase()));
  const seen = new Set();
  let dupSkipped = 0, suppressed = 0;

  // Phase 1 (sequential): assign a variant per prospect, reserving each pick in a
  // live stats map so exploration holds regardless of the concurrent scan below.
  const stats = {};
  for (const v of variantsCfg.variants) stats[v.id] = statsFromLedger(ledger, v.id);
  const byVariant = {};
  const work = [];
  for (const row of prospects) {
    const em = (row.email || "").trim().toLowerCase();
    if (em && seen.has(em)) { dupSkipped += 1; continue; }
    if (em) seen.add(em);
    if (em && unsub.has(em)) { suppressed += 1; work.push({ row, suppressed: true }); continue; }

    const variant = chooseVariant(variantsCfg.variants, stats, eps);
    stats[variant.id].sends += 1; // reserve
    byVariant[variant.id] = (byVariant[variant.id] || 0) + 1;
    work.push({ row, variant });

    if (em && !blocked) {
      const existing = ledger.find((r) => r.email === row.email);
      const entry = existing || { email: row.email, replied: false, booked: false, unsub: false };
      entry.company = businessOf(row);
      entry.niche = row.niche || "";
      entry.city = row.city || "";
      entry.variantId = variant.id;
      entry.queuedAt = new Date().toISOString();
      if (!existing) ledger.push(entry);
    }
  }

  console.log(`Hermes outreach — ${work.length} to process, ε=${eps}, ${variantsCfg.variants.length} variants` +
    (dupSkipped ? `, ${dupSkipped} dup email(s) skipped` : "") + (suppressed ? `, ${suppressed} unsubscribed suppressed` : "") + "…\n");

  // Phase 2 (concurrent): scan + build email for each non-suppressed prospect.
  const records = await runPool(
    work,
    async ({ row, variant, suppressed: isSup }) => {
      if (isSup) {
        console.log(`  [suppressed ] ${businessOf(row).padEnd(28)} → unsubscribed`);
        return {
          email: row.email || "", first_name: firstNameOf(row) === "there" ? "" : firstNameOf(row),
          company: businessOf(row), website: normalizeUrl(row.website), city: row.city || "", niche: row.niche || "",
          finding_1: "", finding_2: "", finding_3: "", subject: "",
          email_body: "(suppressed — this contact unsubscribed; not re-contacted)", variant_id: "", status: "suppressed-unsub",
        };
      }
      const rec = await processProspect(row, cfg, { timeout, ua: DEFAULT_UA, variant, blockSend: blocked });
      rec.variant_id = blocked ? "" : variant.id;
      console.log(`  [${rec.status.padEnd(11)}] ${businessOf(row).padEnd(28)} → variant:${rec.variant_id || "—"}`);
      return rec;
    },
    { concurrency, delay }
  );

  await mkdir(OUT_DIR, { recursive: true });
  const outCsv = path.join(OUT_DIR, "outreach.csv");
  const cols = ["email", "first_name", "company", "website", "city", "niche", "finding_1", "finding_2", "finding_3", "subject", "email_body", "variant_id", "status"];
  await writeFile(outCsv, toCsv(records, cols), "utf8");
  await writeFile(path.join(OUT_DIR, "outreach.json"), JSON.stringify(records, null, 2), "utf8");
  if (!blocked) await writeJson(LEDGER_PATH, ledger);

  console.log("\n────────────────────────────────────────────");
  console.log("variant assignment:", Object.entries(byVariant).map(([k, n]) => `${k}=${n}`).join("  ") || "(none)");
  if (blocked) console.log("⚠️  Output is BLOCKED placeholders — set your address, then re-run.");
  else console.log(`CSV: ${outCsv} (variant_id column tracks each A/B test) · ledger updated.`);
  console.log(`\nNext: send from a warmed domain, then record outcomes:`);
  console.log(`  node tools/hermes/hermes.mjs log --email someone@biz.com --replied`);
}

async function cmdLog(flags) {
  // Marketing engagement: hermes log --angle <id> --engaged   (or --clicks N)
  if (flags.angle && flags.angle !== true) {
    const mk = await loadMarketing();
    const a = mk.angles.find((x) => x.id === flags.angle);
    if (!a) {
      console.error(`Hermes log: unknown angle "${flags.angle}" (see tools/hermes/marketing.json)`);
      exit(1);
    }
    if (flags.sent) a.sends = (a.sends || 0) + (parseInt(flags.sent, 10) || 1);
    if (flags.engaged) a.engaged = (a.engaged || 0) + 1;
    if (flags.clicks) a.engaged = (a.engaged || 0) + (parseInt(flags.clicks, 10) || 0);
    await writeJson(MARKETING_PATH, mk);
    console.log(`Logged angle ${a.id}: sends=${a.sends || 0} engaged=${a.engaged || 0}`);
    return;
  }
  if (!flags.email || flags.email === true) {
    console.error("Hermes log: --email <address> (--replied/--booked/--unsub) OR --angle <id> (--engaged/--clicks N)");
    exit(1);
  }
  const ledger = await readJson(LEDGER_PATH, []);
  let entry = ledger.find((r) => r.email === flags.email);
  if (!entry) {
    entry = { email: flags.email, company: flags.company || "", niche: flags.niche || "", variantId: flags.variant || "", queuedAt: new Date().toISOString(), replied: false, booked: false, unsub: false };
    ledger.push(entry);
  }
  if (flags.replied) entry.replied = true;
  if (flags.booked) {
    entry.booked = true;
    entry.replied = true; // a booking implies a reply
  }
  if (flags.unsub) entry.unsub = true;
  entry.updatedAt = new Date().toISOString();
  await writeJson(LEDGER_PATH, ledger);
  console.log(`Logged ${flags.email}: replied=${entry.replied} booked=${entry.booked} unsub=${entry.unsub} (variant:${entry.variantId || "?"})`);
}

async function cmdLearn() {
  const { cfg: variantsCfg, malformed } = await loadVariants();
  const ledger = await readJson(LEDGER_PATH, []);
  const board = variantsCfg.variants
    .map((v) => ({ id: v.id, ...statsFromLedger(ledger, v.id) }))
    .map((s) => ({ ...s, rate: s.sends ? s.replies / s.sends : 0, score: variantScore(s) }))
    .sort((a, b) => b.score - a.score);

  if (malformed) {
    console.warn("⚠️  variants.json could not be parsed — using defaults and NOT overwriting the file. Fix the JSON.");
  } else {
    variantsCfg.variants = variantsCfg.variants.map((v) => {
      const s = board.find((b) => b.id === v.id);
      return { ...v, sends: s.sends, replies: s.replies, booked: s.booked };
    });
    await writeJson(VARIANTS_PATH, variantsCfg);
  }

  console.log("Hermes learn — variant leaderboard (by smoothed score):\n");
  console.log("  rank  variant      sends  replies  booked  reply-rate  score");
  board.forEach((s, i) =>
    console.log(`  ${String(i + 1).padEnd(4)}  ${s.id.padEnd(11)}  ${String(s.sends).padEnd(5)}  ${String(s.replies).padEnd(7)}  ${String(s.booked).padEnd(6)}  ${(s.rate * 100).toFixed(0).padStart(8)}%  ${s.score.toFixed(3)}`)
  );
  const total = board.reduce((a, b) => a + b.sends, 0);
  console.log(`\n${total} sends recorded. The next \`hermes outreach\` will favour the top variant (ε=${variantsCfg.epsilon} still explores).`);
  if (total < 30) console.log("Note: <30 sends — rankings are still noisy. Keep logging outcomes before trusting them.");

  // Marketing angle leaderboard (social + GBP) — the same learning loop.
  const mk = await loadMarketing();
  const mboard = mk.angles
    .map((a) => ({ id: a.id, sends: a.sends || 0, engaged: a.engaged || 0, rate: a.sends ? a.engaged / a.sends : 0, score: angleScore(a) }))
    .sort((a, b) => b.score - a.score);
  console.log("\nMarketing angle leaderboard (by engagement):");
  console.log("  rank  angle        posts  engaged  rate");
  mboard.forEach((s, i) =>
    console.log(`  ${String(i + 1).padEnd(4)}  ${s.id.padEnd(11)}  ${String(s.sends).padEnd(5)}  ${String(s.engaged).padEnd(7)}  ${(s.rate * 100).toFixed(0).padStart(4)}%`)
  );
  console.log(`The next \`hermes social\`/\`gbp\` will favour the top angles (ε=${mk.epsilon} still explores).`);
  return board;
}

async function countSeoPages() {
  try {
    const mod = await import("../../src/_data/landingPages.js");
    const pages = mod.default();
    return { total: pages.length, tierA: pages.filter((p) => p.tier === "A").length, tierB: pages.filter((p) => p.tier === "B").length };
  } catch {
    return { total: 0, tierA: 0, tierB: 0 };
  }
}

async function cmdReport() {
  const ledger = await readJson(LEDGER_PATH, []);
  const cfg = await loadConfig(CONFIG_PATH);
  const seo = await countSeoPages();
  const board = await cmdLearn();

  const queued = ledger.length;
  const replied = ledger.filter((r) => r.replied).length;
  const booked = ledger.filter((r) => r.booked).length;
  const unsub = ledger.filter((r) => r.unsub).length;
  const rate = queued ? ((replied / queued) * 100).toFixed(1) : "0.0";

  const byNiche = {};
  for (const r of ledger) {
    const k = r.niche || "(unspecified)";
    byNiche[k] = byNiche[k] || { queued: 0, replied: 0, booked: 0 };
    byNiche[k].queued += 1;
    if (r.replied) byNiche[k].replied += 1;
    if (r.booked) byNiche[k].booked += 1;
  }

  const mk = await loadMarketing();
  const mboard = mk.angles
    .map((a) => ({ id: a.id, sends: a.sends || 0, engaged: a.engaged || 0, rate: a.sends ? a.engaged / a.sends : 0, score: angleScore(a) }))
    .sort((a, b) => b.score - a.score);

  const addressSet = !addressIsPlaceholder(cfg);
  const md = [
    `# Hermes — Growth Report`, ``, `_Generated ${new Date().toISOString()}_`, ``,
    `## Inbound surface (programmatic SEO)`,
    `- Landing pages live: **${seo.total}** (${seo.tierA} service×niche, ${seo.tierB} city pages)`,
    `- Plus hub + 3 service hubs, sitemap.xml, robots.txt.`, ``,
    `## Outreach funnel`,
    `| metric | value |`, `| --- | --- |`,
    `| Prospects queued | ${queued} |`, `| Replies | ${replied} |`, `| Booked | ${booked} |`,
    `| Unsubscribed | ${unsub} |`, `| Reply rate | ${rate}% |`, ``,
    `## A/B variant leaderboard`,
    `| rank | variant | sends | replies | booked | reply-rate |`, `| --- | --- | --- | --- | --- | --- |`,
    ...board.map((s, i) => `| ${i + 1} | ${s.id} | ${s.sends} | ${s.replies} | ${s.booked} | ${(s.rate * 100).toFixed(0)}% |`), ``,
    `## Marketing angle leaderboard (social + GBP)`,
    `| rank | angle | posts | engaged | rate |`, `| --- | --- | --- | --- | --- |`,
    ...mboard.map((s, i) => `| ${i + 1} | ${s.id} | ${s.sends} | ${s.engaged} | ${(s.rate * 100).toFixed(0)}% |`), ``,
    `## Reply rate by niche`,
    `| niche | queued | replied | booked |`, `| --- | --- | --- | --- |`,
    ...Object.entries(byNiche).map(([k, v]) => `| ${k} | ${v.queued} | ${v.replied} | ${v.booked} |`), ``,
    `## Next actions (the human-only switches)`,
    `- [${addressSet ? "x" : " "}] Real mailing address + opt-out set in \`tools/outreach.config.json\` (CAN-SPAM).`,
    `- [ ] Stripe Payment Links pasted into \`src/_data/site.js\` packages (self-serve checkout).`,
    `- [ ] Separate, warmed sending domain connected in Smartlead/Instantly.`,
    `- [ ] After sending a batch, log outcomes: \`hermes log --email … --replied\`.`, ``,
  ].join("\n");

  await writeFile(REPORT_PATH, md, "utf8");
  console.log(`\n──────── REPORT ────────`);
  console.log(`SEO pages live: ${seo.total} | queued: ${queued} | replies: ${replied} (${rate}%) | booked: ${booked}`);
  console.log(`Report written: ${REPORT_PATH}`);
}

// Speed-to-lead: render the lifecycle sequence (instant reply + timed follow-ups)
// for each INBOUND lead. Output loads into your email tool as an automated
// sequence — it then sends on the delays, so every lead is worked the moment it
// lands, with no manual typing. Honors unsubscribes, dedupes, gates on address.
async function cmdNurture(flags) {
  const inPath = flags.in || "tools/prospects.sample.csv";
  const limit = flags.limit ? parseInt(flags.limit, 10) : Infinity;
  const cfg = await loadConfig(CONFIG_PATH);
  const blocked = addressIsPlaceholder(cfg);
  if (blocked) console.warn("\n⚠️  Address not set — rendering BLOCKED placeholders only (CAN-SPAM). Set it in " + CONFIG_PATH + ".\n");

  const seq = await loadSequence();
  const ledger = await readJson(LEDGER_PATH, []);
  const unsub = new Set(ledger.filter((r) => r.unsub).map((r) => (r.email || "").toLowerCase()));
  const leads = await loadProspects(inPath, limit);
  if (!leads.length) {
    console.error(`Hermes nurture: no leads in ${inPath}`);
    exit(1);
  }

  const footer = `\n\n— ${cfg.fromName}, ${cfg.company}\n${cfg.websiteUrl}\n\n${cfg.physicalAddress}\n${cfg.unsubscribeLine}`;
  const seen = new Set();
  let dup = 0, suppressed = 0;
  const records = [];
  for (const lead of leads) {
    const em = (lead.email || "").trim().toLowerCase();
    if (em && seen.has(em)) { dup += 1; continue; }
    if (em) seen.add(em);
    if (em && unsub.has(em)) { suppressed += 1; continue; }

    const ctx = {
      first: firstNameOf(lead) === "there" ? "there" : firstNameOf(lead),
      biz: businessOf(lead),
      need: lead.need || "your project",
      fromName: cfg.fromName, company: cfg.company, websiteUrl: cfg.websiteUrl,
      scanLink: `${cfg.websiteUrl}/scan.html`, bookLink: `${cfg.websiteUrl}/buy.html`,
    };
    const rec = { email: lead.email || "", first_name: ctx.first === "there" ? "" : ctx.first, company: ctx.biz };
    seq.steps.forEach((s, i) => {
      rec[`step${i + 1}_after_days`] = s.delayDays;
      rec[`step${i + 1}_subject`] = blocked ? "" : renderTemplate(s.subjectTemplate, ctx);
      rec[`step${i + 1}_body`] = blocked
        ? "[BLOCKED] Set a real physical address in tools/outreach.config.json before sending (CAN-SPAM)."
        : renderTemplate(s.bodyTemplate, ctx) + footer;
    });
    rec.status = blocked ? "blocked-no-address" : lead.email ? "ready" : "no-email";
    records.push(rec);
  }

  const stepCols = seq.steps.flatMap((_, i) => [`step${i + 1}_after_days`, `step${i + 1}_subject`, `step${i + 1}_body`]);
  const cols = ["email", "first_name", "company", ...stepCols, "status"];
  await mkdir(OUT_DIR, { recursive: true });
  const outCsv = path.join(OUT_DIR, "nurture.csv");
  await writeFile(outCsv, toCsv(records, cols), "utf8");
  await writeFile(path.join(OUT_DIR, "nurture.json"), JSON.stringify(records, null, 2), "utf8");

  console.log(`Hermes nurture — ${records.length} lead(s), ${seq.steps.length}-step sequence` +
    (dup ? `, ${dup} dup skipped` : "") + (suppressed ? `, ${suppressed} unsubscribed suppressed` : "") + ".");
  console.log(`CSV: ${outCsv}`);
  console.log(blocked
    ? "⚠️  Output is BLOCKED placeholders — set your address, then re-run."
    : "Load these as an automated sequence in Smartlead/Instantly (it sends on the step delays = speed-to-lead).");
}

/* ---- the marketing engine (ever-improving, like outreach) ------------ */
const DEFAULT_MARKETING = { epsilon: 0.25, hashtags: ["#smallbusiness", "#localbusiness", "#bayarea"], angles: [{ id: "offer", label: "Offer", sends: 0, engaged: 0, templates: ["Free scan of your site — we send the top 3 fixes costing you leads. {url}"] }] };

async function loadMarketing() {
  const m = await readJson(MARKETING_PATH, null);
  return m && Array.isArray(m.angles) && m.angles.length ? m : DEFAULT_MARKETING;
}

async function loadSiteData() {
  const [site, niches, services, cities] = await Promise.all([
    import("../../src/_data/site.js").then((m) => m.default),
    import("../../src/_data/niches.js").then((m) => m.default).catch(() => ({})),
    import("../../src/_data/growServices.js").then((m) => m.default).catch(() => []),
    import("../../src/_data/cities.js").then((m) => m.default).catch(() => ({})),
  ]);
  return { site, niches, services, cities };
}

const angleScore = (a) => ((a.engaged || 0) + 1) / ((a.sends || 0) + 2);

// Epsilon-greedy over engagement rate — same idea as the outreach bandit.
function pickAngle(angles, epsilon) {
  if (Math.random() < epsilon) return angles[Math.floor(Math.random() * angles.length)];
  return [...angles].sort((a, b) => angleScore(b) - angleScore(a) || (a.sends || 0) - (b.sends || 0))[0];
}

function fillCtx(i, site, niches, services, cities) {
  const nicheLabels = Object.values(niches).map((n) => n.label);
  const serviceLabels = (services || []).map((s) => s.label);
  const cityNames = Object.values(cities).map((c) => c.name);
  const offers = (site.packages || []).map((p) => `${p.name} — ${p.price}`);
  return {
    brand: site.name,
    url: site.url || "https://symbioai.dev",
    niche: (nicheLabels[i % (nicheLabels.length || 1)] || "local businesses").toLowerCase(),
    service: serviceLabels[i % (serviceLabels.length || 1)] || "a fast website",
    city: cityNames[i % (cityNames.length || 1)] || "the Bay Area",
    offer: offers.length ? offers[i % offers.length] : "a fixed-price package",
  };
}

async function cmdSocial(flags) {
  const weeks = Math.max(1, parseInt(flags.weeks || "4", 10));
  const perWeek = Math.max(1, parseInt(flags["per-week"] || "3", 10));
  const mk = await loadMarketing();
  const eps = flags.epsilon != null ? parseFloat(flags.epsilon) : mk.epsilon;
  const { site, niches, services, cities } = await loadSiteData();
  const platforms = ["LinkedIn", "Instagram", "Facebook"];
  const total = weeks * perWeek;
  const start = new Date();
  start.setDate(start.getDate() + 1);

  const rows = [];
  const byAngle = {};
  for (let i = 0; i < total; i += 1) {
    const angle = pickAngle(mk.angles, eps);
    angle.sends = (angle.sends || 0) + 1;
    byAngle[angle.id] = (byAngle[angle.id] || 0) + 1;
    const ctx = fillCtx(i, site, niches, services, cities);
    const tpl = angle.templates[i % angle.templates.length];
    const d = new Date(start);
    d.setDate(start.getDate() + i * 2);
    rows.push({
      date: d.toISOString().slice(0, 10),
      platform: platforms[i % platforms.length],
      angle: angle.id,
      post: renderTemplate(tpl, ctx),
      hashtags: (mk.hashtags || []).slice(0, 6).join(" "),
    });
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outCsv = path.join(OUT_DIR, "social-calendar.csv");
  await writeFile(outCsv, toCsv(rows, ["date", "platform", "angle", "post", "hashtags"]), "utf8");
  const md = ["# Social calendar\n", ...rows.map((r) => `### ${r.date} · ${r.platform}  _(angle: ${r.angle})_\n${r.post}\n\n${r.hashtags}\n`)].join("\n");
  await writeFile(path.join(OUT_DIR, "social-calendar.md"), md, "utf8");
  await writeJson(MARKETING_PATH, mk);

  console.log(`Hermes social — ${rows.length} posts across ${platforms.join("/")} → ${outCsv}`);
  console.log("angles used:", Object.entries(byAngle).map(([k, n]) => `${k}=${n}`).join("  "));
  console.log("Schedule them (Buffer free tier, etc.), then log what performs:");
  console.log("  node tools/hermes/hermes.mjs log --angle <id> --engaged   (or --clicks N)");
}

async function cmdGbp(flags) {
  const count = Math.max(1, parseInt(flags.count || "8", 10));
  const mk = await loadMarketing();
  const eps = flags.epsilon != null ? parseFloat(flags.epsilon) : mk.epsilon;
  const { site, niches, services, cities } = await loadSiteData();
  const ctas = ["Call now", "Book", "Learn more", "Get a free scan"];

  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const angle = pickAngle(mk.angles, eps);
    angle.sends = (angle.sends || 0) + 1;
    const ctx = fillCtx(i, site, niches, services, cities);
    const tpl = angle.templates[i % angle.templates.length];
    rows.push({ angle: angle.id, cta: ctas[i % ctas.length], post: renderTemplate(tpl, ctx) });
  }
  await mkdir(OUT_DIR, { recursive: true });
  const outCsv = path.join(OUT_DIR, "gbp-posts.csv");
  await writeFile(outCsv, toCsv(rows, ["angle", "cta", "post"]), "utf8");
  await writeJson(MARKETING_PATH, mk);
  console.log(`Hermes gbp — ${rows.length} Google Business Profile posts → ${outCsv}`);
  console.log("Post 1-2/week in your GBP dashboard with the suggested CTA button. Log engagement with `log --angle`.");
}

async function cmdReview(flags) {
  const { site } = await loadSiteData();
  const reviewUrl = flags["review-url"] || site.googleReviewUrl || "";
  const cfg = await loadConfig(CONFIG_PATH);
  const blocked = addressIsPlaceholder(cfg);
  if (blocked) console.warn("\n⚠️  Address not set — BLOCKED placeholders only (CAN-SPAM). Set it in " + CONFIG_PATH + ".\n");
  if (!reviewUrl) console.warn("! No googleReviewUrl in site.js — add it for one-tap reviews (GBP → Get more reviews → copy link).");

  const clients = await loadProspects(flags.in || "tools/prospects.sample.csv", flags.limit ? parseInt(flags.limit, 10) : Infinity);
  const footer = `\n\n— ${cfg.fromName}, ${cfg.company}\n${cfg.websiteUrl}\n\n${cfg.physicalAddress}\n${cfg.unsubscribeLine}`;
  const records = clients.map((c) => {
    const first = firstNameOf(c) === "there" ? "there" : firstNameOf(c);
    const biz = businessOf(c);
    const body = blocked
      ? "[BLOCKED] Set a real physical address in tools/outreach.config.json before sending (CAN-SPAM)."
      : `Hi ${first},\n\nThank you for trusting us with ${biz}'s project — it was a pleasure to build.\n\n` +
        (reviewUrl ? `If you have 30 seconds, a quick Google review would mean the world to two founders just getting started:\n${reviewUrl}\n\n` : `If you have 30 seconds, a quick Google review would mean the world to two founders just getting started.\n\n`) +
        `And if you know another local business or organization that could use a better site, booking, or an AI assistant, we'd be grateful for the introduction — we'll take great care of them.${footer}`;
    return {
      email: c.email || "",
      first_name: first === "there" ? "" : first,
      company: biz,
      subject: blocked ? "" : `Quick favor, ${first}?`,
      email_body: body,
      status: blocked ? "blocked-no-address" : c.email ? "ready" : "no-email",
    };
  });
  await mkdir(OUT_DIR, { recursive: true });
  const outCsv = path.join(OUT_DIR, "review-requests.csv");
  await writeFile(outCsv, toCsv(records, ["email", "first_name", "company", "subject", "email_body", "status"]), "utf8");
  console.log(`Hermes review — ${records.length} review + referral request(s) → ${outCsv}`);
  console.log(blocked ? "⚠️  BLOCKED placeholders — set your address, then re-run." : "Send these after a project ships — reviews compound your local SEO and trust.");
}

async function main() {
  const { cmd, flags } = parseArgs(argv.slice(2));
  switch (cmd) {
    case "outreach": return cmdOutreach(flags);
    case "nurture": return cmdNurture(flags);
    case "social": return cmdSocial(flags);
    case "gbp": return cmdGbp(flags);
    case "review": return cmdReview(flags);
    case "log": return cmdLog(flags);
    case "learn": await cmdLearn(); return;
    case "report": return cmdReport();
    case "run":
      await cmdOutreach(flags);
      return cmdReport();
    default:
      console.log(`Hermes — Symbio AI growth engine (every channel learns from what you log)

  OUTBOUND
  outreach --in leads.csv     Scan prospects + write A/B emails (bandit-assigned)
  nurture  --in leads.csv     Speed-to-lead follow-up sequence for inbound leads
  review   --in clients.csv   Review + referral requests (after a project ships)

  MARKETING (ever-improving — angles learn from engagement)
  social   --weeks 4          Generate a LinkedIn/Instagram/Facebook content calendar
  gbp      --count 8          Generate Google Business Profile posts

  LEARN / REPORT
  log --email e@x.com --replied        Record an outreach outcome
  log --angle community --engaged      Record marketing engagement
  learn                                Update variant + angle win-rates
  report                               Write the funnel + channel dashboard
  run --in leads.csv                   outreach -> report

What you log makes the next run smarter. See tools/hermes/README.md.`);
  }
}

main().catch((err) => {
  console.error("Hermes failed:", err);
  exit(1);
});
