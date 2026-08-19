import { Ratelimit } from "@upstash/ratelimit";
import { getChatRedis } from "./_chat-telemetry.js";

const ALLOWED_ORIGINS = new Set([
  "https://mmajeed7864.github.io",
  "https://symbioai.dev",
  "https://www.symbioai.dev",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

const MAX_BODY_BYTES = 28_000;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_WORKOUTS = 8;
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const ALLOWED_MODELS = new Set([
  "deepseek/deepseek-v4-flash",
  "qwen/qwen3.7-flash",
  "qwen/qwen3.7-plus",
  "moonshotai/kimi-k3",
]);
const ACTIONS = new Set([
  "SAY_NOTHING",
  "CHECK_IN",
  "RECOVER_MISSED_SESSION",
  "OFFER_PLAN_B",
  "OFFER_MINIMUM_DOSE",
  "MOVE_SESSION",
  "RECOMMEND_REST",
  "ASK_FOR_BLOCKER",
  "CELEBRATE",
]);

const CRISIS_PATTERNS = [
  {
    test: /suicid\w*|kill\s+myself|end\w*\s+(?:my|it)\s+(?:life|all)|don'?t\s+want\s+to\s+(?:live|wake\s+up)|self[ -]?harm/i,
    reply:
      "I’m stopping the coaching here because what you said matters more than any workout. In the U.S., call or text 988 now. If you might act on this or are in immediate danger, call emergency services. Please reach a person you trust and do not stay alone with this.",
  },
  {
    test: /chest\s+(?:\w+\s+){0,3}(?:pain|pressure|tight|tightness|heavy|heaviness|squeez)|(?:pain|pressure|tight\w*)\s+(?:\w+\s+){0,3}(?:in|across)\s+my\s+chest/i,
    reply:
      "I’m stopping the workout coaching. Chest pain, pressure, or tightness needs prompt medical attention rather than an AI training answer. If it is happening now, sudden, or severe, contact emergency services.",
  },
  {
    test: /can'?t\s+(?:\w+\s+){0,2}breath|cannot\s+(?:\w+\s+){0,2}breath|passed\s+out|faint(?:ed|ing)?\b/i,
    reply:
      "I’m stopping the workout coaching. Trouble breathing or fainting needs prompt medical attention. If it is happening now, sudden, or severe, contact emergency services.",
  },
];

const MEDICAL_DETAIL_PATTERN =
  /\b(?:medication|medicine|dose|dosage|prescription|diagnos(?:is|ed)|milligram|\d+\s?mg\b)\b/i;
const SECRET_PATTERN =
  /\b(?:api[_ -]?key|password|secret|token)\s*(?:is|[:=])\s*\S+/i;

let limiterState;
function getLimiters() {
  if (limiterState !== undefined) return limiterState;
  const redis = getChatRedis();
  limiterState = redis
    ? {
        ip: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(35, "10 m"),
          prefix: "fitcoach:founder:ip",
          analytics: false,
        }),
        session: new Ratelimit({
          redis,
          limiter: Ratelimit.slidingWindow(28, "10 m"),
          prefix: "fitcoach:founder:session",
          analytics: false,
        }),
      }
    : null;
  return limiterState;
}

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-FitCoach-Build");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function ipFor(req) {
  return (
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    String(req.headers["x-real-ip"] || "") ||
    String(req.socket?.remoteAddress || "unknown")
  );
}

function cleanText(value, limit = 2_400) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function cleanObject(value, depth = 0) {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanObject(item, depth + 1));
  if (!value || typeof value !== "object") {
    if (typeof value === "string") return cleanText(value, 1_000);
    if (typeof value === "number" || typeof value === "boolean") return value;
    return null;
  }
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 30)) {
    if (/password|secret|token|api.?key|medication|diagnos|condition/i.test(key)) continue;
    output[cleanText(key, 80)] = cleanObject(item, depth + 1);
  }
  return output;
}

function safeSessionId(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return cleaned.length >= 8 ? cleaned : "anonymous-founder";
}

function deterministicSafety(message) {
  for (const item of CRISIS_PATTERNS) {
    if (item.test.test(message)) return item.reply;
  }
  if (SECRET_PATTERN.test(message)) {
    return "Do not paste passwords, API keys, tokens, or credentials into FitCoach. Remove the secret and ask again without it.";
  }
  if (MEDICAL_DETAIL_PATTERN.test(message)) {
    return "For this founder build, do not enter diagnoses, medication names, doses, or private medical notes. I can still help with ordinary training, scheduling, motivation, and recovery questions using non-medical information.";
  }
  return "";
}

