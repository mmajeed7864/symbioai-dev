#!/usr/bin/env node
/**
 * new-client — spin up a deployable one-page client site from a JSON config.
 *
 *   node tools/new-client.mjs --config clients/acme.json
 *   npm run new-client -- --config tools/client-template/example.json
 *
 * Reuses the Symbio design system (styles.css) with the client's accent colour,
 * drops in the AI chat widget (configured for them), and adds a "Site by Symbio
 * AI" footer backlink (passive lead-gen). Output is a self-contained static
 * folder you can deploy anywhere — so a new client build is "fill a JSON, run a
 * command", not a from-scratch project.
 *
 * Pure Node, zero deps.
 */

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { argv, exit } from "node:process";
import path from "node:path";

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(argv.slice(2));
const CONFIG = args.config || "tools/client-template/example.json";
const OUT_BASE = args.out || "clients-out";
const TEMPLATE = "tools/client-template/index.html";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const slugify = (s) =>
  String(s || "client").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function renderServices(services) {
  return (services || [])
    .map(
      (s) =>
        `<article class="card">\n            <h3 class="card__title">${esc(s.title)}</h3>\n            <p class="card__text">${esc(s.text)}</p>\n          </article>`
    )
    .join("\n            ");
}

function renderAbout(about) {
  const paras = Array.isArray(about) ? about : about ? [about] : [];
  return paras.map((p) => `<p class="section__lead">${esc(p)}</p>`).join("\n          ");
}

function renderContact(c) {
  if (!c) return "";
  const lines = [];
  if (c.phone) lines.push(`<a href="tel:${esc(String(c.phone).replace(/[^0-9+]/g, ""))}">☎ ${esc(c.phone)}</a>`);
  if (c.email) lines.push(`<a href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>`);
  if (c.address) lines.push(`<span>${esc(c.address)}</span>`);
  if (c.hours) lines.push(`<span>${esc(c.hours)}</span>`);
  return lines.join("\n          ");
}

function renderWidget(cfg) {
  if (!cfg.widget) return "";
  const conf = {
    businessName: cfg.name || "",
    accent: cfg.accent || "#2f6bff",
    services: (cfg.services || []).map((s) => s.title),
    hours: (cfg.contact && cfg.contact.hours) || "",
    phone: (cfg.contact && cfg.contact.phone) || "",
    position: "right",
    theme: "auto",
    greeting: `Hi! 👋 Thanks for visiting ${cfg.name || "us"} — how can we help?`,
  };
  return (
    `<script>\n      window.SymbioConfig = ${JSON.stringify(conf, null, 2)};\n    </script>\n    ` +
    `<script src="assets/js/symbio-widget.js" defer></script>`
  );
}

async function main() {
  const cfg = JSON.parse(await readFile(CONFIG, "utf8"));
  if (!cfg.name) {
    console.error(`Config ${CONFIG} needs at least a "name".`);
    exit(1);
  }
  const slug = cfg.slug || slugify(cfg.name);
  const outDir = path.join(OUT_BASE, slug);
  const cta = cfg.primaryCta || { label: "Contact us", href: "#contact" };

  let html = await readFile(TEMPLATE, "utf8");
  const fills = {
    NAME: esc(cfg.name),
    TITLE: esc(cfg.title || cfg.name),
    DESCRIPTION: esc(cfg.description || ""),
    ACCENT: (cfg.accent || "#2f6bff").replace(/[^#a-zA-Z0-9(),.% ]/g, ""),
    TAGLINE: esc(cfg.tagline || ""),
    HEADLINE: esc(cfg.headline || cfg.name),
    HEROTEXT: esc(cfg.heroText || ""),
    PRIMARYCTA_LABEL: esc(cta.label),
    PRIMARYCTA_HREF: esc(cta.href),
    SERVICES: renderServices(cfg.services),
    ABOUT: renderAbout(cfg.about),
    CONTACT: renderContact(cfg.contact),
    YEAR: String(new Date().getFullYear()),
    WIDGET: renderWidget(cfg),
  };
  for (const [k, v] of Object.entries(fills)) {
    html = html.replaceAll(`{{${k}}}`, v);
  }

  await mkdir(path.join(outDir, "assets/css"), { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html, "utf8");
  await copyFile("src/assets/css/styles.css", path.join(outDir, "assets/css/styles.css"));
  if (cfg.widget) {
    await mkdir(path.join(outDir, "assets/js"), { recursive: true });
    await copyFile("src/assets/js/symbio-widget.js", path.join(outDir, "assets/js/symbio-widget.js"));
  }

  console.log(`✓ Built client site → ${outDir}/`);
  console.log(`  index.html + assets/ (styles${cfg.widget ? " + AI widget" : ""}).`);
  console.log(`\nPreview:  npx serve ${outDir}`);
  console.log(`Deploy:   drag ${outDir}/ onto Netlify, or push to any static host.`);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  exit(1);
});
