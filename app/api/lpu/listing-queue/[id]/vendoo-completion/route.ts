import { NextResponse } from "next/server";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  completeListingQueueVendoo,
  normalizeQueueApiError,
} from "@/lib/lpu/listingQueueServer";

export const runtime = "nodejs";

type QueueCompletionRouteContext = {
  params: Promise<{ id: string }>;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function authError(error: QueueAuthError) {
  return jsonError(error.status === 403 ? "Forbidden" : "Unauthorized", error.status);
}

export async function POST(request: Request, context: QueueCompletionRouteContext) {
  try {
    await requireQueueOwnerSession();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const { id } = await context.params;
    const result = await completeListingQueueVendoo(id, body);
    return NextResponse.json({
      ok: true,
      item: result.item,
      receipt: result.receipt,
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}
