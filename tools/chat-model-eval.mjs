import { readFile } from "node:fs/promises";

import {
  CHAT_PROMPT_VERSION,
  DEFAULT_CHAT_MODEL,
  buildOpenRouterBody,
  sensitiveTypesInText,
} from "../api/_chat-shared.js";

const fixtureUrl = new URL("../tests/fixtures/chat-model-eval.json", import.meta.url);
const allCases = JSON.parse(await readFile(fixtureUrl, "utf8"));
const requestedCase = String(process.env.CHAT_EVAL_CASE || "").trim();
const cases = requestedCase ? allCases.filter(({ id }) => id === requestedCase) : allCases;
const apiKey = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL;
const maxPromptTokens = Number(process.env.CHAT_EVAL_MAX_PROMPT_TOKENS || 2500);
const maxCompletionTokens = Number(process.env.CHAT_EVAL_MAX_COMPLETION_TOKENS || 220);
const maxTurnCostUsd = Number(process.env.CHAT_EVAL_MAX_TURN_COST_USD || 0.01);

if (!apiKey) {
  throw new Error("Set OPENROUTER_CHAT_API_KEY or OPENROUTER_API_KEY before running this eval.");
}
if (!cases.length) {
  throw new Error(`No chat model eval case matched CHAT_EVAL_CASE=${requestedCase}.`);
}

let totalCost = 0;
let passedCount = 0;

for (const item of cases) {
  const startedAt = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://symbioai.dev",
      "X-Title": "Symbio Chat Model Regression Eval",
    },
    body: JSON.stringify(buildOpenRouterBody(item.messages, model)),
  });

  const payload = await response.json().catch(() => null);
  const answer = String(payload?.choices?.[0]?.message?.content || "").trim();
  const normalized = answer.toLowerCase();
  const requiredPass = item.requiredAny.some((term) => normalized.includes(term.toLowerCase()));
  const requiredAllPass = (item.requiredAll || []).every((term) =>
    normalized.includes(term.toLowerCase())
  );
  const forbiddenPass = item.forbidden.every((term) => !normalized.includes(term.toLowerCase()));
  const promptTokens = Number(payload?.usage?.prompt_tokens);
  const completionTokens = Number(payload?.usage?.completion_tokens);
  const sourceCost = payload?.usage?.cost;
  const cost = Number(sourceCost);
  const usageKnown =
    Number.isFinite(promptTokens) &&
    Number.isFinite(completionTokens) &&
    sourceCost !== null &&
    sourceCost !== undefined &&
    sourceCost !== "" &&
    Number.isFinite(cost);
  const piiTypes = sensitiveTypesInText(answer);
  const usagePass =
    usageKnown &&
    promptTokens <= maxPromptTokens &&
    completionTokens <= maxCompletionTokens &&
    cost <= maxTurnCostUsd;
  const passed =
    response.ok &&
    answer &&
    requiredPass &&
    requiredAllPass &&
    forbiddenPass &&
    piiTypes.length === 0 &&
    usagePass;
  const billedCost = Number.isFinite(cost) ? cost : 0;
  totalCost += billedCost;
  if (passed) passedCount += 1;

  console.log(
    JSON.stringify({
      id: item.id,
      model,
      promptVersion: CHAT_PROMPT_VERSION,
      passed,
      latencyMs: Date.now() - startedAt,
      costUsd: Number.isFinite(cost) ? cost : null,
      promptTokens: Number.isFinite(promptTokens) ? promptTokens : null,
      completionTokens: Number.isFinite(completionTokens) ? completionTokens : null,
      piiTypes,
      usagePass,
      answer,
    })
  );
}

console.log(
  JSON.stringify({
    model,
    promptVersion: CHAT_PROMPT_VERSION,
    cases: cases.length,
    passed: passedCount,
    totalCostUsd: Number(totalCost.toFixed(8)),
  })
);

if (passedCount !== cases.length) process.exitCode = 1;
