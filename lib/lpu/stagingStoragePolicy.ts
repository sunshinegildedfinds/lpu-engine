export const STAGING_STORAGE_BUCKET = "lpu-generator-images-staging";
export const STAGING_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const STAGING_SIGNED_READ_TTL_SECONDS = 30 * 60;
// Supabase Storage signed-upload capabilities expire after two hours.
export const STAGING_SIGNED_UPLOAD_TTL_SECONDS = 2 * 60 * 60;

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type StagingImageMimeType = keyof typeof MIME_TO_EXTENSION;

export function validateStagingImageUpload(input: {
  mimeType?: unknown;
  size?: unknown;
}): { ok: true; mimeType: StagingImageMimeType } | { ok: false; error: string } {
  if (!isStagingImageMimeType(input.mimeType)) {
    return { ok: false, error: "Only JPEG, PNG, and WebP images are supported." };
  }
  if (!Number.isInteger(input.size) || (input.size as number) <= 0) {
    return { ok: false, error: "Image size must be a positive whole number of bytes." };
  }
  if ((input.size as number) > STAGING_MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Image exceeds the 10 MB staging upload limit." };
  }
  return { ok: true, mimeType: input.mimeType };
}

export function buildStagingStoragePath(id: string, mimeType: StagingImageMimeType): string {
  if (!isUuid(id)) throw new Error("Invalid generated storage ID.");
  return `lpu/staging/${id}.${MIME_TO_EXTENSION[mimeType]}`;
}

export function isStagingStoragePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^lpu\/staging\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(
      value
    )
  );
}

export function getRequiredStagingStorageBucket(configuredBucket: unknown): string {
  if (configuredBucket !== STAGING_STORAGE_BUCKET) {
    throw new Error("Staging storage bucket is not configured correctly.");
  }
  return STAGING_STORAGE_BUCKET;
}

export function getProductionStorageBucket(configuredBucket: unknown): string {
  return typeof configuredBucket === "string" && configuredBucket.trim()
    ? configuredBucket.trim()
    : "lpu-generator-images";
}

export function hasRequiredStagingBucketConfiguration(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bucket = value as {
    id?: unknown;
    public?: unknown;
    file_size_limit?: unknown;
    allowed_mime_types?: unknown;
  };
  if (
    bucket.id !== STAGING_STORAGE_BUCKET ||
    bucket.public !== false ||
    bucket.file_size_limit !== STAGING_MAX_UPLOAD_BYTES ||
    !Array.isArray(bucket.allowed_mime_types)
  ) {
    return false;
  }
  const actual = [...bucket.allowed_mime_types].sort();
  const expected = Object.keys(MIME_TO_EXTENSION).sort();
  return actual.length === expected.length && actual.every((mimeType, index) => mimeType === expected[index]);
}

export function isValidStagingSignedReadRequest(
  storagePath: unknown,
  expiresIn: unknown
): boolean {
  return (
    isStagingStoragePath(storagePath) &&
    Number.isInteger(expiresIn) &&
    (expiresIn as number) > 0 &&
    (expiresIn as number) <= STAGING_SIGNED_READ_TTL_SECONDS
  );
}

function isStagingImageMimeType(value: unknown): value is StagingImageMimeType {
  return typeof value === "string" && value in MIME_TO_EXTENSION;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
