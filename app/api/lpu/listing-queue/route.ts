import { NextResponse } from "next/server";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  createListingQueueItem,
  listListingQueueItems,
  normalizeQueueApiError,
} from "@/lib/lpu/listingQueueServer";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function authError(error: QueueAuthError) {
  return jsonError(error.status === 403 ? "Forbidden" : "Unauthorized", error.status);
}

export async function GET(request: Request) {
  try {
    await requireQueueOwnerSession();

    const url = new URL(request.url);
    const items = await listListingQueueItems({
      status: url.searchParams.get("status") ?? undefined,
      includeArchived: url.searchParams.get("includeArchived") === "true",
      limit: url.searchParams.get("limit") ?? undefined,
    });

    return NextResponse.json({ ok: true, items });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}

export async function POST(request: Request) {
  try {
    await requireQueueOwnerSession();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }

    const item = await createListingQueueItem(body ?? {});
    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    if (error instanceof QueueAuthError) return authError(error);
    const normalized = normalizeQueueApiError(error);
    return jsonError(normalized.message, normalized.status);
  }
}
