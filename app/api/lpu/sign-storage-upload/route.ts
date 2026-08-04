import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { isStagingDeployment } from "@/lib/lpu/deploymentEnv";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  buildStagingStoragePath,
  getRequiredStagingStorageBucket,
  hasRequiredStagingBucketConfiguration,
  validateStagingImageUpload,
} from "@/lib/lpu/stagingStoragePolicy";

type UploadSignRequest = {
  mimeType?: unknown;
  size?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/** Staging-only signed upload capability. The server chooses both bucket and path. */
export async function POST(request: Request) {
  if (!isStagingDeployment()) return jsonError("Not found.", 404);

  try {
    await requireQueueOwnerSession();
    const body = (await request.json()) as UploadSignRequest;
    const validation = validateStagingImageUpload(body);
    if (!validation.ok) return jsonError(validation.error, 400);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    const bucketName = getRequiredStagingStorageBucket(
      process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim()
    );
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonError("Staging storage signing is not configured.", 500);
    }

    const bucketResponse = await fetch(
      `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucketName)}`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );
    if (!bucketResponse.ok) {
      return jsonError("Staging storage bucket is unavailable.", 502);
    }
    const bucket = (await bucketResponse.json()) as unknown;
    if (!hasRequiredStagingBucketConfiguration(bucket)) {
      return jsonError("Staging storage bucket restrictions are not configured.", 500);
    }

    const storagePath = buildStagingStoragePath(randomUUID(), validation.mimeType);
    const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `${supabaseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(bucketName)}/${encodedPath}`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );
    if (!response.ok) return jsonError("Unable to create staging upload URL.", 502);

    const payload = (await response.json()) as { url?: unknown; token?: unknown };
    if (typeof payload.url !== "string" || typeof payload.token !== "string") {
      return jsonError("Signed upload response is invalid.", 502);
    }
    const baseUrl = payload.url.startsWith("http")
      ? payload.url
      : `${supabaseUrl}/storage/v1${payload.url}`;
    const uploadUrl = new URL(baseUrl);
    uploadUrl.searchParams.set("token", payload.token);

    return NextResponse.json({ ok: true, storagePath, uploadUrl: uploadUrl.toString() });
  } catch (error) {
    if (error instanceof QueueAuthError) return jsonError("Unauthorized", error.status);
    return jsonError("Unable to sign staging upload.", 500);
  }
}
