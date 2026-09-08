import assert from "node:assert/strict";
import test from "node:test";
import { startFitCoachCorsFixture } from "./integration/fitcoach-cors-http.mjs";

test("real HTTP preflight and actual responses agree for both native origins", async (t) => {
  const fixture = await startFitCoachCorsFixture();
  t.after(() => fixture.close());
  for (const origin of ["capacitor://localhost", "https://localhost"]) {
    for (const [route, method, status] of [
      ["fitcoach-platform-config-v1", "GET", 200],
      ["fitcoach-chat-v3", "POST", 400],
      ["fitcoach-speech-v2", "POST", 400],
    ]) {
      const url = `${fixture.baseUrl}/api/${route}`;
      const preflight = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "content-type,x-fitcoach-build",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
      assert.ok(preflight.headers.get("access-control-allow-methods").includes(method));
      const actual = await fetch(url, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-FitCoach-Build": "0.7.3",
        },
        ...(method === "POST" ? { body: "{}" } : {}),
      });
      assert.equal(actual.status, status);
      assert.equal(actual.headers.get("access-control-allow-origin"), origin);
      assert.equal(actual.headers.get("access-control-allow-credentials"), null);
      const body = await actual.json();
      if (method === "GET") {
        assert.equal(body.config.auth.enabled, false);
        assert.equal(body.config.sync.available, false);
      } else assert.equal(body.ok, false);
    }
  }
  assert.equal(fixture.requests.filter((item) => item.method === "OPTIONS").length, 6);
  assert.equal(fixture.requests.filter((item) => item.method !== "OPTIONS").length, 6);
});

test("real HTTP rejects opaque/untrusted origins and consolidated routing retains CORS", async (t) => {
  const fixture = await startFitCoachCorsFixture();
  t.after(() => fixture.close());
  for (const origin of ["null", "capacitor://evil.localhost", "https://localhost.attacker.test"]) {
    for (const route of ["fitcoach-platform-config-v1", "fitcoach-chat-v3", "fitcoach-speech-v2"]) {
      const result = await fetch(`${fixture.baseUrl}/api/${route}`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
      });
      assert.equal(result.status, 403);
      assert.equal(result.headers.get("access-control-allow-origin"), null);
      assert.equal((await result.json()).error, "ORIGIN_NOT_ALLOWED");
    }
  }
  const routed = await fetch(`${fixture.baseUrl}/api/fitcoach-platform-v1?fitcoach_route=config`, {
    headers: { Origin: "capacitor://localhost", "X-FitCoach-Build": "0.7.3" },
  });
  assert.equal(routed.status, 200);
  assert.equal(routed.headers.get("access-control-allow-origin"), "capacitor://localhost");
  assert.equal((await routed.json()).config.auth.enabled, false);
});

test("diagnostic server cannot forward credentials, provider payloads or non-config platform actions", async (t) => {
  const fixture = await startFitCoachCorsFixture();
  t.after(() => fixture.close());
  for (const [route, options] of [
    [
      "fitcoach-platform-config-v1",
      { headers: { Authorization: "Bearer synthetic-fixture-only" } },
    ],
    ["fitcoach-platform-config-v1", { headers: { Cookie: "fixture=synthetic" } }],
    ["fitcoach-chat-v3", { method: "POST", body: '{"text":"hello"}' }],
    ["fitcoach-speech-v2", { method: "POST", body: "malformed" }],
    ["fitcoach-chat-v3", { method: "OPTIONS", body: "malformed" }],
    ["fitcoach-platform-v1?fitcoach_route=account", {}],
    ["fitcoach-platform-v1?fitcoach_route=sync", { method: "POST", body: "{}" }],
    ["fitcoach-chat-v3", { method: "PUT", body: "{}" }],
  ]) {
    const result = await fetch(`${fixture.baseUrl}/api/${route}`, options);
    assert.equal(result.status, 400, route);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
  }
  const tooLarge = await fetch(`${fixture.baseUrl}/api/fitcoach-chat-v3`, {
    method: "POST",
    body: "x".repeat(1001),
  });
  assert.equal(tooLarge.status, 413);
  // Rejected requests must not terminate the fixture or change its safe config.
  const healthy = await fetch(`${fixture.baseUrl}/api/fitcoach-platform-config-v1`, {
    headers: { "X-FitCoach-Build": "0.7.3" },
  });
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).config.auth.enabled, false);
});
