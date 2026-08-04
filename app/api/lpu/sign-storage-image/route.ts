import { NextResponse } from "next/server";

import { isStagingDeployment } from "@/lib/lpu/deploymentEnv";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  getProductionStorageBucket,
  getRequiredStagingStorageBucket,
  isValidStagingSignedReadRequest,
  STAGING_SIGNED_READ_TTL_SECONDS,
} from "@/lib/lpu/stagingStoragePolicy";

type SignRequest = {
  storagePath?: string;
};

const ALLOWED_ORIGINS = new Set([
  "https://web.vendoo.co",
  "https://lpu-engine.vercel.app",
  "http://localhost:3000",
]);

function buildCorsHeaders(origin: string | null): HeadersInit {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : !origin ? "*" : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }
  return headers;
}

function jsonWithCors(
  request: Request,
  body: unknown,
  init?: { status?: number }
): NextResponse {
  const origin = request.headers.get("origin");
  return NextResponse.json(body, {
    ...(init ?? {}),
    headers: buildCorsHeaders(origin),
  });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const sameOrigin = origin === new URL(request.url).origin;
  if (origin && !sameOrigin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonWithCors(
      request,
      { error: "Origin not allowed." },
      { status: 403 }
    );
  }

  try {
    const body = (await request.json()) as SignRequest;
    const storagePath =
      typeof body?.storagePath === "string" ? body.storagePath.trim() : "";

    if (!storagePath) {
      return jsonWithCors(
        request,
        { error: "Missing required storagePath." },
        { status: 400 }
      );
    }

    const staging = isStagingDeployment();
    if (staging) {
      await requireQueueOwnerSession();
      if (!isValidStagingSignedReadRequest(storagePath, STAGING_SIGNED_READ_TTL_SECONDS)) {
        return jsonWithCors(request, { error: "Invalid staging image request." }, { status: 400 });
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const bucketName = staging
      ? getRequiredStagingStorageBucket(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim())
      : getProductionStorageBucket(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim());

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonWithCors(
        request,
        { error: "Storage signing is not configured." },
        { status: 500 }
      );
    }

    const encodedPath = storagePath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const signEndpoint = `${supabaseUrl}/storage/v1/object/sign/${bucketName}/${encodedPath}`;
    const signResponse = await fetch(signEndpoint, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expiresIn: staging ? STAGING_SIGNED_READ_TTL_SECONDS : 60 * 30,
      }),
      cache: "no-store",
    });

    if (!signResponse.ok) {
      const text = await signResponse.text();
      return jsonWithCors(
        request,
        { error: `Unable to create signed URL: ${signResponse.status} ${text}` },
        { status: 502 }
      );
    }

    const signedPayload = (await signResponse.json()) as {
      signedURL?: string;
      signedUrl?: string;
    };
    const relativeSigned =
      typeof signedPayload?.signedURL === "string"
        ? signedPayload.signedURL
        : typeof signedPayload?.signedUrl === "string"
          ? signedPayload.signedUrl
          : "";

    if (!relativeSigned) {
      return jsonWithCors(
        request,
        { error: "Signed URL response missing signedURL." },
        { status: 502 }
      );
    }

    const signedUrl = relativeSigned.startsWith("http")
      ? relativeSigned
      : `${supabaseUrl}/storage/v1${relativeSigned}`;

    return jsonWithCors(request, { signedUrl });
  } catch (error) {
    if (error instanceof QueueAuthError) {
      return jsonWithCors(request, { error: "Unauthorized" }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Failed to sign storage image.";
    return jsonWithCors(request, { error: message }, { status: 500 });
  }
}
