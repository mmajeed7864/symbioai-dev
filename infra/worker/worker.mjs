/**
 * Symbio AI — instant teardown Worker (Cloudflare).
 *
 * Two endpoints, both CORS-enabled, zero dependencies (reuses the shared, pure
 * scan engine in tools/lib/scan-core.mjs — same logic as the CLI tools):
 *
 *   POST /api/scan  { "url": "example.com" }
 *     → { ok, reachable, score, findings: [{title, fix}, ...] }
 *       Powers the live on-page teardown (teardown.html). No email needed.
 *
 *   POST /api/lead  { "name", "email", "business", "need" }
 *     → sends an instant auto-reply to the lead (speed-to-lead) IF the
 *       RESEND_API_KEY + LEAD_FROM secrets are set; always returns { ok }.
 *
 * Deploy: see infra/worker/README.md. Set the deployed URL in site.js `scanApi`.
 */

import { normalizeUrl, fetchSite, findings } from "../../tools/lib/scan-core.mjs";

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

// 0–100 friendliness score from the findings' severities.
function scoreFrom(found) {
  const penalty = found.reduce((a, f) => a + f.sev * 9, 0);
  return Math.max(5, Math.min(100, 100 - penalty));
}

async function handleScan(req, env) {
  const { url } = await readJson(req);
  const norm = normalizeUrl(url);
  if (!norm) return json({ ok: false, error: "Please include a website URL." }, 400, env);

  const scan = await fetchSite(norm, { timeout: 8000 });
  const found = findings(scan, { website: norm });
  const top = found.slice(0, 3).map((f) => ({ title: f.title, fix: f.fix }));
  return json(
    { ok: true, url: norm, reachable: !!scan.ok, score: scoreFrom(found), findings: top },
    200,
    env
  );
}

async function handleLead(req, env) {
  const lead = await readJson(req);
  const email = (lead.email || "").trim();
  const first = (lead.name || "there").trim().split(/\s+/)[0] || "there";
  const biz = (lead.business || "your business").trim();

  // Without a mail provider configured, acknowledge without sending (the site's
  // existing lead pipeline still captures it). With RESEND_API_KEY, send the
  // instant auto-reply — the speed-to-lead win.
  if (!env.RESEND_API_KEY || !env.LEAD_FROM || !email) {
    return json({ ok: true, sent: false }, 200, env);
  }

  const address = env.PHYSICAL_ADDRESS || "";
  const body =
    `Hi ${first},\n\nThanks for reaching out about ${biz} — got it. A real person will reply ` +
    `within one business day. In the meantime, reply here with anything you want us to look at first.\n\n` +
    `— Symbio AI\nhttps://symbioai.dev` + (address ? `\n\n${address}` : "");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.LEAD_FROM,
        to: email,
        ...(env.LEAD_BCC ? { bcc: env.LEAD_BCC } : {}),
        subject: `Thanks ${first} — we got it`,
        text: body,
      }),
    });
    return json({ ok: true, sent: res.ok }, 200, env);
  } catch {
    return json({ ok: true, sent: false }, 200, env);
  }
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(env) });
    if (req.method === "POST" && pathname === "/api/scan") return handleScan(req, env);
    if (req.method === "POST" && pathname === "/api/lead") return handleLead(req, env);
    return json({ ok: false, error: "Not found. Use POST /api/scan or /api/lead." }, 404, env);
  },
};
