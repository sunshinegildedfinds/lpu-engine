const STORAGE_KEY = "lpuVendooPayload";
const TRANSIENT_PHOTO_KEY = "lpuVendooTransientPhotos";
let transientPhotoRecord = null;

chrome.runtime.onInstalled.addListener(() => {
  console.log("[LPU Vendoo Fill] installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "Invalid message" });
    return false;
  }

  if (message.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "STORE_PAYLOAD") {
    const relayPayload =
      message.payload && typeof message.payload === "object" ? message.payload : null;
    const relayResolvedPrice =
      typeof relayPayload?.resolvedPrice === "string" ? relayPayload.resolvedPrice : "";
    console.debug("[Extension][RelayPayload]", {
      hasResolvedPrice: Boolean(relayResolvedPrice),
      resolvedPrice: relayResolvedPrice,
      topLevelPayloadKeys: relayPayload ? Object.keys(relayPayload) : [],
    });

    const transientPhotos = normalizeTransientPhotos(message.transientPhotos);
    const savedAt = Date.now();
    const record = {
      payload: message.payload ?? null,
      savedAt,
      sourceUrl: sender?.url ?? null
    };

    transientPhotoRecord = {
      photos: transientPhotos,
      savedAt,
      sourceUrl: sender?.url ?? null,
    };
    setTransientPhotoRecord(transientPhotoRecord);

    chrome.storage.local.set({ [STORAGE_KEY]: record }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      sendResponse({
        ok: true,
        savedAt: record.savedAt,
        transientPhotoCount: transientPhotos.length,
      });
    });

    return true;
  }

  if (message.type === "GET_PAYLOAD") {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      sendResponse({
        ok: true,
        record: result[STORAGE_KEY] ?? null
      });
    });

    return true;
  }

  if (message.type === "CLEAR_PAYLOAD") {
    chrome.storage.local.remove([STORAGE_KEY], () => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      transientPhotoRecord = null;
      clearTransientPhotoRecord(() => {
        sendResponse({ ok: true });
      });
    });

    return true;
  }

  if (message.type === "GET_TRANSIENT_PHOTOS") {
    getTransientPhotoRecord((record, error) => {
      if (error) {
        sendResponse({ ok: false, error });
        return;
      }

      sendResponse({
        ok: true,
        record: record ?? null,
      });
    });

    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  return false;
});

function normalizeTransientPhotos(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((photo, index) => {
      if (!photo || typeof photo !== "object") return null;
      const dataUrl = typeof photo.dataUrl === "string" ? photo.dataUrl.trim() : "";
      if (!dataUrl) return null;
      return {
        index:
          typeof photo.index === "number" && Number.isFinite(photo.index)
            ? photo.index
            : index,
        name: typeof photo.name === "string" ? photo.name.trim() : "",
        type: typeof photo.type === "string" ? photo.type.trim() : "",
        size:
          typeof photo.size === "number" && Number.isFinite(photo.size) && photo.size >= 0
            ? photo.size
            : 0,
        dataUrl,
      };
    })
    .filter(Boolean);
}

function setTransientPhotoRecord(record) {
  if (!chrome.storage?.session?.set) return;
  chrome.storage.session.set({ [TRANSIENT_PHOTO_KEY]: record }, () => {
    if (chrome.runtime.lastError) {
      // Keep in-memory transient photos available even when session quota is exceeded.
      return;
    }
  });
}

function clearTransientPhotoRecord(done) {
  if (!chrome.storage?.session?.remove) {
    done();
    return;
  }
  chrome.storage.session.remove([TRANSIENT_PHOTO_KEY], () => {
    done();
  });
}

function getTransientPhotoRecord(done) {
  if (transientPhotoRecord?.photos?.length) {
    done(transientPhotoRecord, "");
    return;
  }

  if (!chrome.storage?.session?.get) {
    done(null, "");
    return;
  }

  chrome.storage.session.get([TRANSIENT_PHOTO_KEY], (result) => {
    if (chrome.runtime.lastError) {
      done(null, chrome.runtime.lastError.message);
      return;
    }

    const stored = result?.[TRANSIENT_PHOTO_KEY] ?? null;
    transientPhotoRecord = stored;
    done(stored, "");
  });
}