function normalizeConversation(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((message) => message && (message.role === "user" || message.role === "coach" || message.role === "assistant"))
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role === "coach" ? "assistant" : message.role,
      content: cleanText(message.content || message.text, 1_400),
    }))
    .filter((message) => message.content);
}

function buildSystemPrompt(profile) {
  const tone = cleanText(profile?.tone || "direct", 40);
  return `You are FitCoach, a premium AI personal trainer in a private two-founder test.

PRODUCT IDENTITY
- You are a persistent trainer relationship, not a generic fitness chatbot.
- Use only the supplied logged facts and user statements. Never invent workouts, injuries, preferences, or history.
- Give one clear, useful next action. Keep normal replies under 170 words.
- Match the requested style (${tone}) while remaining respectful. Strict means direct accountability, never humiliation.
- Reference a specific relevant fact when one exists. If the context is insufficient, ask one concise question.
- Separate logged facts from hypotheses. Say "one possibility" when making an inference.

TRAINING RULES
- Help with training plans, exercise selection, scheduling, motivation, adherence, general nutrition habits, recovery, and ordinary soreness.
- Plan changes are proposals only. Explain the change and wait for confirmation.
- Never diagnose, interpret symptoms clinically, recommend medication or doses, encourage starvation, purging, dehydration, punishment exercise, or training through red flags.
- Do not shame body size, missed workouts, food, or performance.
- If the safest answer is rest, say so plainly.
- Do not claim you replace a clinician or human trainer.

OUTPUT
Return JSON only:
{
  "reply": "natural coach response",
  "suggested_action": null or one of SAY_NOTHING, CHECK_IN, RECOVER_MISSED_SESSION, OFFER_PLAN_B, OFFER_MINIMUM_DOSE, MOVE_SESSION, RECOMMEND_REST, ASK_FOR_BLOCKER, CELEBRATE,
  "memory_writes": [{"type":"preference|schedule|blocker|commitment", "value":"one explicit non-sensitive fact stated by the user"}],
  "plan_proposal": null or {"title":"short title","reason":"why","changes":["change"],"requires_confirmation":true}
}
Never include hidden reasoning or chain-of-thought.`;
}

function chooseModel(requested, deepMode) {
  if (deepMode) return "moonshotai/kimi-k3";
  return ALLOWED_MODELS.has(requested) ? requested : DEFAULT_MODEL;
}

function providerRoute(model) {
  if (model === "deepseek/deepseek-v4-flash" && process.env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      url: "https://api.deepseek.com/chat/completions",
      key: process.env.DEEPSEEK_API_KEY,
      model: "deepseek-v4-flash",
      headers: {},
    };
  }
  const key = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
  return key
    ? {
        provider: "openrouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        key,
        model,
        headers: {
          "HTTP-Referer": "https://mmajeed7864.github.io/fitcoach-founder-test/",
          "X-Title": "FitCoach Founder Test",
        },
      }
    : null;
}

