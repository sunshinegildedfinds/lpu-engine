(() => {
  if (window.__LPU_VENDOO_APP_BRIDGE__) return;
  window.__LPU_VENDOO_APP_BRIDGE__ = true;

  const BRIDGE_SOURCE = "lpu-app";
  const BRIDGE_TYPE = "LPU_VENDOO_PAYLOAD";
  const TRANSIENT_PHOTO_KEY = "__LPU_VENDOO_TRANSIENT_PHOTO_PAYLOAD__";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE || data.type !== BRIDGE_TYPE) {
      return;
    }

    const normalized = normalizePayload(data.payload);
    cacheTransientPhotos(normalized.photos ?? []);
    const prepared = preparePayloadForStorage(normalized);

    if (!canUseChromeRuntimeMessaging()) {
      showToast("Save failed: extension messaging unavailable.", false);
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "STORE_PAYLOAD",
        payload: prepared.payloadForStorage,
        transientPhotos: normalized.photos ?? [],
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        const storageSaveError = runtimeError || (!response?.ok ? response?.error ?? "Unknown error" : "");
        const transportDiagnostics = {
          ...prepared.diagnostics,
          storageSavePassed: !storageSaveError,
          storageSaveError,
        };
        console.debug("[LPU Vendoo] Payload storage diagnostics", transportDiagnostics);

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
    const photos = pickPhotos(
      input,
      ["photos"],
      ["payloadMap", "photos"]
    );

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

    const canonicalVendooCategoryPath = pickString(
      input,
      ["marketplaces", "ebay", "canonicalVendooCategoryPath"],
      ["ebay", "canonicalVendooCategoryPath"],
      ["payloadMap", "ebay", "canonicalVendooCategoryPath"]
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

    const signedMaker = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "signedMaker"],
      ["marketplaces", "ebay", "itemSpecifics", "maker"],
      ["marketplaces", "ebay", "signedMaker"],
      ["ebay", "itemSpecifics", "signedMaker"],
      ["ebay", "itemSpecifics", "maker"],
      ["ebay", "signedMaker"]
    );

    const material = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "material"],
      ["marketplaces", "ebay", "material"],
      ["ebay", "itemSpecifics", "material"],
      ["ebay", "material"]
    );

    const styleType = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "styleType"],
      ["marketplaces", "ebay", "styleType"],
      ["ebay", "itemSpecifics", "styleType"],
      ["ebay", "styleType"]
    );
    const condition = pickString(
      input,
      ["marketplaces", "ebay", "itemSpecifics", "condition"],
      ["marketplaces", "ebay", "itemSpecifics", "itemCondition"],
      ["marketplaces", "ebay", "condition"],
      ["marketplaces", "ebay", "itemCondition"],
      ["ebay", "itemSpecifics", "condition"],
      ["ebay", "itemSpecifics", "itemCondition"],
      ["ebay", "condition"],
      ["ebay", "itemCondition"],
      ["payloadMap", "ebay", "itemSpecifics", "condition"],
      ["payloadMap", "ebay", "itemSpecifics", "itemCondition"],
      ["payloadMap", "ebay", "condition"],
      ["payloadMap", "ebay", "itemCondition"]
    );

    const incomingItemSpecifics = pickObject(
      input,
      ["marketplaces", "ebay", "itemSpecifics"],
      ["ebay", "itemSpecifics"],
      ["payloadMap", "ebay", "itemSpecifics"]
    );
    const resolvedPrice = pickDefined(
      input,
      ["resolvedPrice"],
      ["payloadMap", "resolvedPrice"]
    );
    const researchMeta = pickObject(
      input,
      ["researchMeta"],
      ["payloadMap", "researchMeta"]
    );
    const pricing = pickObject(
      input,
      ["pricing"],
      ["payloadMap", "pricing"]
    );
    const depop = pickObject(
      input,
      ["depop"],
      ["marketplaces", "depop"],
      ["payloadMap", "depop"]
    );
    const poshmark = pickObject(
      input,
      ["poshmark"],
      ["marketplaces", "poshmark"],
      ["payloadMap", "poshmark"]
    );
    const etsy = pickObject(
      input,
      ["etsy"],
      ["marketplaces", "etsy"],
      ["payloadMap", "etsy"]
    );
    const vendooBaseTags = pickStringArray(
      input,
      ["vendooBaseTags"],
      ["payloadMap", "vendooBaseTags"]
    );

    const normalizedItemSpecifics = normalizeItemSpecifics(incomingItemSpecifics);
    const itemSpecifics = {
      ...normalizedItemSpecifics,
      brand: normalizedItemSpecifics.brand || brand,
      size: normalizedItemSpecifics.size || size,
      color: normalizedItemSpecifics.color || color,
      ...(normalizedItemSpecifics.condition || condition
        ? { condition: normalizedItemSpecifics.condition || condition }
        : {}),
      ...(signedMaker ? { signedMaker } : {}),
      ...(material ? { material } : {}),
      ...(styleType ? { styleType } : {}),
    };

    const normalizedDepop =
      depop && typeof depop === "object"
        ? {
            listing: pickString(depop, ["listing"]),
            description: pickString(depop, ["description"], ["listing"]),
            hashtags: pickString(depop, ["hashtags"]),
            optionalBrandHashtags: pickString(depop, ["optionalBrandHashtags"]),
            ...(pickString(depop, ["brand"]) ? { brand: pickString(depop, ["brand"]) } : {}),
            ...(pickString(depop, ["size"]) ? { size: pickString(depop, ["size"]) } : {}),
            ...(pickString(depop, ["style"]) ? { style: pickString(depop, ["style"]) } : {}),
          }
        : null;
    const includeDepop = Boolean(
      normalizedDepop &&
        (normalizedDepop.listing ||
          normalizedDepop.description ||
          normalizedDepop.hashtags ||
          normalizedDepop.optionalBrandHashtags ||
          normalizedDepop.brand ||
          normalizedDepop.size ||
          normalizedDepop.style)
    );
    const normalizedPoshmark =
      poshmark && typeof poshmark === "object"
        ? {
            title: pickString(poshmark, ["title"]),
            description: pickString(poshmark, ["description"]),
            categoryPath: pickString(poshmark, ["categoryPath"], ["category"]),
            adjustedPrice: pickString(poshmark, ["adjustedPrice"]),
            styleTags: pickStringArray(poshmark, ["styleTags"]),
          }
        : null;
    const includePoshmark = Boolean(
      normalizedPoshmark &&
        (normalizedPoshmark.title ||
          normalizedPoshmark.description ||
          normalizedPoshmark.categoryPath ||
          normalizedPoshmark.adjustedPrice ||
          normalizedPoshmark.styleTags.length)
    );
    const normalizedEtsy =
      etsy && typeof etsy === "object"
        ? {
            title: pickString(etsy, ["title"]),
            description: pickString(etsy, ["description"]),
            categoryPath: pickString(etsy, ["categoryPath"], ["category"]),
            adjustedPrice: pickString(etsy, ["adjustedPrice"]),
            materials: pickString(etsy, ["materials"]),
            style: pickString(etsy, ["style"]),
            theme: pickString(etsy, ["theme"]),
            occasion: pickString(etsy, ["occasion"]),
            recipient: pickString(etsy, ["recipient"]),
            jewelryType: pickString(etsy, ["jewelryType"]),
            gemstone: pickString(etsy, ["gemstone"]),
            gemColor: pickString(etsy, ["gemColor"]),
            sustainability: pickString(etsy, ["sustainability"]),
            goldSolidity: pickString(etsy, ["goldSolidity"]),
            recycled: pickString(etsy, ["recycled"]),
            canBePersonalized: pickString(etsy, ["canBePersonalized"]),
            age: pickString(etsy, ["age"]),
            tags: pickStringArray(etsy, ["tags"]),
          }
        : null;
    const includeEtsy = Boolean(
      normalizedEtsy &&
        (
          normalizedEtsy.title ||
          normalizedEtsy.description ||
          normalizedEtsy.categoryPath ||
          normalizedEtsy.adjustedPrice ||
          normalizedEtsy.materials ||
          normalizedEtsy.style ||
          normalizedEtsy.theme ||
          normalizedEtsy.occasion ||
          normalizedEtsy.recipient ||
          normalizedEtsy.jewelryType ||
          normalizedEtsy.gemstone ||
          normalizedEtsy.gemColor ||
          normalizedEtsy.sustainability ||
          normalizedEtsy.goldSolidity ||
          normalizedEtsy.recycled ||
          normalizedEtsy.canBePersonalized ||
          normalizedEtsy.age ||
          normalizedEtsy.tags.length
        )
    );

    return {
      version: 1,
      meta: {
        sentAt: new Date().toISOString(),
        sourcePage: window.location.href,
      },
      ...(photos.length ? { photos } : {}),
      ...((resolvedPrice !== undefined &&
        resolvedPrice !== null &&
        (typeof resolvedPrice !== "string" || resolvedPrice.trim()))
        ? { resolvedPrice }
        : {}),
      ...(researchMeta ? { researchMeta } : {}),
      ...(pricing ? { pricing } : {}),
      ...(vendooBaseTags.length ? { vendooBaseTags } : {}),
      ...(includeDepop && normalizedDepop ? { depop: normalizedDepop } : {}),
      ...(includePoshmark && normalizedPoshmark ? { poshmark: normalizedPoshmark } : {}),
      ...(includeEtsy && normalizedEtsy ? { etsy: normalizedEtsy } : {}),
      marketplaces: {
        ebay: {
          title,
          titleA,
          titleB,
          description,
          category,
          canonicalVendooCategoryPath,
          itemSpecifics,
        },
        ...(includeDepop && normalizedDepop ? { depop: normalizedDepop } : {}),
        ...(includePoshmark && normalizedPoshmark ? { poshmark: normalizedPoshmark } : {}),
        ...(includeEtsy && normalizedEtsy ? { etsy: normalizedEtsy } : {}),
      },
    };
  }

  function preparePayloadForStorage(payload) {
    const safePayload = {
      ...(payload && typeof payload === "object" ? payload : {}),
    };
    const photos = Array.isArray(payload?.photos) ? payload.photos : [];
    const metadataPhotos = photos.map((photo, index) => ({
      index,
      name: typeof photo?.name === "string" ? photo.name : "",
      type: typeof photo?.type === "string" ? photo.type : "",
      size:
        typeof photo?.size === "number" && Number.isFinite(photo.size) && photo.size >= 0
          ? photo.size
          : 0,
    }));

    safePayload.photos = metadataPhotos;
    if (safePayload.raw) {
      delete safePayload.raw;
    }

    const storedPayloadByteEstimate = estimateByteSize(safePayload);
    const diagnostics = {
      storedPayloadByteEstimate,
      transientPhotoPayloadPresent: photos.length > 0,
      photoCount: photos.length,
      persistedPhotoMetadataOnly: true,
      photoPayloadStrippedForStorage: photos.length > 0,
    };
    safePayload.meta = {
      ...(safePayload.meta && typeof safePayload.meta === "object" ? safePayload.meta : {}),
      ...diagnostics,
    };

    return { payloadForStorage: safePayload, diagnostics };
  }

  function cacheTransientPhotos(photos) {
    const sanitized = Array.isArray(photos)
      ? photos
          .map((photo, index) => {
            const dataUrl =
              typeof photo?.dataUrl === "string" ? photo.dataUrl.trim() : "";
            if (!dataUrl) return null;
            return {
              index,
              name: typeof photo?.name === "string" ? photo.name.trim() : "",
              type: typeof photo?.type === "string" ? photo.type.trim() : "",
              size:
                typeof photo?.size === "number" &&
                Number.isFinite(photo.size) &&
                photo.size >= 0
                  ? photo.size
                  : 0,
              dataUrl,
            };
          })
          .filter(Boolean)
      : [];

    window[TRANSIENT_PHOTO_KEY] = {
      savedAt: Date.now(),
      photos: sanitized,
    };
  }

  function estimateByteSize(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
    } catch {
      return -1;
    }
  }

  function canUseChromeRuntimeMessaging() {
    return (
      typeof chrome !== "undefined" &&
      !!chrome &&
      !!chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    );
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

  function pickObject(obj, ...paths) {
    for (const path of paths) {
      const value = getAtPath(obj, path);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
      }
    }
    return null;
  }

  function pickDefined(obj, ...paths) {
    for (const path of paths) {
      const value = getAtPath(obj, path);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  function pickPhotos(obj, ...paths) {
    for (const path of paths) {
      const value = getAtPath(obj, path);
      if (!Array.isArray(value)) continue;

      const photos = value
        .map((photo) => {
          if (!photo || typeof photo !== "object") return null;
          const dataUrl =
            typeof photo.dataUrl === "string" ? photo.dataUrl.trim() : "";
          if (!dataUrl) return null;
          return {
            name: typeof photo.name === "string" ? photo.name.trim() : "",
            type: typeof photo.type === "string" ? photo.type.trim() : "",
            size:
              typeof photo.size === "number" &&
              Number.isFinite(photo.size) &&
              photo.size >= 0
                ? photo.size
                : 0,
            dataUrl,
          };
        })
        .filter(Boolean);

      if (photos.length) return photos;
    }

    return [];
  }

  function pickStringArray(obj, ...paths) {
    for (const path of paths) {
      const value = getAtPath(obj, path);
      if (!Array.isArray(value)) continue;
      const seen = new Set();
      const normalized = [];
      for (const item of value) {
        if (typeof item !== "string") continue;
        const cleaned = item.trim().replace(/^#+/, "");
        if (!cleaned || seen.has(cleaned)) continue;
        seen.add(cleaned);
        normalized.push(cleaned);
      }
      if (normalized.length) return normalized;
    }
    return [];
  }

  function normalizeItemSpecifics(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const result = {};
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw !== "string") continue;
      const normalized = raw.trim();
      if (!normalized) continue;
      result[key] = normalized;
    }

    return result;
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
