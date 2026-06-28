/* =========================================================================
   Symbio Widget - an embeddable chat + lead-capture assistant.

   Drop onto ANY website with a single tag. No framework, no build step,
   no backend required. Renders inside a Shadow DOM so the host page's CSS
   can't break it and its styles can't leak out.

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
      position:
        (attr("position") || user.position || "right").toLowerCase() === "left" ? "left" : "right",
      // "auto" follows the visitor's OS; "light" / "dark" force the widget theme.
      theme: theme === "light" || theme === "dark" ? theme : "auto",
      greeting: attr("greeting") || user.greeting || "",
      leadEndpoint: attr("lead-endpoint") || user.leadEndpoint || "",
      aiEndpoint: attr("ai-endpoint") || user.aiEndpoint || "",
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
    if (cfg.phone) phones.push(cfg.secondaryPhone || cfg.email ? "Mohammed at " + cfg.phone : cfg.phone);
    if (cfg.secondaryPhone) phones.push("Ravi at " + cfg.secondaryPhone);
    const phoneLine = phones.length ? "Call or text " + phones.join(" or ") + "." : "";
    const emailLine = cfg.email ? "Email " + cfg.email + "." : "";
    return [phoneLine, emailLine].filter(Boolean).join(" ") || "Leave your details here and we will follow up.";
  }

  function serviceAreaLine() {
    return (
      cfg.location ||
      "Founder-led from California and North Carolina, serving businesses across the entire US."
    );
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
        ". Send your website or tell us what you want redesigned, and I will point you toward the right next step."
    );
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
        bottom: 20px;
        ${cfg.position}: 20px;
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
        .panel { height: calc(100vh - 32px); }
      }
    `;
  }

  /* ---- Markup ---------------------------------------------------------- */
  function template() {
    const initial = (cfg.businessName || "S").trim().charAt(0).toUpperCase();
    return `
      <div class="root" data-theme="${cfg.theme}">
        <button class="launcher" type="button" part="launcher" aria-label="Open chat with ${escapeHtml(
          cfg.businessName
        )}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5Z"/>
          </svg>
        </button>

        <section class="panel" role="dialog" aria-modal="false"
                 aria-label="Chat with ${escapeHtml(cfg.businessName)}">
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
                   placeholder="Type your message..." aria-label="Type your message" />
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
    const chips = ["Services", "Pricing", "Free scan", "Hours"];
    if (cfg.location) chips.push("Location");
    chips.push("Talk to founder");
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
        text:
          serviceAreaLine() +
          " Most work is remote, so we can help whether you are local or out of state. " +
          contactLine(),
      };
    }
    if (has(text, ["price", "cost", "how much", "pricing", "rates", "fee"])) {
      return {
        text:
          "Website and redesign work starts at $1,000. Chatbot and lead-intake work starts around $750. Dashboards and automation usually start around $1,500, and custom apps start around $2,000. The free scan helps us tell you which lane actually makes sense before you spend anything. " +
          contactLine(),
        offerLead: true,
      };
    }
    if (has(text, ["free scan", "scan", "audit", "review my site", "fix my site"])) {
      return {
        text:
          "The free scan is simple: send your website, Instagram, or business page. We look for the first fixes that can improve trust, mobile flow, speed, booking, leads, or follow-up.",
        offerLead: true,
      };
    }
    if (has(text, ["service", "what do you", "offer", "do you do", "help with"])) {
      return {
        text:
          "Our main focus is website design and redesign: cleaner pages, better mobile flow, stronger copy, and clearer calls to action. We can also add booking systems, lead capture, custom apps, dashboards, and AI chatbots when the site needs more.",
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
          "Simple landing pages and focused redesigns can move fast. Bigger websites, apps, dashboards, or automation depend on scope. Send the link and we will give you a realistic next step after the free scan.",
        offerLead: true,
      };
    }
    if (has(text, ["example", "portfolio", "proof", "demo", "work"])) {
      return {
        text:
          "The live demo shows how a clean site can guide visitors, answer common questions, and route leads somewhere useful. If you want, send your site and we will show what we would improve first.",
        offerLead: true,
      };
    }
    if (has(text, ["thank", "thanks", "cheers", "appreciate"])) {
      return { text: "You got it. Send a link or idea whenever you are ready and we can take a look." };
    }
    if (has(text, ["hi", "hello", "hey", "yo "]) || text === "hi" || text === "hello") {
      return { text: "Hey. What are you trying to build, fix, or improve?" };
    }
    return {
      text:
        "I can help with website redesigns, pricing, timelines, examples, apps, chatbots, or a free scan. Send your site or tell me what feels broken.",
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
        "Use clear, human language. Position website design and redesign as a core offer, while treating apps, chatbots, dashboards, and AI agents as standalone products when the customer asks for them. The company is founder-led, available for 24/7 intake, and serves clients across the US. Encourage a free project scan or founder follow-up when useful."
    );
    return parts.join(" ");
  }

  async function aiReply() {
    const messages = history.map((m) => ({ role: m.role, content: m.text }));
    const res = await fetch(cfg.aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system: systemPrompt() }),
    });
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
      "Absolutely. First, what is your name? Then I will grab the best contact and what you want redesigned or built."
    );
  }

  function advanceLead(text) {
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
        "Got it. Send your website, Instagram, business page, or a short description of what you want redesigned or built."
      );
    } else if (lead.step === "detail") {
      lead.detail = text;
      lead.step = null;
      finishLead();
    }
  }

  function finishLead() {
    const record = {
      name: lead.name,
      contact: lead.contact,
      detail: lead.detail,
      business: cfg.businessName,
      page: window.location.href,
      at: new Date().toISOString(),
    };
    const followUpOwner = cfg.secondaryPhone || cfg.email ? "A Symbio founder" : "The team";
    addMessage(
      "bot",
      "Perfect, " +
        firstName(record.name) +
        ". We saved your request. " +
        followUpOwner +
        " will review it and follow up. " +
        contactLine()
    );
    deliverLead(record);
    setChips(defaultChips());
  }

  function deliverLead(record) {
    try {
      window.dispatchEvent(new CustomEvent("symbio:lead", { detail: record }));
    } catch (e) {
      /* CustomEvent unsupported - ignore */
    }
    if (cfg.onLead) {
      try {
        cfg.onLead(record);
      } catch (e) {
        /* host callback threw - ignore */
      }
    }
    if (cfg.leadEndpoint) {
      try {
        fetch(cfg.leadEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
        }).catch(function () {
          /* delivery is best-effort; the event/callback already fired */
        });
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* ---- Message orchestration ------------------------------------------ */
  async function handleUserText(raw) {
    const text = String(raw).trim();
    if (!text) return;
    addMessage("user", text);
    el.input.value = "";

    if (lead.step) {
      advanceLead(text);
      return;
    }

    if (isLeadTrigger(text)) {
      startLead();
      return;
    }

    if (cfg.aiEndpoint) {
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
      el.launcher.setAttribute("aria-expanded", "false");
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
    el.messages = shadow.querySelector("[data-messages]");
    el.chips = shadow.querySelector("[data-chips]");
    el.input = shadow.querySelector("[data-input]");
    el.form = shadow.querySelector("[data-form]");
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