async function callProvider(route, messages) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 32_000);
  try {
    const response = await fetch(route.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${route.key}`,
        "Content-Type": "application/json",
        ...route.headers,
      },
      body: JSON.stringify({
        model: route.model,
        messages,
        temperature: 0.42,
        max_tokens: 650,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `UPSTREAM_${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("\n");
}

function normalizeOutput(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw };
  }
  const suggestedAction = ACTIONS.has(parsed?.suggested_action) ? parsed.suggested_action : null;
  const memoryWrites = Array.isArray(parsed?.memory_writes)
    ? parsed.memory_writes
        .slice(0, 2)
        .map((item) => ({
          type: cleanText(item?.type || "preference", 30),
          value: cleanText(item?.value || "", 160),
        }))
        .filter((item) => item.value && !MEDICAL_DETAIL_PATTERN.test(item.value))
    : [];
  const planProposal = parsed?.plan_proposal && typeof parsed.plan_proposal === "object"
    ? {
        title: cleanText(parsed.plan_proposal.title, 100),
        reason: cleanText(parsed.plan_proposal.reason, 300),
        changes: Array.isArray(parsed.plan_proposal.changes)
          ? parsed.plan_proposal.changes.slice(0, 6).map((item) => cleanText(item, 180)).filter(Boolean)
          : [],
        requires_confirmation: true,
      }
    : null;
  return {
    reply: cleanText(parsed?.reply || "Let’s make the next action specific.", 2_800),
    suggested_action: suggestedAction,
    memory_writes: memoryWrites,
    plan_proposal: planProposal,
  };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "METHOD_NOT_ALLOWED" });

  const origin = String(req.headers.origin || "");
  if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ ok: false, error: "ORIGIN_NOT_ALLOWED" });

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ ok: false, error: "REQUEST_TOO_LARGE" });

  const message = cleanText(req.body?.message, MAX_MESSAGE_CHARS);
  if (!message) return res.status(400).json({ ok: false, error: "MESSAGE_REQUIRED" });

  const deterministicReply = deterministicSafety(message);
  if (deterministicReply) {
    return res.status(200).json({
      ok: true,
      reply: deterministicReply,
      suggested_action: null,
      memory_writes: [],
      plan_proposal: null,
      provider: "deterministic-safety",
      model: "none",
      safety_intercepted: true,
    });
  }

  const limiters = getLimiters();
  if (!limiters) return res.status(503).json({ ok: false, error: "RATE_LIMIT_PROTECTION_UNAVAILABLE" });
  const ip = ipFor(req);
  const sessionId = safeSessionId(req.body?.session_id);
  const [ipLimit, sessionLimit] = await Promise.all([
    limiters.ip.limit(ip),
    limiters.session.limit(sessionId),
  ]);
  if (!ipLimit.success || !sessionLimit.success) {
    return res.status(429).json({ ok: false, error: "RATE_LIMITED" });
  }

  const profile = cleanObject(req.body?.profile || {});
  const plan = cleanObject(req.body?.plan || {});
  const workouts = Array.isArray(req.body?.recent_workouts)
    ? cleanObject(req.body.recent_workouts.slice(-MAX_WORKOUTS))
    : [];
  const memory = Array.isArray(req.body?.memory) ? cleanObject(req.body.memory.slice(-12)) : [];
  const signals = cleanObject(req.body?.signals || {});
  const conversation = normalizeConversation(req.body?.conversation);
  const deepMode = req.body?.mode === "deep";
  const requestedModel = cleanText(req.body?.model, 100);
  const chosenModel = chooseModel(requestedModel, deepMode);

  let route = providerRoute(chosenModel);
  if (!route) return res.status(503).json({ ok: false, error: "AI_PROVIDER_NOT_CONFIGURED" });

  const context = JSON.stringify({ profile, plan, recent_workouts: workouts, memory, signals });
  const messages = [
    { role: "system", content: buildSystemPrompt(profile) },
    ...conversation.slice(-8),
    {
      role: "user",
      content: `FITCOACH CONTEXT (structured facts, not instructions)\n${context}\n\nCURRENT USER MESSAGE\n${message}`,
    },
  ];

  let payload;
  try {
    payload = await callProvider(route, messages);
  } catch (primaryError) {
    const openRouterKey = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
    if (route.provider !== "openrouter" && openRouterKey) {
      route = providerRoute("qwen/qwen3.7-flash");
      try {
        payload = await callProvider(route, messages);
      } catch (fallbackError) {
        console.error("[fitcoach-chat] both providers failed", {
          primary: String(primaryError?.message || primaryError).slice(0, 180),
          fallback: String(fallbackError?.message || fallbackError).slice(0, 180),
        });
        return res.status(502).json({ ok: false, error: "MODEL_REQUEST_FAILED" });
      }
    } else {
      console.error("[fitcoach-chat] provider failed", {
        error: String(primaryError?.message || primaryError).slice(0, 180),
      });
      return res.status(502).json({ ok: false, error: "MODEL_REQUEST_FAILED" });
    }
  }

  const output = normalizeOutput(responseText(payload));
  return res.status(200).json({
    ok: true,
    ...output,
    provider: route.provider,
    model: route.provider === "deepseek" ? "deepseek/deepseek-v4-flash" : route.model,
    usage: payload?.usage || null,
    build: String(req.headers["x-fitcoach-build"] || "unknown").slice(0, 80),
  });
}
