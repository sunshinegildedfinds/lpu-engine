(() => {
  if (window.__LPU_VENDOO_APP_BRIDGE__) return;
  window.__LPU_VENDOO_APP_BRIDGE__ = true;

  const BRIDGE_SOURCE = "lpu-app";
  const BRIDGE_TYPE = "LPU_VENDOO_PAYLOAD";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE || data.type !== BRIDGE_TYPE) {
      return;
    }

    const normalized = normalizePayload(data.payload);

    chrome.runtime.sendMessage(
      {
        type: "STORE_PAYLOAD",
        payload: normalized,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError) {
          showToast(`Extension error: ${runtimeError}`, false);
          return;
        }

        if (!response?.ok) {
          showToast(`Save failed: ${response?.error ?? "Unknown error"}`, false);
          return;
        }

        showToast("Vendoo payload sent to extension.", true);
      }
    );
  });

  function normalizePayload(input) {
    const title = pickString(
      input,
      ["marketplaces", "ebay", "title"],
      ["marketplaces", "ebay", "titleA"],
      ["ebay", "title"],
      ["ebay", "titleA"],
      ["payloadMap", "ebay", "title"],
      ["payloadMap", "ebay", "titleA"]
    );

    const titleA = pickString(
      input,
      ["marketplaces", "ebay", "titleA"],
      ["ebay", "titleA"],
      ["payloadMap", "ebay", "titleA"]
    );

    const titleB = pickString(
      input,
      ["marketplaces", "ebay", "titleB"],
      ["ebay", "titleB"],
      ["payloadMap", "ebay", "titleB"]
    );

    const description = pickString(
      input,
      ["marketplaces", "ebay", "description"],
      ["ebay", "description"],
      ["payloadMap", "ebay", "description"]
    );

    const category = pickString(
      input,
      ["marketplaces", "ebay", "category"],
      ["ebay", "category"],
      ["payloadMap", "ebay", "category"]
    );

    const brand = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "brand"],
      ["marketplaces", "ebay", "brand"],
      ["ebay", "itemSpecifics", "brand"],
      ["ebay", "brand"],
      ["payloadMap", "ebay", "itemSpecifics", "brand"],
      ["payloadMap", "ebay", "brand"]
    );

    const size = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "size"],
      ["marketplaces", "ebay", "size"],
      ["ebay", "itemSpecifics", "size"],
      ["ebay", "size"],
      ["payloadMap", "ebay", "itemSpecifics", "size"],
      ["payloadMap", "ebay", "size"]
    );

    const color = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "color"],
      ["marketplaces", "ebay", "colour"],
      ["marketplaces", "ebay", "color"],
      ["ebay", "itemSpecifics", "color"],
      ["ebay", "itemSpecifics", "colour"],
      ["ebay", "color"],
      ["payloadMap", "ebay", "itemSpecifics", "color"],
      ["payloadMap", "ebay", "color"]
    );

    return {
      version: 1,
      meta: {
        sentAt: new Date().toISOString(),
        sourcePage: window.location.href,
      },
      marketplaces: {
        ebay: {
          title,
          titleA,
          titleB,
          description,
          category,
          itemSpecifics: {
            brand,
            size,
            color,
          },
        },
      },
      raw: input ?? null,
    };
  }

  function pickString(obj, ...paths) {
    for (const path of paths) {
      const value = getAtPath(obj, path);
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  function getAtPath(obj, path) {
    let current = obj;
    for (const key of path) {
      if (!current || typeof current !== "object" || !(key in current)) {
        return undefined;
      }
      current = current[key];
    }
    return current;
  }

  function showToast(message, ok) {
    const existing = document.getElementById("lpu-vendoo-extension-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "lpu-vendoo-extension-toast";
    toast.textContent = message;

    toast.style.position = "fixed";
    toast.style.top = "16px";
    toast.style.right = "16px";
    toast.style.zIndex = "2147483647";
    toast.style.padding = "10px 14px";
    toast.style.borderRadius = "10px";
    toast.style.fontSize = "13px";
    toast.style.fontFamily = "system-ui, sans-serif";
    toast.style.background = ok ? "#111827" : "#7f1d1d";
    toast.style.color = "#ffffff";
    toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.18)";

    document.documentElement.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 2500);
  }
})();
