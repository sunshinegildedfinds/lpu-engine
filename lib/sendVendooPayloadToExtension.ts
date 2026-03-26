export function sendVendooPayloadToExtension(payload: unknown): boolean {
  if (typeof window === "undefined") return false;

  window.postMessage(
    {
      source: "lpu-app",
      type: "LPU_VENDOO_PAYLOAD",
      payload,
    },
    window.location.origin
  );

  return true;
}