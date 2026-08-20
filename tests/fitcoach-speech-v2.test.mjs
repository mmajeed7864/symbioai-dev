import assert from "node:assert/strict";
import test from "node:test";

import {
  FITCOACH_SPEECH_VERSION,
  buildElevenLabsRequest,
  parseSpeechRequest,
  reserveSpeechCharBudget,
  resolveVoiceProfile,
  speechCharBudgetKey,
  speechCharBudgetLimit,
} from "../api/_fitcoach-speech-v2.js";

function rawRequest(overrides = {}) {
  return {
    text: "You kept the session honest. Set two is next when you are ready.",
    session_id: "fitcoach_voice_session_123",
    data_classification: "synthetic_low_sensitivity",
    tone: "supportive",
    voice_gender: "female",
    voice_profile: "nova",
    ...overrides,
  };
}

function parsedRequest(overrides = {}) {
  const parsed = parseSpeechRequest(rawRequest(overrides));
  assert.equal(parsed.ok, true);
  return parsed.request;
}

test("speech v2 accepts one exact low-sensitivity text-only envelope", () => {
  const parsed = parseSpeechRequest(rawRequest());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.text, rawRequest().text);
  assert.equal(FITCOACH_SPEECH_VERSION, "2026-08-20.1");

  assert.equal(parseSpeechRequest({ ...rawRequest(), audio: "must-not-exist" }).error, "INVALID_REQUEST_ENVELOPE");
  assert.equal(parseSpeechRequest(rawRequest({ data_classification: "real_user" })).error, "REAL_USER_VOICE_EGRESS_DISABLED");
  assert.equal(parseSpeechRequest(rawRequest({ voice_gender: "unknown" })).error, "INVALID_REQUEST_CONFIGURATION");
  assert.equal(parseSpeechRequest(rawRequest({ voice_profile: "unknown" })).error, "INVALID_REQUEST_CONFIGURATION");
  assert.equal(parseSpeechRequest(rawRequest({ voice_gender: "female", voice_profile: "atlas" })).error, "INVALID_REQUEST_CONFIGURATION");
  assert.equal(parseSpeechRequest(rawRequest({ tone: "cruel" })).error, "INVALID_REQUEST_CONFIGURATION");
  assert.equal(parseSpeechRequest(rawRequest({ text: "x".repeat(1_201) })).error, "INVALID_REQUEST_CONFIGURATION");
});

test("legacy exact speech envelope remains compatible during service-worker rollout", () => {
  const legacy = rawRequest();
  delete legacy.voice_profile;
  const parsed = parseSpeechRequest(legacy);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.profile, "nova");
  assert.equal(parsed.request.gender, "female");
});

test("female and male profiles have reviewed tone-specific delivery settings", () => {
  const supportive = resolveVoiceProfile(parsedRequest(), {
    FITCOACH_ELEVENLABS_FEMALE_VOICE_ID: "femaleBaseVoice12345",
  });
  const strict = resolveVoiceProfile(parsedRequest({ tone: "strict", voice_gender: "male", voice_profile: "atlas" }), {
    FITCOACH_ELEVENLABS_FEMALE_VOICE_ID: "femaleBaseVoice12345",
    FITCOACH_ELEVENLABS_MALE_VOICE_ID: "maleBaseVoice123456",
    FITCOACH_ELEVENLABS_ATLAS_STRICT_VOICE_ID: "atlasStrictVoice123",
  });
  const directBritish = resolveVoiceProfile(parsedRequest({ tone: "direct", voice_gender: "male", voice_profile: "bennett" }), {
    FITCOACH_ELEVENLABS_MALE_VOICE_ID: "maleBaseVoice123456",
    FITCOACH_ELEVENLABS_BENNETT_VOICE_ID: "bennettBaseVoice12",
  });

  assert.equal(supportive.voiceId, "femaleBaseVoice12345");
  assert.equal(supportive.profile, "nova-supportive");
  assert.equal(strict.voiceId, "atlasStrictVoice123");
  assert.equal(strict.profile, "atlas-strict");
  assert.equal(directBritish.voiceId, "bennettBaseVoice12");
  assert.equal(directBritish.profile, "bennett-direct");
  assert.ok(supportive.voiceSettings.speed < strict.voiceSettings.speed);
  assert.ok(resolveVoiceProfile(parsedRequest({ tone: "competitive", voice_gender: "male", voice_profile: "atlas" }), {}).voiceSettings.style > strict.voiceSettings.style);
  assert.equal(supportive.modelId, "eleven_flash_v2_5");
});

test("ElevenLabs request streams MP3 and contains no microphone audio field", () => {
  const request = parsedRequest({ tone: "direct", voice_gender: "male", voice_profile: "bennett" });
  const profile = resolveVoiceProfile(request, {});
  const built = buildElevenLabsRequest(request, profile, "server-secret-key");
  const body = JSON.parse(built.options.body);

  assert.match(built.url, /^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\//u);
  assert.match(built.url, /\/stream\?output_format=mp3_44100_128$/u);
  assert.equal(built.options.headers["xi-api-key"], "server-secret-key");
  assert.deepEqual(Object.keys(body).sort(), ["apply_text_normalization", "model_id", "text", "voice_settings"]);
  assert.equal(body.text, request.text);
  assert.equal(body.model_id, "eleven_flash_v2_5");
  assert.equal("audio" in body, false);
  assert.equal("voice_id" in body, false);
});

test("speech character budget is monthly, bounded, and releases rejected overage", async () => {
  const calls = [];
  const values = new Map();
  const redis = {
    async incrby(key, amount) {
      calls.push(["incrby", key, amount]);
      const next = Number(values.get(key) || 0) + amount;
      values.set(key, next);
      return next;
    },
    async decrby(key, amount) {
      calls.push(["decrby", key, amount]);
      const next = Math.max(0, Number(values.get(key) || 0) - amount);
      values.set(key, next);
      return next;
    },
    async expire(key, ttl) {
      calls.push(["expire", key, ttl]);
      return 1;
    },
  };
  const at = new Date("2026-08-20T12:00:00Z");
  assert.equal(speechCharBudgetLimit({ monthlyCharBudget: 5 }), 10_000);
  assert.equal(speechCharBudgetLimit({ monthlyCharBudget: 2_000_000 }), 1_000_000);
  assert.equal(speechCharBudgetKey(at), "fitcoach:speech-v2:char-budget:2026-08");

  const first = await reserveSpeechCharBudget(redis, { chars: 4_000, at, monthlyCharBudget: 10_000 });
  const second = await reserveSpeechCharBudget(redis, { chars: 7_000, at, monthlyCharBudget: 10_000 });

  assert.equal(first.success, true);
  assert.equal(first.used, 4_000);
  assert.equal(second.success, false);
  assert.equal(second.used, 4_000);
  assert.equal(values.get("fitcoach:speech-v2:char-budget:2026-08"), 4_000);
  assert.deepEqual(calls.map(call => call[0]), ["incrby", "expire", "incrby", "decrby"]);
});
