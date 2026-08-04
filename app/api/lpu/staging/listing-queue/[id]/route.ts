import { NextResponse } from "next/server";

import { isExactUuid, isStagingDeployment } from "@/lib/lpu/deploymentEnv";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  hardDeleteStagingListingQueueItem,
  normalizeQueueApiError,
} from "@/lib/lpu/listingQueueServer";

export const runtime = "nodejs";

type StagingQueueItemRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Exact-ID hard delete for staging records only. No production fallback exists. */
export async function DELETE(
  request: Request,
  context: StagingQueueItemRouteContext
) {
  if (!isStagingDeployment()) return jsonError("Not found.", 404);

  try {
    await requireQueueOwnerSession();
    const { id } = await context.params;
    if (!isExactUuid(id)) return jsonError("Invalid queue item ID.", 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    const confirmedId =
      body && typeof body === "object" && "id" in body
        ? (body as { id?: unknown }).id
        : undefined;
    if (!isExactUuid(confirmedId) || confirmedId !== id) {
      return jsonError("Body ID must exactly match the route ID.", 400);
    }

    await hardDeleteStagingListingQueueItem(id);
    return NextResponse.json({ ok: true, deletedId: id });
  } catch (error) {
    if (error instanceof QueueAuthError) {
      return jsonError(error.status === 403 ? "Forbidden" : "Unauthorized", error.status);
    }
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}
