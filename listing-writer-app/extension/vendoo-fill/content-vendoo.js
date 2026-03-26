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
      { key: "title", label: "eBay title", value: pickEbayTitle(payload), selectorConfig: selectors.title },
      {
        key: "description",
        label: "eBay description",
        value: payload?.marketplaces?.ebay?.description ?? "",
        selectorConfig: selectors.description,
      },
      {
        key: "category",
        label: "eBay category",
        value: pickEbayCategory(payload),
        selectorConfig: selectors.category,
      },
      { key: "brand", label: "eBay brand", value: pickEbayBrand(payload), selectorConfig: selectors.brand },
      { key: "size", label: "eBay size", value: pickEbaySize(payload), selectorConfig: selectors.size },
      { key: "color", label: "eBay color", value: pickEbayColor(payload), selectorConfig: selectors.color },
    ];

    const filled = [];
    const needsReview = [];
    const skippedForSafety = [];
    const usedElements = new Set();

    for (const step of fillSteps) {
      const rawValue = typeof step.value === "string" ? step.value.trim() : "";
      if (!rawValue) {
        needsReview.push(`${step.label} (payload missing)`);
        continue;
      }

      const field = findElementBySelectorMap(step.selectorConfig);
      if (!field) {
        needsReview.push(step.label);
        continue;
      }

      if (usedElements.has(field)) {
        skippedForSafety.push(`${step.label} (collision prevention)`);
        continue;
      }

      if (step.selectorConfig?.controlType === "custom_select") {
        const valueResult = getCustomSelectAttemptValue(step.key, rawValue);
        if (!valueResult.value) {
          needsReview.push(`${step.label} (${valueResult.reason})`);
          continue;
        }

        const customSelectResult = await tryFillCustomSelect({
          step,
          value: valueResult.value,
          control: field,
          usedElements,
        });

        if (customSelectResult.status === "filled") {
          filled.push(step.label);
          continue;
        }

        if (customSelectResult.status === "needs_review") {
          needsReview.push(`${step.label} (${customSelectResult.reason})`);
          continue;
        }

        skippedForSafety.push(`${step.label} (${customSelectResult.reason})`);
        continue;
      }

      if (step.selectorConfig?.controlType === "text" && !field.matches("input")) {
        skippedForSafety.push(`${step.label} (unexpected control type)`);
        continue;
      }

      if (
        step.selectorConfig?.controlType === "textarea" &&
        !field.matches('textarea, [contenteditable="true"]')
      ) {
        skippedForSafety.push(`${step.label} (unexpected control type)`);
        continue;
      }

      setElementValue(field, rawValue);
      usedElements.add(field);
      filled.push(step.label);
    }

    const parts = [];
    if (filled.length) parts.push(`Filled: ${filled.join(", ")}`);
    if (needsReview.length) parts.push(`Needs review: ${needsReview.join(", ")}`);
    if (skippedForSafety.length) {
      parts.push(`Skipped for safety: ${skippedForSafety.join(", ")}`);
    }

    reportEl.textContent = parts.join(" | ") || "Nothing changed.";
    await refreshPanel();
  }

  async function tryFillCustomSelect(input) {
    const { step, value, control, usedElements } = input;
    const fieldConfig = step.selectorConfig ?? {};

    if (!isSafeCustomSelectControl(control)) {
      return { status: "skipped_for_safety", reason: "unexpected control type" };
    }

    if (step.key === "category") {
      const stagedCategoryResult = await tryFillCategoryByStages({
        value,
        control,
        fieldConfig,
      });

      if (stagedCategoryResult.status === "filled") {
        usedElements.add(control);
      }

      return stagedCategoryResult;
    }

    openCustomSelectControl(control);
    await wait(140);

    const options = findVisibleOptions(fieldConfig.optionSelectors ?? []);
    const matchingOptions = findMatchingOptions(options, value);

    if (matchingOptions.length === 1) {
      clickElement(matchingOptions[0]);
      usedElements.add(control);
      return { status: "filled" };
    }

    if (matchingOptions.length > 1) {
      return { status: "needs_review", reason: "multiple matching options" };
    }

    if (fieldConfig.allowTypedEntry) {
      const typedEntry = tryTypedEntry(control, value);
      if (typedEntry) {
        usedElements.add(control);
        return { status: "filled" };
      }
    }

    return { status: "needs_review", reason: "no safe visible option match" };
  }

  async function tryFillCategoryByStages(input) {
    const { value, control, fieldConfig } = input;
    const stages = splitCategoryStages(value);
    if (!stages.length) {
      return { status: "needs_review", reason: "no category stages found" };
    }

    openCustomSelectControl(control);
    await wait(150);

    for (let index = 0; index < stages.length; index += 1) {
      const stageLabel = stages[index];
      const pickerRoot = findVisibleCategoryPicker(fieldConfig.pickerContainerSelectors ?? []);
      const options = findVisibleOptions(fieldConfig.optionSelectors ?? [], pickerRoot ?? undefined);
      const matches = findMatchingOptions(options, stageLabel);

      if (matches.length !== 1) {
        return {
          status: "needs_review",
          reason: `stopped at stage ${index + 1}`,
        };
      }

      clickElement(matches[0]);
      await wait(180);
    }

    return { status: "filled" };
  }

  function isSafeCustomSelectControl(control) {
    return control.matches('button, [role="combobox"], input[type="text"], input:not([type])');
  }

  function openCustomSelectControl(control) {
    control.focus();
    clickElement(control);
  }

  function findVisibleCategoryPicker(pickerContainerSelectors) {
    for (const selector of pickerContainerSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find((candidate) => isVisible(candidate));
      if (visible) return visible;
    }

    return null;
  }

  function findVisibleOptions(optionSelectors, root) {
    const selectors = optionSelectors.length
      ? optionSelectors
      : [
          '[role="option"]',
          '[data-radix-collection-item]',
          '.select__option',
          'li[role="option"]',
        ];

    const seen = new Set();
    const options = [];

    const scope = root ?? document;
    for (const selector of selectors) {
      const candidates = Array.from(scope.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        if (!isVisible(candidate)) continue;
        if (seen.has(candidate)) continue;

        seen.add(candidate);
        options.push(candidate);
      }
    }

    return options;
  }

  function findMatchingOptions(options, value) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) return [];

    return options.filter((option) => normalizeText(getOptionText(option)) === normalizedValue);
  }

  function getOptionText(option) {
    return [
      option.textContent,
      option.getAttribute("aria-label"),
      option.getAttribute("title"),
      option.getAttribute("data-value"),
      option.getAttribute("value"),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function getCustomSelectAttemptValue(fieldKey, value) {
    if (fieldKey !== "color") {
      return { value, reason: "" };
    }

    const baseColor = extractSafeBaseColor(value);
    if (!baseColor) {
      return { value: null, reason: "no safe base color" };
    }

    return { value: baseColor, reason: "" };
  }

  function splitCategoryStages(value) {
    return value
      .split(">")
      .map((part) => normalizeText(part))
      .filter(Boolean);
  }

  function extractSafeBaseColor(value) {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    if (normalized.includes("multicolor") || normalized.includes("multi color")) {
      return null;
    }

    if (normalized.includes("navy")) {
      return null;
    }

    const allowedBaseColors = [
      "black",
      "blue",
      "brown",
      "gray",
      "green",
      "orange",
      "pink",
      "purple",
      "red",
      "white",
      "yellow",
      "beige",
      "tan",
      "ivory",
      "cream",
      "gold",
      "silver",
    ];

    const matchedColors = allowedBaseColors.filter((color) =>
      normalized.split(" ").includes(color)
    );

    if (matchedColors.length !== 1) {
      return null;
    }

    return matchedColors[0];
  }

  function tryTypedEntry(control, value) {
    if (!control.matches('input[type="text"], input:not([type])')) {
      return false;
    }

    const metadata = normalizeText(
      [
        control.getAttribute("placeholder"),
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.getAttribute("data-testid"),
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (!metadata.includes("write your own") && !metadata.includes("select or write your own")) {
      return false;
    }

    setElementValue(control, value);
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    control.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    return true;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clickElement(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }

    return el.getClientRects().length > 0;
  }

  function getSelectorMap() {
    return window.LPU_VENDOO_SELECTORS ?? {
      ebay: {
        title: {
          controlType: "text",
          labelStrategies: [
            {
              labelTerms: ["ebay title", "title"],
              elementSelector: 'input[type="text"], input:not([type])',
              metadataIncludes: ["title"],
              metadataExcludes: ["category", "brand", "size", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'input[type="text"], input:not([type])',
              metadataIncludes: ["title"],
              metadataExcludes: ["category", "brand", "size", "color", "colour"],
            },
          ],
        },
        description: {
          controlType: "textarea",
          labelStrategies: [
            {
              labelTerms: ["ebay description", "description"],
              elementSelector: "textarea",
              metadataIncludes: ["description"],
              metadataExcludes: ["title", "category"],
            },
            {
              labelTerms: ["ebay description", "description", "details"],
              elementSelector: '[contenteditable="true"]',
              metadataIncludes: ["description", "details"],
              metadataExcludes: ["title", "category"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: "textarea",
              metadataIncludes: ["description", "details"],
              metadataExcludes: ["title", "category"],
            },
            {
              elementSelector: '[contenteditable="true"]',
              metadataIncludes: ["description", "details"],
              metadataExcludes: ["title", "category"],
            },
          ],
        },
        category: {
          controlType: "custom_select",
          allowTypedEntry: false,
          pickerContainerSelectors: [
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[data-radix-dialog-content]',
            '[data-testid*="category"]',
            ".modal",
          ],
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["ebay category", "category"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["category"],
              metadataExcludes: ["title", "brand", "size", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["category"],
              metadataExcludes: ["title", "brand", "size", "color", "colour"],
            },
          ],
        },
        brand: {
          controlType: "custom_select",
          allowTypedEntry: true,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["brand"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["brand"],
              metadataExcludes: ["title", "category", "size", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["brand"],
              metadataExcludes: ["title", "category", "size", "color", "colour"],
            },
          ],
        },
        size: {
          controlType: "custom_select",
          allowTypedEntry: false,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["size"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["size"],
              metadataExcludes: ["title", "category", "brand", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["size"],
              metadataExcludes: ["title", "category", "brand", "color", "colour"],
            },
          ],
        },
        color: {
          controlType: "custom_select",
          allowTypedEntry: false,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["color", "colour"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["color", "colour"],
              metadataExcludes: ["title", "category", "brand", "size"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["color", "colour"],
              metadataExcludes: ["title", "category", "brand", "size"],
            },
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
    const brand =
      payload?.marketplaces?.ebay?.itemSpecifics?.brand ??
      payload?.marketplaces?.ebay?.brand ??
      "";
    return typeof brand === "string" ? brand.trim() : "";
  }

  function pickEbaySize(payload) {
    const size =
      payload?.marketplaces?.ebay?.itemSpecifics?.size ??
      payload?.marketplaces?.ebay?.size ??
      "";
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
      const found = findByLabelStrategy(strategy);
      if (found) return found;
    }

    const fallbackStrategies = fieldConfig?.fallbackStrategies ?? [];
    for (const strategy of fallbackStrategies) {
      const found = findByFallbackStrategy(strategy);
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

  function findByLabelStrategy(strategy) {
    const terms = (strategy?.labelTerms ?? []).map(normalizeText);
    if (!terms.length) return null;

    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const labelText = normalizeText(label.textContent);
      if (!terms.some((term) => labelText.includes(term))) continue;

      const candidates = collectLabelCandidates(label, strategy.elementSelector);
      const matched = candidates.find((el) => matchesStrategy(el, strategy));
      if (matched) return matched;
    }

    return null;
  }

  function collectLabelCandidates(label, elementSelector) {
    const selector = elementSelector || "input, textarea, [contenteditable='true'], button";
    const seen = new Set();
    const candidates = [];

    function addCandidate(el) {
      if (!el || !(el instanceof Element) || seen.has(el)) return;
      seen.add(el);
      candidates.push(el);
    }

    const forId = label.getAttribute("for");
    if (forId) {
      const linked = document.getElementById(forId);
      if (linked?.matches(selector)) addCandidate(linked);
    }

    label.querySelectorAll(selector).forEach(addCandidate);

    const parent = label.parentElement;
    if (parent) {
      parent.querySelectorAll(selector).forEach(addCandidate);
    }

    const container = label.closest("div, section, form");
    if (container) {
      container.querySelectorAll(selector).forEach(addCandidate);
    }

    return candidates;
  }

  function findByFallbackStrategy(strategy) {
    const selector = strategy?.elementSelector;
    if (!selector) return null;

    const elements = Array.from(document.querySelectorAll(selector));
    return elements.find((el) => matchesStrategy(el, strategy)) || null;
  }

  function matchesStrategy(el, strategy) {
    const includes = strategy?.metadataIncludes ?? [];
    const excludes = strategy?.metadataExcludes ?? [];

    const metadata = normalizeText(
      [
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.getAttribute("title"),
        el.getAttribute("role"),
        el.className,
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (includes.length && !includes.some((term) => metadata.includes(normalizeText(term)))) {
      return false;
    }

    if (excludes.some((term) => metadata.includes(normalizeText(term)))) {
      return false;
    }

    return true;
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
