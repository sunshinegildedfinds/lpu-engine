const STORAGE_KEY = "lpuVendooPayload";

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
    const record = {
      payload: message.payload ?? null,
      savedAt: Date.now(),
      sourceUrl: sender?.url ?? null
    };

    chrome.storage.local.set({ [STORAGE_KEY]: record }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      sendResponse({ ok: true, savedAt: record.savedAt });
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

      sendResponse({ ok: true });
    });

    return true;
  }

  sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
  return false;
});