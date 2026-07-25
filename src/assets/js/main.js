/* =========================================================================
   Symbio AI - site behaviour
   Plain, dependency-free JavaScript shared by every page. Sections:
     1. Helpers
     2. Theme toggle (persisted, respects OS preference)
     3. Mobile menu
     4. Reveal-on-scroll
     5. Hero: rotating word
     6. Hero: live lead inbox
     7. Free-scan form (POST JSON, mailto fallback)
     8. Product demos, checkout, teardown, tracking, and voice preview
   Each feature is guarded by element checks, so the file is safe on any page.
   ========================================================================= */
(function () {
  "use strict";

  /* ---- 1. Helpers ------------------------------------------------------ */
  const root = document.documentElement;

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function onFirstView(el, cb) {
    if (!("IntersectionObserver" in window)) {
      cb();
      return;
    }
    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            obs.disconnect();
            cb();
          }
        });
      },
      { threshold: 0.35 }
    );
    io.observe(el);
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }

  // Fire a conversion event to whatever analytics is loaded (Plausible if set),
  // and a DOM event so anything else can hook it. No-op if nothing's listening.
  function track(name, props) {
    try {
      if (window.plausible) window.plausible(name, props ? { props: props } : undefined);
    } catch (e) {
      /* analytics must never break the page */
    }
    try {
      window.dispatchEvent(new CustomEvent("symbio:track", { detail: { name: name, props: props || {} } }));
    } catch (e) {
      /* CustomEvent unsupported - ignore */
    }
  }

  /* ---- 2. Theme toggle ------------------------------------------------- */
  const THEME_KEY = "symbio-theme";

  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme, toggle) {
    root.setAttribute("data-theme", theme);
    if (toggle) {
      const isDark = theme === "dark";
      toggle.setAttribute("aria-pressed", String(isDark));
      toggle.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
    }
    // Keep the embedded chat widget in step with the site theme (if loaded yet).
    if (window.SymbioWidget && typeof window.SymbioWidget.configure === "function") {
      window.SymbioWidget.configure({ theme });
    }
  }

  function initTheme() {
    const toggle = document.querySelector("[data-theme-toggle]");
    applyTheme(storedTheme() || systemTheme(), toggle);

    // The widget loads after this script, so sync it once it's available.
    window.addEventListener("load", () => {
      if (window.SymbioWidget && typeof window.SymbioWidget.configure === "function") {
        window.SymbioWidget.configure({ theme: root.getAttribute("data-theme") || "auto" });
      }
    });

    // Follow the OS preference live, but only while the user hasn't chosen.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
      if (!storedTheme()) applyTheme(event.matches ? "dark" : "light", toggle);
    });

    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {
        /* storage may be blocked; the choice just won't persist. */
      }
      applyTheme(next, toggle);
    });
  }

  /* ---- 3. Mobile menu -------------------------------------------------- */
  function initMenu() {
    const toggle = document.querySelector("[data-nav-toggle]");
    const menu = document.querySelector("[data-nav-menu]");
    if (!toggle || !menu) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.classList.toggle("is-open", open);
    }

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Close after following a link.
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) setOpen(false);
    });

    // Close on Escape.
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setOpen(false);
    });

    // Close when clicking outside the menu.
    document.addEventListener("click", (event) => {
      if (
        toggle.getAttribute("aria-expanded") === "true" &&
        !event.target.closest("[data-nav-menu]") &&
        !event.target.closest("[data-nav-toggle]")
      ) {
        setOpen(false);
      }
    });

    // Reset when growing to the desktop layout.
    window.matchMedia("(min-width: 880px)").addEventListener("change", (event) => {
      if (event.matches) setOpen(false);
    });
  }

  /* ---- 4. Reveal-on-scroll -------------------------------------------- */
  function initReveals() {
    const els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;

    if (!("IntersectionObserver" in window) || prefersReducedMotion()) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );

    els.forEach((el) => observer.observe(el));
  }

  /* ---- 5. Hero: rotating word ----------------------------------------- */
  function initRotator() {
    const rotator = document.querySelector("[data-rotator]");
    if (!rotator) return;

    const wordEl = rotator.querySelector(".hero__rotator-word");
    const words = (rotator.getAttribute("data-words") || "")
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);

    if (!wordEl || words.length < 2 || prefersReducedMotion()) return;

    const HOLD = 2200;
    const SWAP = 350;
    let index = 0;
    let interval = null;

    function swap() {
      wordEl.classList.add("is-exiting");
      window.setTimeout(() => {
        index = (index + 1) % words.length;
        wordEl.textContent = words[index];
        wordEl.classList.remove("is-exiting");
        wordEl.classList.add("is-entering");
        // Two frames so the "entering" start state is painted before release.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => wordEl.classList.remove("is-entering"))
        );
      }, SWAP);
    }

    function start() {
      if (!interval) interval = window.setInterval(swap, HOLD);
    }

    function stop() {
      window.clearInterval(interval);
      interval = null;
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    start();
  }

  /* ---- 6. Hero: live lead inbox --------------------------------------- */
  const SAMPLE_LEADS = [
    { name: "Jordan M.", msg: "Do you take new patients this week?", outcome: "Booked" },
    { name: "Sarah R.", msg: "Can I get a quote for a kitchen remodel?", outcome: "Replied" },
    { name: "Alex T.", msg: "Are you open this Saturday?", outcome: "Booked" },
    { name: "Priya K.", msg: "How much for a 5-page website?", outcome: "Replied" },
    { name: "Dev S.", msg: "Need a cut before Friday - any slots?", outcome: "Booked" },
    { name: "Mia L.", msg: "Do you offer payment plans?", outcome: "Replied" },
    { name: "Tom B.", msg: "Can someone call me back today?", outcome: "Booked" },
    { name: "Nina P.", msg: "Is the first consultation free?", outcome: "Replied" },
  ];

  function buildLeadEl(data) {
    const li = document.createElement("li");
    li.className = "lead";
    li.innerHTML =
      '<span class="lead__avatar" aria-hidden="true">' +
      initials(data.name) +
      "</span>" +
      '<span class="lead__body">' +
      '<span class="lead__name">' +
      data.name +
      "</span>" +
      '<span class="lead__msg">' +
      data.msg +
      "</span>" +
      "</span>" +
      '<span class="badge badge--typing" aria-label="Typing a reply">' +
      '<span class="lead__typing" aria-hidden="true"><span></span><span></span><span></span></span>' +
      "</span>";
    return li;
  }

  function resolveLead(li, data) {
    const badge = li.querySelector(".badge");
    if (!badge) return;
    badge.className = "badge badge--" + (data.outcome === "Booked" ? "booked" : "replied");
    badge.textContent = data.outcome;
    badge.removeAttribute("aria-label");
  }

  function initInbox() {
    const list = document.querySelector("[data-inbox]");
    const countEl = document.querySelector("[data-inbox-count]");
    if (!list) return;

    // Reduced motion / no JS keep the static populated markup already in the page.
    if (prefersReducedMotion()) return;

    const MAX_VISIBLE = 4;
    const PERIOD = 3400;
    const RESOLVE_DELAY = 1400;
    let index = 0;
    let count = parseInt(countEl ? countEl.textContent : "", 10);
    if (!Number.isFinite(count)) count = 24;

    let cycle = null;
    const pending = [];

    function clearPending() {
      pending.forEach((id) => window.clearTimeout(id));
      pending.length = 0;
    }

    // Seed a few already-resolved leads so the panel isn't empty.
    list.textContent = "";
    for (let s = 0; s < MAX_VISIBLE; s += 1) {
      const data = SAMPLE_LEADS[s];
      const li = buildLeadEl(data);
      resolveLead(li, data);
      list.appendChild(li);
    }
    index = 2;

    function addLead() {
      const data = SAMPLE_LEADS[index % SAMPLE_LEADS.length];
      index += 1;

      const li = buildLeadEl(data);
      list.prepend(li);
      li.classList.add("is-entering");

      while (list.children.length > MAX_VISIBLE) {
        list.lastElementChild.remove();
      }

      const id = window.setTimeout(() => {
        resolveLead(li, data);
        count += 1;
        if (countEl) countEl.textContent = String(count);
      }, RESOLVE_DELAY);
      pending.push(id);
    }

    function start() {
      if (cycle) return;
      addLead();
      cycle = window.setInterval(addLead, PERIOD);
    }

    function stop() {
      window.clearInterval(cycle);
      cycle = null;
      clearPending();
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    start();
  }

  /* ---- 7. Free-scan form ---------------------------------------------- */
  // Backend contract: POST JSON to the endpoint; success = HTTP 200 AND
  // {"ok": true}. On any failure, fall back to a pre-filled mailto.
  const SCAN_FIELDS = [
    "name",
    "business",
    "email",
    "phone",
    "link",
    "need",
    "budget",
    "goal",
    "problem",
    "sourceUrl",
    "_gotcha",
  ];
  const LEAD_EMAIL = "freescan@symbioai.dev";
  const LEAD_EMAIL_CC = "mohammed@symbioai.dev,ravi@symbioai.dev";
  const PERMANENT_SCAN_ENDPOINT = "/api/free-scan";

  function scanEndpoints() {
    const configured =
      window.SymbioConfig?.freeScanEndpoint ||
      document.querySelector('meta[name="symbio-free-scan-endpoint"]')?.getAttribute("content") ||
      "";
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
    const endpoints = [];
    if (configured) endpoints.push(configured);
    if (isLocal) endpoints.push("http://127.0.0.1:8878/api/free-scan");
    else endpoints.push(PERMANENT_SCAN_ENDPOINT);
    return endpoints.filter((endpoint, index) => endpoint && endpoints.indexOf(endpoint) === index);
  }

  // POST a scan payload; resolves true only on HTTP 200 with {"ok": true}.
  async function submitScan(payload) {
    for (const endpoint of scanEndpoints()) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.ok === true) return true;
      } catch (e) {
        // Try the next intake endpoint before using the mail fallback.
      }
    }
    return false;
  }

  function initScanForm() {
    const form = document.querySelector("[data-scan-form]");
    if (!form) return;

    const statusEl = form.querySelector("[data-scan-status]");
    const submitBtn = form.querySelector("[data-scan-submit]");
    const sourceUrlInput = form.querySelector("[data-source-url]");
    if (sourceUrlInput) sourceUrlInput.value = window.location.href;
    const needSelect = form.querySelector('select[name="need"]');
    const requestedNeed = new URLSearchParams(window.location.search).get("need");
    const needLabels = {
      "voice-agent": "AI voice agent / phone support",
      chatbot: "AI chatbot",
      app: "Custom app",
      dashboard: "Dashboard",
      automation: "AI agent / automation",
      website: "Website",
      redesign: "Redesign",
    };
    if (needSelect && requestedNeed && needLabels[requestedNeed]) {
      needSelect.value = needLabels[requestedNeed];
    }

    function setStatus(kind, message) {
      if (!statusEl) return;
      statusEl.className = "form__status form__status--" + kind;
      statusEl.textContent = message;
    }

    function collect() {
      const fd = new FormData(form);
      const payload = {};
      SCAN_FIELDS.forEach((key) => {
        payload[key] = (fd.get(key) || "").toString().trim();
      });
      if (!payload.sourceUrl) payload.sourceUrl = window.location.href;
      return payload;
    }

    function fallbackMailto(payload) {
      const subject = "Free scan request - " + (payload.business || payload.name || "New lead");
      const body = [
        "Name: " + payload.name,
        "Business: " + payload.business,
        "Email: " + payload.email,
        "Phone: " + payload.phone,
        "Link: " + payload.link,
        "Need: " + payload.need,
        "Budget: " + payload.budget,
        "Goal: " + payload.goal,
        "Problem: " + payload.problem,
        "Source: " + payload.sourceUrl,
      ].join("\n");
      const href =
        "mailto:" +
        LEAD_EMAIL +
        "?cc=" +
        encodeURIComponent(LEAD_EMAIL_CC) +
        "&subject=" +
        encodeURIComponent(subject) +
        "&body=" +
        encodeURIComponent(body);
      setStatus(
        "error",
        "We couldn't reach the server - opening your email app so you can send it directly."
      );
      window.location.href = href;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      const payload = collect();
      setStatus("pending", "Sending your request...");
      if (submitBtn) submitBtn.disabled = true;

      try {
        if (await submitScan(payload)) {
          setStatus(
            "success",
            "Thanks! Your scan request is in - we'll reply within one business day."
          );
          track("Lead", { source: "scan-form" });
          form.reset();
          if (sourceUrlInput) sourceUrlInput.value = window.location.href;
        } else {
          fallbackMailto(payload);
        }
      } catch (e) {
        fallbackMailto(payload);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  /* ---- 8. Widget lead bridge ------------------------------------------ */
  // The embedded chat widget fires "symbio:lead" when it captures someone.
  // Deliver those to the same inbox as the scan form (best-effort - the widget
  // has already confirmed to the visitor and fired its own event/callback).
  function mapWidgetLead(lead) {
    const contact = (lead.contact || "").trim();
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
    return {
      name: lead.name || "",
      business: lead.business || "",
      email: isEmail ? contact : "",
      phone: isEmail ? "" : contact,
      link: "",
      need: "AI chatbot / website assistant enquiry",
      budget: "",
      goal: "",
      problem: lead.detail || "",
      sourceUrl: lead.page || window.location.href,
    };
  }

  function initWidgetLeadBridge() {
    window.addEventListener("symbio:lead", (event) => {
      const lead = event.detail;
      if (!lead) return;
      track("WidgetLead");
      const delivery = submitScan(mapWidgetLead(lead));
      if (typeof lead.respond === "function") {
        lead.respond(delivery);
      } else {
        delivery.catch(() => false);
      }
    });
  }

  /* ---- 9. Card motion: 3D tilt + cursor spotlight --------------------- */
  function initCardMotion() {
    if (prefersReducedMotion()) return;
    // Pointer tilt only makes sense with a precise, hovering pointer.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const MAX_TILT = 6; // degrees
    document.querySelectorAll(".grid .card").forEach((card) => {
      card.addEventListener("pointermove", (event) => {
        const rect = card.getBoundingClientRect();
        const px = (event.clientX - rect.left) / rect.width; // 0..1
        const py = (event.clientY - rect.top) / rect.height; // 0..1
        card.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
        card.style.setProperty("--my", (py * 100).toFixed(1) + "%");
        card.style.setProperty("--ry", ((px - 0.5) * 2 * MAX_TILT).toFixed(2) + "deg");
        card.style.setProperty("--rx", (-(py - 0.5) * 2 * MAX_TILT).toFixed(2) + "deg");
      });
      card.addEventListener("pointerleave", () => {
        card.style.setProperty("--rx", "0deg");
        card.style.setProperty("--ry", "0deg");
      });
    });
  }

  /* ---- 10. Product demos ---------------------------------------------- */
  const APP_DEMOS = {
    portal: {
      title: "Client Portal",
      status: "Client request synced",
      body:
        '<div class="app-demo__stat-row"><span><strong>3</strong> active requests</span><span><strong>12m</strong> avg reply</span></div><p>Clients can log in, upload files, check status, and message your team without chasing a text thread.</p><div class="app-demo__activity"><span>New file uploaded</span><b>Founder notified</b></div><div class="app-demo__task-list"><button class="app-demo__task" type="button"><span>Upload received</span><b>Contract.pdf</b></button><button class="app-demo__task" type="button"><span>Client question</span><b>Needs reply</b></button><button class="app-demo__task" type="button"><span>Project stage</span><b>In review</b></button></div><div class="app-demo__timeline"><i></i><i></i><i></i></div><div class="app-demo__tags"><button type="button">Secure intake</button><button type="button">Status tracking</button><button type="button">File notes</button></div>',
    },
    booking: {
      title: "Booking App",
      status: "Calendar hold created",
      body:
        '<div class="app-demo__stat-row"><span><strong>18</strong> open slots</span><span><strong>4</strong> no-shows saved</span></div><p>Visitors choose a service, pick a time, and get routed into a clean follow-up flow.</p><div class="app-demo__activity"><span>Booking confirmed</span><b>SMS reminder queued</b></div><div class="app-demo__schedule"><span>9:30</span><b>Consultation</b><em>Booked</em></div><div class="app-demo__schedule"><span>11:00</span><b>Follow-up</b><em>Reminder</em></div><div class="app-demo__timeline"><i></i><i></i><i></i></div><div class="app-demo__tags"><button type="button">Calendar logic</button><button type="button">Reminders</button><button type="button">No-show control</button></div>',
    },
    ops: {
      title: "Ops Board",
      status: "Team queue refreshed",
      body:
        '<div class="app-demo__stat-row"><span><strong>18</strong> live tasks</span><span><strong>4</strong> owner decisions</span></div><p>Staff can see what is waiting, what is blocked, and what needs a founder decision.</p><div class="app-demo__activity"><span data-ops-active>Priority queue updated</span><b data-ops-status>Daily brief ready</b></div><div class="app-demo__ops-grid"><div class="app-demo__lane"><b>Today</b><span>7 tasks</span><i style="--fill: 82%"></i></div><div class="app-demo__lane"><b>Blocked</b><span>2 issues</span><i style="--fill: 38%"></i></div><div class="app-demo__lane"><b>Waiting</b><span>5 replies</span><i style="--fill: 64%"></i></div></div><div class="app-demo__task-list"><button class="app-demo__task is-hot" type="button"><span>Founder decision</span><b>Approve quote</b></button><button class="app-demo__task" type="button"><span>Team queue</span><b>3 tasks moved</b></button><button class="app-demo__task" type="button"><span>Closeout</span><b>Report sent</b></button></div><div class="app-demo__ops-detail"><span data-ops-kicker>Team queue</span><strong data-ops-title>3 tasks moved into today</strong><p data-ops-copy>Shows what staff should handle first, who owns it, and what can wait.</p></div><div class="app-demo__tags"><button class="is-active" type="button" data-ops-action="queue">Team queue</button><button type="button" data-ops-action="notes">Owner notes</button><button type="button" data-ops-action="closeout">Daily closeout</button></div>',
    },
  };

  const OPS_ACTIONS = {
    queue: {
      active: "Priority queue updated",
      status: "3 tasks assigned",
      kicker: "Team queue",
      title: "3 tasks moved into today",
      copy: "Shows what staff should handle first, who owns it, and what can wait.",
    },
    notes: {
      active: "Owner notes opened",
      status: "Decision brief ready",
      kicker: "Owner notes",
      title: "Quote needs founder approval",
      copy: "Pulls the client request, scope, price note, and next action into one clean decision card.",
    },
    closeout: {
      active: "Daily closeout generated",
      status: "Report ready",
      kicker: "Daily closeout",
      title: "Today summarized in plain English",
      copy: "Shows completed work, blocked items, follow-ups, and what the owner should check tomorrow.",
    },
  };

  const PREMIUM_ROUTES = {
    services: {
      kicker: "24/7 AI intake + booking",
      title: "Premium site. Instant bookings.",
      copy: "Sharp visuals, clear service paths, and a 24/7 assistant that captures real leads.",
      cta: "Book consultation",
      statOne: "4.9",
      labelOne: "client rating",
      statTwo: "38%",
      labelTwo: "more booked calls",
      statThree: "24/7",
      labelThree: "lead capture",
      chat: "Hi, I can help choose a service, answer pricing questions, or book a time.",
      lead: "Lead captured: name, phone, service, best time",
      feed: "Consultation request routed",
      status: "Booking path optimized",
    },
    results: {
      kicker: "Proof above the fold",
      title: "Trust before they scroll.",
      copy: "Reviews, before-and-after proof, and clear next steps make the business feel established fast.",
      cta: "View transformations",
      statOne: "112",
      labelOne: "reviews surfaced",
      statTwo: "2.8x",
      labelTwo: "more CTA taps",
      statThree: "9s",
      labelThree: "first decision",
      chat: "Want proof? I can show recent results, service photos, and the fastest way to book.",
      lead: "Visitor viewed: reviews, gallery, pricing, booking",
      feed: "Review gallery opened",
      status: "Trust proof moved above the fold",
    },
    book: {
      kicker: "Frictionless booking path",
      title: "No phone tag. Just booked.",
      copy: "The visitor picks a service, chooses a time, and gets confirmation before they lose interest.",
      cta: "Reserve a time",
      statOne: "3",
      labelOne: "steps to book",
      statTwo: "0",
      labelTwo: "dead-end forms",
      statThree: "1m",
      labelThree: "confirmation",
      chat: "I can book the next open appointment or route the request to the right team member.",
      lead: "Booking ready: service, time, contact, notes",
      feed: "SMS confirmation queued",
      status: "Follow-up flow connected",
    },
  };

  const DASH_DEMOS = {
    week: {
      leads: "142",
      booked: "38",
      bars: ["52%", "76%", "61%", "88%", "69%"],
      insight: "Best channel: mobile visitors. Biggest fix: shorten the contact form.",
      command: "Call back mobile leads within 10 minutes.",
      status: "Mobile leads rising",
      funnel: ["92%", "68%", "44%"],
    },
    month: {
      leads: "612",
      booked: "171",
      bars: ["44%", "58%", "74%", "82%", "93%"],
      insight: "Strongest page: services. Biggest fix: add proof near pricing.",
      command: "Turn the services page into a booking path.",
      status: "Services page carrying demand",
      funnel: ["88%", "71%", "49%"],
    },
    quarter: {
      leads: "1,840",
      booked: "503",
      bars: ["62%", "71%", "67%", "89%", "95%"],
      insight: "Growth pattern: follow-up speed improved booked calls by 28%.",
      command: "Scale the follow-up flow before adding more ad spend.",
      status: "Follow-up system compounding",
      funnel: ["96%", "76%", "57%"],
    },
  };

  const CONCIERGE_DEMOS = {
    website: {
      user: "Can you help redesign my salon site?",
      answer:
        "Yes. Send the link and we will review mobile flow, trust, booking, and follow-up.",
      cardTitle: "Needs redesign + booking path",
      handoff: "Routed to founder with website link and notes",
      intent: "Website redesign",
      next: "Send site link",
      status: "Lead card ready",
    },
    app: {
      user: "I need clients to log in and upload files.",
      answer:
        "That sounds like a custom portal. We can map the login, upload, notes, and status flow first.",
      cardTitle: "Custom portal + secure file flow",
      handoff: "Routed as custom app scope with portal requirements",
      intent: "Custom portal",
      next: "Map login flow",
      status: "Portal request captured",
    },
    agent: {
      user: "Can an agent follow up with leads?",
      answer:
        "Yes, with human approval gates. It can draft the reply, update the queue, and wait before sending.",
      cardTitle: "Follow-up agent + approval gate",
      handoff: "Routed as automation request with approval gates",
      intent: "AI follow-up agent",
      next: "Define safe actions",
      status: "Automation scope detected",
    },
  };

  function initRedesignDemo() {
    const demo = document.querySelector("[data-redesign-demo]");
    if (!demo) return;
    const range = demo.querySelector("[data-redesign-range]");
    const stage = demo.querySelector("[data-redesign-stage]");
    const handle = demo.querySelector("[data-redesign-handle]");
    if (!range || !stage) return;

    const routeButtons = demo.querySelectorAll("[data-premium-route]");
    const premiumFields = {
      kicker: demo.querySelector("[data-premium-kicker]"),
      title: demo.querySelector("[data-premium-title]"),
      copy: demo.querySelector("[data-premium-copy]"),
      cta: demo.querySelector("[data-premium-cta]"),
      statOne: demo.querySelector("[data-premium-stat-one]"),
      labelOne: demo.querySelector("[data-premium-label-one]"),
      statTwo: demo.querySelector("[data-premium-stat-two]"),
      labelTwo: demo.querySelector("[data-premium-label-two]"),
      statThree: demo.querySelector("[data-premium-stat-three]"),
      labelThree: demo.querySelector("[data-premium-label-three]"),
      chat: demo.querySelector("[data-premium-chat]"),
      lead: demo.querySelector("[data-premium-lead]"),
      feed: demo.querySelector("[data-premium-feed]"),
      status: demo.querySelector("[data-premium-live-status]"),
    };

    function clamp(n, lo, hi) {
      return Math.max(lo, Math.min(hi, n));
    }

    function applyReveal(pct) {
      demo.style.setProperty("--reveal", clamp(pct, 3, 97) + "%");
    }

    function setFromRange() {
      applyReveal(100 - Number(range.value));
    }

    function setFromPct(pct) {
      pct = clamp(pct, 3, 97);
      range.value = String(Math.round(100 - pct));
      applyReveal(pct);
    }

    function pointerPct(event) {
      const rect = stage.getBoundingClientRect();
      return ((event.clientX - rect.left) / rect.width) * 100;
    }

    let dragging = false;
    let userControlled = false;

    function markUserControlled() {
      userControlled = true;
      demo.classList.add("is-dragged", "is-user-controlled");
    }

    function pctFromClientX(clientX) {
      const rect = stage.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    }

    function startDrag(clientX) {
      dragging = true;
      markUserControlled();
      setFromPct(pctFromClientX(clientX));
    }

    stage.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button, a, input, textarea, select")) return;
      event.preventDefault();
      startDrag(event.clientX);
      try {
        stage.setPointerCapture(event.pointerId);
      } catch (e) {
        /* Pointer capture is not available in every browser. */
      }
      setFromPct(pointerPct(event));
    });
    stage.addEventListener("pointermove", (event) => {
      if (dragging) setFromPct(pointerPct(event));
    });
    function endDrag() {
      dragging = false;
    }
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    if (handle) {
      handle.addEventListener("mousedown", (event) => {
        event.preventDefault();
        startDrag(event.clientX);
      });
    }

    document.addEventListener("mousemove", (event) => {
      if (dragging) setFromPct(pctFromClientX(event.clientX));
    });
    document.addEventListener("mouseup", endDrag);

    stage.addEventListener(
      "touchstart",
      (event) => {
        if (event.target.closest("button, a, input, textarea, select")) return;
        if (!event.touches.length) return;
        event.preventDefault();
        startDrag(event.touches[0].clientX);
      },
      { passive: false }
    );
    stage.addEventListener(
      "touchmove",
      (event) => {
        if (!dragging || !event.touches.length) return;
        event.preventDefault();
        setFromPct(pctFromClientX(event.touches[0].clientX));
      },
      { passive: false }
    );
    stage.addEventListener("touchend", endDrag);

    range.addEventListener("pointerdown", markUserControlled);
    range.addEventListener("input", () => {
      markUserControlled();
      setFromRange();
    });

    function setPremiumRoute(route) {
      const data = PREMIUM_ROUTES[route];
      if (!data) return;

      routeButtons.forEach((button) => {
        const active = button.getAttribute("data-premium-route") === route;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-current", active ? "true" : "false");
      });

      Object.entries(data).forEach(([key, value]) => {
        if (premiumFields[key]) premiumFields[key].textContent = value;
      });

      demo.classList.remove("is-premium-changing");
      window.requestAnimationFrame(() => {
        demo.classList.add("is-premium-changing");
      });

      if (!userControlled && Number(range.value) < 70) setFromPct(18);
    }

    routeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        markUserControlled();
        setPremiumRoute(button.getAttribute("data-premium-route"));
      });
    });

    setFromPct(window.matchMedia("(max-width: 720px)").matches ? 18 : 34);

    if (!prefersReducedMotion() && window.matchMedia("(hover: hover)").matches) {
      onFirstView(demo, () => {
        const base = 34;
        const peak = 56;
        const start = performance.now();
        function frame(now) {
          if (demo.classList.contains("is-dragged") || demo.classList.contains("is-user-controlled")) return;
          const p = Math.min(1, (now - start) / 1100);
          const wave = Math.sin(p * Math.PI);
          const value = base + (peak - base) * wave;
          applyReveal(value);
          range.value = String(Math.round(100 - value));
          if (p < 1) window.requestAnimationFrame(frame);
        }
        window.requestAnimationFrame(frame);
      });
    }
  }

  function initAppDemo() {
    const demo = document.querySelector("[data-app-demo]");
    if (!demo) return;

    const title = demo.querySelector("[data-app-title]");
    const body = demo.querySelector("[data-app-body]");
    const status = demo.querySelector("[data-app-status]");
    const buttons = demo.querySelectorAll("[data-app-view]");
    if (!title || !body || !buttons.length) return;

    let userInteracted = false;

    function setAppView(button, userInitiated) {
      if (userInitiated) userInteracted = true;
        const data = APP_DEMOS[button.getAttribute("data-app-view")];
        if (!data) return;
        buttons.forEach((btn) => btn.classList.toggle("is-active", btn === button));
        title.textContent = data.title;
        if (status) status.textContent = data.status;
        body.innerHTML = data.body;
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        setAppView(button, true);
      });
    });

    body.addEventListener("click", (event) => {
      const action = event.target.closest("[data-ops-action]");
      if (!action) return;
      const data = OPS_ACTIONS[action.getAttribute("data-ops-action")];
      if (!data) return;
      userInteracted = true;

      body.querySelectorAll("[data-ops-action]").forEach((button) => {
        button.classList.toggle("is-active", button === action);
      });

      const active = body.querySelector("[data-ops-active]");
      const opStatus = body.querySelector("[data-ops-status]");
      const kicker = body.querySelector("[data-ops-kicker]");
      const detailTitle = body.querySelector("[data-ops-title]");
      const copy = body.querySelector("[data-ops-copy]");
      if (active) active.textContent = data.active;
      if (opStatus) opStatus.textContent = data.status;
      if (kicker) kicker.textContent = data.kicker;
      if (detailTitle) detailTitle.textContent = data.title;
      if (copy) copy.textContent = data.copy;
      demo.classList.remove("is-app-updating");
      window.requestAnimationFrame(() => demo.classList.add("is-app-updating"));
    });

    if (!prefersReducedMotion()) {
      let index = 0;
      const views = Array.from(buttons);
      onFirstView(demo, () => {
        window.setInterval(() => {
          if (document.hidden || demo.matches(":hover") || userInteracted) return;
          index = (index + 1) % views.length;
          setAppView(views[index], false);
        }, 4800);
      });
    }
  }

  function initDashboardDemo() {
    const demo = document.querySelector("[data-dashboard-demo]");
    if (!demo) return;

    const leads = demo.querySelector("[data-dashboard-leads]");
    const booked = demo.querySelector("[data-dashboard-booked]");
    const insight = demo.querySelector("[data-dashboard-insight]");
    const command = demo.querySelector("[data-dashboard-command]");
    const status = demo.querySelector("[data-dashboard-status]");
    const funnel = demo.querySelectorAll(".dash-demo__funnel i");
    const bars = demo.querySelectorAll(".dash-demo__bars i");
    const buttons = demo.querySelectorAll("[data-dashboard-range]");
    if (!leads || !booked || !insight || !command || !bars.length || !buttons.length) return;

    let userInteracted = false;

    function setDashboardRange(button, userInitiated) {
      if (userInitiated) userInteracted = true;
        const data = DASH_DEMOS[button.getAttribute("data-dashboard-range")];
        if (!data) return;
        buttons.forEach((btn) => btn.classList.toggle("is-active", btn === button));
        leads.textContent = data.leads;
        booked.textContent = data.booked;
        insight.textContent = data.insight;
        command.textContent = data.command;
        if (status) status.textContent = data.status;
        bars.forEach((bar, index) => {
          bar.style.setProperty("--h", data.bars[index] || data.bars[data.bars.length - 1]);
        });
        funnel.forEach((bar, index) => {
          bar.style.setProperty("--w", data.funnel[index] || data.funnel[data.funnel.length - 1]);
        });
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        setDashboardRange(button, true);
      });
    });

    if (!prefersReducedMotion()) {
      let index = 0;
      const ranges = Array.from(buttons);
      onFirstView(demo, () => {
        window.setInterval(() => {
          if (document.hidden || demo.matches(":hover") || userInteracted) return;
          index = (index + 1) % ranges.length;
          setDashboardRange(ranges[index], false);
        }, 5200);
      });
    }
  }

  function initConciergeDemo() {
    const demo = document.querySelector("[data-concierge-demo]");
    if (!demo) return;

    const user = demo.querySelector("[data-concierge-user]");
    const answer = demo.querySelector("[data-concierge-answer]");
    const cardTitle = demo.querySelector("[data-concierge-card-title]");
    const handoff = demo.querySelector("[data-concierge-handoff]");
    const intent = demo.querySelector("[data-concierge-intent]");
    const next = demo.querySelector("[data-concierge-next]");
    const status = demo.querySelector("[data-concierge-status]");
    const buttons = demo.querySelectorAll("[data-concierge-prompt]");
    if (!user || !answer || !buttons.length) return;

    let typingTimers = [];
    let userInteracted = false;

    function clearTypingTimers() {
      typingTimers.forEach((timer) => window.clearTimeout(timer));
      typingTimers = [];
    }

    function typeText(node, text, delay, done) {
      if (!node) return;
      node.textContent = "";
      node.classList.add("is-typing");
      const safeText = String(text);
      for (let i = 0; i <= safeText.length; i += 1) {
        typingTimers.push(
          window.setTimeout(() => {
            node.textContent = safeText.slice(0, i);
            if (i === safeText.length) {
              node.classList.remove("is-typing");
              if (done) done();
            }
          }, delay + i * 18)
        );
      }
    }

    function showConversation(data) {
      clearTypingTimers();
      typeText(user, data.user, 0, () => {
        typeText(answer, data.answer, 220);
      });
      if (cardTitle) cardTitle.textContent = data.cardTitle;
      if (handoff) handoff.textContent = data.handoff;
      if (intent) intent.textContent = data.intent;
      if (next) next.textContent = data.next;
      if (status) status.textContent = data.status;
      demo.classList.remove("is-chat-typing");
      window.requestAnimationFrame(() => demo.classList.add("is-chat-typing"));
    }

    function selectConversation(button, userInitiated) {
      if (userInitiated) userInteracted = true;
        const data = CONCIERGE_DEMOS[button.getAttribute("data-concierge-prompt")];
        if (!data) return;
        buttons.forEach((btn) => btn.classList.toggle("is-active", btn === button));
        showConversation(data);
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        selectConversation(button, true);
      });
    });

    if (!prefersReducedMotion()) {
      let index = 0;
      const prompts = Array.from(buttons);
      onFirstView(demo, () => {
        window.setInterval(() => {
          if (document.hidden || demo.matches(":hover") || userInteracted) return;
          index = (index + 1) % prompts.length;
          selectConversation(prompts[index], false);
        }, 5600);
      });
    }
  }

  function initWorkflowDemo() {
    const demo = document.querySelector("[data-workflow-demo]");
    if (!demo) return;

    const run = demo.querySelector("[data-workflow-run]");
    const status = demo.querySelector("[data-workflow-status]");
    const log = demo.querySelector("[data-workflow-log]");
    const steps = Array.from(demo.querySelectorAll(".workflow-demo__steps li"));
    const nodes = Array.from(demo.querySelectorAll(".workflow-demo__node"));
    if (!run || !steps.length || !nodes.length) return;

    let timers = [];
    const logs = [
      "Lead received from website form. Creating clean record.",
      "Drafting reply with project notes and founder handoff.",
      "Updating queue, tags, and follow-up reminder.",
      "Approval required before anything is sent."
    ];
    const statuses = [
      "Lead captured",
      "Reply drafted",
      "Queue updated",
      "Waiting for approval"
    ];
    function clearTimers() {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
    }

    run.addEventListener("click", () => {
      clearTimers();
      run.disabled = true;
      demo.classList.add("is-running");
      steps.forEach((step) => step.classList.remove("is-active"));
      nodes.forEach((node) => node.classList.remove("is-active"));

      steps.forEach((step, index) => {
        const timer = window.setTimeout(() => {
          steps.forEach((item) => item.classList.remove("is-active"));
          nodes.forEach((node) => node.classList.remove("is-active"));
          step.classList.add("is-active");
          if (nodes[index]) nodes[index].classList.add("is-active");
          if (status) status.textContent = statuses[index] || "Workflow running";
          if (log) log.textContent = logs[index] || "Workflow running.";
          if (index === steps.length - 1) {
            run.disabled = false;
            demo.classList.remove("is-running");
          }
        }, index * 520);
        timers.push(timer);
      });
    });
  }

  function initProductDemos() {
    initRedesignDemo();
    initAppDemo();
    initDashboardDemo();
    initConciergeDemo();
    initWorkflowDemo();
    initDemoNav();
  }

  function initDemoNav() {
    const nav = document.querySelector("[data-demo-nav]");
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll("[data-demo-link]"));
    const pairs = links
      .map((link) => {
        const id = (link.getAttribute("href") || "").slice(1);
        const section = id && document.getElementById(id);
        return section ? { link, section } : null;
      })
      .filter(Boolean);
    if (!pairs.length) return;

    function setCurrent() {
      const targetY = window.innerHeight * 0.42;
      let best = pairs[0];
      let bestDistance = Infinity;
      pairs.forEach((pair) => {
        const rect = pair.section.getBoundingClientRect();
        const center = rect.top + Math.min(rect.height, window.innerHeight * 0.82) / 2;
        const distance = Math.abs(center - targetY);
        if (distance < bestDistance) {
          best = pair;
          bestDistance = distance;
        }
      });
      links.forEach((link) => link.classList.toggle("is-current", link === best.link));
    }

    let ticking = false;
    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          setCurrent();
          ticking = false;
        });
      },
      { passive: true }
    );
    window.addEventListener("resize", setCurrent);
    setCurrent();
  }

  function initCheckoutPage() {
    const checkout = document.querySelector("[data-checkout-page]");
    if (!checkout) return;

    const offers = checkout.querySelectorAll("[data-checkout-offer]");
    const title = checkout.querySelector("[data-checkout-title]");
    const price = checkout.querySelector("[data-checkout-price]");
    const deposit = checkout.querySelector("[data-checkout-deposit]");
    const turnaround = checkout.querySelector("[data-checkout-turnaround]");
    const summary = checkout.querySelector("[data-checkout-summary]");
    const ongoing = checkout.querySelector("[data-checkout-ongoing]");
    const includes = checkout.querySelector("[data-checkout-includes]");
    const careLink = checkout.querySelector("[data-checkout-care]");
    const checkoutLink = checkout.querySelector(".checkout-actions .btn--primary");
    if (!offers.length) return;

    function mailtoFor(offerTitle, ongoingCost) {
      const subject = encodeURIComponent("Symbio AI secure checkout request");
      const body = encodeURIComponent(
        `Hi Symbio AI,\n\nI want to start a secure checkout for: ${offerTitle}\nOngoing terms shown at checkout: ${ongoingCost || "None listed"}\n\nMy business name:\nMy website or social link:\nBest phone number:\n`
      );
      return `mailto:contact@symbioai.dev?subject=${subject}&body=${body}`;
    }

    function renderIncludes(value) {
      if (!includes) return;
      includes.textContent = "";
      String(value || "")
        .split("||")
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => {
          const li = document.createElement("li");
          li.textContent = item;
          includes.appendChild(li);
        });
    }

    function activateOffer(offer, updateUrl) {
      offers.forEach((item) => item.classList.toggle("is-active", item === offer));
      const data = offer.dataset;
      if (title) title.textContent = data.title || "";
      if (price) price.textContent = data.price || "";
      if (deposit) deposit.textContent = data.deposit || "";
      if (turnaround) turnaround.textContent = data.turnaround || "";
      if (summary) summary.textContent = data.summary || "";
      if (ongoing) ongoing.textContent = data.ongoing || "No recurring cost listed.";
      renderIncludes(data.includes);
      if (careLink) careLink.hidden = data.websiteCare !== "true";
      if (checkoutLink) {
        checkoutLink.href = mailtoFor(data.title || "Symbio AI build", data.ongoing);
      }
      checkout.classList.remove("is-checkout-changing");
      window.requestAnimationFrame(() => checkout.classList.add("is-checkout-changing"));

      if (updateUrl && data.key && window.history?.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.set("offer", data.key);
        window.history.replaceState({}, "", url);
      }
    }

    offers.forEach((offer) => {
      offer.addEventListener("click", () => {
        activateOffer(offer, true);
      });
    });

    const requestedKey = new URLSearchParams(window.location.search).get("offer");
    const requestedOffer = requestedKey
      ? Array.from(offers).find((offer) => offer.dataset.key === requestedKey)
      : null;
    activateOffer(requestedOffer || offers[0], false);
  }

  // On buy.html, package buttons without a Stripe checkout link point at the
  // intake form (#intake). When one is clicked, pre-select that package so the
  // visitor doesn't have to choose again. Guarded - no-op on every other page.
  function initBuyButtons() {
    const select = document.querySelector("[data-intake-package]");
    if (!select) return;

    document.querySelectorAll("[data-buy-package]").forEach((btn) => {
      // Only the fallback buttons (href="#intake") need prefilling; real
      // Stripe checkout links navigate away and are left alone.
      if ((btn.getAttribute("href") || "").charAt(0) !== "#") return;
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-buy-package");
        if (name) select.value = name; // option text doubles as its value
      });
    });
  }

  /* ---- 11. Instant teardown (teardown.html) --------------------------- */
  // Posts a URL to the deployed scan Worker and renders the findings live.
  // If no endpoint is configured (data-scan-api empty), falls back to the human
  // free-scan form. Guarded - no-op on every other page.
  function initTeardown() {
    const form = document.querySelector("[data-teardown-form]");
    if (!form) return;

    const api = (form.getAttribute("data-scan-api") || "").replace(/\/+$/, "");
    const statusEl = form.querySelector("[data-teardown-status]");
    const submitBtn = form.querySelector("[data-teardown-submit]");
    const results = document.querySelector("[data-teardown-results]");
    const list = document.querySelector("[data-teardown-list]");
    const titleEl = document.querySelector("[data-teardown-title]");

    function setStatus(kind, msg) {
      if (!statusEl) return;
      statusEl.className = "form__status form__status--" + kind;
      statusEl.textContent = msg;
    }

    function renderResults(data) {
      if (!results || !list) return;
      list.textContent = "";
      (data.findings || []).forEach((f) => {
        const card = document.createElement("article");
        card.className = "card";
        const h = document.createElement("h3");
        h.className = "card__title";
        h.textContent = f.title;
        const p = document.createElement("p");
        p.className = "card__text";
        p.textContent = "Fix: " + f.fix;
        card.appendChild(h);
        card.appendChild(p);
        list.appendChild(card);
      });
      if (titleEl) {
        titleEl.textContent = data.reachable
          ? "Top fixes - site score " + data.score + "/100"
          : "We couldn't reach that site - here's where we'd start";
      }
      results.hidden = false;
      results.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const urlInput = form.querySelector('[name="url"]');
      const url = urlInput ? urlInput.value.trim() : "";

      // No backend configured yet -> hand off to the human free-scan form.
      if (!api) {
        window.location.href = "scan.html";
        return;
      }

      setStatus("pending", "Scanning your site...");
      if (submitBtn) submitBtn.disabled = true;
      try {
        const res = await fetch(api + "/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || "scan failed");
        renderResults(data);
        track("Teardown", { reachable: !!data.reachable });
        setStatus("success", "Done - here's what we found.");
      } catch (e) {
        setStatus("error", "Couldn't scan that automatically - try the free scan form below.");
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });
  }

  /* ---- 12. Scripted voice-agent preview ------------------------------ */
  const VOICE_SCENARIOS = {
    restaurant: {
      title: "Restaurant order",
      outcome: "Order ready for confirmation",
      detail:
        "The business receives the items, pickup timing, customer name, contact, and a clear confirmation step.",
      facts: ["Order intent identified", "Items and timing structured", "Staff confirmation assigned"],
      steps: [
        {
          speaker: "Caller",
          text: "Can I place a pickup order for tonight?",
          status: "Caller request",
        },
        {
          speaker: "Voice agent",
          text: "Absolutely. I will collect the order and pickup details, then confirm the next step.",
          status: "Intent understood",
        },
        {
          speaker: "Caller",
          text: "One large pepperoni pizza and garlic knots, under Maya.",
          status: "Details captured",
        },
        {
          speaker: "Voice agent",
          text: "I have the items and name. What pickup time and callback number should I use?",
          status: "Confirmation requested",
        },
        {
          speaker: "System",
          text: "Order details structured and sent to the restaurant for confirmation.",
          status: "Call complete",
        },
      ],
    },
    construction: {
      title: "Estimate request",
      outcome: "Urgent estimate lead routed",
      detail:
        "The team receives the job type, location, urgency, caller details, and the reason it needs priority follow-up.",
      facts: ["Job and location captured", "Urgency identified", "Priority callback assigned"],
      steps: [
        {
          speaker: "Caller",
          text: "I need someone to look at my roof in south Charlotte.",
          status: "Caller request",
        },
        {
          speaker: "Voice agent",
          text: "I can help with the estimate request. Is there active damage or a leak right now?",
          status: "Lead qualification",
        },
        {
          speaker: "Caller",
          text: "There is a leak near the upstairs window after last night's storm.",
          status: "Urgency detected",
        },
        {
          speaker: "Voice agent",
          text: "I will flag this for priority follow-up. May I collect the address and callback number?",
          status: "Handoff prepared",
        },
        {
          speaker: "System",
          text: "Urgent estimate summary routed to the team with the caller's context.",
          status: "Call complete",
        },
      ],
    },
    appointment: {
      title: "Appointment change",
      outcome: "Reschedule request prepared",
      detail:
        "The business receives the original appointment, requested window, caller contact, and the confirmation still needed.",
      facts: ["Appointment identified", "New window captured", "Confirmation step assigned"],
      steps: [
        {
          speaker: "Caller",
          text: "I need to move my appointment tomorrow afternoon.",
          status: "Caller request",
        },
        {
          speaker: "Voice agent",
          text: "I can collect the change request. What name is the appointment under?",
          status: "Appointment lookup",
        },
        {
          speaker: "Caller",
          text: "Jordan Lee. Friday morning would work better if anything is available.",
          status: "Preference captured",
        },
        {
          speaker: "Voice agent",
          text: "I will send the Friday-morning preference to the scheduling team for confirmation.",
          status: "Next step explained",
        },
        {
          speaker: "System",
          text: "Reschedule request summarized and assigned to scheduling.",
          status: "Call complete",
        },
      ],
    },
  };

  function initVoicePreview() {
    const preview = document.querySelector("[data-voice-preview]");
    if (!preview) return;

    const timeline = preview.querySelector("[data-voice-timeline]");
    const title = preview.querySelector("[data-voice-title]");
    const status = preview.querySelector("[data-voice-status]");
    const next = preview.querySelector("[data-voice-next]");
    const restart = preview.querySelector("[data-voice-restart]");
    const outcome = preview.querySelector("[data-voice-outcome]");
    const outcomeDetail = preview.querySelector("[data-voice-outcome-detail]");
    const facts = preview.querySelector("[data-voice-facts]");
    const scenarioButtons = preview.querySelectorAll("[data-voice-scenario]");

    if (
      !timeline ||
      !title ||
      !status ||
      !next ||
      !restart ||
      !outcome ||
      !outcomeDetail ||
      !facts ||
      !scenarioButtons.length
    ) {
      return;
    }

    let scenarioKey = "restaurant";
    let stepIndex = 0;

    function buildStep(step, index, activeIndex) {
      const item = document.createElement("li");
      item.className =
        "voice-timeline__step " +
        (index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : "");

      const marker = document.createElement("span");
      marker.className = "voice-timeline__marker";
      marker.textContent = String(index + 1).padStart(2, "0");

      const body = document.createElement("div");
      const speaker = document.createElement("span");
      speaker.className = "voice-timeline__speaker";
      speaker.textContent = step.speaker;

      const stepText = document.createElement("p");
      stepText.textContent = step.text;

      body.append(speaker, stepText);
      item.append(marker, body);
      return item;
    }

    function renderFacts(items) {
      facts.textContent = "";
      items.forEach((fact) => {
        const item = document.createElement("li");
        item.textContent = fact;
        facts.appendChild(item);
      });
    }

    function render() {
      const scenario = VOICE_SCENARIOS[scenarioKey];
      const complete = stepIndex === scenario.steps.length - 1;

      title.textContent = scenario.title;
      status.textContent = scenario.steps[stepIndex].status;
      timeline.textContent = "";
      scenario.steps.slice(0, stepIndex + 1).forEach((step, index) => {
        timeline.appendChild(buildStep(step, index, stepIndex));
      });

      outcome.textContent = complete ? scenario.outcome : "Waiting for the call flow";
      outcomeDetail.textContent = complete
        ? scenario.detail
        : "Advance the preview to see what the business receives.";
      renderFacts(scenario.facts);

      next.disabled = complete;
      next.textContent = complete ? "Flow complete" : "Next call step";

      scenarioButtons.forEach((button) => {
        const active = button.getAttribute("data-voice-scenario") === scenarioKey;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }

    scenarioButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const nextScenario = button.getAttribute("data-voice-scenario");
        if (!VOICE_SCENARIOS[nextScenario]) return;
        scenarioKey = nextScenario;
        stepIndex = 0;
        render();
      });
    });

    next.addEventListener("click", () => {
      const lastIndex = VOICE_SCENARIOS[scenarioKey].steps.length - 1;
      stepIndex = Math.min(stepIndex + 1, lastIndex);
      render();
    });

    restart.addEventListener("click", () => {
      stepIndex = 0;
      render();
    });

    render();
  }

  /* ---- 13. Conversion tracking --------------------------------------- */
  // One delegated listener turns checkout/package clicks into analytics events.
  // Works with whatever analytics is loaded (Plausible if configured); silent otherwise.
  function initTracking() {
    document.addEventListener("click", (event) => {
      const t = event.target;
      if (!t || !t.closest) return;
      const stripe = t.closest('a[href*="buy.stripe.com"]');
      if (stripe) {
        track("CheckoutClick", { href: stripe.getAttribute("href") });
        return;
      }
      const pkg = t.closest("[data-buy-package]");
      if (pkg) track("PackageClick", { package: pkg.getAttribute("data-buy-package") });
    });
  }

  /* ---- Init ------------------------------------------------------------ */
  function init() {
    initTheme();
    initMenu();
    initReveals();
    initRotator();
    initInbox();
    initScanForm();
    initWidgetLeadBridge();
    initCardMotion();
    initProductDemos();
    initCheckoutPage();
    initBuyButtons();
    initTeardown();
    initVoicePreview();
    initTracking();
    // Tell the pre-paint safety net that we ran, so it won't unhide reveals.
    window.__symbioReady = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
