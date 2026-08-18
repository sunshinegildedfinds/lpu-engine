export const LISTING_QUEUE_SCHEMA_VERSION = 1;

export const LISTING_QUEUE_STATUSES = [
  "intake",
  "brief_generated",
  "lpu_generated",
  "payload_ready",
  "sent_to_vendoo",
  "needs_review",
  "error",
  "archived",
] as const;

export type ListingQueueStatus = (typeof LISTING_QUEUE_STATUSES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type ListingQueueItemIntake = {
  notes?: string;
  knownDetails?: string;
  conditionNotes?: string;
  measurements?: string;
  markings?: string;
  [key: string]: JsonValue | undefined;
};

export type ListingQueuePhoto = {
  storagePath: string;
  sortOrder: number;
  imageUrl?: string;
  name?: string;
  type?: string;
  size?: number;
};

export type ListingQueuePricingSnapshot = JsonObject;
export type ListingQueuePublicWebCompsSnapshot = JsonObject;
export type ListingQueueManualCompInputs = JsonObject;
export type ListingQueueVendooSendStatus = JsonObject;
export type ListingQueuePayloadSnapshot = JsonObject;

export const EXTENSION_POST_RECEIPT_SCHEMA_VERSION = 1;
const EXTENSION_POST_RECEIPT_KEYS = new Set([
  "schemaVersion",
  "kind",
  "verificationStatus",
  "postedAt",
]);

export function normalizePostedToExtensionUnverifiedReceipt(
  value: unknown
): ListingQueueVendooSendStatus {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !EXTENSION_POST_RECEIPT_KEYS.has(key)) ||
    value.schemaVersion !== EXTENSION_POST_RECEIPT_SCHEMA_VERSION ||
    value.kind !== "posted_to_extension_unverified" ||
    value.verificationStatus !== "unverified"
  ) {
    throw new Error("Invalid posted_to_extension_unverified receipt.");
  }

  return {
    schemaVersion: EXTENSION_POST_RECEIPT_SCHEMA_VERSION,
    kind: "posted_to_extension_unverified",
    verificationStatus: "unverified",
    postedAt: normalizeIsoTimestamp(value.postedAt),
  };
}

export const VENDOO_COMPLETION_RECEIPT_SCHEMA_VERSION = 1;
export const VENDOO_COMPLETION_MARKETPLACES = [
  "ebay",
  "etsy",
  "poshmark",
  "mercari",
  "depop",
] as const;

export type VendooCompletionMarketplace =
  (typeof VENDOO_COMPLETION_MARKETPLACES)[number];

export type ListingQueueVendooCompletionReceipt = {
  schemaVersion: typeof VENDOO_COMPLETION_RECEIPT_SCHEMA_VERSION;
  kind: "vendoo_completion";
  queueId: string;
  expectedStatus: "lpu_generated";
  itemFingerprint: string;
  transformedLpuSha256: string;
  vendooDraftIdentitySha256: string;
  verifiedMarketplaces: Array<{
    marketplace: VendooCompletionMarketplace;
    status: "verified";
  }>;
  fieldLedgerSha256: string;
  finalManifestSha256: string;
  seoReviewSha256: string;
  completedAt: string;
};

export type ListingQueueVendooCompletionInput = {
  queueId?: unknown;
  expectedStatus?: unknown;
  itemFingerprint?: unknown;
  transformedLpuSha256?: unknown;
  vendooDraftIdentitySha256?: unknown;
  verifiedMarketplaces?: unknown;
  fieldLedgerSha256?: unknown;
  finalManifestSha256?: unknown;
  seoReviewSha256?: unknown;
  completedAt?: unknown;
};

export type ListingQueueRecord = {
  id?: string;
  userId?: string | null;
  status: ListingQueueStatus;
  title?: string;
  subtitle?: string;
  categorySummary?: string;
  thumbnailPath?: string;
  finalListPrice?: string;
  itemIntake: ListingQueueItemIntake;
  sellingBrief?: string;
  finalLpuOutput?: string;
  payloadSnapshot?: ListingQueuePayloadSnapshot;
  pricingSnapshot?: ListingQueuePricingSnapshot;
  publicWebCompsSnapshot?: ListingQueuePublicWebCompsSnapshot;
  manualCompInputs?: ListingQueueManualCompInputs;
  vendooSendStatus?: ListingQueueVendooSendStatus;
  appVersion?: string;
  schemaVersion: number;
  photos: ListingQueuePhoto[];
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string | null;
  sentToVendooAt?: string | null;
  createOperationId?: string;
  createRequestSha256?: string;
  agentItemFingerprint?: string;
  environment?: "staging";
  testRunId?: string;
  expiresAt?: string;
};

