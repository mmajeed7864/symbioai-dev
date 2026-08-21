import test from "node:test";
import assert from "node:assert/strict";

import {
  lookupBarcodeNutrition,
  mapOpenFoodFactsProduct,
  parseNutritionRequest,
  searchNutritionFoods,
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
    fetchImpl: async url => {
      calledUrl = String(url);
      return { ok: true, json: async () => ({ products: [product, { ...product, code: "2", product_name: "Second" }] }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.foods.length, 2);
  assert.match(calledUrl, /\/cgi\/search\.pl\?/);
  assert.match(calledUrl, /search_terms=greek\+yogurt/);
  assert.match(calledUrl, /page_size=5/);
});
