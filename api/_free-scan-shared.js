const { createHash, randomUUID } = require("crypto");

const ALLOWED_ORIGINS = new Set([
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function corsOrigin(req) {
  const origin = req.headers.origin || "";
  return ALLOWED_ORIGINS.has(origin) ? origin : "https://www.symbioai.dev";
}

function setCors(req, res, methods = "GET, POST, OPTIONS") {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Vary", "Origin");
}

function parseRecipients(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function compact(value, limit = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function normalizePayload(body) {
  const payload = {
    id: compact(body?.id, 90) || `scan-${randomUUID()}`,
    name: compact(body?.name, 180),
    business: compact(body?.business, 220),
    email: compact(body?.email, 220).toLowerCase(),
    phone: compact(body?.phone, 80),
    link: compact(body?.link, 500),
    need: compact(body?.need, 180),
    budget: compact(body?.budget, 120),
    goal: compact(body?.goal, 700),
    problem: compact(body?.problem, 1600),
    sourceUrl: compact(body?.sourceUrl, 700),
    status: compact(body?.status, 90) || "new",
  };
  payload.idempotencyKey = createHash("sha256")
    .update(
      [
        payload.email,
        payload.phone,
        payload.business,
        payload.link,
        payload.goal,
        payload.problem,
      ].join("|")
    )
    .digest("hex");
  return payload;
}

function requireSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const table = process.env.SUPABASE_FREE_SCAN_TABLE || "free_scan_requests";
  if (!url || !key) {
    throw new Error("Supabase storage is not configured.");
  }
  return { url, key, table };
}

function supabaseHeaders(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function rowFromPayload(payload, req) {
  const now = new Date().toISOString();
  return {
    id: payload.id,
    idempotency_key: payload.idempotencyKey,
    name: payload.name,
    business: payload.business,
    email: payload.email,
    phone: payload.phone,
    link: payload.link,
    need: payload.need,
    budget: payload.budget,
    goal: payload.goal,
    problem: payload.problem,
    source_url: payload.sourceUrl,
    status: payload.status || "new",
    priority: "P0 - inbound free scan (reply first)",
    score: "100/100 inbound",
    client_ip:
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "",
    user_agent: req.headers["user-agent"] || "",
    raw_payload: payload,
    updated_at: now,
  };
}

function scanFromRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    business: row.business || "",
    email: row.email || "",
    phone: row.phone || "",
    link: row.link || "",
    need: row.need || "",
    goal: row.goal || "",
    budget: row.budget || "",
    problem: row.problem || "",
    status: row.status || "new",
    sourceUrl: row.source_url || "",
    created: row.created_at || row.updated_at || "",
    updated: row.updated_at || row.created_at || "",
    clientIp: row.client_ip || "",
    userAgent: row.user_agent || "",
  };
}

async function upsertFreeScan(payload, req) {
  const { url, key, table } = requireSupabaseEnv();
  const endpoint = `${url}/rest/v1/${encodeURIComponent(
    table
  )}?on_conflict=idempotency_key&select=*`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: supabaseHeaders(key, {
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify([rowFromPayload(payload, req)]),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Supabase store failed (${response.status}): ${JSON.stringify(data)}`
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { row, scan: scanFromRow(row) };
}

async function listFreeScans(limit = 250) {
  const { url, key, table } = requireSupabaseEnv();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 250, 500));
  const endpoint = `${url}/rest/v1/${encodeURIComponent(
    table
  )}?select=*&order=created_at.desc&limit=${safeLimit}`;
  const response = await fetch(endpoint, {
    headers: supabaseHeaders(key),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Supabase list failed (${response.status}): ${JSON.stringify(data)}`
    );
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.map(scanFromRow);
}

function verifySyncToken(req) {
  const expected = process.env.OLYMPUS_REMOTE_FREE_SCAN_TOKEN || "";
  if (!expected) return false;
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token && token === expected;
}

function scanText(payload) {
  return [
    "New Symbio free scan request",
    "",
    `Name: ${payload.name || "not provided"}`,
    `Business: ${payload.business || "not provided"}`,
    `Email: ${payload.email || "not provided"}`,
    `Phone: ${payload.phone || "not provided"}`,
    `Link: ${payload.link || "not provided"}`,
    `Need: ${payload.need || "not provided"}`,
    `Budget: ${payload.budget || "not provided"}`,
    `Goal: ${payload.goal || "not provided"}`,
    `Problem: ${payload.problem || "not provided"}`,
    `Source: ${payload.sourceUrl || "not provided"}`,
  ].join("\n");
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.ALERT_EMAIL_FROM || "Symbio AI <freescan@symbioai.dev>";
  const to = parseRecipients(process.env.ALERT_EMAIL_TO || "symbioaiiii@gmail.com");
  if (!apiKey || !to.length) {
    return { configured: false, ok: false, detail: "Resend email is not configured." };
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `New free scan: ${payload.business || payload.name || "Symbio lead"}`,
      text: scanText(payload),
    }),
  });
  const data = await response.json().catch(() => null);
  return { configured: true, ok: response.ok, status: response.status, detail: data };
}

async function sendSms(payload) {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM_NUMBER || "";
  const to = parseRecipients(process.env.SMS_TO || "");
  if (!sid || !token || !from || !to.length) {
    return { configured: false, ok: false, detail: "Twilio SMS is not configured." };
  }

  const body = [
    "New Symbio free scan",
    payload.business || payload.name || "Unknown lead",
    payload.phone ? `Phone: ${payload.phone}` : "",
    payload.email ? `Email: ${payload.email}` : "",
    payload.link ? `Link: ${payload.link}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const results = [];
  for (const recipient of to) {
    const form = new URLSearchParams({ To: recipient, From: from, Body: body });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }
    );
    results.push({ to: recipient, ok: response.ok, status: response.status });
  }

  return { configured: true, ok: results.some((item) => item.ok), results };
}

async function sendNotifications(payload) {
  const events = [];
  try {
    events.push({ channel: "email", ...(await sendEmail(payload)) });
  } catch (error) {
    events.push({ channel: "email", configured: true, ok: false, error: error.message });
  }
  try {
    events.push({ channel: "sms", ...(await sendSms(payload)) });
  } catch (error) {
    events.push({ channel: "sms", configured: true, ok: false, error: error.message });
  }
  return events;
}

module.exports = {
  setCors,
  normalizePayload,
  upsertFreeScan,
  listFreeScans,
  verifySyncToken,
  sendNotifications,
};
