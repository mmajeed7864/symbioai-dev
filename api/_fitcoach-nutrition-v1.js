export const FITCOACH_NUTRITION_VERSION = "2026-08-21.1";
export const OPEN_FOOD_FACTS_BASE = "https://world.openfoodfacts.org";

const DATA_CLASSIFICATION = "synthetic_low_sensitivity";
const ACTIONS = Object.freeze(["barcode_lookup", "text_search", "vision_estimate"]);
const SESSION_ID_RE = /^fitcoach-[a-z0-9._:-]{3,96}$/i;
const BARCODE_RE = /^[0-9]{6,18}$/;
const QUERY_RE = /^[\p{L}\p{N}\p{Zs}.,'’&()+/-]{2,80}$/u;
const RAW_IMAGE_RE = /data:image\/|;base64,|blob:|bytes|base64|image_bytes|imageBytes|dataUrl|data_url/i;
const USER_AGENT = "FitCoach/0.4.3 founder-nutrition-contact=support@symbioai.dev";
const PRODUCT_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "generic_name",
  "brands",
  "quantity",
  "serving_size",
  "nutrition_data_per",
  "nutriments",
].join(",");

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value, max = 160) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const round1 = value => Math.round(value * 10) / 10;
const round0 = value => Math.round(value);
const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function exactKeys(record, expected) {
  const keys = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function rejectRawImagePayload(value) {
  try {
    return RAW_IMAGE_RE.test(JSON.stringify(value));
  } catch {
    return true;
  }
}

export function safeNutritionSessionId(value) {
  const candidate = clean(value, 120);
  return SESSION_ID_RE.test(candidate) ? candidate : "fitcoach-nutrition-anonymous";
}

export function parseNutritionRequest(input) {
  if (!isRecord(input)) return { ok: false, status: 400, error: "INVALID_JSON" };
  if (rejectRawImagePayload(input)) return { ok: false, status: 400, error: "RAW_IMAGE_PAYLOAD_REJECTED" };
  if (input.data_classification !== DATA_CLASSIFICATION) {
    return { ok: false, status: 400, error: "UNSUPPORTED_DATA_CLASSIFICATION" };
  }
  if (!ACTIONS.includes(input.action)) return { ok: false, status: 400, error: "INVALID_ACTION" };
  const sessionId = clean(input.session_id, 120);
  if (!SESSION_ID_RE.test(sessionId)) return { ok: false, status: 400, error: "INVALID_SESSION_ID" };

  if (input.action === "barcode_lookup") {
    if (!exactKeys(input, ["action", "data_classification", "session_id", "barcode"])) {
      return { ok: false, status: 400, error: "INVALID_BARCODE_ENVELOPE" };
    }
    const barcode = clean(input.barcode, 24).replace(/\D/g, "");
    if (!BARCODE_RE.test(barcode)) return { ok: false, status: 400, error: "INVALID_BARCODE" };
    return { ok: true, request: { action: input.action, sessionId, barcode } };
  }

  if (input.action === "text_search") {
    if (!exactKeys(input, ["action", "data_classification", "session_id", "query"])) {
      return { ok: false, status: 400, error: "INVALID_SEARCH_ENVELOPE" };
    }
    const query = clean(input.query, 80);
    if (!QUERY_RE.test(query)) return { ok: false, status: 400, error: "INVALID_QUERY" };
    return { ok: true, request: { action: input.action, sessionId, query } };
  }

  if (!exactKeys(input, ["action", "data_classification", "session_id", "image"])) {
    return { ok: false, status: 400, error: "INVALID_VISION_ENVELOPE" };
  }
  if (!isRecord(input.image) || !exactKeys(input.image, ["mime", "name", "size"])) {
    return { ok: false, status: 400, error: "INVALID_IMAGE_METADATA" };
  }
  const mime = clean(input.image.mime, 80).toLowerCase();
  const size = finite(input.image.size);
  if (!["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"].includes(mime) || !Number.isFinite(size) || size < 1 || size > 12_000_000) {
    return { ok: false, status: 400, error: "INVALID_IMAGE_METADATA" };
  }
  return {
    ok: true,
    request: {
      action: input.action,
      sessionId,
      image: { name: clean(input.image.name, 80), mime, size },
    },
  };
}

function firstNumber(object, keys) {
  for (const key of keys) {
    const value = finite(object?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function servingBasis(product) {
  const nutriments = isRecord(product?.nutriments) ? product.nutriments : {};
  const servingCalories = firstNumber(nutriments, ["energy-kcal_serving", "energy_kcal_serving"]);
  if (servingCalories !== null) return "serving";
  return "100g";
}

export function mapOpenFoodFactsProduct(product) {
  if (!isRecord(product)) return null;
  const nutriments = isRecord(product.nutriments) ? product.nutriments : {};
  const name = clean(product.product_name_en, 120) || clean(product.product_name, 120) || clean(product.generic_name, 120);
  if (!name) return null;

  const basis = servingBasis(product);
  const suffixes = basis === "serving" ? ["_serving", "_100g"] : ["_100g"];
  const nutrient = (...names) => firstNumber(nutriments, names.flatMap(namePart => suffixes.map(suffix => `${namePart}${suffix}`)));
  const calories = nutrient("energy-kcal", "energy_kcal");
  const protein = nutrient("proteins", "protein");
  const carbs = nutrient("carbohydrates", "carbohydrate");
  const fat = nutrient("fat");
  if ([calories, protein, carbs, fat].some(value => value === null)) return null;

  const sodiumG = nutrient("sodium");
  const sodiumMg = nutrient("sodium_mg", "sodium-mg");
  const confidence = basis === "serving" && clean(product.serving_size, 80) ? "high" : "medium";
  return {
    name,
    brand: clean(product.brands, 80),
    barcode: clean(product.code, 24),
    servingLabel: clean(product.serving_size, 80) || clean(product.quantity, 80) || (basis === "100g" ? "100 g" : "1 serving"),
    dataBasis: basis,
    confidence,
    source: "open_food_facts",
    licenseNote: "Open Food Facts product data; verify label before relying on it.",
    per: {
      calories: round0(calories),
      protein: round1(protein),
      carbs: round1(carbs),
      fat: round1(fat),
      fiber: round1(nutrient("fiber", "fibers") ?? 0),
      sugar: round1(nutrient("sugars", "sugar") ?? 0),
      sodium: round0(sodiumMg ?? ((sodiumG ?? 0) * 1000)),
    },
  };
}

function productUrl(barcode) {
  const url = new URL(`/api/v2/product/${encodeURIComponent(barcode)}`, OPEN_FOOD_FACTS_BASE);
  url.searchParams.set("fields", PRODUCT_FIELDS);
  return url;
}

function searchUrl(query) {
  const url = new URL("/cgi/search.pl", OPEN_FOOD_FACTS_BASE);
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "5");
  url.searchParams.set("fields", PRODUCT_FIELDS);
  return url;
}

export async function lookupBarcodeNutrition(barcode, { fetchImpl = fetch, timeoutMs = 6_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetchImpl(productUrl(barcode), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: "NUTRITION_PROVIDER_UNAVAILABLE" };
    const body = await response.json();
    if (body?.status !== 1 || !body?.product) return { ok: false, error: "FOOD_NOT_FOUND" };
    const food = mapOpenFoodFactsProduct(body.product);
    if (!food) return { ok: false, error: "NUTRITION_DATA_INCOMPLETE" };
    return { ok: true, food };
  } catch {
    return { ok: false, error: "NUTRITION_PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchNutritionFoods(query, { fetchImpl = fetch, timeoutMs = 6_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetchImpl(searchUrl(query), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: "NUTRITION_PROVIDER_UNAVAILABLE" };
    const body = await response.json();
    const foods = (Array.isArray(body?.products) ? body.products : [])
      .map(mapOpenFoodFactsProduct)
      .filter(Boolean)
      .slice(0, 5);
    if (!foods.length) return { ok: false, error: "FOOD_NOT_FOUND" };
    return { ok: true, foods };
  } catch {
    return { ok: false, error: "NUTRITION_PROVIDER_UNAVAILABLE" };
  } finally {
    clearTimeout(timer);
  }
}

export function unavailableVisionNutritionEstimate() {
  return {
    ok: false,
    error: "VISION_PROVIDER_NOT_CONFIGURED",
    detail: "FitCoach does not upload meal photos until a reviewed vision provider, retention policy, and nutrition validation flow are configured.",
  };
}
