# Symbio AI — Handoff Guide (for Mohammed / Codex)

This guide gets you from **nothing on your laptop** to **the exact same site, running
locally, and then live on a domain you own**. No prior Eleventy knowledge needed.

The site is a plain **static site** — once it's built, it's just HTML, CSS, and JS in a
folder (`dist/`). That folder works on _any_ host: your laptop, GitHub Pages, Netlify,
Vercel, Cloudflare Pages, a cheap shared host — anywhere. There is **no database and no
server code required** to run it.

---

## 0) What you're getting

```
Symbio-AI/
├── src/                  ← the SOURCE you edit (templates, CSS, JS, images)
│   ├── _data/site.js     ← global content: founders, emails, links, CTAs
│   ├── _includes/        ← header, footer, page shell (written ONCE, reused everywhere)
│   ├── assets/           ← css/ js/ img/  (the design system + widget + logos)
│   ├── chatbot-demo.html ← standalone AI assistant demo
│   └── *.njk             ← the 7 pages (index, services, pricing, reviews, about, portfolio, scan)
├── dist/                 ← the BUILT site (auto-generated — this is what you host)
├── package.json          ← the commands (build, dev, lint)
└── .eleventy.js          ← build config
```

You edit files in `src/`. You run one command. It generates `dist/`. You host `dist/`.

---

## 1) Install the one tool you need: Node.js

The site is built with **Node.js** (version **18 or newer** — 20 LTS recommended).

- **Windows / Mac:** download the **LTS** installer from <https://nodejs.org> and run it.
- **Mac with Homebrew:** `brew install node`
- **Linux:** `sudo apt install nodejs npm` (or use nvm).

Verify it worked — open a terminal (Command Prompt / PowerShell / Terminal) and run:

```bash
node --version   # should print v18.x or higher
npm --version    # should print 9.x or higher
```

If both print a version number, you're ready.

---

## 2) Get the code

**Option A — clone with Git (recommended, keeps you in sync):**

```bash
git clone https://github.com/ravikus1457/Symbio-AI.git
cd Symbio-AI
```

**Option B — download a ZIP (no Git needed):**

1. Go to <https://github.com/ravikus1457/Symbio-AI>
2. Click the green **Code** button → **Download ZIP**
3. Unzip it, then in a terminal `cd` into the unzipped `Symbio-AI` folder.

> The live design lives on the `main` branch — that's the default, so both options give
> you the current site automatically.

---

## 3) Install the project's dependencies

From inside the `Symbio-AI` folder:

```bash
npm install
```

This reads `package-lock.json` and downloads the exact build tools (Eleventy, etc.) into a
`node_modules/` folder. Run it once after cloning. (It can take a minute the first time.)

---

## 4) Preview it on your laptop (live, auto-reloading)

```bash
npm run dev
```

This starts a local web server and prints a URL — usually:

```
[11ty] Server at http://localhost:8080/
```

Open **<http://localhost:8080/>** in your browser. That's the full site running on your
machine. While `npm run dev` is running, any edit you make in `src/` rebuilds and
refreshes the page automatically. Press **Ctrl+C** in the terminal to stop the server.

> This is the literal "host it on his laptop" answer for **previewing / developing**.
> For putting it on a real domain that other people can reach, see Step 6.

---

## 5) Build the production site

When you're happy and want the final, optimized files to host:

```bash
npm run build
```

This regenerates the **`dist/`** folder — that folder _is_ the website. It contains:

```
dist/
├── index.html        about.html     services.html   pricing.html
├── reviews.html      portfolio.html scan.html
├── chatbot-demo.html
└── assets/  (css, js, images)
```

Everything in `dist/` is self-contained, framework-free HTML/CSS/JS. You can double-click
`dist/index.html` to open it directly, or host the folder anywhere.

---

## 6) Put it on a real domain (go live)

You have two realistic paths. **Path A (free static host + your domain) is strongly
recommended** — it's reliable, free, fast, and gives you HTTPS automatically. Path B
(serving from your own laptop) works but your laptop must stay on 24/7 and it's harder to
secure.

### Buy the domain first (either path)

Buy `symbioai.com` (or whatever you choose) from any registrar — **Namecheap**,
**Cloudflare Registrar**, **Google Domains/Squarespace**, **Porkbun**, **GoDaddy**, etc.
Cost is typically ~$10–15/year. You'll point it at your host using **DNS records** in the
registrar's dashboard (the host tells you exactly which records to add).

### Path A — Free static host + your domain (recommended)

Pick ONE host. All three deploy the `dist/` folder and then let you attach your domain:

**Netlify (easiest, drag-and-drop):**

1. Make a free account at <https://netlify.com>.
2. Run `npm run build` locally.
3. Go to **Sites → Add new site → Deploy manually**, and **drag the `dist/` folder** onto
   the page. It's live in seconds on a `*.netlify.app` URL.
