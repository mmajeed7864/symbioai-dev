/**
 * landingPages.js — the programmatic-SEO matrix builder.
 *
 * Produces ONE object per landing page across two tiers (penalty-safe, capped):
 *   Tier A: every service × niche                       → 3 × 6 = 18 pages
 *   Tier B: a CURATED list of service × niche × city      → 12 pages
 * Total: 30 flat pages at /grow-<service>-<niche>[-<city>].html.
 *
 * Each record carries everything the template needs: title, description, the
 * unique copy cell, the optional city overlay, sibling links (no orphans), and
 * a fully-built JSON-LD @graph (Organization + Service + BreadcrumbList +
 * FAQPage + WebPage). A build-time assertion guards against slug collisions.
 *
 * Flat permalinks (not nested dirs) keep every page at the site root so the
 * shared nav/footer/CTA relative links keep working everywhere — matching the
 * site's portability principle.
 */
import site from "./site.js";
import niches from "./niches.js";
import cities from "./cities.js";
import cells from "./cells.js";
import services from "./growServices.js";

// Tier B is hand-picked (never a full cartesian product) — only cells with
// genuine local intent, and only cities the founders actually serve.
const CITY_CELLS = [
  ["web-design", "dentists", "fremont"],
  ["web-design", "restaurants", "san-jose"],
  ["web-design", "law-firms", "san-francisco"],
  ["ai-automation", "dentists", "san-jose"],
  ["ai-automation", "restaurants", "oakland"],
  ["ai-automation", "fitness-studios", "sunnyvale"],
  ["booking-systems", "dentists", "hayward"],
  ["booking-systems", "fitness-studios", "santa-clara"],
  ["booking-systems", "restaurants", "berkeley"],
  ["web-design", "real-estate", "palo-alto"],
  ["ai-automation", "law-firms", "oakland"],
  ["booking-systems", "nonprofits", "berkeley"],
  ["ai-automation", "home-services", "hayward"],
  ["booking-systems", "home-services", "fremont"],
  ["web-design", "faith-communities", "fremont"],
  ["booking-systems", "faith-communities", "san-jose"],
];

// Tier-B (city) pages reuse their Tier-A parent's copy plus a local overlay, so
// until each carries genuinely city-specific proof (a local case study /
// testimonial) they are kept OUT of the index to avoid scaled-content/doorway
// risk — exactly the staged rollout the design calls for. Flip to true (or gate
// per-cell) once the city pages are enriched and Batch 1 has validated in GSC.
const INDEX_TIER_B = false;

const GEO_RADIUS_M = 40000; // ~25mi service radius for the GeoCircle
const ORG_ID = `${site.url}/#org`;
const PHONE = site.founders[0].phone ? `+1-${site.founders[0].phone}` : undefined;

const svcByKey = Object.fromEntries(services.map((s) => [s.key, s]));
const abs = (file) => `${site.url}/${file}`;

function clip(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/[\s.,;:—-]+$/, "") + "…";
}

function titleFor(svc, niche, city) {
  return `${svc.label} for ${niche.label}${city ? ` in ${city.name}` : ""}`;
}

function descFor(svc, niche, city, cell) {
  const where = city ? ` in ${city.name}` : "";
  const lead = `${svc.label} for ${niche.label.toLowerCase()}${where} — ${cell.outcomes[0]}`;
  return `${clip(lead, 150)} Start with a free scan.`;
}

// Organization node is identical on every page (referenced by @id elsewhere).
const orgNode = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: site.name,
  url: site.url,
  logo: abs("assets/img/logo-symbio-color.svg"),
  email: site.founders[0].email,
  ...(PHONE ? { telephone: PHONE } : {}),
  priceRange: "$$",
  areaServed: { "@type": "State", name: "California" },
  address: { "@type": "PostalAddress", addressRegion: "CA", addressCountry: "US" },
  // sameAs must be absolute; fall back to the homepage if links.portfolio is relative.
  sameAs: [/^https?:\/\//.test(site.links.portfolio || "") ? site.links.portfolio : site.url],
};

