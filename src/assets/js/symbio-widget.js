/* =========================================================================
   Symbio Widget - an embeddable chat + lead-capture assistant.

   Drop onto ANY website with a single tag. No framework or build step.
   The fallback answers need no AI backend; confirmed lead delivery requires
   a leadEndpoint, onLead callback, or symbio:lead responder. Renders inside a
   Shadow DOM so the host page's CSS can't break it and its styles can't leak out.

   Setup (either works; data-* wins over window.SymbioConfig):
     <script>
       window.SymbioConfig = {
         businessName: "Glow Salon",
         accent: "#1f6bff",
         services: ["Haircut", "Color", "Beard trim"],
         hours: "Tue-Sat, 9am-6pm",
         location: "Oakland, CA",
          phone: "510-555-0100",
          price: "From $35",
          contactLabel: "Contact the team",
          primaryContactName: "",
          secondaryContactName: "",
          scanMessage: "",            // optional: enables a "Free scan" quick action
          voiceMessage: "",           // optional: enables a "Voice agent" quick action
          pricingMessage: "",         // optional: overrides the derived pricing answer
          timelineMessage: "",        // optional: custom timing answer
          examplesMessage: "",        // optional: custom portfolio/demo answer
          assistantInstructions: "",  // optional: extra facts for an AI endpoint
          position: "right",          // "right" | "left"
          leadEndpoint: "",           // optional: POST {name,contact,detail,business,page,at}
          aiEndpoint: "",             // optional: POST {messages,system} -> {reply}
         onLead: function (lead) {}  // optional callback
       };
     </script>
     <script src="symbio-widget.js" defer></script>

   Or, quick setup via attributes:
     <script src="symbio-widget.js"
             data-business-name="Glow Salon"
             data-accent="#e0457b"
             data-services="Haircut, Color, Beard trim"
             data-hours="Tue-Sat, 9am-6pm"
             data-phone="510-555-0100" defer></script>

   Every captured lead fires a window "symbio:lead" event (event.detail = lead)
   and calls config.onLead(lead). Public API:
     window.SymbioWidget.open();
     window.SymbioWidget.close();
     window.SymbioWidget.toggle();
     window.SymbioWidget.configure({ businessName, accent, services, ... });
   ========================================================================= */
