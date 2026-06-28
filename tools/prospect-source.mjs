#!/usr/bin/env node
/**
 * prospect-source — build a Hermes-ready leads.csv of local businesses.
 *
 * Two modes:
 *   A) Google Places API (live sourcing):
 *      node tools/prospect-source.mjs --query "dentists in Fremont, CA" \
 *        --niche dentist --key $GOOGLE_PLACES_KEY --out leads.csv
 *   B) Normalize an existing export (Apify, a Maps scrape, a purchased list):
 *      node tools/prospect-source.mjs --in raw.csv --niche dentist --out leads.csv
 *
 * For each business with a website, it fetches the homepage and extracts a
 * contact email (best-effort enrichment). Output columns match what Hermes
 * expects: business, website, email, first_name, city, niche.
 *
 * Honest notes: the Places API costs per request and has Google's terms; email
 * enrichment is best-effort B2B and should respect local law and each site's
 * terms. Hermes still gates everything on a real address + honors unsubscribes.
 *
 * Pure Node, zero deps. Reuses tools/lib/scan-core.mjs for fetching.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { argv, env, exit } from "node:process";
import path from "node:path";
import { fetchSite, normalizeUrl } from "./lib/scan-core.mjs";
import { parseCsv, rowsToObjects, toCsv } from "./lib/outreach-core.mjs";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(argv.slice(2));
const OUT = args.out || "leads.csv";
const NICHE = args.niche || "";
const LIMIT = args.limit ? parseInt(args.limit, 10) : 200;
const ENRICH = args.enrich !== false && args["no-enrich"] !== true;
const MAX_ENRICH = parseInt(args["max-enrich"] || "100", 10);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK = /(example|sentry|wix|squarespace|godaddy|domain\.com|email\.com|yourname|your-email|placeholder|\.png|\.jpg|\.jpeg|\.gif|\.svg|@2x|@sentry)/i;

function extractEmail(html, siteHost) {
  const all = (html.match(EMAIL_RE) || []).filter((e) => !JUNK.test(e));
  if (!all.length) return "";
  const host = (siteHost || "").replace(/^www\./, "");
  const sameDomain = all.find((e) => e.split("@")[1].replace(/^www\./, "").toLowerCase() === host.toLowerCase());
  return (sameDomain || all[0]).toLowerCase();
}

function cityFromAddress(addr) {
  if (!addr) return "";
  const parts = addr.split(",").map((s) => s.trim());
  const i = parts.findIndex((p) => /\b[A-Z]{2}\s*\d{5}/.test(p)); // "CA 94536"
  if (i > 0) return parts[i - 1];
  return parts.length >= 3 ? parts[parts.length - 3] : "";
}

async function fromPlaces() {
  const key = args.key || env.GOOGLE_PLACES_KEY;
  if (!key || !args.query || args.query === true) {
    console.error('Places mode needs --query "<text>" and --key (or GOOGLE_PLACES_KEY env).');
    console.error('e.g. --query "dentists in Fremont, CA" --niche dentist --key $GOOGLE_PLACES_KEY');
    exit(1);
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.formattedAddress,places.nationalPhoneNumber",
    },
    body: JSON.stringify({ textQuery: args.query }),
  });
  if (!res.ok) {
    console.error(`Places API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    exit(1);
  }
  const data = await res.json();
  return (data.places || []).map((p) => ({
    business: (p.displayName && p.displayName.text) || "",
    website: p.websiteUri || "",
    phone: p.nationalPhoneNumber || "",
    city: cityFromAddress(p.formattedAddress || ""),
  }));
}

async function fromFile() {
  const rows = rowsToObjects(parseCsv(await readFile(args.in, "utf8")));
  return rows.map((r) => ({
    business: r.business || r.name || r.company || r.title || "",
    website: r.website || r.url || r.site || r.domain || "",
    email: r.email || "",
    phone: r.phone || r.phone_number || "",
    city: r.city || cityFromAddress(r.address || r.formatted_address || ""),
  }));
}

async function main() {
  let rows = args.in ? await fromFile() : await fromPlaces();
  rows = rows.filter((r) => r.business || r.website).slice(0, LIMIT);
  if (!rows.length) {
    console.error("No businesses found.");
    exit(1);
  }

  // Dedupe by website (or business when no site).
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = (normalizeUrl(r.website) || r.business).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  console.log(`Sourced ${rows.length} business(es)${ENRICH ? " — enriching emails…" : ""}`);

  let enriched = 0;
  if (ENRICH) {
    let budget = MAX_ENRICH;
    for (const r of rows) {
      if (r.email || !r.website || budget <= 0) continue;
      budget -= 1;
      const url = normalizeUrl(r.website);
      let host = "";
      try { host = new URL(url).hostname; } catch { /* ignore */ }
      const scan = await fetchSite(url, { timeout: 9000 });
      if (scan.ok && scan.html) {
        const email = extractEmail(scan.html, host);
        if (email) { r.email = email; enriched += 1; }
      }
    }
  }

  const records = rows.map((r) => ({
    business: r.business,
    website: normalizeUrl(r.website),
    email: r.email || "",
    first_name: "",
    city: r.city || "",
    niche: NICHE,
  }));

  await mkdir(path.dirname(path.resolve(OUT)), { recursive: true });
  await writeFile(OUT, toCsv(records, ["business", "website", "email", "first_name", "city", "niche"]), "utf8");

  const withEmail = records.filter((r) => r.email).length;
  const withSite = records.filter((r) => r.website).length;
  console.log(`\nWrote ${records.length} lead(s) → ${OUT}`);
  console.log(`  with website: ${withSite} · with email: ${withEmail} (${enriched} enriched this run)`);
  console.log(`\nNext: node tools/hermes/hermes.mjs outreach --in ${OUT}   (or audit-outreach / nurture)`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  exit(1);
});
