import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLearningEvent,
  isMetricsAuthorized,
  metricKeysForDate,
  normalizeFeedback,
  normalizeProviderUsage,
} from "../api/_chat-telemetry.js";

test("normalizes provider-reported usage without losing a legitimate zero cost", () => {
  assert.deepEqual(
    normalizeProviderUsage({
      usage: {
        prompt_tokens: "125",
        completion_tokens: 30,
        cost: 0,
      },
    }),
    {
      promptTokens: 125,
      completionTokens: 30,
      totalTokens: 155,
      costKnown: true,
      costUsd: 0,
      costMicroUsd: 0,
    }
  );

  assert.equal(normalizeProviderUsage({ usage: { cost: "0.000094" } }).costMicroUsd, 94);
  assert.equal(normalizeProviderUsage({ usage: {} }).costKnown, false);
});

test("uses UTC day and month keys", () => {
  assert.deepEqual(metricKeysForDate(new Date("2026-08-01T00:00:00.000Z")), {
    day: "symbio:chat:metrics:day:2026-08-01",
    month: "symbio:chat:metrics:month:2026-08",
    dayLabel: "2026-08-01",
    monthLabel: "2026-08",
  });
});

test("learning metadata contains no raw conversation or contact data", () => {
  const event = buildLearningEvent({
    question:
      "My name is Jane Doe. Email jane@example.com and visit https://example.com at 123 Main Street.",
    answer: "Call 704-555-0123 and use boxingclt.com.",
    sessionId: "chat_session_12345",
    source: "model",
    model: "qwen/example",
    promptTokens: 20,
    completionTokens: 10,
    costMicroUsd: 3,
  });
  const serialized = JSON.stringify(event);

  assert.equal(event.sessionHash.length, 32);
  assert.equal(serialized.includes("chat_session_12345"), false);
  assert.equal(serialized.includes("Jane Doe"), false);
  assert.equal(serialized.includes("jane@example.com"), false);
  assert.equal(serialized.includes("704-555-0123"), false);
  assert.equal(serialized.includes("example.com"), false);
  assert.equal(event.questionBytes > 0, true);
  assert.equal(event.answerBytes > 0, true);
});

test("metrics bearer comparison and feedback vocabulary are strict", () => {
  assert.equal(isMetricsAuthorized("Bearer correct-secret", "correct-secret"), true);
  assert.equal(isMetricsAuthorized("Bearer wrong-secret", "correct-secret"), false);
  assert.equal(isMetricsAuthorized("", "correct-secret"), false);
  assert.equal(normalizeFeedback("helpful"), "helpful");
  assert.equal(normalizeFeedback("needs_work"), "needs_work");
  assert.equal(normalizeFeedback("free text"), "");
});