4. **Domain settings → Add custom domain →** enter your domain. Netlify shows you the DNS
   records to add at your registrar (or you can move DNS to Netlify). HTTPS is automatic.
5. To update later: `npm run build` again and drag the new `dist/` folder. _(Or connect
   the GitHub repo so it auto-builds on every push — Netlify build command `npm run
   build`, publish directory `dist`.)_

**Cloudflare Pages** (great if you buy the domain at Cloudflare):

1. <https://pages.cloudflare.com> → **Create project → Connect to Git** (or **Direct
   Upload** the `dist/` folder).
2. If using Git: **Build command** `npm run build`, **Build output directory** `dist`.
3. **Custom domains → Set up a domain** — if your domain is at Cloudflare, it's one click.

**Vercel:**

1. <https://vercel.com> → **Add New → Project → Import** the GitHub repo.
2. **Framework preset:** Other. **Build command:** `npm run build`. **Output directory:**
   `dist`.
3. **Settings → Domains →** add your domain and follow the DNS instructions.

> **You can keep GitHub Pages too.** This repo already auto-deploys to GitHub Pages on
> every push to `main` (see `.github/workflows/deploy-pages.yml`). The current live URL is
> <https://ravikus1457.github.io/Symbio-AI/>. To put a custom domain on GitHub Pages,
> add a `CNAME` file and configure it in **Settings → Pages → Custom domain**.

### Path B — Host from your own laptop (advanced / not recommended for production)

Your laptop becomes the web server. It must stay powered on and online, and you'll need to
open your network to the internet — fine for a demo, fragile for a real business site.

1. Build: `npm run build`
2. Serve the `dist/` folder with any static server, e.g.:
   ```bash
   npx serve dist            # prints a local URL like http://localhost:3000
   # or
   npx http-server dist -p 8080
   ```
3. **To reach it from the internet**, easiest is a tunnel (no router config):
   ```bash
   npx localtunnel --port 3000     # or use ngrok / cloudflared tunnel
   ```
   That gives you a public URL. To use **your own domain**, you'd point a DNS record at
   your public IP and forward the port on your router — at which point a free static host
   (Path A) is genuinely less work and more reliable. For a real launch, use Path A.

---

## 7) Editing the content (where things live)

Almost all the wording, names, and links are centralized so you rarely touch templates:

| What you want to change                          | File to edit                          |
| ------------------------------------------------ | ------------------------------------- |
| Founders, emails, phone, CTAs, links, positioning| `src/_data/site.js`                   |
| Header / nav                                     | `src/_includes/header.njk`            |
| Footer                                           | `src/_includes/footer.njk`            |
| Logo / brand mark                                | `src/_includes/brand.njk`, `src/assets/img/` |
| Colors, fonts, all styling & animations          | `src/assets/css/styles.css`           |
| Home page                                        | `src/index.njk`                       |
| Services / Pricing / Reviews / About / Portfolio / Scan | `src/<page>.njk`               |
| The embeddable AI widget                         | `src/assets/js/symbio-widget.js`      |
| Standalone demo                                  | `src/chatbot-demo.html`               |

After any edit: `npm run build` (or keep `npm run dev` running to see changes instantly),
then re-deploy `dist/`.

---

## 8) Quality checks (optional but nice)

```bash
npm run lint          # checks CSS, JS, and built HTML
npm run format        # auto-formats CSS/JS/JSON/Markdown (not the .njk templates)
```

---

## 9) Quick reference — the whole thing in 5 commands

```bash
git clone https://github.com/ravikus1457/Symbio-AI.git
cd Symbio-AI
npm install        # one time
npm run dev        # preview at http://localhost:8080
npm run build      # generate dist/ to host anywhere
```

That's the entire site, reproduced exactly. Host `dist/` on Netlify/Cloudflare/Vercel
(Path A) and point your new domain at it, and you're live with HTTPS.

---

## Troubleshooting

- **`node` / `npm` not found** → Node didn't install or the terminal needs restarting.
  Reinstall from <https://nodejs.org> and open a fresh terminal.
- **`npm install` errors** → make sure you're _inside_ the `Symbio-AI` folder (you should
  see `package.json` when you run `ls` / `dir`). Delete `node_modules` and try again.
- **Styles/logo missing when I open `dist/index.html` directly** → opening via `file://`
  can break some absolute paths; use `npm run dev` or `npx serve dist` to preview properly.
- **Changes don't show up** → re-run `npm run build`, and hard-refresh the browser
  (**Ctrl/Cmd + Shift + R**) to clear the cache.
- **Custom domain not working yet** → DNS changes can take a few minutes to a few hours to
  propagate. Double-check the records match exactly what your host gave you.
