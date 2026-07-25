import assert from "node:assert/strict";
import test from "node:test";

import {
  hasValidLeadContact,
  isValidEmail,
  isValidPhone,
  normalizePayload,
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
