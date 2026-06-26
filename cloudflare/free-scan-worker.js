const DEFAULT_ALLOWED_ORIGINS = [
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://127.0.0.1:8878",
  "http://localhost:8878",
];

function splitList(value = "") {
  return String(value)
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function compact(value, limit = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function allowedOrigins(env) {
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...splitList(env.ALLOWED_ORIGINS)]);
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (allowedOrigins(env).has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers.Vary = "Origin";
  }
  return headers;
}

function json(request, env, status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, env),
  });
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `scan-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeScan(payload, request) {
  const created = compact(payload.created || payload.createdAt || nowIso(), 90);
  return {
    id: compact(payload.id || makeId(), 90),
    name: compact(payload.name, 140),
    business: compact(payload.business || payload.company, 180),
    email: compact(payload.email, 180),
    phone: compact(payload.phone, 80),
    link: compact(payload.link || payload.website, 320),
    need: compact(payload.need || payload.type || payload.projectType || "Website", 120),
    goal: compact(payload.goal, 180),
    budget: compact(payload.budget || payload.budgetRange, 140),
    problem: compact(payload.problem || payload.pain, 1200),
    status: compact(payload.status || "new", 80).toLowerCase(),
    sourceUrl: compact(payload.sourceUrl || request.headers.get("Referer") || "", 320),
    created,
    updated: nowIso(),
    clientIp: compact(request.headers.get("CF-Connecting-IP") || "", 90),
    userAgent: compact(request.headers.get("User-Agent") || "", 240),
  };
}

function scanStorageKey(scan) {
  return `scan:${scan.created}:${scan.id}`;
}

async function saveScan(env, scan) {
  const body = JSON.stringify(scan);
  await env.FREE_SCAN_KV.put(scanStorageKey(scan), body, {
    metadata: {
      id: scan.id,
      status: scan.status,
      created: scan.created,
      business: scan.business || scan.name || "",
    },
  });
  await env.FREE_SCAN_KV.put(`scan-id:${scan.id}`, body);
}

async function listScans(env, limit = 250) {
  const listed = await env.FREE_SCAN_KV.list({ prefix: "scan:", limit: Math.max(1, Math.min(limit, 500)) });
  const scans = [];
  for (const key of listed.keys) {
    const scan = await env.FREE_SCAN_KV.get(key.name, "json");
    if (scan && typeof scan === "object") scans.push(scan);
  }
  scans.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
  return scans;
}

function requireSyncAuth(request, env) {
  const token = env.SYNC_SECRET || "";
  if (!token) return false;
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${token}`;
}

function emailBody(scan) {
  return [
    "New Symbio AI Free Scan request",
    "",
    "Priority: #1 / P0 inbound free scan",
    `Business: ${scan.business || ""}`,
    `Name: ${scan.name || ""}`,
    `Email: ${scan.email || ""}`,
    `Phone: ${scan.phone || ""}`,
    `Link: ${scan.link || ""}`,
    `Need: ${scan.need || ""}`,
    `Budget: ${scan.budget || ""}`,
    `Goal: ${scan.goal || ""}`,
    `Problem: ${scan.problem || ""}`,
    `Source: ${scan.sourceUrl || ""}`,
    `Request ID: ${scan.id || ""}`,
    "",
    "Next action: open Olympus, draft the scan response, and reply fast.",
  ].join("\n");
}

async function sendEmailAlert(env, scan) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL_FROM || !env.ALERT_EMAIL_TO) return { skipped: "email" };
  const recipients = splitList(env.ALERT_EMAIL_TO);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM,
      to: recipients,
      subject: `P0 Free Scan Lead: ${scan.business || scan.name || "New lead"}`,
      text: emailBody(scan),
      ...(scan.email ? { reply_to: scan.email } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Resend alert failed: ${response.status}`);
  return { sent: "email", to: recipients.length };
}

function smsBody(scan) {
  const label = scan.business || scan.name || "New lead";
  const contact = scan.phone || scan.email || "no contact";
  return `SYM BIO P0: New Free Scan from ${label}. Need: ${scan.need || "Free Scan"}. Contact: ${contact}. Open Olympus and reply first.`;
}

async function sendSmsAlert(env, scan) {
  const recipients = splitList(env.SMS_TO);
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM_NUMBER || !recipients.length) {
    return { skipped: "sms" };
  }
  const auth = btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  const results = [];
  for (const to of recipients) {
    const body = new URLSearchParams({
      To: to,
      From: env.TWILIO_FROM_NUMBER,
      Body: smsBody(scan),
    });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!response.ok) throw new Error(`Twilio SMS failed for ${to}: ${response.status}`);
    results.push({ sent: "sms", to });
  }
  return results;
}

async function handleCreateScan(request, env, ctx) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return json(request, env, 400, { ok: false, error: "Invalid JSON." });
  }
  const scan = normalizeScan(payload, request);
  if (!(scan.name || scan.business)) {
    return json(request, env, 400, { ok: false, error: "Name or business is required." });
  }
  if (!(scan.email || scan.phone)) {
    return json(request, env, 400, { ok: false, error: "Email or phone is required." });
  }
  await saveScan(env, scan);
  ctx.waitUntil(Promise.allSettled([sendEmailAlert(env, scan), sendSmsAlert(env, scan)]));
  return json(request, env, 200, {
    ok: true,
    request: scan,
    message: "Free Scan request saved and promoted to P0.",
  });
}

async function handleListScans(request, env) {
  if (!requireSyncAuth(request, env)) {
    return json(request, env, 401, { ok: false, error: "Sync token required." });
  }
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || "250");
  const requests = await listScans(env, limit);
  return json(request, env, 200, {
    ok: true,
    requests,
    summary: {
      total: requests.length,
      new: requests.filter((scan) => (scan.status || "new") === "new").length,
    },
  });
}

async function handleUpdateStatus(request, env) {
  if (!requireSyncAuth(request, env)) {
    return json(request, env, 401, { ok: false, error: "Sync token required." });
  }
  const payload = await request.json();
  const id = compact(payload.id, 90);
  const status = compact(payload.status || "reviewed", 80).toLowerCase();
  if (!id) return json(request, env, 400, { ok: false, error: "Request id is required." });
  const existing = await env.FREE_SCAN_KV.get(`scan-id:${id}`, "json");
  if (!existing) return json(request, env, 404, { ok: false, error: "Free Scan request not found." });
  const updated = { ...existing, status, updated: nowIso() };
  await saveScan(env, updated);
  return json(request, env, 200, { ok: true, request: updated });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (url.pathname === "/api/health") return json(request, env, 200, { ok: true, service: "symbio-free-scan-intake" });
    if (url.pathname === "/api/free-scan" && request.method === "POST") return handleCreateScan(request, env, ctx);
    if (url.pathname === "/api/free-scans" && request.method === "GET") return handleListScans(request, env);
    if (url.pathname === "/api/free-scans/status" && request.method === "POST") return handleUpdateStatus(request, env);
    return json(request, env, 404, { ok: false, error: "Not found." });
  },
};
