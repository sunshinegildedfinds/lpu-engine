import { NextResponse } from "next/server";

import { isStagingDeployment } from "@/lib/lpu/deploymentEnv";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";

export async function GET() {
  if (!isStagingDeployment()) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  try {
    await requireQueueOwnerSession();
    return NextResponse.json({ ok: true, staging: true, authenticated: true });
  } catch (error) {
    if (error instanceof QueueAuthError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Staging access requires Queue sign-in. Use /lpu-v2 to sign in.",
        },
        { status: 401 }
      );
    }
    return NextResponse.json({ ok: false, error: "Unable to verify staging access." }, { status: 500 });
  }
}
