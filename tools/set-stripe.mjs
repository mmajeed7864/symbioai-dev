#!/usr/bin/env node
/**
 * set-stripe — paste Stripe Payment Link URLs into src/_data/site.js without
 * hand-editing JS. Updates the `checkoutUrl` of any package or widget plan by
 * its `key`. Preserves the file's formatting and comments (targeted replace).
 *
 *   npm run set-stripe -- website-7-days=https://buy.stripe.com/abc123
 *   npm run set-stripe -- speed-fix=https://buy.stripe.com/a booking-system=https://buy.stripe.com/b
 *   npm run set-stripe -- widget-growth=https://buy.stripe.com/sub_xyz
 *
 * Keys (from site.js):
 *   packages    : speed-fix · website-7-days · booking-system · ai-assistant
 *   widget plans : widget-starter · widget-growth · widget-pro
 *   care plans   : care-essential · care-growth · care-pro
 *
 * Pass key= (empty) to clear a link back to the graceful fallback.
 * After running: `npm run build` and redeploy dist/.
 */

import { readFile, writeFile } from "node:fs/promises";
import { argv, exit } from "node:process";

const SITE = "src/_data/site.js";

const pairs = argv.slice(2).map((a) => {
  const i = a.indexOf("=");
  if (i < 0) return null;
  return { key: a.slice(0, i).trim(), url: a.slice(i + 1).trim() };
}).filter(Boolean);

if (!pairs.length) {
  console.error("Usage: node tools/set-stripe.mjs <key>=<https-url> [<key>=<url> ...]");
  console.error("Keys: speed-fix, website-7-days, booking-system, ai-assistant, widget-starter, widget-growth, widget-pro, care-essential, care-growth, care-pro");
  exit(1);
}

let text = await readFile(SITE, "utf8");
let changed = 0;
const problems = [];

for (const { key, url } of pairs) {
  if (url && !/^https:\/\//i.test(url)) {
    problems.push(`✗ ${key}: not an https:// URL — skipped`);
    continue;
  }
  if (url && !/stripe\.com/i.test(url)) {
    console.warn(`! ${key}: URL isn't a stripe.com link — setting it anyway.`);
  }
  // Find the object whose `key: "<key>"` is followed by a checkoutUrl, and
  // replace just that checkoutUrl's value. Non-greedy keeps it within one object.
  const re = new RegExp('(key:\\s*"' + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[\\s\\S]*?checkoutUrl:\\s*")[^"]*(")');
  if (!re.test(text)) {
    problems.push(`✗ ${key}: no matching package/plan with a checkoutUrl in ${SITE}`);
    continue;
  }
  text = text.replace(re, `$1${url}$2`);
  changed += 1;
  console.log(`✓ ${key} → ${url || "(cleared)"}`);
}

if (changed) await writeFile(SITE, text, "utf8");

if (problems.length) {
  console.error("\n" + problems.join("\n"));
}
console.log(`\n${changed} link(s) updated in ${SITE}.` + (changed ? " Run `npm run build` and redeploy dist/." : ""));
if (problems.length) exit(1);
