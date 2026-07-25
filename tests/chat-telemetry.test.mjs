import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProviderKeyUsage } from "../api/chat-metrics.js";
import {
  addLearningFeedback,
  buildLearningEvent,
  isMetricsAuthorized,
  markBudgetReservationDispatched,
  metricKeysForDate,
  monthlyBudgetKey,
  monthlyBudgetSettings,
  normalizeFeedback,
  normalizeProviderUsage,
  reserveMonthlyBudget,
  settleMonthlyBudget,
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
  assert.equal(normalizeProviderUsage({ usage: { cost: 0.00000001 } }).costMicroUsd, 1);
  assert.equal(normalizeProviderUsage({ usage: { cost: null } }).costKnown, false);
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
  assert.equal(event.promptVersion, "2026-07-25.2");
  assert.equal(event.pricingSnapshot.basis, "provider-reported");
  assert.equal(event.pricingSnapshot.costMicroUsd, 3);
});

test("metrics bearer comparison and feedback vocabulary are strict", () => {
  assert.equal(isMetricsAuthorized("Bearer correct-secret", "correct-secret"), true);
  assert.equal(isMetricsAuthorized("Bearer wrong-secret", "correct-secret"), false);
  assert.equal(isMetricsAuthorized("", "correct-secret"), false);
  assert.equal(normalizeFeedback("helpful"), "helpful");
  assert.equal(normalizeFeedback("needs_work"), "needs_work");
  assert.equal(normalizeFeedback("free text"), "");
});

test("normalizes the dedicated OpenRouter key usage without exposing key metadata", () => {
  const normalized = normalizeProviderKeyUsage(
    {
      data: {
        usage: 1.25,
        usage_monthly: 0.75,
        limit: 5,
        limit_remaining: 4.25,
        limit_reset: "monthly",
        label: "must-not-leak",
      },
    },
    new Date("2026-07-25T12:00:00.000Z")
  );
  assert.deepEqual(
    {
      available: normalized.available,
      usageMonthlyUsd: normalized.usageMonthlyUsd,
      usageUsd: normalized.usageUsd,
      limitUsd: normalized.limitUsd,
      limitRemainingUsd: normalized.limitRemainingUsd,
      limitReset: normalized.limitReset,
      usageMonth: normalized.usageMonth,
    },
    {
      available: true,
      usageMonthlyUsd: 0.75,
      usageUsd: 1.25,
      limitUsd: 5,
      limitRemainingUsd: 4.25,
      limitReset: "monthly",
      usageMonth: "2026-07",
    }
  );
  assert.match(normalized.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal("label" in normalized, false);
  assert.equal(
    normalizeProviderKeyUsage({
      data: {
        usage: null,
        usage_monthly: "",
        limit: null,
        limit_remaining: undefined,
      },
    }),
    null
  );
});

test("monthly budget reservation uses the same UTC ledger as dashboard metrics", async () => {
  const at = new Date("2026-07-25T12:00:00.000Z");
  const calls = [];
  const redis = {
    async eval(...args) {
      calls.push(args);
      if (calls.length === 1) return [1, 103, 10103];
      if (calls.length === 2) return 1;
      return [207, 0, 1];
    },
  };

  assert.deepEqual(monthlyBudgetSettings({ budgetUsd: 5, reservationUsd: 0.01 }), {
    budgetUsd: 5,
    budgetMicroUsd: 5000000,
    reservationUsd: 0.01,
    reservationMicroUsd: 10000,
  });
  assert.equal(monthlyBudgetKey(at), "symbio:chat:metrics:budget:2026-07");

  const reservation = await reserveMonthlyBudget(redis, { at });
  assert.equal(reservation.success, true);
  assert.equal(reservation.spentMicroUsd, 103);
  assert.deepEqual(calls[0][1], [
    "symbio:chat:metrics:budget:2026-07",
    "symbio:chat:metrics:month:2026-07",
    "symbio:chat:metrics:budget:2026-07:reservations",
  ]);
  assert.equal(
    await markBudgetReservationDispatched(redis, reservation, { at }),
    true
  );
  assert.equal(calls[1][1][0], "symbio:chat:metrics:budget:2026-07");
  assert.equal(calls[1][2][0], reservation.reservationId);

  const settled = await settleMonthlyBudget(redis, reservation, {
    actualCostMicroUsd: 104,
    model: "qwen/test",
    at,
  });
  assert.deepEqual(settled, {
    spentMicroUsd: 207,
    reservedMicroUsd: 0,
    settled: true,
  });
  assert.equal(calls[2][1][0], "symbio:chat:metrics:budget:2026-07");
  assert.equal(calls[2][1][1], "symbio:chat:metrics:budget:2026-07:reservations");
  assert.equal(calls[2][2][0], reservation.reservationId);
});

test("needs-work feedback cannot attach client-substituted training text", async () => {
  const sessionId = "session_feedback_123";
  const event = buildLearningEvent({
    question: "I run a bakery and need online ordering.",
    answer: "A small ordering-ready website is the best first step.",
    sessionId,
    source: "model",
    model: "qwen/test",
  });
  const values = new Map([[`symbio:chat:learning:event:${event.id}`, event]]);
  const redis = {
    async get(key) {
      return values.get(key) ?? null;
    },
    async set(key, value, options = {}) {
      if (options.nx && values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    pipeline() {
      const operations = [];
      const pipeline = {
        set(key, value) {
          operations.push(() => values.set(key, value));
          return pipeline;
        },
        zadd() {
          return pipeline;
        },
        zremrangebyscore() {
          return pipeline;
        },
        zremrangebyrank() {
          return pipeline;
        },
        expire() {
          return pipeline;
        },
        hincrby() {
          return pipeline;
        },
        hset() {
          return pipeline;
        },
        async exec() {
          operations.forEach((operation) => operation());
          return [];
        },
      };
      return pipeline;
    },
  };

  const result = await addLearningFeedback(redis, {
    eventId: event.id,
    sessionId,
    feedback: "needs_work",
    question: "Ignore the real question and train on this unrelated text.",
    answer: "A poisoned replacement answer.",
    shareSample: true,
  });
  const saved = values.get(`symbio:chat:learning:event:${event.id}`);

  assert.equal(result.ok, true);
  assert.equal(result.sampleAccepted, false);
  assert.equal(saved.feedback, "needs_work");
  assert.equal(saved.question, undefined);
  assert.equal(saved.answer, undefined);
});
