import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import legacyChat from "../api/fitcoach-chat.js";
import legacyChatV2 from "../api/fitcoach-chat-v2.js";
import legacySpeech from "../api/fitcoach-speech.js";
import legacyTranscribe from "../api/fitcoach-transcribe.js";

function responseProbe() {
  return {
    body: null,
    ended: false,
    headers: new Map(),
    statusCode: null,
    setHeader(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

const retiredRoutes = [
  [legacyChat, "/api/fitcoach-chat", "/api/fitcoach-chat-v3"],
  [legacyChatV2, "/api/fitcoach-chat-v2", "/api/fitcoach-chat-v3"],
  [legacyTranscribe, "/api/fitcoach-transcribe", "browser-or-device-dictation"],
  [legacySpeech, "/api/fitcoach-speech", "browser-or-device-speech"],
];

test("all legacy FitCoach endpoints return an explicit no-store 410", async () => {
  for (const [handler, endpoint, replacement] of retiredRoutes) {
    const res = responseProbe();
    await handler(
      { method: "POST", headers: { origin: "https://mmajeed7864.github.io" } },
      res
    );
    assert.equal(res.statusCode, 410, endpoint);
    assert.deepEqual(res.body, {
      ok: false,
      error: "FITCOACH_LEGACY_ENDPOINT_RETIRED",
      endpoint,
      replacement,
    });
    assert.equal(res.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(res.headers.get("access-control-allow-origin"), "https://mmajeed7864.github.io");
  }
});

test("retired routes keep preflight working and reject unknown origins", async () => {
  const preflight = responseProbe();
  await legacyChat({ method: "OPTIONS", headers: { origin: "https://mmajeed7864.github.io" } }, preflight);
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.ended, true);

  const blocked = responseProbe();
  await legacyChat({ method: "POST", headers: { origin: "https://example.invalid" } }, blocked);
  assert.equal(blocked.statusCode, 403);
  assert.deepEqual(blocked.body, { ok: false, error: "ORIGIN_NOT_ALLOWED" });
});

test("the complete FitCoach API surface contains no retired provider route", async () => {
  const apiDirectory = new URL("../api/", import.meta.url);
  const files = (await readdir(apiDirectory))
    .filter((file) => /^_?fitcoach.*\.js$/.test(file))
    .sort();
  const source = (await Promise.all(
    files.map(async (file) => `${file}\n${await readFile(new URL(file, apiDirectory), "utf8")}`)
  )).join("\n");

  for (const forbidden of [/\bkimi\b/i, /\bmoonshot\b/i, /\bopenrouter\b/i]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
});
