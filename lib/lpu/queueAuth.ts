import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { type NextResponse } from "next/server";

export const QUEUE_OWNER_SESSION_COOKIE = "lpu_queue_owner_session";

const OWNER_SECRET_ENV = "LPU_QUEUE_OWNER_SECRET";
const SESSION_SECRET_ENV = "LPU_QUEUE_SESSION_SECRET";
const SESSION_VERSION = 1;
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

type QueueOwnerSessionPayload = {
  version: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

export type QueueOwnerSession = {
  authenticated: true;
  expiresAt: string;
};

export class QueueAuthError extends Error {
  status: number;

  constructor(message = "Queue owner session required.", status = 401) {
    super(message);
    this.name = "QueueAuthError";
    this.status = status;
  }
}

export function verifyOwnerSecret(input: unknown): boolean {
  const ownerSecret = getRequiredEnv(OWNER_SECRET_ENV);
  if (!ownerSecret || typeof input !== "string") return false;

  return timingSafeStringEqual(input.trim(), ownerSecret);
}

export function createSignedOwnerSession(now = Date.now()): {
  value: string;
  expiresAt: Date;
  maxAge: number;
} | null {
  const sessionSecret = getRequiredEnv(SESSION_SECRET_ENV);
  if (!sessionSecret) return null;

  const expiresAtMs = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload: QueueOwnerSessionPayload = {
    version: SESSION_VERSION,
    issuedAt: now,
    expiresAt: expiresAtMs,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = encodeJson(payload);
  const signature = signValue(encodedPayload, sessionSecret);

  return {
    value: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAtMs),
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function verifySignedOwnerSession(cookieValue: unknown): QueueOwnerSession | null {
  const sessionSecret = getRequiredEnv(SESSION_SECRET_ENV);
  if (!sessionSecret || typeof cookieValue !== "string") return null;

  const [encodedPayload, signature, extra] = cookieValue.split(".");
  if (!encodedPayload || !signature || extra !== undefined) return null;

  const expectedSignature = signValue(encodedPayload, sessionSecret);
  if (!timingSafeStringEqual(signature, expectedSignature)) return null;

  const payload = decodeJson(encodedPayload);
  if (!isQueueOwnerSessionPayload(payload)) return null;
  if (payload.expiresAt <= Date.now()) return null;

  return {
    authenticated: true,
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}

export async function requireQueueOwnerSession(): Promise<QueueOwnerSession> {
  const cookieStore = await cookies();
  const session = verifySignedOwnerSession(
    cookieStore.get(QUEUE_OWNER_SESSION_COOKIE)?.value
  );

  if (!session) {
    throw new QueueAuthError();
  }

  return session;
}

export function setQueueOwnerSessionCookie(
  response: NextResponse,
  session: { value: string; expiresAt: Date; maxAge: number }
): void {
  response.cookies.set(QUEUE_OWNER_SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
    maxAge: session.maxAge,
  });
}

export function clearQueueOwnerSession(response: NextResponse): void {
  response.cookies.set(QUEUE_OWNER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}

function getRequiredEnv(name: typeof OWNER_SECRET_ENV | typeof SESSION_SECRET_ENV): string {
  return process.env[name]?.trim() ?? "";
}

function signValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftHash = createHmac("sha256", "queue-auth-compare").update(left).digest();
  const rightHash = createHmac("sha256", "queue-auth-compare").update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}

function encodeJson(value: QueueOwnerSessionPayload): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function isQueueOwnerSessionPayload(value: unknown): value is QueueOwnerSessionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const payload = value as Partial<QueueOwnerSessionPayload>;
  return (
    payload.version === SESSION_VERSION &&
    typeof payload.issuedAt === "number" &&
    Number.isFinite(payload.issuedAt) &&
    typeof payload.expiresAt === "number" &&
    Number.isFinite(payload.expiresAt) &&
    payload.expiresAt > payload.issuedAt &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0
  );
}
