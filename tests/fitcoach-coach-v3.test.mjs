import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCoachMessages,
  buildProviderBody,
  createProviderProjection,
  createProviderRoutes,
  deterministicTrainerReply,
  generateCoachReply,
  parseCoachRequest,
  scanTrainerText,
  validateProviderReply,
} from "../api/_fitcoach-coach-v3.js";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/fitcoach-safety.json", import.meta.url), "utf8")
);

function rawRequest(overrides = {}) {
  return {
    message: "I missed a workout. What should I do?",
    session_id: "fitcoach_test_session_123",
    data_classification: "synthetic_low_sensitivity",
    style: "direct",
    response_depth: "smart",
    context: {
      goal_code: "build_muscle",
      experience_code: "intermediate",
      days_per_week: 3,
      session_minutes: 45,
      equipment_code: "full_gym",
      blocker_code: "time",
      energy_1_to_5: 3,
      weekly_completed: 1,
      weekly_target: 3,
      days_since_last_session: 2,
      approved_action: "RECOVER_MISSED_SESSION",
      plan_code: "plan_a",
      plan_minutes: 45,
      exercise_codes: ["incline_press", "romanian_deadlift", "lat_pulldown"],
    },
    conversation: [
      { role: "user", content: "I need the plan to fit a busy week." },
      { role: "assistant", content: "We can keep the plan small and repeatable." },
    ],
    ...overrides,
  };
}

function parsedRequest(overrides = {}) {
  const parsed = parseCoachRequest(rawRequest(overrides));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.intercepted, false);
  return parsed.request;
}

function providerResponse(reply = "Here’s the move. Keep the next planned session and do not add punishment volume.") {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply }) } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

test("preserves the canonical 43-case trainer free-text safety floor", () => {
  assert.equal(fixture.cases.length, 43);
  for (const item of fixture.cases) {
    assert.equal(scanTrainerText(item.text).disposition, item.expected, item.text);
  }
});

test("fails the request envelope closed and blocks non-synthetic provider egress", () => {
  assert.deepEqual(parseCoachRequest({ ...rawRequest(), profile: { name: "must not pass" } }), {
    ok: false,
    status: 400,
    error: "INVALID_REQUEST_ENVELOPE",
  });
  assert.equal(
    parseCoachRequest(rawRequest({ data_classification: "real_user" })).error,
    "REAL_USER_PROVIDER_EGRESS_DISABLED"
  );
  assert.equal(
    parseCoachRequest(rawRequest({ context: { ...rawRequest().context, bodyweight: 180 } })).error,
    "INVALID_REQUEST_CONFIGURATION"
  );
  assert.equal(
    parseCoachRequest(rawRequest({ message: "My API key is sk-do-not-share-this" })).intercepted,
    true
  );
  assert.equal(
    parseCoachRequest(rawRequest({ message: "My medication dose is 10mg" })).disposition,
    "INTERCEPTED_PRIVATE_DATA"
  );
  for (const privateText of [
    "My name is Mohammed Majeed",
    "My address is 42 Main Street",
    "My card number is 4242 4242 4242 4242",
    "I have depression and I want workout advice",
  ]) {
    const privateResult = parseCoachRequest(rawRequest({ message: privateText }));
    assert.equal(privateResult.intercepted, true, privateText);
    assert.equal(privateResult.disposition, "INTERCEPTED_PRIVATE_DATA", privateText);
  }
});

test("uses only verified direct DeepSeek and Qwen US routes", () => {
  const routes = createProviderRoutes({
    DEEPSEEK_API_KEY: "deepseek-test",
    DASHSCOPE_API_KEY: "qwen-test",
    MOONSHOT_API_KEY: "kimi-test",
    OPENROUTER_API_KEY: "openrouter-test",
    FITCOACH_ENABLE_KIMI_FALLBACK: "1",
  });
  assert.deepEqual(
    routes.map(({ provider, model, url }) => ({ provider, model, url })),
    [
      {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        url: "https://api.deepseek.com/chat/completions",
      },
      {
        provider: "qwen-us",
        model: "qwen3.6-flash-2026-04-16",
        url: "https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions",
      },
    ]
  );
  assert.deepEqual(
    createProviderRoutes({
      MOONSHOT_API_KEY: "must-not-route",
      OPENROUTER_API_KEY: "must-not-route",
      OPENROUTER_CHAT_API_KEY: "must-not-route",
    }),
    []
  );
  assert.deepEqual(
    createProviderRoutes({ DASHSCOPE_API_KEY: "qwen-cannot-be-primary" }),
    []
  );
  assert.deepEqual(
    createProviderRoutes({ DEEPSEEK_API_KEY: "deepseek-only" }).map(({ provider }) => provider),
    ["deepseek"]
  );
});

