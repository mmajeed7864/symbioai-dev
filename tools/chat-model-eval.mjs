import { readFile } from "node:fs/promises";

import { DEFAULT_CHAT_MODEL, buildOpenRouterBody } from "../api/_chat-shared.js";

const fixtureUrl = new URL("../tests/fixtures/chat-model-eval.json", import.meta.url);
const cases = JSON.parse(await readFile(fixtureUrl, "utf8"));
const apiKey = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
const model = process.env.OPENROUTER_CHAT_MODEL || DEFAULT_CHAT_MODEL;

if (!apiKey) {
  throw new Error("Set OPENROUTER_CHAT_API_KEY or OPENROUTER_API_KEY before running this eval.");
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
  const forbiddenPass = item.forbidden.every((term) => !normalized.includes(term.toLowerCase()));
  const passed = response.ok && answer && requiredPass && forbiddenPass;
  const cost = Number(payload?.usage?.cost) || 0;
  totalCost += cost;
  if (passed) passedCount += 1;

  console.log(
    JSON.stringify({
      id: item.id,
      model,
      passed,
      latencyMs: Date.now() - startedAt,
      costUsd: cost,
      promptTokens: payload?.usage?.prompt_tokens || null,
      completionTokens: payload?.usage?.completion_tokens || null,
      answer,
    })
  );
}

console.log(
  JSON.stringify({
    model,
    cases: cases.length,
    passed: passedCount,
    totalCostUsd: Number(totalCost.toFixed(8)),
  })
);

if (passedCount !== cases.length) process.exitCode = 1;
