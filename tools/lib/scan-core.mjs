/**
 * scan-core.mjs — pure, runtime-agnostic site-scan logic.
 *
 * NO Node-only APIs (only global fetch / URL / AbortController / setTimeout), so
 * this runs identically in Node (the CLIs) AND in a Cloudflare Worker (the
 * instant-teardown endpoint at infra/worker/). It is the single source of truth
 * for "scan a URL → the 3 most compelling findings".
 *
 * outreach-core.mjs re-exports these so the existing tools keep their imports.
 */

export const DEFAULT_UA =
  "SymbioAuditBot/1.0 (+https://symbioai.dev; site audit — contact via the site)";

export function normalizeUrl(raw) {
  const t = (raw || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return "https://" + t.replace(/^\/+/, "");
}

// SSRF guard: block loopback / private / link-local / cloud-metadata hosts so a
// hostile input can't point the scanner at internal addresses.
export function hostIsPrivate(hostname) {
  const h = (hostname || "").toLowerCase();
  if (!h || h === "localhost" || h === "::1" || h.endsWith(".localhost")) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  }
  return false;
}

export async function fetchSite(url, { timeout = 12000, ua = DEFAULT_UA } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, status: 0, finalUrl: url, ms: 0, error: "invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    return { ok: false, status: 0, finalUrl: url, ms: 0, error: "unsupported scheme" };
  if (hostIsPrivate(u.hostname))
    return { ok: false, status: 0, finalUrl: url, ms: 0, error: "blocked host (private/loopback)" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": ua, Accept: "text/html,*/*" },
    });
    const html = (await res.text()).slice(0, 600_000);
    return { ok: res.ok, status: res.status, finalUrl: res.url || url, ms: Date.now() - started, bytes: html.length, html };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, ms: Date.now() - started, error: String(err && err.message) };
  } finally {
    clearTimeout(timer);
  }
}

const has = (html, re) => re.test(html);

// Findings sorted by severity (3 = most compelling). `row` only needs `website`.
export function findings(scan, row) {
  if (!row.website) {
    return [
      { sev: 3, title: "You don't have a website yet", fix: "a fast, modern one that earns trust and books leads" },
      { sev: 2, title: "Customers can't find or vet you online", fix: "a simple site that shows up on Google" },
      { sev: 2, title: "No way to capture after-hours enquiries", fix: "a chat + booking flow that works 24/7" },
    ];
  }
  if (!scan.ok) {
    return [
      { sev: 3, title: "Your site didn't load when I checked", fix: "get it back up, fast, and keep it that way" },
      { sev: 2, title: "Downtime quietly loses you customers", fix: "a reliable host + monitoring so it never disappears" },
      { sev: 2, title: "A fresh, fast rebuild may cost less than fixing", fix: "a clean modern site in days" },
    ];
  }
  const html = scan.html || "";
  const list = [];
  if (!/^https:/i.test(scan.finalUrl))
    list.push({ sev: 3, title: "Your site isn't secure (no HTTPS)", fix: "an SSL cert + redirect — browsers flag you as 'Not secure' without it" });
  if (!has(html, /<meta[^>]+name=["']?viewport/i))
    list.push({ sev: 3, title: "It isn't mobile-friendly (no viewport tag)", fix: "a responsive layout — most local searches are on phones" });
  if (!has(html, /<title[^>]*>\s*\S/i))
    list.push({ sev: 2, title: "Missing a page title", fix: "a clear title so Google and tabs show your name" });
  if (!has(html, /<meta[^>]+name=["']?description/i))
    list.push({ sev: 2, title: "No meta description", fix: "a one-line pitch so Google shows your words, not a guess" });
  if (!has(html, /book|appointment|calendly|acuity|schedul|reserve|booking/i))
    list.push({ sev: 3, title: "No way to book online", fix: "a booking widget wired to your calendar, with reminders" });
  if (!has(html, /intercom|drift|tawk|crisp|messenger|hubspot|livechat|chat-widget|type=["']?email/i))
    list.push({ sev: 2, title: "No instant lead capture (visitors leave silently)", fix: "an AI chat that answers and grabs the lead in seconds" });
  if (scan.ms > 2500)
    list.push({ sev: 2, title: `Slow to load (~${(scan.ms / 1000).toFixed(1)}s)`, fix: "speed + image cleanup — every second costs conversions" });
  if (scan.bytes > 350_000)
    list.push({ sev: 1, title: "Heavy page (lots of code/markup)", fix: "trim the bloat so it flies on phones" });
  if (!list.length) {
    list.push(
      { sev: 2, title: "No AI assistant capturing leads 24/7", fix: "an always-on assistant that answers and books" },
      { sev: 1, title: "Booking/follow-ups likely still manual", fix: "automation that cuts no-shows and busywork" },
      { sev: 1, title: "Room to convert more of the traffic you have", fix: "a conversion pass on your key pages" }
    );
  }
  return list.sort((a, b) => b.sev - a.sev);
}
