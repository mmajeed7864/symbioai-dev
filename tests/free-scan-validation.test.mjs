import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAllowedFreeScanOrigin,
  hasValidLeadContact,
  isValidEmail,
  isValidPhone,
  normalizePayload,
  publicNotificationSummary,
  safeTokenEqual,
} from "../api/_free-scan-shared.js";

test("accepts a valid email lead", () => {
  const payload = normalizePayload({
    name: "Audit Lead",
    email: "audit@example.com",
  });

  assert.equal(isValidEmail(payload.email), true);
  assert.equal(hasValidLeadContact(payload), true);
});

test("accepts a phone-only chatbot lead", () => {
  const payload = normalizePayload({
    name: "Phone Lead",
    phone: "(704) 555-0123",
  });

  assert.equal(isValidPhone(payload.phone), true);
  assert.equal(hasValidLeadContact(payload), true);
});

test("rejects missing and malformed contact values", () => {
  assert.equal(hasValidLeadContact(normalizePayload({ name: "No Contact" })), false);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidPhone("123"), false);
});

test("normalization bounds public input", () => {
  const payload = normalizePayload({
    name: `  ${"x".repeat(300)}  `,
    email: "AUDIT@EXAMPLE.COM",
    problem: "y".repeat(3000),
    _gotcha: "bot-filled",
  });

  assert.equal(payload.name.length, 180);
  assert.equal(payload.email, "audit@example.com");
  assert.equal(payload.problem.length, 1600);
  assert.equal(payload._gotcha, "bot-filled");
});

test("only trusted website origins may submit free scans", () => {
  assert.equal(
    hasAllowedFreeScanOrigin({ headers: { origin: "https://symbioai.dev" } }),
    true
  );
  assert.equal(
    hasAllowedFreeScanOrigin({ headers: { origin: "https://www.symbioai.dev" } }),
    true
  );
  assert.equal(
    hasAllowedFreeScanOrigin({ headers: { origin: "https://attacker.example" } }),
    false
  );
  assert.equal(hasAllowedFreeScanOrigin({ headers: {} }), false);
});

test("sync bearer comparison accepts only an exact non-empty token", () => {
  assert.equal(safeTokenEqual("same-token", "same-token"), true);
  assert.equal(safeTokenEqual("same-token", "different-token"), false);
  assert.equal(safeTokenEqual("short", "longer"), false);
  assert.equal(safeTokenEqual("", ""), false);
});

test("public notification results omit provider details and recipients", () => {
  const summary = publicNotificationSummary([
    {
      channel: "email",
      configured: true,
      ok: false,
      status: 500,
      detail: { error: "private provider error", to: "owner@example.com" },
      results: [{ to: "+15555550123" }],
    },
  ]);

  assert.deepEqual(summary, [
    {
      channel: "email",
      configured: true,
      ok: false,
      status: 500,
    },
  ]);
  assert.equal(JSON.stringify(summary).includes("private provider error"), false);
  assert.equal(JSON.stringify(summary).includes("owner@example.com"), false);
  assert.equal(JSON.stringify(summary).includes("+15555550123"), false);
});