export type ListingQueueDraftInput = {
  id?: string;
  userId?: string | null;
  status?: unknown;
  title?: unknown;
  subtitle?: unknown;
  categorySummary?: unknown;
  finalListPrice?: unknown;
  itemIntake?: unknown;
  sellingBrief?: unknown;
  finalLpuOutput?: unknown;
  payloadSnapshot?: unknown;
  pricingSnapshot?: unknown;
  publicWebCompsSnapshot?: unknown;
  manualCompInputs?: unknown;
  vendooSendStatus?: unknown;
  appVersion?: unknown;
  photos?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  archivedAt?: unknown;
  sentToVendooAt?: unknown;
};

const VENDOO_COMPLETION_INPUT_KEYS = new Set([
  "queueId",
  "expectedStatus",
  "itemFingerprint",
  "transformedLpuSha256",
  "vendooDraftIdentitySha256",
  "verifiedMarketplaces",
  "fieldLedgerSha256",
  "finalManifestSha256",
  "seoReviewSha256",
  "completedAt",
]);

export function normalizeVendooCompletionReceipt(
  queueId: string,
  input: unknown
): ListingQueueVendooCompletionReceipt {
  if (!isRecord(input)) {
    throw new Error("Vendoo completion receipt must be an object.");
  }
  if (Object.keys(input).some((key) => !VENDOO_COMPLETION_INPUT_KEYS.has(key))) {
    throw new Error("Vendoo completion receipt contains an unsupported field.");
  }
  if (toCleanString(input.queueId) !== queueId) {
    throw new Error("Vendoo completion receipt queueId does not match the route.");
  }
  if (input.expectedStatus !== "lpu_generated") {
    throw new Error("Vendoo completion expectedStatus must be lpu_generated.");
  }

  const itemFingerprint = normalizeSha256(input.itemFingerprint, "itemFingerprint");
  const transformedLpuSha256 = normalizeSha256(
    input.transformedLpuSha256,
    "transformedLpuSha256"
  );
  const vendooDraftIdentitySha256 = normalizeSha256(
    input.vendooDraftIdentitySha256,
    "vendooDraftIdentitySha256"
  );
  const fieldLedgerSha256 = normalizeSha256(
    input.fieldLedgerSha256,
    "fieldLedgerSha256"
  );
  const finalManifestSha256 = normalizeSha256(
    input.finalManifestSha256,
    "finalManifestSha256"
  );
  const seoReviewSha256 = normalizeSha256(input.seoReviewSha256, "seoReviewSha256");
  const completedAt = normalizeIsoTimestamp(input.completedAt);
  const verified = normalizeVerifiedMarketplaces(input.verifiedMarketplaces);

  return {
    schemaVersion: VENDOO_COMPLETION_RECEIPT_SCHEMA_VERSION,
    kind: "vendoo_completion",
    queueId,
    expectedStatus: "lpu_generated",
    itemFingerprint,
    transformedLpuSha256,
    vendooDraftIdentitySha256,
    verifiedMarketplaces: VENDOO_COMPLETION_MARKETPLACES.map((marketplace) => ({
      marketplace,
      status: verified.get(marketplace)!,
    })),
    fieldLedgerSha256,
    finalManifestSha256,
    seoReviewSha256,
    completedAt,
  };
}

const STATUS_SET = new Set<string>(LISTING_QUEUE_STATUSES);

export function normalizeQueueStatus(value: unknown): ListingQueueStatus {
  return typeof value === "string" && STATUS_SET.has(value)
    ? (value as ListingQueueStatus)
    : "intake";
}

export function hasQueuePhotoStorageReference(photo: unknown): boolean {
  if (!isRecord(photo)) return false;
  return toCleanString(photo.storagePath).length > 0;
}

export function stripUnsafePhotoDataForQueue(value: unknown): JsonValue | undefined {
  return sanitizeJsonValue(value, { stripPhotoUnsafeKeys: true });
}

