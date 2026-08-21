export const FITCOACH_SPEECH_VERSION = "2026-08-21.1";
export const MAX_SPEECH_CHARS = 1_200;
export const DEFAULT_MONTHLY_SPEECH_CHAR_BUDGET = 75_000;
export const SPEECH_BUDGET_TTL_SECONDS = 60 * 60 * 24 * 45;
export const VOICE_TONES = Object.freeze(["supportive", "direct", "strict", "competitive", "rude"]);
export const VOICE_GENDERS = Object.freeze(["female", "male"]);
export const VOICE_PROFILES = Object.freeze(["nova", "atlas", "bennett", "mira"]);

const TONE_SET = new Set(VOICE_TONES);
const GENDER_SET = new Set(VOICE_GENDERS);
const PROFILE_SET = new Set(VOICE_PROFILES);
const REQUEST_KEYS = new Set([
  "text",
  "session_id",
  "data_classification",
  "tone",
  "voice_gender",
  "voice_profile",
]);
const LEGACY_REQUEST_KEYS = new Set([
  "text",
  "session_id",
  "data_classification",
  "tone",
  "voice_gender",
]);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu;
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/gu;
const VOICE_ID = /^[A-Za-z0-9_-]{12,64}$/u;
const MODELS = new Set(["eleven_flash_v2_5", "eleven_multilingual_v2"]);

const DEFAULT_VOICE_IDS = Object.freeze({
  female: "EXAVITQu4vr4xnSDxMaL",
  male: "pNInz6obpgDQGcFmaJgB",
});

export const DEFAULT_PROFILE_VOICE_IDS = Object.freeze({
  // Danny — Authentic Modern British Male (Modern London; warm and authoritative).
  bennett: "ZVE5GaLwU3HuFONCXSPz",
});

const PROFILE_GENDERS = Object.freeze({
  nova: "female",
  atlas: "male",
  bennett: "male",
  mira: "female",
});

