import assert from "node:assert/strict";
import test from "node:test";

import {
  FITCOACH_SPEECH_VERSION,
  buildElevenLabsRequest,
  parseSpeechRequest,
  resolveVoiceProfile,
} from "../api/_fitcoach-speech-v2.js";

function rawRequest(overrides = {}) {
  return {
    text: "You kept the session honest. Set two is next when you are ready.",
    session_id: "fitcoach_voice_session_123",
    data_classification: "synthetic_low_sensitivity",
    tone: "supportive",
    voice_gender: "female",
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
  assert.equal(parseSpeechRequest(rawRequest({ tone: "cruel" })).error, "INVALID_REQUEST_CONFIGURATION");
  assert.equal(parseSpeechRequest(rawRequest({ text: "x".repeat(1_201) })).error, "INVALID_REQUEST_CONFIGURATION");
});

test("female and male profiles have reviewed tone-specific delivery settings", () => {
  const supportive = resolveVoiceProfile(parsedRequest(), {
    FITCOACH_ELEVENLABS_FEMALE_VOICE_ID: "femaleBaseVoice12345",
  });
  const strict = resolveVoiceProfile(parsedRequest({ tone: "strict" }), {
    FITCOACH_ELEVENLABS_FEMALE_VOICE_ID: "femaleBaseVoice12345",
    FITCOACH_ELEVENLABS_FEMALE_STRICT_VOICE_ID: "femaleStrictVoice12",
  });
  const competitiveMale = resolveVoiceProfile(parsedRequest({ tone: "competitive", voice_gender: "male" }), {
    FITCOACH_ELEVENLABS_MALE_VOICE_ID: "maleBaseVoice123456",
  });

  assert.equal(supportive.voiceId, "femaleBaseVoice12345");
  assert.equal(supportive.profile, "nova-supportive");
  assert.equal(strict.voiceId, "femaleStrictVoice12");
  assert.equal(strict.profile, "nova-strict");
  assert.equal(competitiveMale.voiceId, "maleBaseVoice123456");
  assert.equal(competitiveMale.profile, "atlas-competitive");
  assert.ok(supportive.voiceSettings.speed < strict.voiceSettings.speed);
  assert.ok(competitiveMale.voiceSettings.style > strict.voiceSettings.style);
  assert.equal(supportive.modelId, "eleven_flash_v2_5");
});

test("ElevenLabs request streams MP3 and contains no microphone audio field", () => {
  const request = parsedRequest({ tone: "direct", voice_gender: "male" });
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

