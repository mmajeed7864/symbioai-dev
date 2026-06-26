const DEFAULT_OLYMPUS_ENDPOINT =
  "https://reserved-participating-hospital-solution.trycloudflare.com/api/free-scan";

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

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function parseRecipients(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePayload(body) {
  const clean = {};
  for (const key of [
    "name",
    "business",
    "email",
    "phone",
    "link",
    "need",
    "budget",
    "goal",
    "problem",
    "sourceUrl",
  ]) {
    clean[key] = String(body?.[key] || "").trim();
  }
  clean.created = new Date().toISOString();
  return clean;
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

async function postJson(url, payload, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY || "";
  const from = process.env.ALERT_EMAIL_FROM || "Symbio AI <alerts@symbioai.dev>";
  const to = parseRecipients(process.env.ALERT_EMAIL_TO || "symbioaiiii@gmail.com");
  if (!apiKey || !to.length) {
    return { configured: false, ok: false, detail: "Resend email is not configured." };
  }

  const subject = `New free scan: ${payload.business || payload.name || "Symbio lead"}`;
  const text = scanText(payload);
  const res = await postJson(
    "https://api.resend.com/emails",
    {
      from,
      to,
      subject,
      text,
    },
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 10000,
    }
  );
  return { configured: true, ok: res.ok, status: res.status, detail: res.data || null };
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: form.toString(),
          signal: controller.signal,
        }
      );
      results.push({ to: recipient, ok: res.ok, status: res.status });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    configured: true,
    ok: results.some((result) => result.ok),
    results,
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  const payload = normalizePayload(req.body || {});
  if (!payload.name || !payload.email) {
    res.status(400).json({ ok: false, error: "Name and email are required." });
    return;
  }

  const olympusEndpoint = process.env.FREE_SCAN_OLYMPUS_ENDPOINT || DEFAULT_OLYMPUS_ENDPOINT;
  const events = [];

  let olympus = { ok: false, configured: Boolean(olympusEndpoint) };
  if (olympusEndpoint) {
    try {
      olympus = await postJson(olympusEndpoint, payload, { timeoutMs: 10000 });
    } catch (error) {
      olympus = { ok: false, error: error.message || "Olympus forward failed." };
    }
    events.push({ channel: "olympus", ...olympus });
  }

  let email = { configured: false, ok: false };
  try {
    email = await sendEmail(payload);
  } catch (error) {
    email = { configured: true, ok: false, error: error.message || "Email failed." };
  }
  events.push({ channel: "email", ...email });

  let sms = { configured: false, ok: false };
  try {
    sms = await sendSms(payload);
  } catch (error) {
    sms = { configured: true, ok: false, error: error.message || "SMS failed." };
  }
  events.push({ channel: "sms", ...sms });

  const captured = olympus.ok || email.ok || sms.ok;
  res.status(captured ? 200 : 502).json({
    ok: captured,
    message: captured
      ? "Free scan captured."
      : "Free scan could not be captured by any configured route.",
    events,
  });
};
