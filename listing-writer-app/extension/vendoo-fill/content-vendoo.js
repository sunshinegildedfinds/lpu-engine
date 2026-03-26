(() => {
  if (window.__LPU_VENDOO_PAGE_BRIDGE__) return;
  window.__LPU_VENDOO_PAGE_BRIDGE__ = true;

  const PANEL_ID = "lpu-vendoo-panel";

  init();

  async function init() {
    createPanel();
    await refreshPanel();
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">LPU Vendoo Fill</div>
      <div id="lpu-vendoo-status" style="font-size:12px;line-height:1.4;margin-bottom:10px;color:#374151;">
        Checking stored payload...
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="lpu-vendoo-refresh" type="button">Refresh</button>
        <button id="lpu-vendoo-fill-ebay" type="button">Fill eBay</button>
        <button id="lpu-vendoo-clear" type="button">Clear</button>
      </div>
      <div id="lpu-vendoo-report" style="font-size:12px;line-height:1.4;margin-top:10px;color:#111827;"></div>
    `;

    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "2147483647";
    panel.style.width = "280px";
    panel.style.background = "#ffffff";
    panel.style.border = "1px solid #d1d5db";
    panel.style.borderRadius = "12px";
    panel.style.padding = "12px";
    panel.style.boxShadow = "0 12px 28px rgba(0,0,0,0.18)";
    panel.style.fontFamily = "system-ui, sans-serif";
    panel.style.fontSize = "13px";

    document.documentElement.appendChild(panel);

    styleButton("lpu-vendoo-refresh");
    styleButton("lpu-vendoo-fill-ebay");
    styleButton("lpu-vendoo-clear");

    document
      .getElementById("lpu-vendoo-refresh")
      .addEventListener("click", refreshPanel);

    document
      .getElementById("lpu-vendoo-fill-ebay")
      .addEventListener("click", fillEbayFields);

    document
      .getElementById("lpu-vendoo-clear")
      .addEventListener("click", clearStoredPayload);
  }

  function styleButton(id) {
    const button = document.getElementById(id);
    if (!button) return;

    button.style.border = "1px solid #d1d5db";
    button.style.background = "#f9fafb";
    button.style.borderRadius = "8px";
    button.style.padding = "8px 10px";
    button.style.fontSize = "12px";
    button.style.cursor = "pointer";
  }

  async function refreshPanel() {
    const statusEl = document.getElementById("lpu-vendoo-status");
    const reportEl = document.getElementById("lpu-vendoo-report");

    const record = await getStoredPayload();
    reportEl.textContent = "";

    if (!record?.payload) {
      statusEl.textContent = "No payload stored yet. Send one from your app first.";
      return;
    }

    const ebayPayload = record.payload?.marketplaces?.ebay ?? {};
    const title = pickEbayTitle(record.payload);
    const description = ebayPayload.description ?? "";
    const category = pickEbayCategory(record.payload);
    const brand = pickEbayBrand(record.payload);
    const size = pickEbaySize(record.payload);
    const color = pickEbayColor(record.payload);
    const savedAt = record.savedAt
      ? new Date(record.savedAt).toLocaleString()
      : "unknown";

    statusEl.innerHTML = `
      <div><strong>Stored:</strong> ${savedAt}</div>
      <div><strong>eBay title:</strong> ${title ? "ready" : "missing"}</div>
      <div><strong>eBay description:</strong> ${description ? "ready" : "missing"}</div>
      <div><strong>eBay category:</strong> ${category ? "ready" : "missing"}</div>
      <div><strong>eBay brand:</strong> ${brand ? "ready" : "missing"}</div>
      <div><strong>eBay size:</strong> ${size ? "ready" : "missing"}</div>
      <div><strong>eBay color:</strong> ${color ? "ready" : "missing"}</div>
    `;
  }

  async function clearStoredPayload() {
    const statusEl = document.getElementById("lpu-vendoo-status");
    const reportEl = document.getElementById("lpu-vendoo-report");

    chrome.runtime.sendMessage({ type: "CLEAR_PAYLOAD" }, async (response) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError) {
        reportEl.textContent = `Clear failed: ${runtimeError}`;
        return;
      }

      if (!response?.ok) {
        reportEl.textContent = `Clear failed: ${response?.error ?? "Unknown error"}`;
        return;
      }

      statusEl.textContent = "No payload stored yet. Send one from your app first.";
      reportEl.textContent = "Stored payload cleared.";
    });
  }

  async function fillEbayFields() {
    const reportEl = document.getElementById("lpu-vendoo-report");
    reportEl.textContent = "Attempting fill...";

    const record = await getStoredPayload();
    const payload = record?.payload;

    if (!payload) {
      reportEl.textContent = "No stored payload found.";
      return;
    }

    const selectors = getSelectorMap().ebay;

    const fillSteps = [
      {
        label: "eBay title",
        value: pickEbayTitle(payload),
        selectorConfig: selectors.title,
      },
      {
        label: "eBay description",
        value: payload?.marketplaces?.ebay?.description ?? "",
        selectorConfig: selectors.description,
      },
      {
        label: "eBay category",
        value: pickEbayCategory(payload),
        selectorConfig: selectors.category,
      },
      {
        label: "eBay brand",
        value: pickEbayBrand(payload),
        selectorConfig: selectors.brand,
      },
      {
        label: "eBay size",
        value: pickEbaySize(payload),
        selectorConfig: selectors.size,
      },
      {
        label: "eBay color",
        value: pickEbayColor(payload),
        selectorConfig: selectors.color,
      },
    ];

    const filled = [];
    const needsReview = [];

    for (const step of fillSteps) {
      const value = typeof step.value === "string" ? step.value.trim() : "";
      if (!value) {
        needsReview.push(`${step.label} (payload missing)`);
        continue;
      }

      const field = findElementBySelectorMap(step.selectorConfig);
      if (field) {
        setElementValue(field, value);
        filled.push(step.label);
      } else {
        needsReview.push(step.label);
      }
    }

    const parts = [];
    if (filled.length) {
      parts.push(`Filled: ${filled.join(", ")}`);
    }
    if (needsReview.length) {
      parts.push(`Needs review: ${needsReview.join(", ")}`);
    }

    reportEl.textContent = parts.join(" | ") || "Nothing changed.";
    await refreshPanel();
  }

  function getSelectorMap() {
    return window.LPU_VENDOO_SELECTORS ?? {
      ebay: {
        title: {
          labelStrategies: [{ labelTerms: ["ebay title", "title"], fieldSelector: "input" }],
          fallbackStrategies: [{ fieldSelector: "input", keywords: ["title", "ebay"] }],
        },
        description: {
          labelStrategies: [
            { labelTerms: ["ebay description", "description"], fieldSelector: "textarea" },
            {
              labelTerms: ["ebay description", "description"],
              fieldSelector: '[contenteditable="true"]',
            },
          ],
          fallbackStrategies: [
            { fieldSelector: "textarea", keywords: ["description", "details"] },
            { fieldSelector: '[contenteditable="true"]', keywords: ["description", "details"] },
          ],
        },
        category: {
          labelStrategies: [
            { labelTerms: ["ebay category", "category"], fieldSelector: "input" },
          ],
          fallbackStrategies: [
            { fieldSelector: "input", keywords: ["category", "ebay"] },
            { fieldSelector: "input", keywords: ["category"] },
          ],
        },
        brand: {
          labelStrategies: [{ labelTerms: ["brand"], fieldSelector: "input" }],
          fallbackStrategies: [{ fieldSelector: "input", keywords: ["brand"] }],
        },
        size: {
          labelStrategies: [{ labelTerms: ["size"], fieldSelector: "input" }],
          fallbackStrategies: [{ fieldSelector: "input", keywords: ["size"] }],
        },
        color: {
          labelStrategies: [{ labelTerms: ["color", "colour"], fieldSelector: "input" }],
          fallbackStrategies: [
            { fieldSelector: "input", keywords: ["color"] },
            { fieldSelector: "input", keywords: ["colour"] },
          ],
        },
      },
    };
  }

  function pickEbayTitle(payload) {
    const title = payload?.marketplaces?.ebay?.title ?? "";
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }

    const titleA = payload?.marketplaces?.ebay?.titleA ?? "";
    if (typeof titleA === "string" && titleA.trim()) {
      return titleA.trim();
    }

    return "";
  }

  function pickEbayCategory(payload) {
    const category = payload?.marketplaces?.ebay?.category ?? "";
    return typeof category === "string" ? category.trim() : "";
  }

  function pickEbayBrand(payload) {
    const brand = payload?.marketplaces?.ebay?.itemSpecifics?.brand ?? payload?.marketplaces?.ebay?.brand ?? "";
    return typeof brand === "string" ? brand.trim() : "";
  }

  function pickEbaySize(payload) {
    const size = payload?.marketplaces?.ebay?.itemSpecifics?.size ?? payload?.marketplaces?.ebay?.size ?? "";
    return typeof size === "string" ? size.trim() : "";
  }

  function pickEbayColor(payload) {
    const color =
      payload?.marketplaces?.ebay?.itemSpecifics?.color ??
      payload?.marketplaces?.ebay?.itemSpecifics?.colour ??
      payload?.marketplaces?.ebay?.color ??
      "";

    return typeof color === "string" ? color.trim() : "";
  }

  function findElementBySelectorMap(fieldConfig) {
    const labelStrategies = fieldConfig?.labelStrategies ?? [];
    for (const strategy of labelStrategies) {
      const found = findField(strategy.labelTerms ?? [], strategy.fieldSelector);
      if (found) return found;
    }

    const fallbackStrategies = fieldConfig?.fallbackStrategies ?? [];
    for (const strategy of fallbackStrategies) {
      const found = findFallback(strategy.keywords ?? [], strategy.fieldSelector);
      if (found) return found;
    }

    return null;
  }

  function getStoredPayload() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_PAYLOAD" }, (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError || !response?.ok) {
          resolve(null);
          return;
        }

        resolve(response.record ?? null);
      });
    });
  }

  function findField(labelTerms, fieldSelector) {
    const terms = labelTerms.map(normalizeText);

    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const labelText = normalizeText(label.textContent);
      if (!terms.some((term) => labelText.includes(term))) continue;

      const forId = label.getAttribute("for");
      if (forId) {
        const linked = document.getElementById(forId);
        if (linked && linked.matches(fieldSelector)) return linked;
      }

      const insideLabel = label.querySelector(fieldSelector);
      if (insideLabel) return insideLabel;

      const parent = label.parentElement;
      if (parent) {
        const nearby = parent.querySelector(fieldSelector);
        if (nearby) return nearby;
      }

      const container = label.closest("div, section, form");
      if (container) {
        const nearby = container.querySelector(fieldSelector);
        if (nearby) return nearby;
      }
    }

    return null;
  }

  function findFallback(keywords, fieldSelector) {
    const terms = keywords.map(normalizeText);
    const elements = Array.from(document.querySelectorAll(fieldSelector));

    return elements.find((el) => matchesElementMetadata(el, terms)) || null;
  }

  function matchesElementMetadata(el, terms) {
    const haystack = normalizeText(
      [
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.getAttribute("title"),
      ]
        .filter(Boolean)
        .join(" ")
    );

    return terms.some((term) => haystack.includes(term));
  }

  function setElementValue(el, value) {
    el.focus();

    if (el.matches('[contenteditable="true"]')) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }

    const prototype =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(el, value);

    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
})();
