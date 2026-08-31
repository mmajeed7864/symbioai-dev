import test from "node:test";
import assert from "node:assert/strict";

import {
  lookupBarcodeNutrition,
  mapOpenFoodFactsProduct,
  mapUsdaFood,
  parseNutritionRequest,
  searchOpenFoodFactsFoods,
  searchNutritionFoods,
  searchUsdaNutritionFoods,
  unavailableVisionNutritionEstimate,
} from "../api/_fitcoach-nutrition-v1.js";

const SESSION = "fitcoach-mo-nutrition-v040";

const product = {
  code: "0123456789012",
  product_name: "Greek Yogurt",
  brands: "Example Dairy",
  serving_size: "170 g",
  quantity: "680 g",
  nutrition_data_per: "serving",
  nutriments: {
    "energy-kcal_serving": 150,
    proteins_serving: 17,
    carbohydrates_serving: 9,
    fat_serving: 4,
    fiber_serving: 0,
    sugars_serving: 7,
    sodium_serving: 0.08,
  },
};

test("parseNutritionRequest accepts only a bounded synthetic barcode envelope", () => {
  const parsed = parseNutritionRequest({
    action: "barcode_lookup",
    data_classification: "synthetic_low_sensitivity",
    session_id: SESSION,
    barcode: "0123 456789012",
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.request.barcode, "0123456789012");

  assert.equal(parseNutritionRequest({ action: "barcode_lookup", data_classification: "real_user", session_id: SESSION, barcode: "0123456789012" }).error, "UNSUPPORTED_DATA_CLASSIFICATION");
  assert.equal(parseNutritionRequest({ action: "barcode_lookup", data_classification: "synthetic_low_sensitivity", session_id: SESSION, barcode: "0123456789012", profile_name: "Mohammed" }).error, "INVALID_BARCODE_ENVELOPE");
  assert.equal(parseNutritionRequest({ action: "barcode_lookup", data_classification: "synthetic_low_sensitivity", session_id: SESSION, barcode: "abc" }).error, "INVALID_BARCODE");
});

test("parseNutritionRequest rejects raw image payloads and accepts metadata-only vision requests", () => {
  assert.equal(parseNutritionRequest({
    action: "vision_estimate",
    data_classification: "synthetic_low_sensitivity",
    session_id: SESSION,
    image: { name: "meal.jpg", mime: "image/jpeg", size: 2000, dataUrl: "data:image/jpeg;base64,AAAA" },
  }).error, "RAW_IMAGE_PAYLOAD_REJECTED");

  const parsed = parseNutritionRequest({
    action: "vision_estimate",
    data_classification: "synthetic_low_sensitivity",
    session_id: SESSION,
    image: { name: "meal.jpg", mime: "image/jpeg", size: 2000 },
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(unavailableVisionNutritionEstimate().error, "VISION_PROVIDER_NOT_CONFIGURED");
});

test("mapOpenFoodFactsProduct converts verified label fields into FitCoach nutrition shape", () => {
  const mapped = mapOpenFoodFactsProduct(product);
  assert.equal(mapped.name, "Greek Yogurt");
  assert.equal(mapped.brand, "Example Dairy");
  assert.equal(mapped.servingLabel, "170 g");
  assert.equal(mapped.confidence, "high");
  assert.deepEqual(mapped.per, {
    calories: 150,
    protein: 17,
    carbs: 9,
    fat: 4,
    fiber: 0,
    sugar: 7,
    sodium: 80,
  });
});

test("barcode lookup uses Open Food Facts v2 product endpoint and no private fields", async () => {
  let calledUrl = "";
  const result = await lookupBarcodeNutrition("0123456789012", {
    fetchImpl: async (url, options) => {
      calledUrl = String(url);
      assert.match(options.headers["User-Agent"], /FitCoach/);
      return { ok: true, json: async () => ({ status: 1, product }) };
    },
  });
  assert.equal(result.ok, true);
  assert.match(calledUrl, /\/api\/v2\/product\/0123456789012\?/);
  assert.match(calledUrl, /fields=/);
  assert.doesNotMatch(calledUrl, /profile|medical|condition/i);
});

test("text search uses Open Food Facts search endpoint and returns bounded candidates", async () => {
  let calledUrl = "";
  const result = await searchNutritionFoods("greek yogurt", {
    env: {},
    fetchImpl: async url => {
      calledUrl = String(url);
      return { ok: true, json: async () => ({ products: [product, { ...product, code: "2", product_name: "Second" }] }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "open_food_facts");
  assert.equal(result.foods.length, 2);
  assert.match(calledUrl, /\/cgi\/search\.pl\?/);
  assert.match(calledUrl, /search_terms=greek\+yogurt/);
  assert.match(calledUrl, /page_size=5/);
});

const usdaFood = {
  fdcId: 123456,
  description: "Greek yogurt, plain",
  dataType: "Foundation",
  foodNutrients: [
    { nutrientId: 1008, value: 97 },
    { nutrientId: 1003, value: 9 },
    { nutrientId: 1005, value: 3.9 },
    { nutrientId: 1004, value: 5 },
    { nutrientId: 1079, value: 0 },
    { nutrientId: 2000, value: 3.2 },
    { nutrientId: 1093, value: 35 },
  ],
};

test("USDA mapping keeps per-100g basis, source, and public-domain provenance explicit", () => {
  const mapped = mapUsdaFood(usdaFood);
  assert.equal(mapped.fdcId, 123456);
  assert.equal(mapped.dataBasis, "100g");
  assert.equal(mapped.servingLabel, "100 g");
  assert.equal(mapped.source, "usda_fooddata_central");
  assert.equal(mapped.confidence, "high");
  assert.match(mapped.licenseNote, /USDA FoodData Central \(CC0\)/);
  assert.deepEqual(mapped.per, {
    calories: 97,
    protein: 9,
    carbs: 3.9,
    fat: 5,
    fiber: 0,
    sugar: 3.2,
    sodium: 35,
  });
});

test("USDA search is primary only when its server-side key is configured", async () => {
  let calledUrl = "";
  let calledOptions;
  const result = await searchUsdaNutritionFoods("greek yogurt", {
    apiKey: "server-only-test-key",
    fetchImpl: async (url, options) => {
      calledUrl = String(url);
      calledOptions = options;
      return { ok: true, json: async () => ({ foods: [usdaFood] }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "usda_fooddata_central");
  assert.match(calledUrl, /^https:\/\/api\.nal\.usda\.gov\/fdc\/v1\/foods\/search\?/);
  assert.match(calledUrl, /api_key=server-only-test-key/);
  assert.equal(calledOptions.method, "POST");
  assert.deepEqual(JSON.parse(calledOptions.body).dataType, ["Foundation", "Survey (FNDDS)", "SR Legacy", "Branded"]);
});

test("verified search falls back honestly to Open Food Facts when USDA is unavailable", async () => {
  const calls = [];
  const result = await searchNutritionFoods("greek yogurt", {
    env: { FDC_API_KEY: "server-only-test-key" },
    fetchImpl: async url => {
      calls.push(String(url));
      if (String(url).includes("api.nal.usda.gov")) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => ({ products: [product] }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "open_food_facts");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.fallbackReason, "NUTRITION_PROVIDER_UNAVAILABLE");
  assert.equal(calls.length, 2);
});

test("verified search reports provider failure only after every configured path fails", async () => {
  const result = await searchNutritionFoods("greek yogurt", {
    env: { FDC_API_KEY: "server-only-test-key" },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.deepEqual(result.providersAttempted, ["usda_fooddata_central", "open_food_facts"]);
  assert.equal(result.error, "NUTRITION_PROVIDER_UNAVAILABLE");
});

test("Open Food Facts helper remains the barcode-adjacent fallback without a USDA key", async () => {
  const result = await searchOpenFoodFactsFoods("greek yogurt", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ products: [product] }) }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "open_food_facts");
});
