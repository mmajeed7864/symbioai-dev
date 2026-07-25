# Symbio AI — Website

The Symbio AI marketing site, built as a clean, dependency-light **static site** with
[Eleventy (11ty)](https://www.11ty.dev/) and Nunjucks templating. The header, footer, design
system, and scripts are each written **once** and reused across every page. The output in
`dist/` is plain HTML/CSS/JS with **no client-side framework runtime** — it hosts trivially on
any static host (Cloudflare tunnel, GitHub Pages, a Raspberry Pi) by simply serving the folder.

> Brand: **Symbio AI** — _“We catch and convert leads in real time.”_
> Built by Mohammed & Ravi.

---

## Quick start

```bash
npm install        # install dev dependencies
npm run dev        # local dev server with live reload (http://localhost:8080)
npm run build      # produce the static site in ./dist
npm run lint       # HTMLHint + Stylelint + ESLint
npm run format     # Prettier (CSS / JS / JSON / MD)
```

Requires Node 18+ (developed on Node 22).

---

## Project structure

```
package.json            # scripts: dev, build, lint, format, minify:widget
.eleventy.js            # Eleventy config: src/ -> dist/, passthrough assets, njk-only templates
.editorconfig           # shared editor settings
.prettierrc             # Prettier config (CSS/JS/JSON/MD; templates are hand-formatted)
.stylelintrc.json       # Stylelint config (extends stylelint-config-standard)
.htmlhintrc             # HTMLHint config
eslint.config.js        # ESLint flat config (browser scripts + Node config files)
src/
  _data/
    site.js             # global data: brand, nav, contacts, links (single source of truth)
  _includes/
    base.njk            # HTML shell: <head>, pre-paint theme script, nav + footer, main.js
    nav.njk             # site header / primary navigation
    footer.njk          # site footer
    brand.njk           # logo + wordmark lockup (reused by nav and footer)
  index.njk             # Home — the living hero, teasers, closing CTA
  about.njk             # About / Vision — founders + Scan → Map → Build → Polish
  services.njk          # Services — websites, booking, AI agents + AI-assistant highlight
  pricing.njk           # Pricing — three honest tiers
  portfolio.njk         # Portfolio — honest, early-stage work
  reviews.njk           # Reviews — proof, not fluff (no fabricated testimonials)
  scan.njk              # Free scan / Contact — the conversion form + contact cards
  chatbot-demo.html     # Shareable full-page demo using the production widget source
  assets/
    css/styles.css      # the single design system (CSS custom properties, sectioned)
    js/main.js          # theme toggle, mobile menu, reveals, living hero, scan form
    js/symbio-widget.js # standalone embeddable chat widget (NOT bundled with the site)
    js/symbio-widget.min.js  # minified widget (run `npm run minify:widget` to regenerate)
    img/                # logo-symbio.svg (favicon), -color / -mono / -reversed marks (brand kit)
README.md
```

Eleventy only treats `.njk` files as templates; CSS, JS, images, and `chatbot-demo.html` are
copied through verbatim. Links between pages are **relative** (`about.html`, `pricing.html`, …)
so the built site works from any subpath.

---

## Design system

One stylesheet — `src/assets/css/styles.css` — is the single source of truth. All colors,
spacing, radii, shadows, type, and motion are CSS custom properties, organized into clearly
commented sections.

- **Light _and_ dark mode** via CSS variables. The theme is set **before first paint** by a
  tiny inline script in `<head>` to avoid a flash. A toggle in the header flips it and persists
  the choice in `localStorage` under the key **`symbio-theme`**; with no stored choice the OS
  preference (`prefers-color-scheme`) governs.
- **Mobile-first & responsive**, with a clean collapsing mobile menu.
- **Honors `prefers-reduced-motion`** — the rotating hero word, drifting aurora, and live lead
  feed all degrade to a static populated state; reveal-on-scroll content is shown immediately.
- Accessible: landmarks, skip link, visible focus states, `aria-current` on the active nav
  item, labelled controls, and sufficient contrast in both themes.

### The living hero

The home hero is one orchestrated moment: a headline whose last word cycles through outcomes
(booked leads → booked calls → new clients → real revenue), a soft drifting gradient aurora,
and a live “lead inbox” where leads slide in, a typing indicator resolves to **Replied/Booked**,
and a counter ticks up. Animation **pauses when the tab is hidden** and is replaced by a static
populated state under reduced motion.

---

## Deploying `dist/`

`npm run build` writes a self-contained static site to `dist/`. Serve that folder anywhere:

**Any static host / your own box**

```bash
npm run build
cd dist && python3 -m http.server 8080   # or any static file server
```

**Cloudflare Tunnel** (serve the folder, then expose it)

```bash
npm run build
npx serve dist            # or: cd dist && python3 -m http.server 8080
cloudflared tunnel --url http://localhost:8080
```

**GitHub Pages** — push the contents of `dist/` to your Pages branch/folder. Because all links
are relative, it also works from a project subpath (e.g. `user.github.io/repo/`).

**Raspberry Pi / nginx** — copy `dist/` to the web root (e.g. `/var/www/html`) and serve it
statically. No Node.js runtime is needed in production.

---

## The embeddable chat widget

`src/assets/js/symbio-widget.js` is a **standalone, dependency-free** assistant that drops onto
**any** website with a single `<script>` tag. It renders inside a **Shadow DOM**, so the host
page’s CSS can’t break it and its styles can’t leak out. It’s shipped as its own file (and
`symbio-widget.min.js`) and is **not bundled** into the site build.

The marketing site dogfoods it: `base.njk` loads the widget on every page exactly the way a
customer would (one `<script>` tag + `window.SymbioConfig`), branded for Symbio. There,
`main.js` bridges captured leads to the same scan endpoint as the form and keeps the widget’s
theme in step with the site’s light/dark toggle.

### Install

Configure with `window.SymbioConfig` **or** `data-*` attributes on the script tag (data-\*
wins):

```html
<script>
  window.SymbioConfig = {
    businessName: "Glow Salon",
    accent: "#1f6bff",
    services: ["Haircut", "Color", "Beard trim"],
    hours: "Tue–Sat, 9am–6pm",
    location: "Oakland, CA",
    phone: "510-555-0100",
    price: "From $35",
    chatbotMessage: "We can add a trained chatbot to your site.",
    voiceMessage: "We can answer approved routine calls and hand off to your team.",
    leadGenerationMessage: "We can improve lead capture, qualification, and follow-up.",
    position: "right", // "right" | "left"
    theme: "auto", // "auto" (follow the OS) | "light" | "dark"
    leadEndpoint: "", // optional, see contracts below
    aiEndpoint: "", // optional, see contracts below
    eventEndpoint: "", // optional; derived from aiEndpoint when omitted
    feedbackEndpoint: "", // optional; derived from aiEndpoint when omitted
    onLead: function (lead) {
      console.log("captured", lead);
    },
  };
</script>
<script src="symbio-widget.js" defer></script>
```

Quick setup via attributes:

```html
<script
  src="symbio-widget.js"
  data-business-name="Glow Salon"
  data-accent="#e0457b"
  data-services="Haircut, Color, Beard trim"
  data-hours="Tue–Sat, 9am–6pm"
  data-phone="510-555-0100"
  defer
></script>
```

### Behavior & API

- Built-in **zero-token intent engine** for products, lead-generation goals, pricing, timelines,
  support fees, guarantees, hours, location, examples, and contact questions, plus a deterministic
  **lead-intake flow** (name → contact → detail). Confirmed delivery still requires a
  `leadEndpoint`, `onLead`, or `symbio:lead` responder.
- Every captured lead fires a `window` **`symbio:lead`** event. The event detail contains the lead
  plus `respond(resultOrPromise)`, which lets the host report whether delivery succeeded.
- **Theme:** `auto` follows the visitor’s OS; pass `light`/`dark` (or call `configure({ theme })`)
  to pin it — that’s how the site keeps the widget in sync with its toggle. A theme change never
  resets the conversation; a branding change (name/accent/services/…) re-greets.
- Public API:

  ```js
  window.SymbioWidget.open();
  window.SymbioWidget.close();
  window.SymbioWidget.toggle();
  window.SymbioWidget.configure({ businessName, accent, services, theme /* … */ }); // live update
  ```

> The minified build is produced with `npm run minify:widget`. The full-page demo loads
> `src/assets/js/symbio-widget.js` directly, so production and demo behavior cannot drift.

---

## Backend contracts

These are implemented client-side; a backend developer only needs to honor them.

### 1. Free-scan form (`scan.html`)

On submit, the form POSTs JSON to:

| Host                       | Endpoint                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| `localhost` / `127.0.0.1`  | `http://127.0.0.1:8878/api/free-scan`                                     |
| anything else (production) | `/api/free-scan` on `https://www.symbioai.dev`                            |

**Body** (JSON):

```json
{
  "name": "",
  "business": "",
  "email": "",
  "phone": "",
  "link": "",
  "need": "",
  "budget": "",
  "goal": "",
  "problem": "",
  "sourceUrl": ""
}
```

**Success** = HTTP `200` **and** a body of `{"ok": true}`. On any other response, a network
error, or a CORS failure, the form falls back to a pre-filled **mailto** to
`freescan@symbioai.dev` and CCs `mohammed@symbioai.dev,ravi@symbioai.dev`.

### 2. Widget lead delivery — `leadEndpoint` (optional)

```
POST <leadEndpoint>
{ "name", "contact", "detail", "business", "page", "at" }   ->   HTTP 200
```

The widget only says a request was delivered after at least one configured delivery path confirms
success. Otherwise it shows direct contact information instead of a false success message.

### 3. Widget AI replies — `aiEndpoint` (optional)

```
POST <aiEndpoint>
{ "messages": [{ "role": "user|assistant", "content": "…" }], "sessionId": "…" }
->
{ "reply": "…", "source": "model|cache|privacy", "messageId": "…" }
```

High-confidence business questions use the built-in intent engine first, so they stay instant and
token-free. An `aiEndpoint` is only called for an unclassified question. If it is unset or fails,
the widget uses its configured service-fit response. Lead capture is always deterministic.

When `aiEndpoint` ends in `/chat`, the widget derives `/chat-event` and `/chat-feedback`
automatically. Every answer records anonymous operational metadata (model/source, byte counts,
tokens, and provider-reported cost where applicable). Raw conversation text is not retained by
default. If a visitor explicitly marks an answer **Needs work**, that one question/answer pair is
scrubbed, hash-matched to the original answer, stored for at most 30 days, and queued for private
review. Feedback must be submitted within 24 hours, is rate-limited, and never changes the
production prompt automatically.

### 4. Private chatbot metrics

`GET /api/chat-metrics` returns day/month cost, token, cache, feedback, and learning-queue totals.
`POST /api/chat-metrics` marks reviewed learning samples. Both require:

```text
Authorization: Bearer <SYMBIO_COMMAND_CENTER_TOKEN>
```

Required production environment variables:

| Variable                         | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------------ |
| `SYMBIO_COMMAND_CENTER_TOKEN`    | Dedicated server-only bearer token for the private dashboard |
| `SYMBIO_CHAT_MONTHLY_BUDGET_USD` | Enforced monthly model budget; defaults to `5`                |
| `SYMBIO_CHAT_MAX_CALL_USD`        | Conservative pre-call reservation; defaults to `0.01`        |
| `UPSTASH_REDIS_REST_URL`         | Existing Upstash REST endpoint                               |
| `UPSTASH_REDIS_REST_TOKEN`       | Existing Upstash REST token                                  |
| `OPENROUTER_CHAT_API_KEY`        | Restricted OpenRouter key used only by the website assistant |
| `OPENROUTER_CHAT_MODEL`          | Live chatbot model override                                  |

---

## Tooling

| Script                  | What it does                                             |
| ----------------------- | -------------------------------------------------------- |
| `npm run dev`           | Eleventy dev server with live reload                     |
| `npm run build`         | Build the static site to `dist/`                         |
| `npm run clean`         | Remove `dist/`                                           |
| `npm run lint`          | Stylelint + ESLint + HTMLHint (HTMLHint runs on `dist/`) |
| `npm run format`        | Prettier write (CSS / JS / JSON / MD)                    |
| `npm run minify:widget` | Regenerate `symbio-widget.min.js` with Terser            |
| `npm run eval:chat-model` | Run versioned quality, PII-output, token, and cost gates |

The model path atomically reserves budget in Redis before calling OpenRouter. Each reservation has
a unique five-minute lease and is settled once; an expired dispatched lease is conservatively
charged instead of silently released. The dashboard reads that same local guard ledger. At the
local cap, the widget falls back to a no-token response; an unavailable budget ledger fails
closed. The dedicated OpenRouter key's provider-side monthly limit is the final hard stop if an
actual provider charge exceeds the conservative per-call reservation. Provider-reported cost is
stored with model, prompt version, token counts, and an effective price snapshot. The private
metrics endpoint reconciles the local ledger against that key's monthly usage on a month-scoped
15-minute cache. Prompt changes stay review-only
until the golden regression, PII, and per-turn cost gates pass; Git/Vercel retain the prior
production version for one-step rollback.

Nunjucks templates and `chatbot-demo.html` are excluded from Prettier
(its HTML parser rewrites `{% %}`/`{{ }}` tags) — they are hand-formatted and validated by
HTMLHint instead. Run `npm run build` before `npm run lint`, since HTMLHint lints the built
HTML in `dist/`.

---

## Contacts

- **Symbio AI** — business inbox — contact@symbioai.dev
- **Mohammed H. Majeed** — founder & lead builder — 510-585-7136
- **Ravi** — build partner
- Technical portfolio / GitHub: https://mmajeed7864.github.io/
