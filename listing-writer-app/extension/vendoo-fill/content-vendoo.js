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

    const title = record.payload?.marketplaces?.ebay?.title ?? "";
    const description = record.payload?.marketplaces?.ebay?.description ?? "";
    const savedAt = record.savedAt
      ? new Date(record.savedAt).toLocaleString()
      : "unknown";

    statusEl.innerHTML = `
      <div><strong>Stored:</strong> ${savedAt}</div>
      <div><strong>eBay title:</strong> ${title ? "ready" : "missing"}</div>
      <div><strong>eBay description:</strong> ${description ? "ready" : "missing"}</div>
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

    const ebayTitle = payload?.marketplaces?.ebay?.title ?? "";
    const ebayDescription = payload?.marketplaces?.ebay?.description ?? "";

    const filled = [];
    const needsReview = [];

    if (ebayTitle) {
      const titleField =
        findField(["ebay title", "title"], "input") ||
        findInputFallback(["title", "ebay"]);

      if (titleField) {
        setElementValue(titleField, ebayTitle);
        filled.push("eBay title");
      } else {
        needsReview.push("eBay title");
      }
    } else {
      needsReview.push("eBay title (payload missing)");
    }

    if (ebayDescription) {
      const descriptionField =
        findField(["ebay description", "description"], "textarea") ||
        findField(["ebay description", "description"], '[contenteditable="true"]') ||
        findTextareaFallback(["description", "details"]);

      if (descriptionField) {
        setElementValue(descriptionField, ebayDescription);
        filled.push("eBay description");
      } else {
        needsReview.push("eBay description");
      }
    } else {
      needsReview.push("eBay description (payload missing)");
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

  function findInputFallback(keywords) {
    const terms = keywords.map(normalizeText);
    const inputs = Array.from(document.querySelectorAll("input"));

    return (
      inputs.find((el) => matchesElementMetadata(el, terms)) ||
      null
    );
  }

  function findTextareaFallback(keywords) {
    const terms = keywords.map(normalizeText);

    const textarea =
      Array.from(document.querySelectorAll("textarea")).find((el) =>
        matchesElementMetadata(el, terms)
      ) || null;

    if (textarea) return textarea;

    return (
      Array.from(document.querySelectorAll('[contenteditable="true"]')).find((el) =>
        matchesElementMetadata(el, terms)
      ) || null
    );
  }

  function matchesElementMetadata(el, terms) {
    const haystack = normalizeText(
      [
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.getAttribute("title")
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
    descriptor.set.call(el, value);

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