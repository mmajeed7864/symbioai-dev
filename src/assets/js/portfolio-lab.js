(() => {
  const labs = document.querySelectorAll("[data-product-lab]");
  if (!labs.length) return;

  const SCAN_PROFILES = {
    leads: {
      score: 89,
      route: "Conversion site + lead routing",
      summary: "Shorten the mobile path, move proof forward, and route every inquiry to one owner.",
      priority: "P0 conversion path",
      fix: "Mobile inquiry flow",
      reply: "Under 5 minutes",
    },
    bookings: {
      score: 92,
      route: "Booking site + reminder flow",
      summary:
        "Put availability, services, and confirmation into one path that reduces back-and-forth.",
      priority: "P0 booking path",
      fix: "Fewer booking steps",
      reply: "Instant confirmation",
    },
    sales: {
      score: 84,
      route: "Commerce site + recovery flow",
      summary:
        "Clarify the offer, simplify checkout, and recover visitors who leave before purchasing.",
      priority: "P1 revenue path",
      fix: "Product-to-checkout flow",
      reply: "Within 10 minutes",
    },
    brand: {
      score: 81,
      route: "Premium website redesign",
      summary:
        "Modernize the first impression, improve mobile hierarchy, and make the next action unmistakable.",
      priority: "P1 trust rebuild",
      fix: "Visual credibility",
      reply: "Same business day",
    },
  };

  const AGENT_SCENARIOS = {
    pricing: {
      lead: "How much would a booking website cost for my salon?",
      reply:
        "A focused salon website with services, booking, and lead capture starts with a quick scope check. Send the current link and we can show the first improvements before pricing the build.",
      intent: "Website + booking",
      score: "86 / 100",
      owner: "Founder queue",
      next: "Draft pricing reply",
    },
    afterhours: {
      lead: "It is late, but can someone look at our HVAC website tomorrow?",
      reply:
        "Absolutely. Send the website and the best contact. We will review the mobile experience, calls-to-action, and missed-lead flow, then route the notes to a founder for the morning.",
      intent: "After-hours audit",
      score: "91 / 100",
      owner: "Morning priority",
      next: "Collect site + contact",
    },
    handoff: {
      lead: "We need a client portal with logins and file uploads. Can I talk to someone?",
      reply:
        "Yes. That needs a short discovery call so the login, permissions, uploads, and status flow are scoped correctly. I can package these requirements for a founder handoff now.",
      intent: "Custom client portal",
      score: "95 / 100",
      owner: "Founder discovery",
      next: "Approve human handoff",
    },
  };

  function safeHost(value) {
    const candidate = String(value || "").trim();
    if (!candidate) return "yourbusiness.com";
    try {
      const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
      return new URL(normalized).hostname.replace(/^www\./, "") || "yourbusiness.com";
    } catch (error) {
      return candidate.replace(/^https?:\/\//i, "").split("/")[0] || "yourbusiness.com";
    }
  }

  function initTabs(lab) {
    const tabs = Array.from(lab.querySelectorAll("[data-lab-tab]"));
    const panels = Array.from(lab.querySelectorAll("[data-lab-panel]"));
    const eyebrow = lab.querySelector("[data-lab-eyebrow]");
    const title = lab.querySelector("[data-lab-title]");
    const status = lab.querySelector("[data-lab-status]");
    const labels = {
      scan: ["Live workflow 01", "Free scan intake app"],
      booking: ["Live workflow 02", "Client booking dashboard"],
      agent: ["Live workflow 03", "AI lead follow-up agent"],
      portal: ["Live workflow 04", "School or nonprofit request portal"],
    };
    let active = "scan";

    function announce(message) {
      if (status) status.textContent = message;
    }

    function selectTab(name, focusTab, updateHash) {
      const nextTab = tabs.find((tab) => tab.dataset.labTab === name) || tabs[0];
      if (!nextTab) return;
      active = nextTab.dataset.labTab;

      tabs.forEach((tab) => {
        const selected = tab === nextTab;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      panels.forEach((panel) => {
        const selected = panel.dataset.labPanel === active;
        panel.hidden = !selected;
        panel.classList.toggle("is-active", selected);
      });

      if (labels[active]) {
        if (eyebrow) eyebrow.textContent = labels[active][0];
        if (title) title.textContent = labels[active][1];
      }
      announce("Demo environment online");
      if (focusTab) nextTab.focus();
      if (updateHash && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", `#lab-${active}`);
      }
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectTab(tab.dataset.labTab, false, true));
      tab.addEventListener("keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown")
          nextIndex = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp")
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = tabs.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        selectTab(tabs[nextIndex].dataset.labTab, true, true);
      });
    });

    const requested = window.location.hash.replace(/^#lab-/, "");
    selectTab(labels[requested] ? requested : active, false, false);
    return announce;
  }

  function initScanDemo(lab, announce) {
    const form = lab.querySelector("[data-scan-demo]");
    if (!form) return;
    const goal = form.querySelector("[data-scan-goal]");
    const speed = form.querySelector("[data-scan-speed]");
    const url = form.querySelector("[data-scan-url]");
    const output = lab.querySelector("[data-scan-output]");
    const scoreRing = lab.querySelector("[data-scan-score-ring]");
    const fields = {
      score: lab.querySelector("[data-scan-score]"),
      id: lab.querySelector("[data-scan-id]"),
      route: lab.querySelector("[data-scan-route]"),
      summary: lab.querySelector("[data-scan-summary]"),
      priority: lab.querySelector("[data-scan-priority]"),
      fix: lab.querySelector("[data-scan-fix]"),
      reply: lab.querySelector("[data-scan-reply]"),
      progress: lab.querySelector("[data-scan-progress]"),
      site: lab.querySelector("[data-scan-site]"),
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const base = SCAN_PROFILES[goal.value] || SCAN_PROFILES.leads;
      const checked = form.querySelectorAll('input[type="checkbox"]:checked').length;
      const speedBoost = speed.value === "urgent" ? 2 : speed.value === "planning" ? -2 : 0;
      const score = Math.max(72, Math.min(97, base.score + Math.min(checked, 3) + speedBoost));
      const host = safeHost(url.value);
      const id = `SCAN-${String(1000 + Math.floor(Math.random() * 9000))}`;

      if (fields.score) fields.score.textContent = String(score);
      if (fields.id) fields.id.textContent = id;
      if (fields.route) fields.route.textContent = base.route;
      if (fields.summary) fields.summary.textContent = base.summary;
      if (fields.priority) fields.priority.textContent = base.priority;
      if (fields.fix) fields.fix.textContent = checked ? base.fix : "Clarify the primary path";
      if (fields.reply) fields.reply.textContent = base.reply;
      if (fields.progress) fields.progress.style.setProperty("--progress", `${score}%`);
      if (fields.site) fields.site.textContent = host;
      if (scoreRing) scoreRing.style.setProperty("--score", String(score));

      output?.classList.remove("is-updating");
      window.requestAnimationFrame(() => output?.classList.add("is-updating"));
      announce("Scan packet generated");
    });
  }

  function initBookingDemo(lab, announce) {
    const demo = lab.querySelector("[data-booking-demo]");
    if (!demo) return;
    const list = demo.querySelector("[data-booking-list]");
    const filters = Array.from(demo.querySelectorAll("[data-booking-filter]"));
    const add = demo.querySelector("[data-booking-add]");
    const message = demo.querySelector("[data-booking-message]");
    const total = demo.querySelector("[data-booking-total]");
    const confirmed = demo.querySelector("[data-booking-confirmed]");
    const attention = demo.querySelector("[data-booking-attention]");
    let activeFilter = "all";
    let sampleCount = 0;

    function rows() {
      return Array.from(list.querySelectorAll(".booking-row"));
    }

    function applyFilter() {
      rows().forEach((row) => {
        const state = row.dataset.bookingState;
        const visible =
          activeFilter === "all" ||
          state === activeFilter ||
          (activeFilter === "confirmed" && (state === "arrived" || state === "complete"));
        row.hidden = !visible;
      });
    }

    function updateMetrics(copy) {
      const current = rows();
      if (total) total.textContent = String(current.length);
      if (confirmed) {
        confirmed.textContent = String(
          current.filter((row) =>
            ["confirmed", "arrived", "complete"].includes(row.dataset.bookingState)
          ).length
        );
      }
      if (attention) {
        attention.textContent = String(
          current.filter((row) => row.dataset.bookingState === "attention").length
        );
      }
      if (message && copy) message.textContent = copy;
      applyFilter();
    }

    function setState(row, state) {
      const status = row.querySelector(".booking-status");
      const action = row.querySelector("[data-booking-action]");
      row.dataset.bookingState = state;
      status.className = `booking-status booking-status--${state}`;
      if (state === "confirmed") {
        status.textContent = "Confirmed";
        action.textContent = "Check in";
      } else if (state === "arrived") {
        status.textContent = "Checked in";
        action.textContent = "Complete";
      } else {
        status.textContent = "Complete";
        action.textContent = "Done";
        action.disabled = true;
      }
    }

    list.addEventListener("click", (event) => {
      const action = event.target.closest("[data-booking-action]");
      if (!action || action.disabled) return;
      const row = action.closest(".booking-row");
      if (!row) return;
      const next =
        row.dataset.bookingState === "attention"
          ? "confirmed"
          : row.dataset.bookingState === "confirmed"
            ? "arrived"
            : "complete";
      setState(row, next);
      updateMetrics(
        `${row.querySelector("strong").textContent} moved to ${row.querySelector(".booking-status").textContent.toLowerCase()}.`
      );
      announce("Booking dashboard updated");
    });

    filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.bookingFilter;
        filters.forEach((item) => item.classList.toggle("is-active", item === button));
        applyFilter();
      });
    });

    add?.addEventListener("click", () => {
      sampleCount += 1;
      const row = document.createElement("div");
      row.className = "booking-row is-new";
      row.dataset.bookingState = "attention";
      row.innerHTML = `<time>${sampleCount % 2 ? "4:30 PM" : "5:15 PM"}</time><span><strong>${sampleCount % 2 ? "Taylor Brooks" : "Sam Rivera"}</strong><small>Website review</small></span><span class="booking-status booking-status--attention">Needs reply</span><button type="button" data-booking-action>Confirm</button>`;
      list.prepend(row);
      activeFilter = "all";
      filters.forEach((item) =>
        item.classList.toggle("is-active", item.dataset.bookingFilter === "all")
      );
      updateMetrics("A new sample booking entered the queue.");
      announce("New booking captured");
    });
  }

  function initAgentDemo(lab, announce) {
    const demo = lab.querySelector("[data-agent-demo]");
    if (!demo) return;
    const buttons = Array.from(demo.querySelectorAll("[data-agent-scenario]"));
    const draft = demo.querySelector("[data-agent-draft]");
    const approve = demo.querySelector("[data-agent-approve]");
    const lead = demo.querySelector("[data-agent-lead]");
    const reply = demo.querySelector("[data-agent-reply]");
    const timeline = Array.from(demo.querySelectorAll(".agent-route__timeline span"));
    const fields = {
      state: demo.querySelector("[data-agent-state]"),
      intent: demo.querySelector("[data-agent-intent]"),
      score: demo.querySelector("[data-agent-score]"),
      owner: demo.querySelector("[data-agent-owner]"),
      next: demo.querySelector("[data-agent-next]"),
      caption: demo.querySelector("[data-agent-caption]"),
    };
    let scenario = "pricing";

    function reset(nextScenario) {
      scenario = nextScenario;
      const data = AGENT_SCENARIOS[scenario];
      buttons.forEach((button) =>
        button.classList.toggle("is-active", button.dataset.agentScenario === scenario)
      );
      if (lead) lead.textContent = data.lead;
      if (reply) {
        reply.textContent = "";
        reply.hidden = true;
      }
      if (fields.state) fields.state.textContent = "Ready";
      if (fields.intent) fields.intent.textContent = data.intent;
      if (fields.score) fields.score.textContent = data.score;
      if (fields.owner) fields.owner.textContent = data.owner;
      if (fields.next) fields.next.textContent = data.next;
      if (fields.caption) fields.caption.textContent = "No message leaves this demo.";
      if (draft) draft.disabled = false;
      if (approve) approve.disabled = true;
      timeline.forEach((step, index) => {
        step.classList.toggle("is-complete", index === 0);
        step.classList.toggle("is-active", index === 1);
      });
    }

    buttons.forEach((button) =>
      button.addEventListener("click", () => reset(button.dataset.agentScenario))
    );

    draft?.addEventListener("click", () => {
      const data = AGENT_SCENARIOS[scenario];
      if (reply) {
        reply.textContent = data.reply;
        reply.hidden = false;
      }
      draft.disabled = true;
      approve.disabled = false;
      if (fields.state) fields.state.textContent = "Draft ready";
      if (fields.next) fields.next.textContent = "Approve founder handoff";
      timeline.forEach((step, index) => {
        step.classList.toggle("is-complete", index <= 1);
        step.classList.toggle("is-active", index === 2);
      });
      announce("Lead response drafted");
    });

    approve?.addEventListener("click", () => {
      approve.disabled = true;
      if (fields.state) fields.state.textContent = "Approved";
      if (fields.next) fields.next.textContent = "Founder follow-up queued";
      if (fields.caption)
        fields.caption.textContent = "One approval moved the complete handoff packet.";
      timeline.forEach((step, index) => {
        step.classList.toggle("is-complete", index < timeline.length - 1);
        step.classList.toggle("is-active", index === timeline.length - 1);
      });
      announce("Founder handoff approved");
    });
  }

  function initPortalDemo(lab, announce) {
    const demo = lab.querySelector("[data-portal-demo]");
    if (!demo) return;
    const form = demo.querySelector("[data-portal-form]");
    const type = demo.querySelector("[data-portal-type]");
    const urgency = demo.querySelector("[data-portal-urgency]");
    const detail = demo.querySelector("[data-portal-detail]");
    const title = demo.querySelector("[data-portal-title]");
    const detailOutput = demo.querySelector("[data-portal-detail-output]");
    const id = demo.querySelector("[data-portal-id]");
    const advance = demo.querySelector("[data-portal-advance]");
    const steps = Array.from(demo.querySelectorAll("[data-portal-timeline] li"));
    let stage = 1;

    function paintStage() {
      steps.forEach((step, index) => {
        step.classList.toggle("is-complete", index < stage);
        step.classList.toggle("is-active", index === stage);
      });
      if (!advance) return;
      advance.disabled = stage >= steps.length;
      advance.textContent = stage >= steps.length ? "Workflow complete" : "Advance demo status";
    }

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      stage = 1;
      if (title) title.textContent = type.value;
      if (detailOutput)
        detailOutput.textContent = `${detail.value.trim() || "No additional details."} Priority: ${urgency.value}.`;
      if (id) id.textContent = `REQ-${String(1000 + Math.floor(Math.random() * 9000))}`;
      paintStage();
      announce("Request submitted to portal");
    });

    advance?.addEventListener("click", () => {
      stage = Math.min(steps.length, stage + 1);
      paintStage();
      announce(stage >= steps.length ? "Request workflow complete" : "Request status advanced");
    });
  }

  labs.forEach((lab) => {
    const announce = initTabs(lab);
    initScanDemo(lab, announce);
    initBookingDemo(lab, announce);
    initAgentDemo(lab, announce);
    initPortalDemo(lab, announce);
  });
})();