function buildJsonLd(combo) {
  const pageUrl = abs(combo.permalink);

  const service = {
    "@type": "Service",
    "@id": `${pageUrl}#service`,
    name: combo.title,
    serviceType: combo.serviceType,
    category: combo.schemaCategory,
    description: combo.description,
    provider: { "@id": ORG_ID },
    areaServed: combo.city
      ? {
          "@type": "GeoCircle",
          geoMidpoint: {
            "@type": "GeoCoordinates",
            latitude: combo.city.geo.lat,
            longitude: combo.city.geo.lng,
          },
          geoRadius: GEO_RADIUS_M,
        }
      : { "@type": "State", name: "California" },
  };

  // Breadcrumb: Home > Industries > Service > Niche [> City]. Current page omits `item`.
  const crumbs = [
    { name: "Home", item: `${site.url}/` },
    { name: "Industries", item: abs("grow.html") },
    { name: combo.serviceLabel, item: abs(`grow-${combo.serviceKey}.html`) },
  ];
  if (combo.city) {
    crumbs.push({ name: combo.nicheLabel, item: abs(`grow-${combo.serviceKey}-${combo.nicheKey}.html`) });
    crumbs.push({ name: combo.city.name });
  } else {
    crumbs.push({ name: combo.nicheLabel });
  }
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.item ? { item: c.item } : {}),
    })),
  };

  // FAQPage — every Q&A is visibly rendered on the page (required to be legit).
  const faqs = combo.city && combo.city.cityFaq ? [...combo.cell.faqs, combo.city.cityFaq] : combo.cell.faqs;
  const faqPage = {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const webPage = {
    "@type": "WebPage",
    "@id": pageUrl,
    url: pageUrl,
    name: combo.title,
    description: combo.description,
    inLanguage: "en-US",
    isPartOf: { "@id": ORG_ID },
    about: { "@id": `${pageUrl}#service` },
  };

  // Escape <, >, & so the serialized JSON can never break out of the
  // <script type="application/ld+json"> tag (e.g. a stray "</script>" in copy).
  // \uXXXX escapes are parser-identical, so the structured data is unchanged.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [orgNode, service, breadcrumb, faqPage, webPage] })
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function makeCombo({ tier, svc, nicheKey, cityKey }) {
  const niche = niches[nicheKey];
  const cell = cells[`${svc.key}/${nicheKey}`];
  if (!niche) throw new Error(`landingPages: unknown niche "${nicheKey}"`);
  if (!cell) throw new Error(`landingPages: missing copy cell "${svc.key}/${nicheKey}" in cells.js`);
  const city = cityKey ? cities[cityKey] : null;
  if (cityKey && !city) throw new Error(`landingPages: unknown city "${cityKey}" in cities.js`);

  const permalink = cityKey
    ? `grow-${svc.key}-${nicheKey}-${cityKey}.html`
    : `grow-${svc.key}-${nicheKey}.html`;

  const combo = {
    tier,
    serviceKey: svc.key,
    serviceLabel: svc.label,
    serviceType: svc.serviceType,
    offer: svc.offer,
    priceRange: svc.priceRange,
    nicheKey,
    nicheLabel: niche.label,
    schemaCategory: niche.schemaCategory,
    cityKey: cityKey || null,
    city, // null for Tier A
    cell,
    permalink,
    noindex: tier === "B" ? !INDEX_TIER_B : false,
  };
  combo.title = titleFor(svc, niche, city);
  combo.description = descFor(svc, niche, city, cell);
  combo.jsonLd = buildJsonLd(combo);
  return combo;
}

export default function () {
  const out = [];

  // Tier A — every service × niche
  for (const svc of services) {
    for (const nicheKey of Object.keys(niches)) {
      out.push(makeCombo({ tier: "A", svc, nicheKey }));
    }
  }

  // Tier B — curated city cells only
  for (const [svcKey, nicheKey, cityKey] of CITY_CELLS) {
    const svc = svcByKey[svcKey];
    if (!svc) throw new Error(`landingPages: unknown service "${svcKey}" in CITY_CELLS`);
    out.push(makeCombo({ tier: "B", svc, nicheKey, cityKey }));
  }

  // Sibling links (anti-orphan): up to 3 same-service pages, Tier A first.
  for (const c of out) {
    const sameSvc = out.filter((o) => o.serviceKey === c.serviceKey && o.permalink !== c.permalink);
    const ordered = [...sameSvc.filter((o) => o.tier === "A"), ...sameSvc.filter((o) => o.tier === "B")];
    c.related = ordered.slice(0, 3).map((o) => ({ title: o.title, url: o.permalink }));
  }

  // Tier-A pages link DOWN to their Tier-B city children (so city pages aren't
  // near-orphans, and users can reach the local variants from the niche page).
  for (const c of out) {
    if (c.tier !== "A") continue;
    c.cityChildren = out
      .filter((o) => o.tier === "B" && o.serviceKey === c.serviceKey && o.nicheKey === c.nicheKey)
      .map((o) => ({ title: o.city.name, url: o.permalink }));
  }

  // Build-time slug-collision assertion.
  const seen = new Set();
  for (const p of out) {
    if (seen.has(p.permalink)) throw new Error(`landingPages: slug collision "${p.permalink}"`);
    seen.add(p.permalink);
  }

  return out;
}
