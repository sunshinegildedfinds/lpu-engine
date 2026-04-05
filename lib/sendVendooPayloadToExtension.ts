export function sendVendooPayloadToExtension(payload: unknown): boolean {
  if (typeof window === "undefined") return false;
  const typedPayload = payload as {
    resolvedPrice?: unknown;
  } | null;
  const topLevelPayloadKeys =
    payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : [];
  const resolvedPrice =
    typeof typedPayload?.resolvedPrice === "string" ? typedPayload.resolvedPrice : "";
  console.debug("[LPU][SendPayload]", {
    hasResolvedPrice: Boolean(resolvedPrice),
    resolvedPrice,
    topLevelPayloadKeys,
  });

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
