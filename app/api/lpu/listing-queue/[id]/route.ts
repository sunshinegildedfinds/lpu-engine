import { NextResponse } from "next/server";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  archiveListingQueueItem,
  getListingQueueItem,
  normalizeQueueApiError,
  updateListingQueueItem,
} from "@/lib/lpu/listingQueueServer";

export const runtime = "nodejs";

type QueueItemRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function authError(error: QueueAuthError) {
  return jsonError(error.status === 403 ? "Forbidden" : "Unauthorized", error.status);
}

export async function GET(_request: Request, context: QueueItemRouteContext) {
  try {
    await requireQueueOwnerSession();

    const { id } = await context.params;
    const item = await getListingQueueItem(id);

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}

export async function PATCH(request: Request, context: QueueItemRouteContext) {
  try {
    await requireQueueOwnerSession();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const { id } = await context.params;
    const item = await updateListingQueueItem(id, body ?? {});

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}

export async function DELETE(_request: Request, context: QueueItemRouteContext) {
  try {
    await requireQueueOwnerSession();

    const { id } = await context.params;
    const item = await archiveListingQueueItem(id);

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}
