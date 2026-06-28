#!/usr/bin/env node
/**
 * Symbio AI — audit-first outreach generator (Engine 1 of GROWTH_PLAYBOOK.md)
 * =============================================================================
 * Reads a list of prospect businesses, scans each site, picks the 3 most useful
 * talking points, writes a personalized CAN-SPAM-compliant cold email, and
 * exports a CSV (+ JSON) ready to import into a cold-email tool (Smartlead,
 * Instantly, Saleshandy, …) and map as variables.
 *
 * The scan/finding/email logic lives in tools/lib/outreach-core.mjs (shared
 * with Hermes). This file is just the one-shot CLI. Pure Node, zero deps.
 *
 *   node tools/audit-outreach.mjs --in tools/prospects.sample.csv
 *   node tools/audit-outreach.mjs --in leads.csv --out out/run1.csv --limit 200
 *
 * Flags: --in --out --config --limit --concurrency --timeout --delay
 * Input columns: business, website, email, first_name, city, niche
 *
 * IMPORTANT: send from a SEPARATE, WARMED domain — never your main one. Set a
 * real physical address + opt-out in tools/outreach.config.json (CAN-SPAM).
 */

import { writeFile, mkdir } from "node:fs/promises";
import { argv, exit } from "node:process";
import path from "node:path";
import { loadConfig, loadProspects, processProspect, runPool, toCsv, businessOf, addressIsPlaceholder, DEFAULT_UA } from "./lib/outreach-core.mjs";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(argv.slice(2));
const IN = args.in || "tools/prospects.sample.csv";
const OUT = args.out || "tools/out/outreach.csv";
const CONFIG = args.config || "tools/outreach.config.json";
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const CONCURRENCY = Math.max(1, parseInt(args.concurrency || "4", 10));
const TIMEOUT = parseInt(args.timeout || "12000", 10);
const DELAY = parseInt(args.delay || "250", 10);

const COLUMNS = [
  "email", "first_name", "company", "website", "city", "niche",
  "finding_1", "finding_2", "finding_3", "subject", "email_body", "status",
];

async function main() {
  const cfg = await loadConfig(CONFIG);
  const blocked = addressIsPlaceholder(cfg);
  if (blocked) {
    console.warn("\n⚠️  PHYSICAL ADDRESS NOT SET in " + CONFIG + ".");
    console.warn("   Generating BLOCKED placeholders only — set a real postal address before sending (CAN-SPAM).\n");
  }
  const prospects = await loadProspects(IN, LIMIT);
  if (!prospects.length) {
    console.error(`No prospects found in ${IN}. Expected columns: business, website, email, first_name, city, niche`);
    exit(1);
  }
  console.log(`Scanning ${prospects.length} prospect(s) — concurrency ${CONCURRENCY}, timeout ${TIMEOUT}ms…\n`);

  let reachable = 0;
  const records = await runPool(
    prospects,
    async (row) => {
      const rec = await processProspect(row, cfg, { timeout: TIMEOUT, ua: DEFAULT_UA, blockSend: blocked });
      if (rec.status === "ok") reachable += 1;
      console.log(`  [${rec.status.padEnd(11)}] ${businessOf(row)}`);
      return rec;
    },
    { concurrency: CONCURRENCY, delay: DELAY }
  );

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, toCsv(records, COLUMNS), "utf8");
  const jsonOut = OUT.replace(/\.csv$/i, "") + ".json";
  await writeFile(jsonOut, JSON.stringify(records, null, 2), "utf8");

  const sendable = records.filter((r) => r.email).length;
  console.log("\n────────────────────────────────────────────");
  console.log(`Done. ${records.length} processed · ${reachable} reachable · ${sendable} sendable.`);
  console.log(`CSV : ${OUT}\nJSON: ${jsonOut}`);
  console.log("\nNext: import the CSV into Smartlead/Instantly, map {{subject}} + {{email_body}},");
  console.log(`send from a SEPARATE, WARMED domain, and confirm your address + opt-out in ${CONFIG}.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  exit(1);
});