export function sanitizeQueuePhotosForStorage(photos: unknown): ListingQueuePhoto[] {
  if (!Array.isArray(photos)) return [];

  return photos
    .map((photo, index): ListingQueuePhoto | null => {
      if (!isRecord(photo)) return null;

      const storagePath = toCleanString(photo.storagePath);
      if (!storagePath) return null;

      const sortOrder = toFiniteInteger(photo.sortOrder) ?? index;
      const imageUrl = toCleanString(photo.imageUrl);
      const name = toCleanString(photo.name);
      const type = toCleanString(photo.type);
      const size = toNonNegativeNumber(photo.size);

      return {
        storagePath,
        sortOrder,
        ...(imageUrl ? { imageUrl } : {}),
        ...(name ? { name } : {}),
        ...(type ? { type } : {}),
        ...(size !== undefined ? { size } : {}),
      };
    })
    .filter((photo): photo is ListingQueuePhoto => photo !== null)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function sanitizePayloadSnapshotForQueue(
  payload: unknown
): ListingQueuePayloadSnapshot | undefined {
  const sanitized = sanitizeJsonValue(payload, { stripPhotoUnsafeKeys: true });
  return isJsonObject(sanitized) ? sanitized : undefined;
}

export function createListingQueueDraftFromSnapshot(
  input: ListingQueueDraftInput
): ListingQueueRecord {
  const photos = sanitizeQueuePhotosForStorage(input.photos);
  const payloadSnapshot = sanitizePayloadSnapshotForQueue(input.payloadSnapshot);
  const itemIntake = sanitizeObject(input.itemIntake) ?? {};
  const pricingSnapshot = sanitizeObject(input.pricingSnapshot);
  const publicWebCompsSnapshot = sanitizeObject(input.publicWebCompsSnapshot);
  const manualCompInputs = sanitizeObject(input.manualCompInputs);
  const vendooSendStatus = sanitizeObject(input.vendooSendStatus);
  const finalLpuOutput = toCleanString(input.finalLpuOutput);
  const sellingBrief = toCleanString(input.sellingBrief);
  const finalListPrice = toCleanString(input.finalListPrice);
  const explicitStatus = normalizeQueueStatus(input.status);
  const inferredStatus =
    explicitStatus !== "intake"
      ? explicitStatus
      : payloadSnapshot
        ? "payload_ready"
        : finalLpuOutput
          ? "lpu_generated"
          : sellingBrief
            ? "brief_generated"
            : "intake";

  const title = toCleanString(input.title) || summarizeQueueTitle({ payloadSnapshot, finalLpuOutput });
  const thumbnailPath = getQueueThumbnailPath(photos);
  const categorySummary = toCleanString(input.categorySummary) || summarizeCategory(payloadSnapshot);
  const subtitle = toCleanString(input.subtitle);
  const appVersion = toCleanString(input.appVersion);
  const id = toCleanString(input.id);
  const userId = toCleanString(input.userId);
  const createdAt = toCleanString(input.createdAt);
  const updatedAt = toCleanString(input.updatedAt);
  const archivedAt = toCleanString(input.archivedAt);
  const sentToVendooAt = toCleanString(input.sentToVendooAt);

  return {
    ...(id ? { id } : {}),
    ...(userId ? { userId } : input.userId === null ? { userId: null } : {}),
    status: inferredStatus,
    ...(title ? { title } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(categorySummary ? { categorySummary } : {}),
    ...(thumbnailPath ? { thumbnailPath } : {}),
    ...(finalListPrice ? { finalListPrice } : {}),
    itemIntake: itemIntake as ListingQueueItemIntake,
    ...(sellingBrief ? { sellingBrief } : {}),
    ...(finalLpuOutput ? { finalLpuOutput } : {}),
    ...(payloadSnapshot ? { payloadSnapshot } : {}),
    ...(pricingSnapshot ? { pricingSnapshot } : {}),
    ...(publicWebCompsSnapshot ? { publicWebCompsSnapshot } : {}),
    ...(manualCompInputs ? { manualCompInputs } : {}),
    ...(vendooSendStatus ? { vendooSendStatus } : {}),
    ...(appVersion ? { appVersion } : {}),
    schemaVersion: LISTING_QUEUE_SCHEMA_VERSION,
    photos,
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(archivedAt ? { archivedAt } : input.archivedAt === null ? { archivedAt: null } : {}),
    ...(sentToVendooAt
      ? { sentToVendooAt }
      : input.sentToVendooAt === null
        ? { sentToVendooAt: null }
        : {}),
  };
}

export function getQueueThumbnailPath(photos: readonly ListingQueuePhoto[]): string {
  return photos[0]?.storagePath ?? "";
}

export function summarizeQueueTitle(input: {
  title?: unknown;
  payloadSnapshot?: unknown;
  finalLpuOutput?: unknown;
}): string {
  const directTitle = toCleanString(input.title);
  if (directTitle) return directTitle;

  const payloadTitle = readNestedString(input.payloadSnapshot, [
    ["coreFields", "title"],
    ["marketplaces", "ebay", "title"],
    ["marketplaces", "ebay", "titleA"],
  ]);
  if (payloadTitle) return payloadTitle;

  const output = toCleanString(input.finalLpuOutput);
  const titleLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Title(?:\s+A|\s+B)?\s*:/i.test(line));
  if (!titleLine) return "";

  return titleLine.replace(/^Title(?:\s+A|\s+B)?\s*:\s*/i, "").trim();
}

export function isSerializableQueueRecord(record: unknown): boolean {
  if (containsUnsafeRuntimeValue(record)) return false;

  try {
    const json = JSON.stringify(record);
    if (typeof json !== "string") return false;
    const parsed = JSON.parse(json) as unknown;
    return !containsUnsafeQueueStorageKeys(parsed);
  } catch {
    return false;
  }
}

function sanitizeObject(value: unknown): JsonObject | undefined {
  const sanitized = sanitizeJsonValue(value, { stripPhotoUnsafeKeys: true });
  return isJsonObject(sanitized) ? sanitized : undefined;
}

function sanitizeJsonValue(
  value: unknown,
  options: { stripPhotoUnsafeKeys: boolean },
  seen = new WeakSet<object>()
): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "bigint") return undefined;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (isUnsafeRuntimeObject(value)) return undefined;

  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const sanitizedArray = value
      .map((entry) => sanitizeJsonValue(entry, options, seen))
      .filter((entry): entry is JsonValue => entry !== undefined);
    seen.delete(value);
    return sanitizedArray;
  }

  if (!isRecord(value)) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (options.stripPhotoUnsafeKeys && (key === "dataUrl" || key === "signedUrl")) {
      continue;
    }

    const sanitizedEntry = sanitizeJsonValue(entry, options, seen);
    if (sanitizedEntry !== undefined) {
      output[key] = sanitizedEntry;
    }
  }

  seen.delete(value);
  return output;
}

function containsUnsafeRuntimeValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) return false;
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  if (isUnsafeRuntimeObject(value)) return true;
  if (seen.has(value)) return true;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => containsUnsafeRuntimeValue(entry, seen));
  }

  return Object.values(value).some((entry) => containsUnsafeRuntimeValue(entry, seen));
}

function containsUnsafeQueueStorageKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUnsafeQueueStorageKeys);
  if (!isRecord(value)) return false;

  return Object.entries(value).some(
    ([key, entry]) =>
      key === "dataUrl" || key === "signedUrl" || containsUnsafeQueueStorageKeys(entry)
  );
}

function isUnsafeRuntimeObject(value: object): boolean {
  const candidate = value as {
    constructor?: { name?: string };
    arrayBuffer?: unknown;
    stream?: unknown;
    text?: unknown;
    name?: unknown;
    size?: unknown;
    type?: unknown;
  };
  const constructorName = candidate.constructor?.name ?? "";

  if (constructorName === "File" || constructorName === "Blob") return true;
  if (
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.stream === "function" &&
    typeof candidate.text === "function" &&
    typeof candidate.size === "number" &&
    typeof candidate.type === "string"
  ) {
    return true;
  }
  if (value instanceof Date) return false;

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

function toCleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value)
    ? value
    : undefined;
}

function toNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readNestedString(value: unknown, paths: string[][]): string {
  for (const path of paths) {
    let current: unknown = value;
    for (const segment of path) {
      if (!isRecord(current)) {
        current = undefined;
        break;
      }
      current = current[segment];
    }

    const found = toCleanString(current);
    if (found) return found;
  }

  return "";
}

function summarizeCategory(payloadSnapshot: unknown): string {
  return readNestedString(payloadSnapshot, [
    ["coreFields", "canonicalVendooCategoryPath"],
    ["coreFields", "category"],
    ["marketplaces", "ebay", "canonicalVendooCategoryPath"],
    ["marketplaces", "ebay", "category"],
  ]);
}

function normalizeSha256(value: unknown, field: string): string {
  const normalized = toCleanString(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a SHA-256 hex digest.`);
  }
  return normalized;
}

function normalizeIsoTimestamp(value: unknown): string {
  const raw = toCleanString(value);
  const parsed = Date.parse(raw);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ||
    !Number.isFinite(parsed)
  ) {
    throw new Error("completedAt must be an ISO-8601 timestamp.");
  }
  return new Date(parsed).toISOString();
}

function normalizeVerifiedMarketplaces(
  value: unknown
): Map<VendooCompletionMarketplace, "verified"> {
  if (!Array.isArray(value) || value.length !== VENDOO_COMPLETION_MARKETPLACES.length) {
    throw new Error("Exactly five verified marketplace receipts are required.");
  }

  const allowed = new Set<string>(VENDOO_COMPLETION_MARKETPLACES);
  const verified = new Map<VendooCompletionMarketplace, "verified">();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).some((key) => key !== "marketplace" && key !== "status") ||
      typeof entry.marketplace !== "string" ||
      !allowed.has(entry.marketplace) ||
      entry.status !== "verified" ||
      verified.has(entry.marketplace as VendooCompletionMarketplace)
    ) {
      throw new Error("Marketplace completion receipts must be unique and verified.");
    }
    verified.set(entry.marketplace as VendooCompletionMarketplace, "verified");
  }

  return verified;
}
