import { NextResponse } from "next/server";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  normalizeQueueApiError,
  restoreListingQueueItem,
} from "@/lib/lpu/listingQueueServer";

export const runtime = "nodejs";

type QueueItemRestoreRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function authError(error: QueueAuthError) {
  return jsonError(error.status === 403 ? "Forbidden" : "Unauthorized", error.status);
}

export async function POST(
  _request: Request,
  context: QueueItemRestoreRouteContext
) {
  try {
    await requireQueueOwnerSession();

    const { id } = await context.params;
    const item = await restoreListingQueueItem(id);

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}
