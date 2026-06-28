/**
 * Global site data. Templates read this via the `site` global.
 */
export default {
  name: "Symbio AI",
  shortName: "Symbio",
  tagline: "Websites that look better and convert faster.",
  poweredBy: "Powered by international AI engineers and devs.",
  // Production origin (no trailing slash). Used for absolute canonical URLs,
  // og:url, sitemap entries, and JSON-LD @id values. Set to the live domain.
  url: "https://symbioai.dev",
  // Deployed instant-teardown Worker base URL (infra/worker/). Empty -> the
  // teardown page falls back to the normal free-scan form. e.g.
  // "https://symbio-scan.<you>.workers.dev"
  scanApi: "https://symbio-scan.symbioai.workers.dev",
  // Privacy-friendly analytics (cookieless). Set analyticsDomain to your domain
  // to enable Plausible (free trial / self-host) — conversion events (Lead,
  // Teardown, CheckoutClick, ...) fire automatically. analyticsScript is a generic
  // escape hatch for any other analytics <script> URL. Both empty -> no tracking.
  analyticsDomain: "",
  analyticsScript: "",
  // Retargeting pixels (off until set) — build audiences for cheap paid ads
  // later. base.njk loads them and main.js forwards conversion events to them.
  // IDs from Meta Events Manager (e.g. "1234567890") and Google Ads/Analytics
  // (e.g. "AW-123" / "G-123"). Both empty -> no pixels load.
  metaPixelId: "",
  googleAdsId: "",
  // Direct "leave a review" link for your Google Business Profile — used by
  // `hermes review`. In GBP: "Get more reviews" -> copy link.
  googleReviewUrl: "",
  positioning:
    "We build premium websites, apps, dashboards, chatbots, and AI agents that help businesses look credible and turn attention into action.",
  description:
    "Symbio AI builds premium websites, redesigns, custom apps, dashboards, AI chatbots, and workflow agents for local businesses, nonprofits, schools, creators, and growing teams.",

  whoWeHelp: ["Local businesses", "Nonprofits", "Schools", "Creators", "Small teams"],

  nav: [
    { key: "home", label: "Home", url: "index.html" },
    { key: "about", label: "About", url: "about.html" },
    { key: "services", label: "Services", url: "services.html" },
    { key: "demos", label: "Demos", url: "demos.html" },
    { key: "pricing", label: "Pricing", url: "pricing.html" },
    { key: "packages", label: "Packages", url: "buy.html" },
    { key: "grow", label: "Industries", url: "grow.html" },
    { key: "portfolio", label: "Portfolio", url: "portfolio.html" },
    { key: "reviews", label: "Reviews", url: "reviews.html" },
  ],

  cta: { key: "scan", label: "Get a free project scan", url: "scan.html" },

  businessEmail: "symbioaiiii@gmail.com",

  founders: [
    {
      name: "Mohammed H. Majeed",
      role: "Founder and lead builder",
      email: "symbioaiiii@gmail.com",
      phone: "510-585-7136",
    },
    {
      name: "Ravi Kumar",
      role: "Founder and lead builder",
      email: "symbioaiiii@gmail.com",
      phone: "925-597-8128",
    },
  ],

  leadEmail: "symbioaiiii@gmail.com",
  leadEmailCc: "",
  // Emergency bridge while the permanent Cloudflare Worker route is being deployed.
  // The JS default is the permanent endpoint: https://api.symbioai.dev/api/free-scan
  freeScanEndpoint: "/api/free-scan",

  links: {
    portfolio: "portfolio.html",
    demo: "chatbot-demo.html",
    demos: "demos.html",
  },

  productLanes: [
    {
      key: "website",
      eyebrow: "Websites and redesigns",
      title: "Premium website or redesign",
      shortTitle: "Website / redesign",
      startsAt: "$1,500",
      typical: "$2,500-$5,500",
      compareAt: "$5,000-$9,000 at agencies",
      summary:
        "A modern site that makes the business look trustworthy, explains the offer clearly, and turns visitors into calls, bookings, or leads.",
      bestFor: "New websites, homepage rebuilds, landing pages, service pages, and mobile cleanup.",
      features: [
        "Homepage and offer cleanup",
        "Mobile-first layout",
        "Conversion-focused copy",
        "Contact or booking path",
      ],
      demoUrl: "demos.html#redesign-lab",
      cta: "See website demo",
    },
    {
      key: "app",
      eyebrow: "Apps and portals",
      title: "Custom app",
      shortTitle: "Custom app",
      startsAt: "$4,500",
      typical: "$6,000-$18,000",
      compareAt: "$25,000+ at agencies",
      summary:
        "A real tool with logins, forms, workflows, dashboards, uploads, or internal screens built around how the business actually runs.",
      bestFor: "Client portals, staff tools, quote builders, booking workflows, and internal operations.",
      features: ["Logins and roles", "Forms and workflows", "Client or staff views", "Clean admin experience"],
      demoUrl: "demos.html#app-canvas",
      cta: "See app demo",
    },
    {
      key: "dashboard",
      eyebrow: "Dashboards",
      title: "Business dashboard",
      shortTitle: "Dashboard",
      startsAt: "$1,500",
      typical: "$2,500-$6,500",
      compareAt: "$12,000 at a BI firm",
      summary:
        "A simple command center for leads, bookings, performance, follow-ups, or team activity so owners can see what is happening.",
      bestFor: "Lead tracking, booking visibility, sales follow-up, KPIs, and founder dashboards.",
      features: ["Lead and booking views", "KPI cards", "Follow-up status", "Export-ready data"],
      demoUrl: "demos.html#pulse-dashboard",
      cta: "See dashboard demo",
    },
    {
      key: "chatbot",
      eyebrow: "Chatbots",
      title: "AI chatbot / lead intake",
      shortTitle: "AI chatbot",
      startsAt: "$750",
      typical: "$1,500-$4,000",
      compareAt: "$6,000-$13,000 at agencies",
      summary:
        "A customer-facing assistant that answers common questions, collects lead details, and routes the next step to a real person.",
      bestFor: "24/7 intake, FAQs, bookings, service questions, and missed-lead recovery.",
      features: ["Lead capture", "Service FAQs", "Founder handoff", "Embeddable widget"],
      demoUrl: "demos.html#concierge-studio",
      cta: "See chatbot demo",
    },
    {
      key: "agent",
      eyebrow: "AI agents",
      title: "AI agent system",
      shortTitle: "AI agent",
      startsAt: "$1,500",
      typical: "$3,000-$9,000",
      compareAt: "$7,500+ at AI agencies",
      summary:
        "A controlled automation lane that drafts, routes, reminds, updates, or organizes repeat work while humans approve the important steps.",
      bestFor: "Follow-up systems, inbox routing, CRM cleanup, content drafts, reminders, and repeat admin work.",
      features: ["Approval gates", "Repeat task handling", "Status tracking", "Human-in-control flow"],
      demoUrl: "demos.html#workflow-theater",
      cta: "See agent demo",
    },
    {
      key: "system",
      eyebrow: "Full systems",
      title: "Website + app + AI system",
      shortTitle: "Connected system",
      startsAt: "$7,500",
      typical: "$12,000-$25,000",
      compareAt: "$50,000+ at agencies",
      summary:
        "A connected build where the site, app, dashboard, chatbot, and automation work together instead of living as separate tools.",
      bestFor: "Businesses that need a full lead, booking, dashboard, and follow-up system built as one experience.",
      features: ["Public site", "Internal app", "Dashboard", "Chatbot or agent lane"],
      demoUrl: "demos.html",
      cta: "Explore all demos",
    },
  ],

  packages: [
    {
      key: "speed-fix",
      name: "Site speed & mobile fix",
      price: "$399",
      cadence: "one-time",
      blurb: "The easy first yes. We make your existing site fast and flawless on phones.",
      features: [
        "Mobile + speed audit, then the fixes",
        "Core Web Vitals & image cleanup",
        "Done in days, not weeks",
      ],
      checkoutUrl: "",
      featured: false,
    },
    {
      key: "website-7-days",
      name: "Website in 7 days",
      price: "$1,290",
      cadence: "flat",
      blurb: "A fast, modern site that earns trust and turns visitors into enquiries.",
      features: [
        "Up to 5 pages, conversion-first",
        "Lead capture + the AI assistant wired in",
        "Live in a week — flat price, no surprises",
      ],
      checkoutUrl: "",
      featured: true,
    },
    {
      key: "booking-system",
      name: "Booking + lead system",
      price: "$890",
      cadence: "one-time",
      blurb: "Turn enquiries into booked time, with reminders that cut no-shows.",
      features: [
        "Online booking wired to your calendar",
        "Lead capture flow — nothing dropped",
        "Automatic reminders & follow-ups",
      ],
      checkoutUrl: "",
      featured: false,
    },
    {
      key: "ai-assistant",
      name: "AI assistant install",
      price: "$690",
      cadence: "setup + monthly",
      blurb: "Our always-on assistant on your site — answers, captures leads, books.",
      features: [
        "One-time $690 setup & styling",
        "From $39/mo — hosting, AI & lead delivery",
        "Every lead reaches a real person on your team",
      ],
      checkoutUrl: "",
      featured: false,
    },
  ],

  // ── AI assistant monthly plans (the recurring-revenue lane: widget.html) ─
  // Same Stripe pattern as packages, but these are SUBSCRIPTION Payment Links.
  // Paste a link into each checkoutUrl, or run:
  //   npm run set-stripe -- widget-growth=https://buy.stripe.com/...
  // Empty links fall back to the free scan, so there are never dead buttons.
  widgetSetup: "$690 one-time setup",
  widgetPlans: [
    {
      key: "widget-starter",
      name: "Starter",
      price: "$39",
      cadence: "/mo",
      blurb: "The always-on assistant on one site — answering questions and catching leads.",
      features: [
        "AI chat on one website",
        "Lead capture → your inbox",
        "Styled to your brand",
        "Email support",
      ],
      checkoutUrl: "",
      featured: false,
    },
    {
      key: "widget-growth",
      name: "Growth",
      price: "$89",
      cadence: "/mo",
      blurb: "More volume, booking hand-off, and monthly tuning as you grow.",
      features: [
        "Everything in Starter",
        "Higher monthly conversation limit",
        "Booking / calendar hand-off",
        "Monthly tuning & tweaks",
      ],
      checkoutUrl: "",
      featured: true,
    },
    {
      key: "widget-pro",
      name: "Pro",
      price: "$149",
      cadence: "/mo",
      blurb: "For busier sites that want priority support and custom answer flows.",
      features: [
        "Everything in Growth",
        "Priority support",
        "Custom answer flows",
        "Lead delivery to your CRM",
      ],
      checkoutUrl: "",
      featured: false,
    },
  ],

  // ── Website care plans (recurring retainer: care.html) ──────────────────
  // Pure-margin monthly revenue — every build client should convert to one.
  // Same Stripe pattern (subscription Payment Links); set via:
  //   npm run set-stripe -- care-growth=https://buy.stripe.com/...
  carePlans: [
    {
      key: "care-essential",
      name: "Essential",
      price: "$79",
      cadence: "/mo",
      blurb: "We keep your site fast, secure, online, and up to date — so you never think about it.",
      features: [
        "Managed hosting + SSL",
        "Uptime & security monitoring",
        "Software/plugin updates",
        "Up to 30 min of content edits / month",
      ],
      checkoutUrl: "",
      featured: false,
    },
    {
      key: "care-growth",
      name: "Growth",
      price: "$149",
      cadence: "/mo",
      blurb: "Everything in Essential, plus monthly improvements and a plain-English report.",
      features: [
        "Everything in Essential",
        "Up to 2 hrs of changes / month",
        "Monthly analytics + insights report",
        "Priority turnaround",
      ],
      checkoutUrl: "",
      featured: true,
    },
    {
      key: "care-pro",
      name: "Pro",
      price: "$279",
      cadence: "/mo",
      blurb: "Ongoing conversion work — we keep improving the site to win more leads.",
      features: [
        "Everything in Growth",
        "Up to 4 hrs of changes / month",
        "Ongoing conversion & A/B tweaks",
        "A direct line to the builders",
      ],
      checkoutUrl: "",
      featured: false,
    },
  ],

  // ── Flagship retainer: the premium "S-tier" offer (shown on pricing.html
  // and demos.html). A deliberate high anchor — a recurring growth partnership
  // that makes every one-time price below it read as an easy yes. Subscription
  // Payment Link; empty checkoutUrl falls back to the free scan.
  partnerPlan: {
    key: "symbio-partner",
    name: "Symbio Partner",
    price: "$2,500",
    cadence: "/mo",
    minimum: "3-month minimum, then month-to-month",
    blurb:
      "A done-with-you growth partnership for ambitious businesses and nonprofits that want a senior team on call — not another vendor. Both founders, priority everything, and a website + AI system run as a living growth engine.",
    compareAt: "$2,500-$5,000/mo at a premium agency",
    features: [
      "Direct line to both founders — private channel, same-day priority response",
      "Quarterly strategy roadmap + monthly growth sprints (conversion, SEO, AI tuning) with a scorecard",
      "Unlimited reasonable design & content edits, 48-hour turnaround — no per-ticket nickel-and-diming",
      "Managed AI assistant + automations included (Pro widget, lead routing, follow-up sequences)",
      "Full website care: hosting oversight, security, backups, uptime & performance tuning",
      "First access to new builds (apps, dashboards, agents) at a 15% partner rate + a launch-day guarantee",
    ],
    checkoutUrl: "",
    featured: true,
  },

  footerCredit: "Built by Mohammed and Ravi.",
};