test("provider projection is allow-listed and carries no raw profile, memory, health, or measurements", () => {
  const request = parsedRequest();
  const projection = createProviderProjection(request);
  const serialized = JSON.stringify(projection);
  assert.deepEqual(Object.keys(projection.facts), [
    "goal_code",
    "experience_code",
    "days_per_week",
    "session_minutes",
    "equipment_code",
    "blocker_code",
    "energy_1_to_5",
    "weekly_completed",
    "weekly_target",
    "days_since_last_session",
    "plan_code",
    "plan_minutes",
    "exercise_codes",
  ]);
  for (const forbidden of ["name", "condition", "medication", "bodyweight", "profileId", "memory"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(projection.approved_action, "RECOVER_MISSED_SESSION");
});

test("all response depths keep DeepSeek first and style never changes action or facts", async () => {
  for (const responseDepth of ["fast", "smart", "deep"]) {
    for (const style of ["supportive", "direct", "strict", "competitive"]) {
      const request = parsedRequest({ style, response_depth: responseDepth });
      const calls = [];
      const result = await generateCoachReply(request, {
        env: {
          DEEPSEEK_API_KEY: "deepseek-test",
          DASHSCOPE_API_KEY: "qwen-test",
        },
        fetchImpl: async (url, options) => {
          calls.push({ url, body: JSON.parse(options.body) });
          return providerResponse(`${style} renderer reply with a concrete next step and no plan mutation.`);
        },
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
      assert.equal(calls[0].body.model, "deepseek-v4-flash");
      assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
      assert.equal(result.provider, "deepseek");
      assert.equal(createProviderProjection(request).approved_action, "RECOVER_MISSED_SESSION");
    }
  }
});

test("fails over only on retryable transport, 429, or server errors", async () => {
  const request = parsedRequest();
  const calls = [];
  const retryable = await generateCoachReply(request, {
    env: { DEEPSEEK_API_KEY: "d", DASHSCOPE_API_KEY: "q" },
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return new Response("busy", { status: 503 });
      return providerResponse("Direct answer from the reviewed Qwen US fallback with one clear next move.");
    },
  });
  assert.equal(retryable.provider, "qwen-us");
  assert.equal(calls.length, 2);

  const terminalCalls = [];
  const terminal = await generateCoachReply(request, {
    env: { DEEPSEEK_API_KEY: "d", DASHSCOPE_API_KEY: "q" },
    fetchImpl: async (url) => {
      terminalCalls.push(url);
      return new Response("bad key", { status: 401 });
    },
  });
  assert.equal(terminal.provider, "deterministic-copy");
  assert.equal(terminal.fallback_used, true);
  assert.equal(terminalCalls.length, 1);
});

test("timeout reaches the next provider, while invalid or unsafe output stays local", async () => {
  const request = parsedRequest();
  let calls = 0;
  const timed = await generateCoachReply(request, {
    env: { DEEPSEEK_API_KEY: "d", DASHSCOPE_API_KEY: "q" },
    timeoutMs: 20,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      return providerResponse("The backup renderer answered cleanly after the primary timed out.");
    },
  });
  assert.equal(timed.provider, "qwen-us");
  assert.equal(calls, 2);

  for (const content of [
    JSON.stringify({ reply: "Take twice your tablets and skip all meals today." }),
    JSON.stringify({ reply: "I moved your workout and activated the new plan already." }),
    JSON.stringify({ reply: "Useful reply", suggested_action: "MOVE_SESSION" }),
  ]) {
    calls = 0;
    const result = await generateCoachReply(request, {
      env: { DEEPSEEK_API_KEY: "d", DASHSCOPE_API_KEY: "q" },
      fetchImpl: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200 }
        );
      },
    });
    assert.equal(result.provider, "deterministic-copy");
    assert.equal(calls, 1);
    assert.equal(/tablets|skip all meals|activated the new plan/u.test(result.reply), false);
  }
});

test("provider response contract rejects action, memory, plan, unsafe copy, and oversized reply", () => {
  const wrap = (value) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });
  assert.equal(validateProviderReply(wrap({ reply: "A useful trainer answer that is long enough." })).ok, true);
  assert.equal(validateProviderReply(wrap({ reply: "Useful answer", memory_writes: ["private"] })).ok, false);
  assert.equal(validateProviderReply(wrap({ reply: "Useful answer", plan_proposal: {} })).ok, false);
  assert.equal(validateProviderReply(wrap({ reply: "Visit https://phishing.example for your plan." })).ok, false);
  assert.equal(validateProviderReply(wrap({ reply: "x".repeat(1_201) })).ok, false);
});

test("provider bodies use JSON mode without tools and local personalities are visibly distinct", () => {
  const request = parsedRequest();
  for (const route of createProviderRoutes({
    DEEPSEEK_API_KEY: "d",
    DASHSCOPE_API_KEY: "q",
  })) {
    const body = buildProviderBody(route, request);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.tools, undefined);
    assert.equal(body.stream, false);
    assert.equal(JSON.stringify(body).includes("deepseek-v4-pro"), false);
  }
  const supportive = deterministicTrainerReply(parsedRequest({ style: "supportive" }));
  const strict = deterministicTrainerReply(parsedRequest({ style: "strict" }));
  const competitive = deterministicTrainerReply(parsedRequest({ style: "competitive" }));
  assert.notEqual(supportive, strict);
  assert.notEqual(strict, competitive);
  assert.equal(/loser|pathetic|punish/iu.test(`${supportive} ${strict} ${competitive}`), false);
  assert.equal(buildCoachMessages(request).at(-1).content.includes("UNTRUSTED USER MESSAGE"), true);
});
