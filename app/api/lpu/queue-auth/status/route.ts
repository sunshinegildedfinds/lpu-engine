import { NextResponse } from "next/server";
import { requireQueueOwnerSession, QueueAuthError } from "@/lib/lpu/queueAuth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireQueueOwnerSession();

    return NextResponse.json({
      authenticated: true,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    if (error instanceof QueueAuthError) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    return NextResponse.json(
      { authenticated: false, error: "Unable to verify queue owner session." },
      { status: 500 }
    );
  }
}
