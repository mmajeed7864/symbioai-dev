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
          chatbotMessage: "",         // optional: answer for chatbot buying questions
          leadGenerationMessage: "",  // optional: answer for leads / customer growth questions
          websiteMessage: "",         // optional: answer for website buying questions
          appMessage: "",             // optional: answer for app / portal questions
          dashboardMessage: "",       // optional: answer for dashboard questions
          automationMessage: "",      // optional: answer for automation / agent questions
          maintenanceMessage: "",     // optional: answer for recurring support questions
          guaranteeMessage: "",       // optional: answer for guarantee / results questions
          recommendationMessage: "",  // optional: service-fit and unknown-question response
          pricingMessage: "",         // optional: overrides the derived pricing answer
          timelineMessage: "",        // optional: custom timing answer
          examplesMessage: "",        // optional: custom portfolio/demo answer
          assistantInstructions: "",  // optional: extra facts for an AI endpoint
          position: "right",          // "right" | "left"
          leadEndpoint: "",           // optional: POST {name,contact,detail,business,page,at}
          aiEndpoint: "",             // optional: POST {messages,sessionId} -> {reply}
          eventEndpoint: "",          // optional: POST deterministic answer metadata
          feedbackEndpoint: "",       // optional: POST Helpful / Needs work feedback
          aiSessionLimit: 20,         // optional: browser-side courtesy cap
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
    const aiEndpoint = attr("ai-endpoint") || user.aiEndpoint || "";
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
      primaryContactName: attr("primary-contact-name") || user.primaryContactName || "",
      secondaryContactName: attr("secondary-contact-name") || user.secondaryContactName || "",
      scanMessage: attr("scan-message") || user.scanMessage || "",
      voiceMessage: attr("voice-message") || user.voiceMessage || "",
      chatbotMessage: attr("chatbot-message") || user.chatbotMessage || "",
      leadGenerationMessage: attr("lead-generation-message") || user.leadGenerationMessage || "",
      websiteMessage: attr("website-message") || user.websiteMessage || "",
      appMessage: attr("app-message") || user.appMessage || "",
      dashboardMessage: attr("dashboard-message") || user.dashboardMessage || "",
      automationMessage: attr("automation-message") || user.automationMessage || "",
      maintenanceMessage: attr("maintenance-message") || user.maintenanceMessage || "",
      guaranteeMessage: attr("guarantee-message") || user.guaranteeMessage || "",
      recommendationMessage: attr("recommendation-message") || user.recommendationMessage || "",
      pricingMessage: attr("pricing-message") || user.pricingMessage || "",
      timelineMessage: attr("timeline-message") || user.timelineMessage || "",
      examplesMessage: attr("examples-message") || user.examplesMessage || "",
      assistantInstructions: attr("assistant-instructions") || user.assistantInstructions || "",
      position:
        (attr("position") || user.position || "right").toLowerCase() === "left" ? "left" : "right",
      // "auto" follows the visitor's OS; "light" / "dark" force the widget theme.
      theme: theme === "light" || theme === "dark" ? theme : "auto",
      greeting: attr("greeting") || user.greeting || "",
      leadEndpoint: attr("lead-endpoint") || user.leadEndpoint || "",
      aiEndpoint,
      eventEndpoint:
        attr("event-endpoint") ||
        user.eventEndpoint ||
        (aiEndpoint ? aiEndpoint.replace(/\/chat(?:\?.*)?$/, "/chat-event") : ""),
      feedbackEndpoint:
        attr("feedback-endpoint") ||
        user.feedbackEndpoint ||
        (aiEndpoint ? aiEndpoint.replace(/\/chat(?:\?.*)?$/, "/chat-feedback") : ""),
      aiTimeoutMs: Math.max(1000, Number(user.aiTimeoutMs) || 30000),
      aiSessionLimit: Math.max(1, Number(user.aiSessionLimit) || 20),
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
  let aiCalls = 0;
  let volatileChatSessionId = "";
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
    return (
      [phoneLine, emailLine].filter(Boolean).join(" ") ||
      "Leave your details here and we will follow up."
    );
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
    return cfg.greeting || "Hey, this is " + cfg.businessName + ". How can we help today?";
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
      .feedback { display: flex; align-items: center; gap: 5px; margin-top: 9px;
        padding-top: 7px; border-top: 1px solid var(--border); white-space: normal; }
      .feedback-label { color: var(--muted); font-size: 10px; margin-right: 2px; }
      .feedback-btn { appearance: none; border: 1px solid var(--border); border-radius: 999px;
        background: var(--bg-2); color: var(--muted); cursor: pointer; font: inherit;
        font-size: 10px; line-height: 1; padding: 6px 8px; }
      .feedback-btn:hover, .feedback-btn:focus-visible { border-color: var(--sa); color: var(--sa); }
      .feedback-btn:focus-visible { outline: 2px solid var(--sa); outline-offset: 1px; }
      .feedback-btn:disabled { cursor: default; opacity: 0.65; }
      .feedback-status { color: var(--muted); font-size: 10px; }
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

  function addFeedbackControls(messageEl, details) {
    if (!messageEl || !cfg.feedbackEndpoint || !details?.messageId) return;
    const box = document.createElement("div");
    box.className = "feedback";
    const label = document.createElement("span");
    label.className = "feedback-label";
    label.textContent = "Was this useful?";
    box.appendChild(label);

    const choices = [
      { value: "helpful", label: "Helpful", shareSample: false },
      { value: "needs_work", label: "Needs work", shareSample: true },
    ];
    const buttons = choices.map((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "feedback-btn";
      button.textContent = choice.label;
      button.setAttribute(
        "aria-label",
        choice.shareSample
          ? "Mark as needs work and privately share this answer for improvement"
          : "Mark this answer as helpful"
      );
      button.addEventListener("click", async () => {
        buttons.forEach((item) => {
          item.disabled = true;
        });
        try {
          const response = await postJson(
            cfg.feedbackEndpoint,
            {
              messageId: details.messageId,
              sessionId: chatSessionId(),
              feedback: choice.value,
              shareSample: choice.shareSample,
              ...(choice.shareSample
                ? {
                    question: String(details.question || "").slice(0, 1600),
                    answer: String(details.answer || "").slice(0, 1800),
                  }
                : {}),
            },
            cfg.aiTimeoutMs
          );
          if (!response.ok) throw new Error("feedback " + response.status);
          const result = await response.json().catch(() => null);
          const queuedForReview = choice.shareSample && result?.sampleAccepted === true;
          box.innerHTML =
            '<span class="feedback-status">' +
            (queuedForReview
              ? "Thanks - this scrubbed answer was queued for review."
              : "Thanks for the feedback.") +
            "</span>";
        } catch (error) {
          buttons.forEach((item) => {
            item.disabled = false;
          });
          label.textContent = "Feedback could not save. Try again?";
        }
      });
      box.appendChild(button);
      return button;
    });
    messageEl.appendChild(box);
    el.messages.scrollTop = el.messages.scrollHeight;
  }

  async function trackDeterministicReply(question, answer, messageEl) {
    if (!cfg.eventEndpoint || !cfg.feedbackEndpoint) return;
    try {
      const response = await postJson(
        cfg.eventEndpoint,
        {
          question: String(question || "").slice(0, 1600),
          answer: String(answer || "").slice(0, 1800),
          sessionId: chatSessionId(),
        },
        cfg.aiTimeoutMs
      );
      if (!response.ok) return;
      const data = await response.json();
      if (data?.messageId) {
        addFeedbackControls(messageEl, {
          messageId: data.messageId,
          question,
          answer,
        });
      }
    } catch (error) {
      // Learning telemetry must never interrupt the visitor's chat.
    }
  }

  function addTrackedDeterministicReply(question, answer) {
    const messageEl = addMessage("bot", answer);
    trackDeterministicReply(question, answer, messageEl);
    return messageEl;
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
    if (cfg.leadGenerationMessage) chips.push("Get more leads");
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
  function normalizeIntentText(value) {
    return String(value)
      .toLowerCase()
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9$@.+/\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function has(text, words) {
    const haystack = " " + normalizeIntentText(text) + " ";
    return words.some((word) => {
      const needle = normalizeIntentText(word);
      return needle ? haystack.indexOf(" " + needle + " ") !== -1 : false;
    });
  }

  function recentUserContext(limit) {
    return history
      .filter((message) => message.role === "user")
      .slice(-(limit || 4))
      .map((message) => message.text)
      .join(" ");
  }

  function createSecureChatSessionId() {
    const cryptoApi = window.crypto;
    if (!cryptoApi) return "";
    if (typeof cryptoApi.randomUUID === "function") {
      return "chat_" + cryptoApi.randomUUID().replace(/-/g, "");
    }
    if (typeof cryptoApi.getRandomValues !== "function") return "";
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return "chat_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function chatSessionId() {
    if (volatileChatSessionId) return volatileChatSessionId;
    const storageKey = "symbio-ai-chat-session";
    try {
      const existing = window.sessionStorage.getItem(storageKey);
      if (existing) {
        volatileChatSessionId = existing;
        return existing;
      }
      volatileChatSessionId = createSecureChatSessionId();
      if (volatileChatSessionId) {
        window.sessionStorage.setItem(storageKey, volatileChatSessionId);
      }
      return volatileChatSessionId;
    } catch (error) {
      volatileChatSessionId = createSecureChatSessionId();
      return volatileChatSessionId;
    }
  }

  function hasExplicitBusinessDeclaration(text) {
    const normalized = normalizeIntentText(text);
    return (
      /\b(?:for\s+(?:my|our|a|an)|(?:i|we)\s+(?:run|own|operate|manage)\s+(?:a|an|the)?)\s+(?:[a-z0-9&]+\s+){1,5}(?:business|company|shop|store|restaurant|agency|firm|practice|office|studio|service|services)\b/.test(
        normalized
      ) ||
      /\b(?:i|we)\s+(?:run|own|operate|manage)\s+(?:a|an|the)\s+[a-z0-9&]+(?:\s+[a-z0-9&]+){0,4}\b/.test(
        normalized
      ) ||
      /\b(?:no|actually|correction)\b.{0,30}\b(?:i said|i meant|it is|its)\b/.test(normalized)
    );
  }

  const INTENT_GOALS = [
    {
      key: "seller_lead_gen",
      terms: [
        "seller lead",
        "seller leads",
        "find sellers",
        "find home sellers",
        "find homeowners",
        "people selling houses",
        "people selling homes",
        "homeowners selling",
        "owners selling",
        "houses for sale",
        "homes for sale",
        "list their house",
        "list their home",
        "selling their house",
        "selling their home",
        "off market sellers",
        "off market homes",
      ],
    },
    {
      key: "custom_app",
      terms: [
        "app",
        "custom app",
        "custom apps",
        "mobile app",
        "mobile apps",
        "web app",
        "web apps",
        "apps",
        "client portal",
        "customer portal",
        "staff portal",
        "internal tool",
        "custom software",
      ],
    },
    {
      key: "voice_agent",
      terms: [
        "voice agent",
        "voice agents",
        "phone agent",
        "phone agents",
        "ai caller",
        "ai phone",
        "answer calls",
        "answer my calls",
        "answer phone calls",
        "answering service",
        "call answering",
        "handle calls",
        "pick up calls",
        "phone support",
        "take orders",
        "take phone orders",
        "phone orders",
        "miss phone orders",
        "missing phone orders",
        "missed phone orders",
        "miss calls",
        "missing calls",
        "missed calls",
        "voice bot",
      ],
    },
    {
      key: "chatbot",
      terms: [
        "chatbot",
        "chatbots",
        "chat bot",
        "chat bots",
        "website assistant",
        "web assistant",
        "site assistant",
        "website bot",
        "chat widget",
        "ai chat",
        "live chat",
      ],
    },
    {
      key: "lead_generation",
      terms: [
        "lead",
        "leads",
        "find clients",
        "find customers",
        "get clients",
        "get customers",
        "more clients",
        "more customers",
        "new customers",
        "more listings",
        "listing appointments",
        "grow my business",
        "sales pipeline",
        "book more",
        "more bookings",
        "more calls",
        "generate business",
      ],
    },
  ];

  const INDUSTRY_PROFILES = [
    {
      key: "real_estate",
      terms: [
        "real estate",
        "realtor",
        "realtors",
        "realty",
        "property agent",
        "property agents",
        "real estate agent",
        "real estate agents",
        "brokerage",
        "listing agent",
      ],
      responses: {
        seller_lead_gen:
          "That is a seller-lead problem, and we can build around it. A strong first version is a seller-focused landing page or home-value offer, a short intake that qualifies the homeowner, and immediate routing into your follow-up system so interested sellers do not go cold. If you already have a website or CRM, we can connect the flow instead of replacing everything. Do sellers reach you mostly by referral today, or do you want new inbound leads from search and ads?",
        lead_generation:
          "Yes. For a real-estate business, we can build a measurable lead path around buyer enquiries, seller opportunities, or both: focused landing pages, qualification, CRM routing, and fast follow-up. The right first build depends on which side matters most. Are you trying to win more listings, find more buyers, or both?",
        custom_app:
          "Yes. A real-estate app could be a seller pipeline, listing and showing manager, transaction tracker, client-update portal, or internal team dashboard. We would start with the one workflow that creates the clearest return instead of packing everything into version one. Which matters most right now: leads, listings, transactions, client updates, or team operations?",
        voice_agent:
          "Yes. For a real-estate business, a voice agent can answer routine property questions, qualify buyer or seller enquiries, collect showing or valuation requests, and route urgent calls to an agent. It should not invent property facts or commitments. Are missed inbound calls, lead qualification, or appointment requests the biggest problem?",
        chatbot:
          "Yes. A real-estate chatbot can answer approved listing questions, qualify buyers and sellers, collect valuation or showing requests, and route each lead to the right agent. Is your first priority seller leads, buyer enquiries, or support for active clients?",
      },
    },
    {
      key: "restaurant",
      terms: [
        "restaurant",
        "restaurants",
        "pizza shop",
        "pizza restaurant",
        "cafe",
        "coffee shop",
        "takeout",
        "food truck",
        "chinese restaurant",
      ],
      responses: {
        voice_agent:
          "Yes. A restaurant voice agent can answer approved menu and hours questions, collect order or reservation details, and bring in a person for allergies, complaints, large orders, or anything outside the rules. Is the biggest need phone orders, reservations, or routine questions?",
        chatbot:
          "Yes. A restaurant chatbot can answer approved menu and hours questions, collect catering or reservation requests, and send customers to the correct ordering path. Should it focus first on orders, reservations, catering, or basic questions?",
        custom_app:
          "Yes. A restaurant app could handle direct ordering, loyalty, catering requests, reservations, or an internal order dashboard. The best first version is the one that removes the most friction without replacing tools that already work. Which workflow costs you the most time today?",
        lead_generation:
          "For a restaurant, we would focus on measurable demand such as direct orders, reservations, catering enquiries, or repeat visits. That usually means a clear local landing page, strong offer, fast mobile path, and follow-up for people who opt in. Which result matters most?",
      },
    },
    {
      key: "car_wash",
      terms: [
        "car wash",
        "car washes",
        "carwash",
        "car wash company",
        "car wash business",
        "mobile car wash",
        "express wash",
        "wash club",
      ],
      responses: {
        voice_agent:
          "Yes. A car-wash voice agent can answer approved package, hours, location, and membership questions, collect fleet or membership enquiries, and hand billing, damage, or unusual calls to a person. Is the first priority routine questions, membership calls, or fleet enquiries?",
        chatbot:
          "Yes. A car-wash chatbot can explain approved packages, hours, locations, memberships, and fleet options, then route sign-ups or unusual questions correctly. Should it focus first on memberships, wash packages, or fleet accounts?",
        custom_app:
          "Yes. A car-wash app could handle memberships, loyalty, wash history, fleet accounts, add-on purchases, and location or queue updates. We would start with the workflow that affects revenue or staff time most. Is the priority membership growth, repeat visits, fleet accounts, or operations?",
        lead_generation:
          "For a car wash, the smallest measurable lead path usually focuses on membership sign-ups, repeat visits, or fleet accounts with a clear local offer and fast follow-up. Which customer type matters most right now?",
      },
    },
    {
      key: "auto_services",
      terms: [
        "auto shop",
        "auto detailing",
        "car detailing",
        "detail shop",
        "body shop",
        "mechanic",
        "repair shop",
        "tint shop",
        "car shop",
        "auto custom",
      ],
      responses: {
        voice_agent:
          "Yes. For an auto-service business, a voice agent can collect the vehicle, requested service, timing, and photos or follow-up details, answer approved questions, and route urgent or unusual calls to a person. Is the first priority missed calls, quote requests, or appointment intake?",
        chatbot:
          "Yes. An auto-service chatbot can collect vehicle and service details, answer approved questions, qualify quote requests, and send the customer toward booking or a human reply. Which service should it handle first?",
        custom_app:
          "Yes. An auto-service app could manage quote intake, vehicle photos, job status, customer approvals, appointments, or technician workflow. Who should use the first version: customers, the front desk, or technicians?",
        lead_generation:
          "For an auto-service business, the smallest useful lead system is usually a strong service page, proof gallery, vehicle-and-service intake, and fast quote follow-up. Which service brings the best customers today?",
      },
    },
    {
      key: "home_services",
      terms: [
        "contractor",
        "construction company",
        "construction business",
        "home services",
        "roofer",
        "roofing",
        "plumber",
        "plumbing",
        "electrician",
        "electrical company",
        "hvac",
        "landscaping",
        "remodeling",
      ],
      responses: {
        voice_agent:
          "Yes. For a home-service company, a voice agent can collect the job type, location, urgency, and preferred time, answer approved questions, and route emergencies or high-value calls to a person. Is the main issue missed calls, estimate requests, or scheduling?",
        chatbot:
          "Yes. A home-service chatbot can collect job details and photos, answer approved service-area questions, qualify estimate requests, and route urgent work correctly. Which service should it qualify first?",
        custom_app:
          "Yes. A home-service app could manage estimates, job photos, schedules, customer updates, approvals, or crew workflows. Who needs the biggest improvement first: customers, the office, or field crews?",
        lead_generation:
          "For a home-service company, we would start with the highest-value service and build a local landing page, trust proof, estimate intake, and immediate follow-up around it. Which job type do you most want more of?",
      },
    },
  ];

  function findMostRecentIndustry(text) {
    const normalized = " " + normalizeIntentText(text) + " ";
    let industry = null;
    let latestIndex = -1;

    INDUSTRY_PROFILES.forEach((profile) => {
      profile.terms.forEach((term) => {
        const index = normalized.lastIndexOf(" " + normalizeIntentText(term) + " ");
        if (index > latestIndex) {
          latestIndex = index;
          industry = profile;
        }
      });
    });

    return industry;
  }

  function extractIntentSlots(text, context) {
    const goals = INTENT_GOALS.filter((goal) => has(text, goal.terms)).map((goal) => goal.key);
    const directIndustry = findMostRecentIndustry(text);
    const explicitCurrentBusiness = hasExplicitBusinessDeclaration(text);
    const industry =
      directIndustry || (!explicitCurrentBusiness ? findMostRecentIndustry(context) : null);
    const unknownExplicitBusiness =
      !industry && (explicitCurrentBusiness || hasExplicitBusinessDeclaration(context));
    return { goals, industry, unknownExplicitBusiness };
  }

  function verticalReply(slots) {
    if (!slots.industry) return null;
    const priority = ["seller_lead_gen", "custom_app", "voice_agent", "chatbot", "lead_generation"];
    const goal = priority.find((key) => slots.goals.includes(key) && slots.industry.responses[key]);
    if (!goal) return null;
    return { text: slots.industry.responses[goal], offerLead: true, highConfidence: true };
  }

  function isLeadTrigger(text) {
    return has(text, [
      "yes contact me",
      "contact me",
      "call me",
      "have someone call me",
      "reach me",
      "talk to founder",
      "talk to a founder",
      "leave my details",
      "leave details",
      "request a quote",
      "get a quote",
      "book a consult",
      "schedule a call",
      "start a project",
      "sign up",
      "signup",
      "get started",
    ]);
  }

  function intentReply(raw) {
    const text = normalizeIntentText(raw);
    const context = normalizeIntentText(recentUserContext(2) || text);
    const slots = extractIntentSlots(text, context);
    const voiceIntent = slots.goals.includes("voice_agent");
    const chatbotIntent = slots.goals.includes("chatbot");
    const appIntent = slots.goals.includes("custom_app");

    if (voiceIntent && chatbotIntent) {
      return {
        text: "Yes. A website chatbot handles visitors on your site, while a voice agent handles phone calls. They can work separately or share one approved knowledge base and handoff process. The best choice depends on where customers currently contact you most. Do you want help with website messages, phone calls, or both?",
        offerLead: true,
      };
    }
    const specificVerticalReply = verticalReply(slots);
    if (specificVerticalReply) return specificVerticalReply;
    if (voiceIntent) {
      return {
        text:
          cfg.voiceMessage ||
          "We can build a phone-based customer-service agent for approved questions, request intake, and human handoff. Tell me what calls it should handle and the team can scope the right workflow.",
        offerLead: true,
        fallback: slots.unknownExplicitBusiness,
      };
    }
    if (chatbotIntent) {
      return {
        text:
          cfg.chatbotMessage ||
          "Yes. We can add a trained chatbot to a website so it can answer approved questions, explain services, capture lead details, and route the right next step to a person.",
        offerLead: true,
        fallback: slots.unknownExplicitBusiness,
      };
    }
    if (has(text, ["guarantee", "guaranteed", "promise results", "guaranteed leads"])) {
      return {
        text:
          cfg.guaranteeMessage ||
          "No honest provider can guarantee a specific number of leads or sales. We can improve how your business attracts, captures, qualifies, and follows up with potential customers, then measure what is working.",
      };
    }
    if (
      has(text, [
        "lead",
        "leads",
        "find customers",
        "get customers",
        "more customers",
        "new customers",
        "grow my business",
        "marketing",
        "sales pipeline",
        "book more",
        "more bookings",
        "more calls",
        "generate business",
      ])
    ) {
      return {
        text:
          cfg.leadGenerationMessage ||
          "We can help improve lead generation with a stronger conversion path, better intake, and faster follow-up. Tell me what business you run and where customers currently find you.",
        offerLead: true,
        fallback: slots.unknownExplicitBusiness,
      };
    }
    if (
      has(text, [
        "website",
        "websites",
        "web site",
        "landing page",
        "landing pages",
        "redesign",
        "site redesign",
        "build me a site",
        "new site",
      ])
    ) {
      return {
        text:
          cfg.websiteMessage ||
          "Yes. We build and redesign business websites around credibility, clear offers, mobile usability, and a direct path to calls, bookings, or enquiries.",
        offerLead: true,
      };
    }
    if (appIntent) {
      return {
        text:
          cfg.appMessage ||
          "Yes. We build custom apps, portals, and internal tools around the actual users, forms, roles, and workflows your business needs.",
        offerLead: true,
        fallback: slots.unknownExplicitBusiness,
      };
    }
    if (
      has(text, [
        "dashboard",
        "dashboards",
        "analytics dashboard",
        "reporting portal",
        "kpi",
        "kpis",
        "metrics",
      ])
    ) {
      return {
        text:
          cfg.dashboardMessage ||
          "Yes. We build business dashboards for leads, bookings, performance, follow-up status, and the metrics an owner or team actually needs to see.",
        offerLead: true,
      };
    }
    if (
      has(text, [
        "automation",
        "automations",
        "automate",
        "workflow",
        "workflows",
        "ai agent",
        "ai agents",
        "manual work",
        "repetitive work",
        "follow up automatically",
        "follow-up automatically",
      ])
    ) {
      return {
        text:
          cfg.automationMessage ||
          "Yes. We build controlled automations and AI-agent workflows that handle repeat work, keep humans in charge of important decisions, and record what happened.",
        offerLead: true,
      };
    }
    if (
      has(text, [
        "maintenance",
        "monthly fee",
        "monthly fees",
        "monthly cost",
        "ongoing cost",
        "support plan",
        "after launch",
      ])
    ) {
      return {
        text:
          cfg.maintenanceMessage ||
          "Ongoing costs depend on hosting, support, usage, and integrations. The team shows every recurring line item before you approve the build.",
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
    if (
      has(text, [
        "which service",
        "what should i get",
        "what do i need",
        "not sure",
        "best option",
        "recommend",
        "right for me",
      ])
    ) {
      return {
        text:
          cfg.recommendationMessage ||
          "Tell me the business, the main bottleneck, and what you already use. I will point you toward the smallest useful service instead of pushing a bigger build.",
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
    if (
      has(text, [
        "service",
        "services",
        "what do you",
        "what can you do",
        "offer",
        "do you do",
        "help with",
      ])
    ) {
      return {
        text:
          cfg.businessName +
          " can help with " +
          listServices() +
          ". What are you trying to improve?",
      };
    }
    if (has(text, ["hour", "hours", "open", "close", "when are you"])) {
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
    if (has(text, ["phone", "number", "call", "email", "contact", "human", "founder"])) {
      return {
        text:
          contactLine() +
          " You can also leave your name and what you need here, and we will route it.",
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
        cfg.recommendationMessage ||
        "Tell me what you want to improve: more leads, fewer missed calls, a better website, a chatbot, an app or dashboard, or less manual work. I will point you toward the most useful next step.",
      offerLead: true,
      fallback: true,
    };
  }

  /* ---- Live chat connection (optional) -------------------------------- */
  async function aiReply() {
    if (aiCalls >= cfg.aiSessionLimit) return null;
    aiCalls += 1;
    const messages = history.slice(-10).map((m) => ({
      role: m.role,
      content: String(m.text || "").slice(0, 1200),
    }));
    const res = await postJson(
      cfg.aiEndpoint,
      { messages, sessionId: chatSessionId() },
      cfg.aiTimeoutMs
    );
    if (!res.ok) throw new Error("chat connection " + res.status);
    const data = await res.json();
    return data && data.reply
      ? {
          reply: String(data.reply),
          messageId: String(data.messageId || ""),
          source: String(data.source || ""),
        }
      : null;
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

    // With a live endpoint configured, the model answers every normal message.
    // The built-in intent engine remains the instant fallback if the endpoint fails.
    const result = intentReply(text);
    const shouldAskAi = Boolean(cfg.aiEndpoint && aiCalls < cfg.aiSessionLimit);
    if (!shouldAskAi) {
      addTrackedDeterministicReply(text, result.text);
      if (result.offerLead) setChips(["Yes, contact me"].concat(defaultChips()));
      else setChips(defaultChips());
      return;
    }

    if (shouldAskAi) {
      setComposerBusy(true);
      showTyping();
      try {
        const aiResult = await aiReply();
        hideTyping();
        if (aiResult?.reply) {
          const messageEl = addMessage("bot", aiResult.reply);
          addFeedbackControls(messageEl, {
            messageId: aiResult.messageId,
            question: text,
            answer: aiResult.reply,
          });
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

    addTrackedDeterministicReply(text, result.text);
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
    "chatbotMessage",
    "leadGenerationMessage",
    "websiteMessage",
    "appMessage",
    "dashboardMessage",
    "automationMessage",
    "maintenanceMessage",
    "guaranteeMessage",
    "recommendationMessage",
    "pricingMessage",
    "timelineMessage",
    "examplesMessage",
    "assistantInstructions",
    "greeting",
    "eventEndpoint",
    "feedbackEndpoint",
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
  const publicApi = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    configure: configure,
    __loaded: true,
  };
  if (window.__SYMBIO_WIDGET_TEST__) {
    publicApi.__intentReplyForTests = (text, context) => {
      const originalHistory = history.slice();
      history.length = 0;
      String(context || "")
        .split("|||")
        .filter(Boolean)
        .forEach((message) => history.push({ role: "user", text: message }));
      const result = intentReply(text);
      history.length = 0;
      originalHistory.forEach((message) => history.push(message));
      return result;
    };
    publicApi.__shouldUseAiForTests = () => Boolean(cfg.aiEndpoint && aiCalls < cfg.aiSessionLimit);
  }
  window.SymbioWidget = publicApi;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
