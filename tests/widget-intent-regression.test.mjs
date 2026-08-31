import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const widgetSource = await readFile(
  new URL("../src/assets/js/symbio-widget.js", import.meta.url),
  "utf8"
);

function loadWidgetTestApi() {
  const currentScript = {
    hasAttribute: () => false,
    getAttribute: () => null,
  };
  const window = {
    __SYMBIO_WIDGET_TEST__: true,
    SymbioConfig: {
      businessName: "Symbio AI",
      services: ["Websites", "Apps", "Chatbots", "Voice agents"],
      appMessage: "Generic app guidance.",
      voiceMessage: "Generic voice guidance.",
      chatbotMessage: "Generic chatbot guidance.",
      leadGenerationMessage: "Generic lead guidance.",
      aiEndpoint: "/api/chat",
      aiSessionLimit: 20,
    },
    location: { href: "https://symbioai.dev/" },
    addEventListener: () => {},
  };
  const document = {
    currentScript,
    readyState: "loading",
    addEventListener: () => {},
    querySelectorAll: () => [],
  };

  vm.runInNewContext(widgetSource, {
    window,
    document,
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
  });

  return window.SymbioWidget;
}

function loadIntentClassifier() {
  return loadWidgetTestApi().__intentReplyForTests;
}

test("chat session identifiers use browser cryptography with no insecure fallback", () => {
  assert.equal(widgetSource.includes("Math.random"), false);
  assert.match(widgetSource, /cryptoApi\.randomUUID/u);
  assert.match(widgetSource, /cryptoApi\.getRandomValues/u);
});

test("configured AI endpoint handles every normal business question", () => {
  const widget = loadWidgetTestApi();

  assert.equal(widget.__shouldUseAiForTests(), true);
});

test("new car-wash app request overrides stale real-estate context", () => {
  const classify = loadIntentClassifier();
  const result = classify(
    "i want an app for my car wash company",
    "i run a real estate company|||yes i have a lot of calls coming in"
  );

  assert.match(result.text, /car-wash app/i);
  assert.doesNotMatch(result.text, /real-estate app/i);
  assert.equal(result.highConfidence, true);
});

test("latest recognized industry wins on a contextual follow-up", () => {
  const classify = loadIntentClassifier();
  const result = classify(
    "what would that app do",
    "i run a real estate company|||i want an app for my car wash company"
  );

  assert.match(result.text, /car-wash app/i);
  assert.doesNotMatch(result.text, /real-estate app/i);
});

test("unknown newly declared business uses AI fallback instead of stale industry copy", () => {
  const classify = loadIntentClassifier();
  const result = classify(
    "i want an app for my pet grooming business",
    "i run a real estate company"
  );

  assert.equal(result.fallback, true);
  assert.equal(result.text, "Generic app guidance.");
  assert.doesNotMatch(result.text, /real-estate/i);
});

test("bare product follow-up still inherits the latest known industry", () => {
  const classify = loadIntentClassifier();
  const result = classify("what would that app do", "i run a real estate company");

  assert.match(result.text, /real-estate app/i);
  assert.equal(result.highConfidence, true);
});

test("explicit correction hard-clears an unrecognized stale industry", () => {
  const classify = loadIntentClassifier();
  const result = classify("no i said laundromat app", "i run a real estate company");

  assert.equal(result.fallback, true);
  assert.equal(result.text, "Generic app guidance.");
  assert.doesNotMatch(result.text, /real-estate/i);
});

test("generic recognized-industry question does not inherit a conflicting industry", () => {
  const classify = loadIntentClassifier();
  const result = classify("do you build apps for car washes", "i run a real estate company");

  assert.match(result.text, /car-wash app/i);
  assert.doesNotMatch(result.text, /real-estate/i);
});