(function () {
  "use strict";

  if (window.SymbioWidget && window.SymbioWidget.__loaded) return;

  /* ---- Config resolution (runs at load so document.currentScript works) - */
  function resolveConfig() {
    let script = document.currentScript;
    if (!script) {
      const guesses = document.querySelectorAll(
        'script[data-symbio-widget], script[src*="symbio-widget"]'
      );
      script = guesses[guesses.length - 1] || null;
    }
    const attr = (name) =>
      script && script.hasAttribute("data-" + name) ? script.getAttribute("data-" + name) : null;
    const toList = (value) => {
      if (Array.isArray(value)) return value.slice();
      if (typeof value === "string") {
        return value
          .split(/[,|]/)
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return null;
    };
    const user = window.SymbioConfig || {};
    const theme = (attr("theme") || user.theme || "auto").toLowerCase();
    return {
      businessName: attr("business-name") || user.businessName || "Our Business",
      accent: attr("accent") || user.accent || "#1f6bff",
      services: toList(attr("services")) ||
        toList(user.services) || ["General enquiry", "Pricing", "Booking"],
      hours: attr("hours") || user.hours || "Mon-Fri, 9am-5pm",
      location: attr("location") || user.location || "",
      phone: attr("phone") || user.phone || "",
      secondaryPhone: attr("secondary-phone") || user.secondaryPhone || "",
      email: attr("email") || user.email || "",
      price: attr("price") || user.price || "",
      contactLabel: attr("contact-label") || user.contactLabel || "Contact the team",
      primaryContactName:
        attr("primary-contact-name") || user.primaryContactName || "",
      secondaryContactName:
        attr("secondary-contact-name") || user.secondaryContactName || "",
      scanMessage: attr("scan-message") || user.scanMessage || "",
      voiceMessage: attr("voice-message") || user.voiceMessage || "",
      pricingMessage: attr("pricing-message") || user.pricingMessage || "",
      timelineMessage: attr("timeline-message") || user.timelineMessage || "",
      examplesMessage: attr("examples-message") || user.examplesMessage || "",
      assistantInstructions:
        attr("assistant-instructions") || user.assistantInstructions || "",
      position:
        (attr("position") || user.position || "right").toLowerCase() === "left" ? "left" : "right",
      // "auto" follows the visitor's OS; "light" / "dark" force the widget theme.
      theme: theme === "light" || theme === "dark" ? theme : "auto",
      greeting: attr("greeting") || user.greeting || "",
      leadEndpoint: attr("lead-endpoint") || user.leadEndpoint || "",
      aiEndpoint: attr("ai-endpoint") || user.aiEndpoint || "",
      aiTimeoutMs: Math.max(1000, Number(user.aiTimeoutMs) || 12000),
      leadTimeoutMs: Math.max(1000, Number(user.leadTimeoutMs) || 10000),
      maxInputLength: Math.max(100, Number(user.maxInputLength) || 600),
      onLead: typeof user.onLead === "function" ? user.onLead : null,
    };
  }

  const cfg = resolveConfig();

  /* ---- State ----------------------------------------------------------- */
  let isOpen = false;
  let mounted = false;
  let shadow = null;
  const el = {};
  const history = [];
  let lead = { step: null, name: "", contact: "", detail: "" };

  /* ---- Small helpers --------------------------------------------------- */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function firstName(name) {
    return String(name).trim().split(/\s+/)[0] || "there";
  }

  function contactLine() {
    const phones = [];
    if (cfg.phone) {
      phones.push((cfg.primaryContactName ? cfg.primaryContactName + " at " : "") + cfg.phone);
    }
    if (cfg.secondaryPhone) {
      phones.push(
        (cfg.secondaryContactName ? cfg.secondaryContactName + " at " : "") + cfg.secondaryPhone
      );
    }
    const phoneLine = phones.length ? "Call or text " + phones.join(" or ") + "." : "";
    const emailLine = cfg.email ? "Email " + cfg.email + "." : "";
    return [phoneLine, emailLine].filter(Boolean).join(" ") || "Leave your details here and we will follow up.";
  }

  function serviceAreaLine() {
    return cfg.location ? "Service area: " + cfg.location : "Ask the team about the service area.";
  }

  function listServices() {
    const items = cfg.services.filter(Boolean);
    if (!items.length) return "general enquiries";
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function looksLikeContact(text) {
    const t = String(text);
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.trim());
    const phone = t.replace(/[^0-9]/g, "").length >= 7;
    return email || phone;
  }

  function defaultGreeting() {
    return (
      cfg.greeting ||
      "Hey, this is " +
        cfg.businessName +
        ". How can we help today?"
    );
  }

  async function postJson(url, body, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = window.setTimeout(() => controller?.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  /* ---- Shadow DOM styles ---------------------------------------------- */
  function styles() {
    return `
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .root {
        --sa: ${cfg.accent};
        --bg: #ffffff;
        --bg-2: #f3f5f9;
        --text: #0c1322;
        --muted: #5a6477;
        --border: rgba(12,19,34,0.12);
        --shadow: 0 24px 60px -18px rgba(12,19,34,0.35);
        position: fixed;
        bottom: max(20px, env(safe-area-inset-bottom));
        ${cfg.position}: max(20px, env(safe-area-inset-${cfg.position}));
        z-index: 2147483000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica,
          Arial, sans-serif;
        font-size: 15px;
        line-height: 1.5;
        color: var(--text);
      }
      /* Dark tokens: forced via data-theme="dark", or the OS preference when "auto". */
      .root[data-theme="dark"] {
        --bg: #131a27;
        --bg-2: #1b2433;
        --text: #eef2fb;
        --muted: #a3afc6;
        --border: rgba(255,255,255,0.12);
        --shadow: 0 24px 60px -18px rgba(0,0,0,0.7);
      }
      @media (prefers-color-scheme: dark) {
        .root[data-theme="auto"] {
          --bg: #131a27;
          --bg-2: #1b2433;
          --text: #eef2fb;
          --muted: #a3afc6;
          --border: rgba(255,255,255,0.12);
          --shadow: 0 24px 60px -18px rgba(0,0,0,0.7);
        }
      }
      .launcher {
        appearance: none;
        border: 0;
        cursor: pointer;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: var(--sa);
        background: linear-gradient(135deg, var(--sa), color-mix(in srgb, var(--sa), #000 16%));
        color: #fff;
        box-shadow: var(--shadow);
        display: grid;
        place-items: center;
        transition: transform 0.18s ease, opacity 0.18s ease;
      }
      .launcher:hover { transform: translateY(-2px) scale(1.04); }
      .launcher svg { width: 28px; height: 28px; }
      .launcher:focus-visible { outline: 3px solid var(--sa); outline-offset: 3px; }
      .root.is-open .launcher { transform: scale(0.9); opacity: 0; pointer-events: none; }

      .panel {
        position: absolute;
        bottom: 0;
        ${cfg.position}: 0;
        width: 370px;
        max-width: calc(100vw - 32px);
        height: 560px;
        max-height: calc(100vh - 40px);
        max-height: calc(100dvh - 40px);
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: var(--shadow);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transform: translateY(16px) scale(0.98);
        transform-origin: bottom ${cfg.position};
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
      }
      .root.is-open .panel { opacity: 1; transform: none; pointer-events: auto; }

      .header {
        background: var(--sa);
        background: linear-gradient(135deg, var(--sa), color-mix(in srgb, var(--sa), #000 16%));
        color: #fff;
        padding: 16px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .avatar {
        width: 38px; height: 38px; border-radius: 50%;
        background: rgba(255,255,255,0.22);
        display: grid; place-items: center; font-weight: 700; flex: none;
      }
      .htext { flex: 1; min-width: 0; }
      .hname { font-weight: 700; font-size: 15px; }
      .hsub { font-size: 12px; opacity: 0.9; display: flex; align-items: center; gap: 6px; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #57e08a; }
      .close {
        appearance: none; border: 0; cursor: pointer;
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(255,255,255,0.18); color: #fff;
        display: grid; place-items: center; flex: none;
      }
      .close:hover { background: rgba(255,255,255,0.3); }
      .close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

      .messages {
        flex: 1; overflow-y: auto; padding: 16px;
        display: flex; flex-direction: column; gap: 10px;
        background: var(--bg-2);
      }
      .msg { max-width: 84%; padding: 10px 13px; border-radius: 14px; white-space: pre-wrap;
        word-wrap: break-word; }
      .msg--bot { align-self: flex-start; background: var(--bg);
        border: 1px solid var(--border); border-bottom-left-radius: 4px; }
      .msg--user { align-self: flex-end; color: #fff;
        background: var(--sa);
        background: linear-gradient(135deg, var(--sa), color-mix(in srgb, var(--sa), #000 16%));
        border-bottom-right-radius: 4px; }
      .typing { display: inline-flex; gap: 4px; align-items: center; }
      .typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted);
        animation: sb-typing 1.2s infinite ease-in-out; }
      .typing span:nth-child(2) { animation-delay: 0.15s; }
      .typing span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes sb-typing { 0%,60%,100% { opacity: 0.3; transform: translateY(0); }
        30% { opacity: 1; transform: translateY(-3px); } }

      .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 16px 6px; background: var(--bg-2); }
      .chip {
        appearance: none; cursor: pointer; font: inherit; font-size: 13px;
        padding: 7px 12px; border-radius: 999px;
        border: 1px solid var(--sa); color: var(--sa); background: transparent;
        transition: background 0.15s ease, color 0.15s ease;
      }
      .chip:hover { background: var(--sa); color: #fff; }
      .chip:focus-visible { outline: 2px solid var(--sa); outline-offset: 2px; }

      .composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid var(--border);
        background: var(--bg); }
      .input {
        flex: 1; font: inherit; font-size: 14px; padding: 11px 14px;
        border: 1px solid var(--border); border-radius: 999px;
        background: var(--bg-2); color: var(--text);
      }
      .input:focus { outline: none; border-color: var(--sa); }
      .input:disabled, .send:disabled { cursor: wait; opacity: 0.62; }
      .send {
        appearance: none; border: 0; cursor: pointer; flex: none;
        width: 44px; height: 44px; border-radius: 50%; color: #fff;
        background: var(--sa);
        background: linear-gradient(135deg, var(--sa), color-mix(in srgb, var(--sa), #000 16%));
        display: grid; place-items: center;
      }
      .send:hover { filter: brightness(1.05); }
      .send:focus-visible { outline: 3px solid var(--sa); outline-offset: 2px; }
      .send svg { width: 18px; height: 18px; }

      .footer { text-align: center; font-size: 11px; color: var(--muted); padding: 8px;
        background: var(--bg); }
      .footer a { color: var(--muted); }

      @media (prefers-reduced-motion: reduce) {
        .launcher, .panel, .typing span { transition: none; animation: none; }
      }
      @media (max-width: 480px) {
        .root {
          bottom: max(12px, env(safe-area-inset-bottom));
          ${cfg.position}: max(12px, env(safe-area-inset-${cfg.position}));
        }
        .launcher { width: 48px; height: 48px; }
        .launcher svg { width: 22px; height: 22px; }
        .panel { height: calc(100vh - 32px); }
        .panel { height: calc(100dvh - 32px); }
      }
    `;
  }

  /* ---- Markup ---------------------------------------------------------- */
  function template() {
    const initial = (cfg.businessName || "S").trim().charAt(0).toUpperCase();
    return `
      <div class="root" data-theme="${cfg.theme}">
        <button class="launcher" type="button" part="launcher" aria-expanded="false"
                aria-controls="symbio-chat-panel" aria-label="Open chat with ${escapeHtml(
          cfg.businessName
        )}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z"/>
          </svg>
        </button>

        <section class="panel" id="symbio-chat-panel" role="dialog" aria-modal="false"
                 aria-hidden="true" inert aria-label="Chat with ${escapeHtml(cfg.businessName)}">
          <header class="header">
            <span class="avatar" aria-hidden="true">${escapeHtml(initial)}</span>
            <span class="htext">
              <span class="hname" data-name>${escapeHtml(cfg.businessName)}</span>
              <span class="hsub"><span class="dot"></span> <span data-status>Online now</span></span>
            </span>
            <button class="close" type="button" aria-label="Close chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
          </header>

          <div class="messages" data-messages role="log" aria-live="polite" aria-atomic="false"></div>
          <div class="chips" data-chips></div>

          <form class="composer" data-form>
            <input class="input" data-input type="text" autocomplete="off"
                   maxlength="${cfg.maxInputLength}" placeholder="Type your message..."
                   aria-label="Type your message" />
            <button class="send" type="submit" aria-label="Send message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z"/>
              </svg>
            </button>
          </form>
          <div class="footer">Powered by Symbio AI</div>
        </section>
      </div>
    `;
  }

  /* ---- Rendering ------------------------------------------------------- */
  function addMessage(role, text, opts) {
    const options = opts || {};
    const item = document.createElement("div");
    item.className = "msg msg--" + (role === "user" ? "user" : "bot");
    if (options.html) item.innerHTML = options.html;
    else item.textContent = text;
    el.messages.appendChild(item);
    el.messages.scrollTop = el.messages.scrollHeight;
    if (!options.transient) history.push({ role: role === "user" ? "user" : "assistant", text });
    return item;
  }

  let typingEl = null;
  function showTyping() {
    if (typingEl) return;
    typingEl = addMessage("bot", "", {
      html: '<span class="typing"><span></span><span></span><span></span></span>',
      transient: true,
    });
  }
  function hideTyping() {
    if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
  }

  function setChips(items) {
    el.chips.innerHTML = "";
    (items || []).forEach((label) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = label;
      chip.addEventListener("click", () => handleUserText(label));
      el.chips.appendChild(chip);
    });
  }

  function defaultChips() {
    const chips = ["Services"];
    if (
      cfg.voiceMessage ||
      cfg.services.some((service) => /voice|phone agent|call answering/i.test(service))
    ) {
      chips.push("Voice agent");
    }
    chips.push("Pricing");
    if (cfg.scanMessage) chips.push("Free scan");
    chips.push("Hours");
    if (cfg.location) chips.push("Location");
    chips.push(cfg.contactLabel);
    return chips;
  }

  /* ---- Intent engine (zero-backend fallback) -------------------------- */
  function has(text, words) {
    return words.some((w) => text.indexOf(w) !== -1);
  }

  function isLeadTrigger(text) {
    return has(text, [
      "book",
      "appointment",
      "schedule",
      "quote",
      "sign up",
      "signup",
      "get started",
      "contact",
      "call me",
      "reach me",
      "talk to founder",
      "talk to a founder",
      "leave my details",
      "leave details",
      "interested",
    ]);
  }

  function intentReply(raw) {
    const text = raw.toLowerCase();

    if (has(text, ["hour", "open", "close", "when are you"])) {
      const allDay = /24\/7|open 24/i.test(cfg.hours);
      return {
        text:
          "Availability: " +
          cfg.hours +
          ". " +
          (allDay
            ? "If we are with a client or building, leave the details here and one of the founders will follow up. "
            : "If you message outside those hours, leave your details and the team will follow up. ") +
          contactLine(),
      };
    }
    if (has(text, ["where", "location", "address", "find you"])) {
      return {
        text: serviceAreaLine() + " " + contactLine(),
      };
    }
    if (
      has(text, [
        "voice agent",
        "phone agent",
        "ai caller",
        "answer calls",
        "answering service",
        "call answering",
        "phone support",
        "take orders",
        "missed calls",
      ])
    ) {
      return {
        text:
          cfg.voiceMessage ||
          "We can help with a phone-based customer-service agent. Tell me what calls it should handle, and the team can scope the right workflow.",
        offerLead: true,
      };
    }
    if (has(text, ["price", "cost", "how much", "pricing", "rates", "fee"])) {
      return {
        text:
          (cfg.pricingMessage ||
            (cfg.price
              ? "Pricing: " + cfg.price + "."
              : "Pricing depends on the service and scope. Tell me what you need and the team can confirm the right next step.")) +
          " " +
          contactLine(),
        offerLead: true,
      };
    }
    if (has(text, ["free scan", "scan", "audit", "review my site", "fix my site"])) {
      return {
        text:
          cfg.scanMessage ||
          "Tell me what you need help with, and I can capture the details for the team.",
        offerLead: true,
      };
    }
    if (has(text, ["service", "what do you", "offer", "do you do", "help with"])) {
      return {
        text: cfg.businessName + " can help with " + listServices() + ". What are you trying to improve?",
      };
    }
    if (has(text, ["phone", "number", "call", "email", "contact", "human", "founder"])) {
      return {
        text: contactLine() + " You can also leave your name and what you need here, and we will route it.",
        offerLead: true,
      };
    }
    if (has(text, ["time", "timeline", "how long", "launch", "build time"])) {
      return {
        text:
          cfg.timelineMessage ||
          "Timing depends on the service and scope. Leave the details here and the team can confirm the next available step.",
        offerLead: true,
      };
    }
    if (has(text, ["example", "portfolio", "proof", "demo", "work"])) {
      return {
        text:
          cfg.examplesMessage ||
          "Tell me which service you are considering and the team can point you to the most relevant example.",
        offerLead: true,
      };
    }
    if (has(text, ["thank", "thanks", "cheers", "appreciate"])) {
      return { text: "You got it. Send the details whenever you are ready." };
    }
    if (has(text, ["hi", "hello", "hey", "yo "]) || text === "hi" || text === "hello") {
      return { text: "Hey. What can we help you with today?" };
    }
    return {
      text:
        "I can help with " +
        listServices() +
        ", pricing, timing, or a follow-up request. What would you like to know?",
    };
  }

  /* ---- Live chat connection (optional) -------------------------------- */
  function systemPrompt() {
    const parts = [
      "You are the friendly assistant for " + cfg.businessName + ".",
      "Services: " + cfg.services.join(", ") + ".",
      "Hours: " + cfg.hours + ".",
    ];
    if (cfg.location) parts.push("Location: " + cfg.location + ".");
    if (cfg.phone) parts.push("Phone: " + cfg.phone + ".");
    if (cfg.secondaryPhone) parts.push("Second founder phone: " + cfg.secondaryPhone + ".");
    if (cfg.email) parts.push("Email: " + cfg.email + ".");
    if (cfg.price) parts.push("Pricing: " + cfg.price + ".");
    parts.push(
      "Use clear, human language. Only use facts in this prompt. Never invent pricing, availability, policies, integrations, or capabilities. If a request needs a person, offer to capture a follow-up request."
    );
    if (cfg.assistantInstructions) parts.push(cfg.assistantInstructions);
    return parts.join(" ");
  }

  async function aiReply() {
    const messages = history.slice(-16).map((m) => ({
      role: m.role,
      content: String(m.text || "").slice(0, 1200),
    }));
    const res = await postJson(
      cfg.aiEndpoint,
      { messages, system: systemPrompt() },
      cfg.aiTimeoutMs
    );
    if (!res.ok) throw new Error("chat connection " + res.status);
    const data = await res.json();
    return data && data.reply ? String(data.reply) : null;
  }

  /* ---- Lead capture (deterministic: name -> contact -> detail) -------- */
  function startLead() {
    lead = { step: "name", name: "", contact: "", detail: "" };
    setChips([]);
    addMessage(
      "bot",
      "Absolutely. First, what is your name? Then I will grab the best contact and what you need help with."
    );
  }

  async function advanceLead(text) {
    if (lead.step === "name") {
      lead.name = text;
      lead.step = "contact";
      addMessage(
        "bot",
        "Thanks, " + firstName(text) + "! What's the best email or phone to reach you?"
      );
    } else if (lead.step === "contact") {
      if (!looksLikeContact(text)) {
        addMessage("bot", "Hmm, that doesn't look like an email or phone - mind trying again?");
        return;
      }
      lead.contact = text;
      lead.step = "detail";
      addMessage(
        "bot",
        "Got it. Tell me what you need help with, plus any useful link or details."
      );
    } else if (lead.step === "detail") {
      lead.detail = text;
      lead.step = null;
      await finishLead();
    }
  }

  async function finishLead() {
    const record = {
      name: lead.name,
      contact: lead.contact,
      detail: lead.detail,
      business: cfg.businessName,
      page: window.location.href,
      at: new Date().toISOString(),
    };
    setComposerBusy(true);
    showTyping();
    const delivery = await deliverLead(record);
    hideTyping();
    setComposerBusy(false);

    if (delivery.confirmed) {
      addMessage(
        "bot",
        "Perfect, " +
          firstName(record.name) +
          ". Your request was delivered. The team will review it and follow up. " +
          contactLine()
      );
    } else if (delivery.attempted) {
      addMessage(
        "bot",
        "I captured the details, but I could not confirm delivery. Please use this direct contact so nothing gets missed: " +
          contactLine()
      );
    } else {
      addMessage(
        "bot",
        "Thanks, " +
          firstName(record.name) +
          ". I captured the details in this chat. For a confirmed follow-up, please use this direct contact: " +
          contactLine()
      );
    }
    setChips(defaultChips());
  }

  async function deliverLead(record) {
    const deliveries = [];
    const respond = (result) => {
      deliveries.push(
        Promise.resolve(result)
          .then((value) => value !== false)
          .catch(() => false)
      );
    };
    const eventRecord = { ...record, respond };

    try {
      window.dispatchEvent(new CustomEvent("symbio:lead", { detail: eventRecord }));
    } catch (e) {
      /* CustomEvent unsupported - ignore */
    }
    if (cfg.onLead) {
      try {
        respond(cfg.onLead(record));
      } catch (e) {
        respond(false);
      }
    }
    if (cfg.leadEndpoint) {
      try {
        respond(
          postJson(cfg.leadEndpoint, record, cfg.leadTimeoutMs).then(async (response) => {
            if (!response.ok) return false;
            const data = await response.json().catch(() => null);
            return data ? data.ok === true : true;
          })
        );
      } catch (e) {
        respond(false);
      }
    }

    if (!deliveries.length) return { attempted: false, confirmed: false };
    const results = await Promise.all(deliveries);
    return { attempted: true, confirmed: results.some(Boolean) };
  }

  /* ---- Message orchestration ------------------------------------------ */
  let responsePending = false;

  function setComposerBusy(busy) {
    responsePending = busy;
    if (!el.form) return;
    el.form.setAttribute("aria-busy", String(busy));
    el.input.disabled = busy;
    if (el.send) el.send.disabled = busy;
  }

  async function handleUserText(raw) {
    const text = String(raw).trim().slice(0, cfg.maxInputLength);
    if (!text || responsePending) return;
    addMessage("user", text);
    el.input.value = "";

    if (lead.step) {
      await advanceLead(text);
      return;
    }

    if (isLeadTrigger(text)) {
      startLead();
      return;
    }

    if (cfg.aiEndpoint) {
      setComposerBusy(true);
      showTyping();
      try {
        const reply = await aiReply();
        hideTyping();
        if (reply) {
          addMessage("bot", reply);
          setChips(defaultChips());
          return;
        }
      } catch (e) {
        hideTyping();
        /* fall through to the built-in engine */
      } finally {
        setComposerBusy(false);
      }
    }

    const result = intentReply(text);
    addMessage("bot", result.text);
    if (result.offerLead) setChips(["Yes, contact me"].concat(defaultChips()));
    else setChips(defaultChips());
  }

  /* ---- Open / close --------------------------------------------------- */
  function openPanel() {
    if (!mounted) mount();
    isOpen = true;
    el.panel.removeAttribute("inert");
    el.panel.setAttribute("aria-hidden", "false");
    el.launcher.tabIndex = -1;
    el.root.classList.add("is-open");
    el.launcher.setAttribute("aria-expanded", "true");
    if (!history.length) {
      addMessage("bot", defaultGreeting());
      setChips(defaultChips());
    }
    window.setTimeout(() => el.input.focus(), 60);
  }

  function closePanel() {
    isOpen = false;
    if (el.root) {
      el.root.classList.remove("is-open");
      el.panel.setAttribute("inert", "");
      el.panel.setAttribute("aria-hidden", "true");
      el.launcher.setAttribute("aria-expanded", "false");
      el.launcher.tabIndex = 0;
      el.launcher.focus();
    }
  }

  function togglePanel() {
    if (isOpen) closePanel();
    else openPanel();
  }

  /* ---- Reconfigure at runtime (used by the demo's presets) ------------ */
  // Branding fields whose change warrants a fresh greeting; theme is cosmetic.
  const BRANDING_KEYS = [
    "businessName",
    "accent",
    "services",
    "hours",
    "location",
    "phone",
    "secondaryPhone",
    "email",
    "price",
    "contactLabel",
    "primaryContactName",
    "secondaryContactName",
    "scanMessage",
    "voiceMessage",
    "pricingMessage",
    "timelineMessage",
    "examplesMessage",
    "assistantInstructions",
    "greeting",
  ];

  function configure(partial) {
    if (!partial) return;
    const brandingChanged = BRANDING_KEYS.some((key) => key in partial);
    Object.keys(partial).forEach((key) => {
      if (key === "services") {
        if (Array.isArray(partial.services)) cfg.services = partial.services.slice();
      } else if (partial[key] !== undefined) {
        cfg[key] = partial[key];
      }
    });
    if (!mounted) return;
    el.root.style.setProperty("--sa", cfg.accent);
    el.root.setAttribute("data-theme", cfg.theme);
    if (el.name) el.name.textContent = cfg.businessName;
    // Only reset the conversation when the brand changed - not for a theme switch.
    if (brandingChanged) {
      history.length = 0;
      lead = { step: null, name: "", contact: "", detail: "" };
      el.messages.innerHTML = "";
      if (isOpen) {
        addMessage("bot", defaultGreeting());
        setChips(defaultChips());
      }
    }
  }

  /* ---- Mount ----------------------------------------------------------- */
  function mount() {
    if (mounted) return;
    const host = document.createElement("div");
    host.id = "symbio-widget-host";
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const styleTag = document.createElement("style");
    styleTag.textContent = styles();
    shadow.appendChild(styleTag);

    const wrap = document.createElement("div");
    wrap.innerHTML = template();
    shadow.appendChild(wrap.firstElementChild);

    el.root = shadow.querySelector(".root");
    el.launcher = shadow.querySelector(".launcher");
    el.panel = shadow.querySelector(".panel");
    el.messages = shadow.querySelector("[data-messages]");
    el.chips = shadow.querySelector("[data-chips]");
    el.input = shadow.querySelector("[data-input]");
    el.form = shadow.querySelector("[data-form]");
    el.send = shadow.querySelector(".send");
    el.name = shadow.querySelector("[data-name]");

    el.launcher.addEventListener("click", togglePanel);
    shadow.querySelector(".close").addEventListener("click", closePanel);
    el.form.addEventListener("submit", (event) => {
      event.preventDefault();
      handleUserText(el.input.value);
    });
    shadow.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePanel();
    });

    mounted = true;
  }

  /* ---- Public API ------------------------------------------------------ */
  window.SymbioWidget = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    configure: configure,
    __loaded: true,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
