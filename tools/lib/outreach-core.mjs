/**
 * outreach-core.mjs — shared engine for the audit/outreach tooling.
 *
 * Pure Node, ZERO dependencies (Node 18+ global fetch). Used by BOTH:
 *   - tools/audit-outreach.mjs  (the simple one-shot CLI)
 *   - tools/hermes/hermes.mjs   (the orchestrator + learning loop)
 *
 * The pure scan logic (fetchSite / findings / normalizeUrl / hostIsPrivate)
 * lives in scan-core.mjs so it can be shared with the Cloudflare Worker; we
 * re-export it here so existing imports keep working unchanged.
 */

import { DEFAULT_UA, normalizeUrl, hostIsPrivate, fetchSite, findings } from "./scan-core.mjs";
export { DEFAULT_UA, normalizeUrl, hostIsPrivate, fetchSite, findings };

export const DEFAULT_CONFIG = {
  fromName: "Ravi",
  company: "Symbio AI",
  serviceLine: "I build fast websites, booking systems, and AI assistants for local businesses.",
  websiteUrl: "https://symbioai.dev",
  physicalAddress: "Symbio AI — <add your mailing address>, <City, ST ZIP>",
  unsubscribeLine: "Not relevant? Reply 'unsubscribe' and you won't hear from me again.",
  cta: 'Want the full one-page teardown (free, no obligation)? Just reply "send it".',
};

/* ---- small helpers --------------------------------------------------- */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CAN-SPAM: every commercial email needs a REAL postal address. Refuse to
// generate sendable bodies while the config still holds the placeholder.
export function addressIsPlaceholder(cfg) {
  return /<add your|<City, ST ZIP>/i.test(cfg.physicalAddress || "");
}

export function firstNameOf(row) {
  return row.first_name ? row.first_name.trim() : "there";
}

export function businessOf(row) {
  if (row.business) return row.business.trim();
  if (row.website) {
    try {
      return new URL(normalizeUrl(row.website)).hostname.replace(/^www\./, "");
    } catch {
      return "your business";
    }
  }
  return "your business";
}

/* ---- minimal CSV ----------------------------------------------------- */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] || "").trim();
    });
    return obj;
  });
}

export function csvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(objects, columns) {
  const lines = [columns.join(",")];
  for (const o of objects) lines.push(columns.map((c) => csvCell(o[c])).join(","));
  return lines.join("\n") + "\n";
}

/* ---- the email (variant-aware) --------------------------------------- */
// A variant is { id, subjectTemplate, cta }. Placeholders in subjectTemplate:
// {biz} {first} {n} {niche}. When no variant is passed, the config defaults win.
export function renderTemplate(tpl, ctx) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : ""));
}

export function buildEmail(cfg, row, top3, variant = null) {
  const first = firstNameOf(row);
  const biz = businessOf(row);
  const niche = (row.niche || "").trim();
  const site = row.website ? normalizeUrl(row.website) : "";
  const ctx = { biz, first, n: top3.length, niche: niche || "local business" };

  const subject = variant
    ? renderTemplate(variant.subjectTemplate, ctx)
    : row.website
      ? `${biz}: ${top3.length} quick wins on your site`
      : `A quick idea for ${biz}'s online presence`;

  const cta = (variant && variant.cta) || cfg.cta;

  const lookedAt = site
    ? `I took a quick look at ${site} and spotted a few quick wins:`
    : `I noticed ${biz} doesn't have much of a website yet — here's where I'd start:`;
  const bullets = top3.map((f) => `  • ${f.title} → ${f.fix}`).join("\n");

  const body = [
    `Hi ${first},`,
    "",
    `I'm ${cfg.fromName} from ${cfg.company}. ${cfg.serviceLine}`,
    "",
    lookedAt,
    bullets,
    "",
    cta,
    "",
    `— ${cfg.fromName}, ${cfg.company}`,
    cfg.websiteUrl,
    "",
    cfg.physicalAddress,
    cfg.unsubscribeLine,
  ].join("\n");

  return { subject, body };
}

/* ---- pooled runner --------------------------------------------------- */
export async function runPool(items, worker, { concurrency = 4, delay = 250 } = {}) {
  const results = new Array(items.length);
  let cursor = 0;
  async function lane() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await worker(items[i], i);
      if (delay) await sleep(delay);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

/* ---- IO helpers ------------------------------------------------------ */
import { readFile } from "node:fs/promises";

export async function loadConfig(path) {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function loadProspects(path, limit = Infinity) {
  const raw = await readFile(path, "utf8");
  let rows;
  if (path.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(raw);
    rows = (Array.isArray(data) ? data : data.prospects || []).map((o) => {
      const lower = {};
      for (const k of Object.keys(o)) lower[k.toLowerCase()] = o[k];
      return lower;
    });
  } else {
    rows = rowsToObjects(parseCsv(raw));
  }
  return rows.filter((r) => r.business || r.website || r.email).slice(0, limit);
}

// One prospect -> a complete outreach record (scan + findings + email).
// blockSend short-circuits with a non-sendable record when the config still has
// a placeholder physical address (CAN-SPAM) — no scan, no email body.
export async function processProspect(row, cfg, { timeout, ua, variant, blockSend = false } = {}) {
  if (blockSend) {
    return {
      email: row.email || "",
      first_name: firstNameOf(row) === "there" ? "" : firstNameOf(row),
      company: businessOf(row),
      website: normalizeUrl(row.website),
      city: row.city || "",
      niche: row.niche || "",
      finding_1: "", finding_2: "", finding_3: "",
      subject: "",
      email_body: "[BLOCKED] Set a real physical address in tools/outreach.config.json before generating emails — CAN-SPAM requires a valid postal address in every message.",
      status: "blocked-no-address",
    };
  }
  const url = normalizeUrl(row.website);
  const scan = url ? await fetchSite(url, { timeout, ua }) : { ok: false, status: 0, ms: 0, bytes: 0 };
  const found = findings(scan, row);
  const top3 = found.slice(0, 3);
  const { subject, body } = buildEmail(cfg, row, top3, variant);
  const status = !row.email ? "no-email" : url ? (scan.ok ? "ok" : "unreachable") : "no-site";
  return {
    email: row.email || "",
    first_name: firstNameOf(row) === "there" ? "" : firstNameOf(row),
    company: businessOf(row),
    website: url,
    city: row.city || "",
    niche: row.niche || "",
    finding_1: top3[0] ? `${top3[0].title} → ${top3[0].fix}` : "",
    finding_2: top3[1] ? `${top3[1].title} → ${top3[1].fix}` : "",
    finding_3: top3[2] ? `${top3[2].title} → ${top3[2].fix}` : "",
    subject,
    email_body: body,
    status,
  };
}
