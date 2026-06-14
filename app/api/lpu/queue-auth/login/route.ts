import { NextResponse } from "next/server";
import {
  createSignedOwnerSession,
  setQueueOwnerSessionCookie,
  verifyOwnerSecret,
} from "@/lib/lpu/queueAuth";

export const runtime = "nodejs";

type QueueAuthLoginBody = {
  ownerSecret?: unknown;
  password?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function POST(request: Request) {
  let body: QueueAuthLoginBody;

  try {
    body = (await request.json()) as QueueAuthLoginBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const candidate =
    typeof body.ownerSecret === "string"
      ? body.ownerSecret
      : typeof body.password === "string"
        ? body.password
        : "";

  if (!verifyOwnerSecret(candidate)) {
    return jsonError("Invalid queue owner credentials.", 401);
  }

  const session = createSignedOwnerSession();
  if (!session) {
    return jsonError("Queue owner auth is not configured.", 500);
  }

  const response = NextResponse.json({
    ok: true,
    authenticated: true,
    expiresAt: session.expiresAt.toISOString(),
  });
  setQueueOwnerSessionCookie(response, session);

  return response;
}
