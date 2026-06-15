import { NextResponse } from "next/server";
import { clearQueueOwnerSession } from "@/lib/lpu/queueAuth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true, authenticated: false });
  clearQueueOwnerSession(response);

  return response;
}
