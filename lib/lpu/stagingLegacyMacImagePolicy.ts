/**
 * Staging-only compatibility for the isolated legacy Mac agent.
 *
 * Browser V2 keeps using authenticated Storage references.  This policy never
 * trusts an external URL: it admits only canonical, bounded JPEG data URLs,
 * and only after the route has authenticated the Queue-owner session.
 */
export const STAGING_LEGACY_MAC_MAX_IMAGES = 12;
export const STAGING_LEGACY_MAC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const STAGING_LEGACY_MAC_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const STAGING_LEGACY_MAC_MAX_SERIALIZED_BYTES = 24 * 1024 * 1024;

export class StagingLegacyMacImageError extends Error {}

type ImageLike = {
  name?: unknown;
  type?: unknown;
  imageUrl?: unknown;
  storagePath?: unknown;
};

function strictJpegDataUrl(value: unknown): { url: string; bytes: number } | null {
  if (typeof value !== "string") return null;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || match[1].length === 0 || match[1].length % 4 !== 0) return null;
  const encoded = match[1];
  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }
  if (!decoded.length || decoded.toString("base64") !== encoded) return null;
  if (decoded.length < 4 || decoded[0] !== 0xff || decoded[1] !== 0xd8 ||
      decoded[decoded.length - 2] !== 0xff || decoded[decoded.length - 1] !== 0xd9) {
    return null;
  }
  return { url: value, bytes: decoded.length };
}

/**
 * Return a map of legacy JPEG URLs by original image index.  A staging browser
 * Storage reference is deliberately not transformed; production always gets
 * an empty result and therefore cannot enter this compatibility path.
 */
export function stagingLegacyMacImageUrls(
  images: unknown,
  staging: boolean,
  isValidStagingStoragePath: (value: string) => boolean
): Map<number, string> {
  if (!staging) return new Map();
  if (!Array.isArray(images)) {
    throw new StagingLegacyMacImageError("Invalid staging image collection.");
  }
  if (Buffer.byteLength(JSON.stringify(images), "utf8") > STAGING_LEGACY_MAC_MAX_SERIALIZED_BYTES) {
    throw new StagingLegacyMacImageError("Staging image request is too large.");
  }

  const legacy = new Map<number, string>();
  let storageCount = 0;
  let totalBytes = 0;
  for (const [index, unknownImage] of images.entries()) {
    if (!unknownImage || typeof unknownImage !== "object") {
      throw new StagingLegacyMacImageError("Invalid staging image object.");
    }
    const image = unknownImage as ImageLike;
    const storagePath = typeof image.storagePath === "string" ? image.storagePath.trim() : "";
    if (storagePath && isValidStagingStoragePath(storagePath)) {
      storageCount += 1;
      continue;
    }
    if (storagePath) {
      throw new StagingLegacyMacImageError("Untrusted staging image object.");
    }
    if (typeof image.name !== "string" || !image.name.trim() || image.type !== "image/jpeg") {
      throw new StagingLegacyMacImageError("Legacy staging images must be named JPEG files.");
    }
    const parsed = strictJpegDataUrl(image.imageUrl);
    if (!parsed) {
      throw new StagingLegacyMacImageError("Staging accepts only canonical JPEG data URLs.");
    }
    if (parsed.bytes > STAGING_LEGACY_MAC_MAX_IMAGE_BYTES) {
      throw new StagingLegacyMacImageError("Staging JPEG image exceeds the per-image limit.");
    }
    totalBytes += parsed.bytes;
    if (totalBytes > STAGING_LEGACY_MAC_MAX_TOTAL_BYTES) {
      throw new StagingLegacyMacImageError("Staging JPEG images exceed the total limit.");
    }
    legacy.set(index, parsed.url);
  }
  if (legacy.size && storageCount) {
    throw new StagingLegacyMacImageError("Mixed legacy and Storage image references are not allowed.");
  }
  if (legacy.size > STAGING_LEGACY_MAC_MAX_IMAGES) {
    throw new StagingLegacyMacImageError("Staging JPEG image count exceeds the limit.");
  }
  return legacy;
}
