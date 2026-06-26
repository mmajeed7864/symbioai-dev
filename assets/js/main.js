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
   Each feature is guarded by element checks, so the file is safe on any page.
   ========================================================================= */
(function () {
  "use strict";

  /* ---- 1. Helpers ------------------------------------------------------ */
  const root = document.documentElement;

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
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
    const PERIOD = 3200;
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
    for (let s = 0; s < 3; s += 1) {
      const data = SAMPLE_LEADS[s];
      const li = buildLeadEl(data);
      resolveLead(li, data);
      list.appendChild(li);
    }
    index = 3;

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
  ];
  const LEAD_EMAIL = "symbioaiiii@gmail.com";
  const LEAD_EMAIL_CC = "";
  const PERMANENT_SCAN_ENDPOINT = "/api/free-scan";
  const EMERGENCY_SCAN_ENDPOINT =
    "https://reserved-participating-hospital-solution.trycloudflare.com/api/free-scan";

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
    else endpoints.push(PERMANENT_SCAN_ENDPOINT, EMERGENCY_SCAN_ENDPOINT);
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
      need: "Chat assistant enquiry",
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
      submitScan(mapWidgetLead(lead)).catch(() => {
        /* best-effort; nothing else to do on the marketing pages */
      });
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
    // Tell the pre-paint safety net that we ran, so it won't unhide reveals.
    window.__symbioReady = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