const TONE_SETTINGS = Object.freeze({
  supportive: Object.freeze({
    stability: 0.56,
    similarity_boost: 0.8,
    style: 0.2,
    use_speaker_boost: true,
    speed: 0.96,
  }),
  direct: Object.freeze({
    stability: 0.68,
    similarity_boost: 0.82,
    style: 0.08,
    use_speaker_boost: true,
    speed: 1,
  }),
  strict: Object.freeze({
    stability: 0.76,
    similarity_boost: 0.84,
    style: 0.1,
    use_speaker_boost: true,
    speed: 1.02,
  }),
  competitive: Object.freeze({
    stability: 0.5,
    similarity_boost: 0.8,
    style: 0.3,
    use_speaker_boost: true,
    speed: 1.04,
  }),
  rude: Object.freeze({
    stability: 0.58,
    similarity_boost: 0.82,
    style: 0.32,
    use_speaker_boost: true,
    speed: 1.04,
  }),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, allowed) {
  return isPlainObject(value)
    && Object.keys(value).length === allowed.size
    && Object.keys(value).every((key) => allowed.has(key));
}

function normalizeCode(value) {
  return String(value || "").trim().toLowerCase();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function cleanSpeechText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(CONTROL, "")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function safeSpeechSessionId(value) {
  const normalized = String(value || "")
    .replace(/[^a-zA-Z0-9_-]/gu, "")
    .slice(0, 80);
  return normalized.length >= 8 ? normalized : "";
}

export function speechCharBudgetLimit({
  monthlyCharBudget = process.env.FITCOACH_ELEVENLABS_MONTHLY_CHAR_BUDGET,
} = {}) {
  return Math.min(
    1_000_000,
    Math.max(10_000, positiveInteger(monthlyCharBudget, DEFAULT_MONTHLY_SPEECH_CHAR_BUDGET))
  );
}

export function speechCharBudgetKey(value = new Date()) {
  return `fitcoach:speech-v2:char-budget:${value.toISOString().slice(0, 7)}`;
}

export async function reserveSpeechCharBudget(
  redis,
  {
    chars,
    at = new Date(),
    monthlyCharBudget = process.env.FITCOACH_ELEVENLABS_MONTHLY_CHAR_BUDGET,
  } = {}
) {
  const amount = positiveInteger(chars, 0);
  if (!redis || !amount) throw new Error("VOICE_BUDGET_PROTECTION_UNAVAILABLE");
  const limit = speechCharBudgetLimit({ monthlyCharBudget });
  const key = speechCharBudgetKey(at);
  const total = positiveInteger(await redis.incrby(key, amount), 0);
  if (total === amount) await redis.expire(key, SPEECH_BUDGET_TTL_SECONDS);
  if (!total) throw new Error("VOICE_BUDGET_PROTECTION_UNAVAILABLE");
  if (total > limit) {
    try { await redis.decrby(key, amount); } catch {}
    return Object.freeze({ success: false, key, limit, chars: amount, used: Math.max(0, total - amount) });
  }
  return Object.freeze({ success: true, key, limit, chars: amount, used: total });
}

export function parseSpeechRequest(value) {
  const hasNewEnvelope = hasExactKeys(value, REQUEST_KEYS);
  const hasLegacyEnvelope = hasExactKeys(value, LEGACY_REQUEST_KEYS);
  if (!hasNewEnvelope && !hasLegacyEnvelope) {
    return { ok: false, status: 400, error: "INVALID_REQUEST_ENVELOPE" };
  }
  if (value.data_classification !== "synthetic_low_sensitivity") {
    return { ok: false, status: 403, error: "REAL_USER_VOICE_EGRESS_DISABLED" };
  }
  const text = cleanSpeechText(value.text);
  const sessionId = safeSpeechSessionId(value.session_id);
  const tone = normalizeCode(value.tone);
  const gender = normalizeCode(value.voice_gender);
  const profile = hasNewEnvelope
    ? normalizeCode(value.voice_profile)
    : gender === "female" ? "nova" : "atlas";
  if (
    !text
    || text.length > MAX_SPEECH_CHARS
    || !sessionId
    || !TONE_SET.has(tone)
    || !GENDER_SET.has(gender)
    || !PROFILE_SET.has(profile)
    || PROFILE_GENDERS[profile] !== gender
  ) {
    return { ok: false, status: 400, error: "INVALID_REQUEST_CONFIGURATION" };
  }
  return {
    ok: true,
    request: Object.freeze({ text, sessionId, tone, gender, profile }),
  };
}

function configuredVoiceId(value, fallback) {
  const candidate = String(value || "").trim();
  return VOICE_ID.test(candidate) ? candidate : fallback;
}

function toneVoiceKey(gender, tone) {
  return `FITCOACH_ELEVENLABS_${gender.toUpperCase()}_${tone.toUpperCase()}_VOICE_ID`;
}

function baseVoiceKey(gender) {
  return `FITCOACH_ELEVENLABS_${gender.toUpperCase()}_VOICE_ID`;
}

function profileVoiceKey(profile, tone) {
  return `FITCOACH_ELEVENLABS_${profile.toUpperCase()}_${tone.toUpperCase()}_VOICE_ID`;
}

function baseProfileKey(profile) {
  return `FITCOACH_ELEVENLABS_${profile.toUpperCase()}_VOICE_ID`;
}

export function resolveVoiceProfile(request, env = process.env) {
  const genderFallback = configuredVoiceId(env[baseVoiceKey(request.gender)], DEFAULT_VOICE_IDS[request.gender]);
  const toneFallback = configuredVoiceId(env[toneVoiceKey(request.gender, request.tone)], genderFallback);
  const profileDefault = configuredVoiceId(DEFAULT_PROFILE_VOICE_IDS[request.profile], toneFallback);
  const profileFallback = configuredVoiceId(env[baseProfileKey(request.profile)], profileDefault);
  const voiceId = configuredVoiceId(env[profileVoiceKey(request.profile, request.tone)], profileFallback);
  const modelId = MODELS.has(String(env.FITCOACH_ELEVENLABS_MODEL || "").trim())
    ? String(env.FITCOACH_ELEVENLABS_MODEL).trim()
    : "eleven_flash_v2_5";
  return Object.freeze({
    voiceId,
    modelId,
    profile: `${request.profile}-${request.tone}`,
    voiceSettings: TONE_SETTINGS[request.tone],
  });
}

export function buildElevenLabsRequest(request, profile, apiKey) {
  return Object.freeze({
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}/stream?output_format=mp3_44100_128`,
    options: Object.freeze({
      method: "POST",
      headers: Object.freeze({
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      }),
      body: JSON.stringify({
        text: request.text,
        model_id: profile.modelId,
        voice_settings: profile.voiceSettings,
        apply_text_normalization: "auto",
      }),
    }),
  });
}
