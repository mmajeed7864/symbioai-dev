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
    "We build premium websites, apps, dashboards, chatbots, voice agents, and AI systems that help businesses look credible and turn attention into action.",
  description:
    "Symbio AI builds premium websites, custom apps, dashboards, AI chatbots, customer-service voice agents, and workflow systems for growing businesses and teams.",

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
  checkout: { key: "checkout", label: "Checkout", url: "checkout.html" },

  businessEmail: "contact@symbioai.dev",

  payment: {
    venmoHandle: "@symbioaii",
    venmoUrl: "https://venmo.com/u/symbioaii",
    venmoQr: "assets/img/symbio-venmo-qr.png",
  },

  founders: [
    {
      name: "Mohammed H. Majeed",
      role: "Founder and lead builder",
      email: "contact@symbioai.dev",
      phone: "510-585-7136",
    },
    {
      name: "Ravi Kumar",
      role: "Founder and lead builder",
      email: "contact@symbioai.dev",
      phone: "925-597-8128",
    },
  ],

  leadEmail: "freescan@symbioai.dev",
  leadEmailCc: "mohammed@symbioai.dev,ravi@symbioai.dev",
  // Emergency bridge while the permanent Cloudflare Worker route is being deployed.
  // The JS default is the permanent endpoint: https://api.symbioai.dev/api/free-scan
  freeScanEndpoint: "/api/free-scan",

  links: {
    portfolio: "portfolio.html",
    demo: "chatbot-demo.html",
    demos: "demos.html",
    voice: "voice-agent.html",
    weddings: "weddings/",
  },

  projects: [
    {
      name: "Bay Area Auto Customz",
      category: "Automotive customization",
      service: "Website + interactive design tool",
      url: "https://bayareaautocustomz.com/",
      image: "assets/img/portfolio-bay-area-auto-customz.jpg",
      imageAlt:
        "Bay Area Auto Customz website with its starlight headliner design selector",
      summary:
        "A premium sales site that lets customers explore finishes, design a starlight headliner, watch real shop work, and request an install without hunting through social media.",
      features: [
        "Interactive 300-4,000 star designer",
        "Finish previews and RGB controls",
        "Quote and booking flow",
        "Real work, video, and review proof",
      ],
    },
    {
      name: "East Bay Hindu Temple",
      category: "Faith and community",
      service: "Multi-page website redesign",
      url: "https://ravikus1457.github.io/Symbio-AI/clients/east-bay-hindu-temple/",
      image: "assets/img/portfolio-east-bay-hindu-temple.jpg",
      imageAlt:
        "East Bay Hindu Temple redesign with a red and gold cultural visual system",
      summary:
        "A respectful red-and-gold redesign that makes darshan times, pooja booking, events, giving, and first-visit information easy to find on any screen.",
      features: [
        "Culturally grounded visual direction",
        "Pooja services and booking paths",
        "Events, calendar, and timings",
        "Mobile-first visitor experience",
      ],
    },
    {
      name: "Four-Day Indian Wedding — Event Platform",
      category: "Weddings",
      service: "Custom event platform",
      url: "portfolio/wedding-demo",
      ctaLabel: "View sanitized demo",
      statusLabel: "Interactive portfolio demo",
      serviceUrl: "weddings/",
      serviceCta: "Build a wedding site",
      image: "assets/img/weddings-showcase.jpg",
      imageAlt:
        "Custom wedding event platform demo with a four-day Indian celebration experience",
      summary:
        "A four-day Indian wedding brought into one custom platform: bespoke design, per-event RSVP, family notifications, thoughtful venue privacy, and QR guest cameras feeding a private couple's album.",
      features: [
        "Per-event RSVP and family notifications",
        "Multi-day, dual-family event schedules",
        "Guest-camera QR upload experience",
        "Private couple's album and venue handling",
      ],
    },
  ],

  productLanes: [
    {
      key: "website",
      art: "assets/img/lanes/website.webp",
      eyebrow: "Websites and redesigns",
      title: "Premium website or redesign",
      shortTitle: "Website / redesign",
      startsAt: "$1,490",
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
      art: "assets/img/lanes/app.webp",
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
      art: "assets/img/lanes/dashboard.webp",
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
      art: "assets/img/lanes/chatbot.webp",
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
      key: "voice",
      art: "assets/img/lanes/voice.webp",
      eyebrow: "Customer-service voice agents",
      title: "AI voice agent",
      shortTitle: "Voice agent",
      startsAt: "Custom quote",
      priceLabel: "Custom quote",
      typical: "Scoped to call volume and integrations",
      summary:
        "A business-trained phone agent that answers routine calls, captures orders or requests, routes booking requests, and brings in a person when needed.",
      bestFor:
        "Restaurants, home services, appointment-based teams, after-hours coverage, overflow calls, and missed-call recovery.",
      features: [
        "Branded call greeting",
        "Order or request intake",
        "Booking request routing and lead qualification",
        "Human escalation with context",
      ],
      demoUrl: "voice-agent.html#call-preview",
      cta: "Preview a call flow",
    },
    {
      key: "agent",
      art: "assets/img/lanes/agent.webp",
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
        "A connected build where the site, app, dashboard, chatbot, voice agent, and automation work together instead of living as separate tools.",
      bestFor:
        "Businesses that need a full lead, call, booking, dashboard, and follow-up system built as one experience.",
      features: ["Public site", "Internal app", "Dashboard", "Chatbot, voice agent, or workflow lane"],
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
      price: "$1,490",
      cadence: "flat",
      blurb: "A fast, modern site that earns trust and turns visitors into enquiries.",
      ongoing: "Managed website care from $79/mo starts at launch",
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
      blurb:
        "Our always-on assistant on your site — answers approved questions, captures lead details, and routes booking requests.",
      features: [
        "One-time $690 setup & styling",
        "From $39/mo — hosting, AI & lead delivery",
        "Confirmed lead delivery to a real person on your team",
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
      blurb: "The managed-site baseline: hosting, protection, maintenance, and small updates handled.",
      features: [
        "Managed hosting + SSL/TLS",
        "Uptime monitoring + deployment restore points",
        "Security, platform & dependency maintenance",
        "Up to 30 min of minor content updates / month",
        "Support response within 2 business days",
      ],
      checkoutUrl: "",
      featured: false,
    },
    {
      key: "care-growth",
      name: "Growth",
      price: "$149",
      cadence: "/mo",
      blurb: "More hands-on help for businesses that update the site and want a monthly performance check.",
      features: [
        "Everything in Essential",
        "Up to 2 hrs of content or design updates / month",
        "Monthly analytics check-in",
        "Support response within 1 business day",
      ],
      checkoutUrl: "",
      featured: true,
    },
    {
      key: "care-pro",
      name: "Pro",
      price: "$279",
      cadence: "/mo",
      blurb: "Ongoing support and conversion work for a site that changes and improves every month.",
      features: [
        "Everything in Growth",
        "Up to 4 hrs of content or design updates / month",
        "Monthly conversion review + 1 improvement",
        "Same-business-day response during business hours",
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
