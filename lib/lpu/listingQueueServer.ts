import "server-only";

import {
  LISTING_QUEUE_SCHEMA_VERSION,
  type JsonObject,
  type ListingQueueDraftInput,
  type ListingQueuePhoto,
  type ListingQueueRecord,
  type ListingQueueStatus,
  createListingQueueDraftFromSnapshot,
  hasQueuePhotoStorageReference,
  normalizeQueueStatus,
  sanitizePayloadSnapshotForQueue,
  sanitizeQueuePhotosForStorage,
} from "@/lib/lpu/listingQueue";
import {
  getStagingListingMetadata,
  isExactUuid,
  isStagingDeployment,
  prefixStagingTitle,
} from "@/lib/lpu/deploymentEnv";

const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
const SUPABASE_SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";
const SUPABASE_STORAGE_BUCKET_ENV = "NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET";

const QUEUE_COLUMNS = [
  "id",
  "user_id",
  "status",
  "title",
  "subtitle",
  "category_summary",
  "thumbnail_path",
  "final_list_price",
  "item_intake",
  "selling_brief",
  "final_lpu_output",
  "payload_snapshot",
  "pricing_snapshot",
  "public_web_comps_snapshot",
  "manual_comp_inputs",
  "vendoo_send_status",
  "app_version",
  "schema_version",
  "created_at",
  "updated_at",
  "archived_at",
  "sent_to_vendoo_at",
].join(",");

const STAGING_QUEUE_COLUMNS = `${QUEUE_COLUMNS},environment,test_run_id,expires_at`;

const PHOTO_COLUMNS = [
  "id",
  "listing_id",
  "sort_order",
  "storage_path",
  "image_url",
  "file_name",
  "mime_type",
  "size",
  "created_at",
].join(",");

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
};

type QueueRow = {
  id: string;
  user_id: string | null;
  status: string;
  title: string | null;
  subtitle: string | null;
  category_summary: string | null;
  thumbnail_path: string | null;
  final_list_price: string | null;
  item_intake: JsonObject | null;
  selling_brief: string | null;
  final_lpu_output: string | null;
  payload_snapshot: JsonObject | null;
  pricing_snapshot: JsonObject | null;
  public_web_comps_snapshot: JsonObject | null;
  manual_comp_inputs: JsonObject | null;
  vendoo_send_status: JsonObject | null;
  app_version: string | null;
  schema_version: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  sent_to_vendoo_at: string | null;
  environment?: string | null;
  test_run_id?: string | null;
  expires_at?: string | null;
};

type PhotoRow = {
  id: string;
  listing_id: string;
  sort_order: number;
  storage_path: string;
  image_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  size: number | null;
  created_at: string;
};

export type ListingQueueCreateInput = ListingQueueDraftInput & {
  thumbnailPath?: unknown;
};

export type ListingQueueUpdateInput = ListingQueueDraftInput & {
  thumbnailPath?: unknown;
};

export type ListingQueueListOptions = {
  includeArchived?: boolean;
  status?: unknown;
  limit?: unknown;
};

export class ListingQueueServerError extends Error {
  status: number;
  code: "not_found" | "storage_unavailable" | "supabase_failed" | "invalid_input";

  constructor(
    message: string,
    status: number,
    code: ListingQueueServerError["code"]
  ) {
    super(message);
    this.name = "ListingQueueServerError";
    this.status = status;
    this.code = code;
  }
}

export class StagingCleanupError extends ListingQueueServerError {
  listingId: string;
  phase: "storage_objects" | "photo_metadata" | "queue_row";

  constructor(
    listingId: string,
    phase: StagingCleanupError["phase"],
    message: string
  ) {
    super(message, 502, "supabase_failed");
    this.name = "StagingCleanupError";
    this.listingId = listingId;
    this.phase = phase;
  }
}

export function normalizeQueueApiError(error: unknown): {
  message: string;
  status: number;
  code: ListingQueueServerError["code"] | "unknown";
} {
  if (error instanceof ListingQueueServerError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
    };
  }

  return {
    message: "Supabase request failed.",
    status: 502,
    code: "unknown",
  };
}

export async function createListingQueueItem(
  input: ListingQueueCreateInput
): Promise<ListingQueueRecord> {
  assertPhotoStoragePaths(input.photos);

  const draft = createListingQueueDraftFromSnapshot(input);
  const staging = isStagingDeployment();
  const queueRow = await supabaseRequest<QueueRow[]>({
    path: `/rest/v1/listing_queue?select=${queueColumnsForEnvironment(staging)}`,
    method: "POST",
    body: toQueueInsertRow(draft, input, staging),
    headers: { Prefer: "return=representation" },
  });
  const createdRow = queueRow[0];
  if (!createdRow?.id) {
    throw new ListingQueueServerError(
      "Supabase request failed.",
      502,
      "supabase_failed"
    );
  }

  if (draft.photos.length > 0) {
    await insertPhotoRows(createdRow.id, draft.photos);
  }

  return getListingQueueItem(createdRow.id);
}

export async function listListingQueueItems(
  options: ListingQueueListOptions = {}
): Promise<ListingQueueRecord[]> {
  const params = new URLSearchParams();
  params.set("select", queueColumnsForEnvironment(isStagingDeployment()));
  params.set("order", "updated_at.desc");
  params.set("limit", normalizeLimit(options.limit).toString());

  const status = normalizeOptionalStatus(options.status);
  if (status) {
    params.set("status", `eq.${status}`);
  } else if (!options.includeArchived) {
    params.set("status", "neq.archived");
  }

  const rows = await supabaseRequest<QueueRow[]>({
    path: `/rest/v1/listing_queue?${params.toString()}`,
    method: "GET",
  });
  const photoRows = await listPhotoRowsForListings(rows.map((row) => row.id));

  return rows.map((row) => queueRecordFromRows(row, photoRows.get(row.id) ?? []));
}

export async function getListingQueueItem(id: string): Promise<ListingQueueRecord> {
  const row = await getQueueRow(id);
  const photos = await listPhotoRows(id);

  return queueRecordFromRows(row, photos);
}

export async function updateListingQueueItem(
  id: string,
  input: ListingQueueUpdateInput
): Promise<ListingQueueRecord> {
  assertValidId(id);
  const patch = toQueuePatchRow(input, isStagingDeployment());

  if (Object.keys(patch).length > 0) {
    await supabaseRequest<QueueRow[]>({
      path: `/rest/v1/listing_queue?id=eq.${encodeURIComponent(id)}&select=${QUEUE_COLUMNS}`,
      method: "PATCH",
      body: patch,
      headers: { Prefer: "return=representation" },
    });
  } else {
    await getQueueRow(id);
  }

  if (Object.prototype.hasOwnProperty.call(input, "photos")) {
    assertPhotoStoragePaths(input.photos);
    const photos = sanitizeQueuePhotosForStorage(input.photos);
    await replacePhotoRows(id, photos);
  }

  return getListingQueueItem(id);
}

export async function archiveListingQueueItem(id: string): Promise<ListingQueueRecord> {
  assertValidId(id);
  const now = new Date().toISOString();

  await supabaseRequest<QueueRow[]>({
    path: `/rest/v1/listing_queue?id=eq.${encodeURIComponent(id)}&select=${QUEUE_COLUMNS}`,
    method: "PATCH",
    body: { status: "archived", archived_at: now },
    headers: { Prefer: "return=representation" },
  });

  return getListingQueueItem(id);
}

export async function restoreListingQueueItem(id: string): Promise<ListingQueueRecord> {
  const item = await getListingQueueItem(id);
  const status = inferRestoredStatus(item);

  await supabaseRequest<QueueRow[]>({
    path: `/rest/v1/listing_queue?id=eq.${encodeURIComponent(id)}&select=${QUEUE_COLUMNS}`,
    method: "PATCH",
    body: { status, archived_at: null },
    headers: { Prefer: "return=representation" },
  });

  return getListingQueueItem(id);
}

/**
 * Staging-only destructive cleanup. This is deliberately not wired to a route
 * or scheduler; a future authenticated job may call it after provisioning.
 */
export async function cleanupExpiredStagingListingQueueItems(
  now = new Date()
): Promise<{
  deletedIds: string[];
  failures: Array<{ id: string; phase: StagingCleanupError["phase"]; error: string }>;
}> {
  if (!isStagingDeployment()) return { deletedIds: [], failures: [] };

  const params = new URLSearchParams();
  params.set("select", "id");
  params.set("environment", "eq.staging");
  params.set("expires_at", `lt.${now.toISOString()}`);
  params.set("order", "expires_at.asc");
  const rows = await supabaseRequest<Array<{ id: string }>>({
    path: `/rest/v1/listing_queue?${params.toString()}`,
    method: "GET",
  });

  const deletedIds: string[] = [];
  const failures: Array<{
    id: string;
    phase: StagingCleanupError["phase"];
    error: string;
  }> = [];
  for (const row of rows) {
    if (!isExactUuid(row.id)) continue;
    try {
      await hardDeleteStagingListingQueueItem(row.id);
      deletedIds.push(row.id);
    } catch (error) {
      if (error instanceof StagingCleanupError) {
        failures.push({ id: row.id, phase: error.phase, error: error.message });
        continue;
      }
      const detail = error instanceof Error ? error.message : "Unknown cleanup failure.";
      failures.push({
        id: row.id,
        phase: "queue_row",
        error: `Staging cleanup failed during queue_row for queue item ${row.id}: ${detail}`,
      });
    }
  }
  return { deletedIds, failures };
}

export async function hardDeleteStagingListingQueueItem(id: string): Promise<void> {
  if (!isStagingDeployment()) {
    throw new ListingQueueServerError("Queue item not found.", 404, "not_found");
  }
  assertExactUuid(id);

  const rows = await supabaseRequest<QueueRow[]>({
    path: `/rest/v1/listing_queue?id=eq.${encodeURIComponent(id)}&environment=eq.staging&select=id&limit=1`,
    method: "GET",
  });
  if (!rows[0]) {
    throw new ListingQueueServerError("Staging queue item not found.", 404, "not_found");
  }

  const photos = await listPhotoRows(id);
  try {
    await assertStoragePathsExclusiveToListing(
      id,
      photos.map((photo) => photo.storage_path)
    );
    await deleteStorageObjects(photos.map((photo) => photo.storage_path));
  } catch (error) {
    throw stagingCleanupError(id, "storage_objects", error);
  }
  try {
    await supabaseRequest<null>({
      path: `/rest/v1/listing_queue_photos?listing_id=eq.${encodeURIComponent(id)}`,
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
      parseJson: false,
    });
  } catch (error) {
    throw stagingCleanupError(id, "photo_metadata", error);
  }
  try {
    await supabaseRequest<null>({
      path: `/rest/v1/listing_queue?id=eq.${encodeURIComponent(id)}&environment=eq.staging`,
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
      parseJson: false,
    });
  } catch (error) {
    throw stagingCleanupError(id, "queue_row", error);
  }
}

async function getQueueRow(id: string): Promise<QueueRow> {
  assertValidId(id);
  const rows = await supabaseRequest<QueueRow[]>({
    path: `/rest/v1/listing_queue?id=eq.${encodeURIComponent(id)}&select=${queueColumnsForEnvironment(isStagingDeployment())}&limit=1`,
    method: "GET",
  });
  const row = rows[0];
  if (!row) {
    throw new ListingQueueServerError("Queue item not found.", 404, "not_found");
  }

  return row;
}

async function listPhotoRows(listingId: string): Promise<PhotoRow[]> {
  const rows = await supabaseRequest<PhotoRow[]>({
    path: `/rest/v1/listing_queue_photos?listing_id=eq.${encodeURIComponent(
      listingId
    )}&select=${PHOTO_COLUMNS}&order=sort_order.asc`,
    method: "GET",
  });

  return rows;
}

async function listPhotoRowsForListings(
  listingIds: string[]
): Promise<Map<string, PhotoRow[]>> {
  if (listingIds.length === 0) return new Map();

  const encodedIds = listingIds.map((id) => encodeURIComponent(id)).join(",");
  const rows = await supabaseRequest<PhotoRow[]>({
    path: `/rest/v1/listing_queue_photos?listing_id=in.(${encodedIds})&select=${PHOTO_COLUMNS}&order=sort_order.asc`,
    method: "GET",
  });
  const grouped = new Map<string, PhotoRow[]>();

  for (const row of rows) {
    const group = grouped.get(row.listing_id) ?? [];
    group.push(row);
    grouped.set(row.listing_id, group);
  }

  return grouped;
}

async function insertPhotoRows(
  listingId: string,
  photos: ListingQueuePhoto[]
): Promise<void> {
  if (photos.length === 0) return;

  await supabaseRequest<PhotoRow[]>({
    path: `/rest/v1/listing_queue_photos?select=${PHOTO_COLUMNS}`,
    method: "POST",
    body: photos.map((photo, index) => toPhotoInsertRow(listingId, photo, index)),
    headers: { Prefer: "return=minimal" },
    parseJson: false,
  });
}

async function replacePhotoRows(
  listingId: string,
  photos: ListingQueuePhoto[]
): Promise<void> {
  await supabaseRequest<null>({
    path: `/rest/v1/listing_queue_photos?listing_id=eq.${encodeURIComponent(listingId)}`,
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
    parseJson: false,
  });
  await insertPhotoRows(listingId, photos);
}

async function supabaseRequest<T>({
  path,
  method,
  body,
  headers,
  parseJson = true,
}: {
  path: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  parseJson?: boolean;
}): Promise<T> {
  const config = getSupabaseConfig();
  const response = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ListingQueueServerError(
      response.status === 404 ? "Queue item not found." : "Supabase request failed.",
      response.status === 404 ? 404 : 502,
      response.status === 404 ? "not_found" : "supabase_failed"
    );
  }

  if (!parseJson || response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

function getSupabaseConfig(): SupabaseConfig {
  const url = process.env[SUPABASE_URL_ENV]?.trim().replace(/\/+$/, "") ?? "";
  const serviceRoleKey = process.env[SUPABASE_SERVICE_ROLE_ENV]?.trim() ?? "";

  if (!url || !serviceRoleKey) {
    throw new ListingQueueServerError(
      "Queue storage unavailable.",
      500,
      "storage_unavailable"
    );
  }

  return { url, serviceRoleKey };
}

function toQueueInsertRow(
  record: ListingQueueRecord,
  input: ListingQueueCreateInput,
  staging: boolean
): Record<string, unknown> {
  const thumbnailPath = cleanString(input.thumbnailPath) || record.thumbnailPath || null;

  const row: Record<string, unknown> = {
    user_id: record.userId ?? null,
    status: record.status,
    title: staging ? prefixStagingTitle(record.title) : record.title ?? null,
    subtitle: record.subtitle ?? null,
    category_summary: record.categorySummary ?? null,
    thumbnail_path: thumbnailPath,
    final_list_price: record.finalListPrice ?? null,
    item_intake: record.itemIntake,
    selling_brief: record.sellingBrief ?? null,
    final_lpu_output: record.finalLpuOutput ?? null,
    payload_snapshot: record.payloadSnapshot ?? null,
    pricing_snapshot: record.pricingSnapshot ?? null,
    public_web_comps_snapshot: record.publicWebCompsSnapshot ?? null,
    manual_comp_inputs: record.manualCompInputs ?? null,
    vendoo_send_status: record.vendooSendStatus ?? null,
    app_version: record.appVersion ?? null,
    schema_version: LISTING_QUEUE_SCHEMA_VERSION,
    sent_to_vendoo_at: record.sentToVendooAt ?? null,
  };
  if (staging) {
    const metadata = getStagingListingMetadata();
    row.environment = metadata.environment;
    row.test_run_id = metadata.testRunId;
    row.expires_at = metadata.expiresAt;
  }
  return row;
}

function toQueuePatchRow(
  input: ListingQueueUpdateInput,
  staging: boolean
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (typeof input.title !== "undefined") {
    patch.title = staging
      ? prefixStagingTitle(cleanString(input.title))
      : cleanString(input.title) || null;
  }
  setStringPatch(patch, "subtitle", input.subtitle);
  setStringPatch(patch, "category_summary", input.categorySummary);
  setStringPatch(patch, "thumbnail_path", input.thumbnailPath);
  setStringPatch(patch, "final_list_price", input.finalListPrice);
  setStringPatch(patch, "selling_brief", input.sellingBrief);
  setStringPatch(patch, "final_lpu_output", input.finalLpuOutput);
  setStringPatch(patch, "app_version", input.appVersion);

  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    patch.status = normalizeQueueStatus(input.status);
  }
  if (Object.prototype.hasOwnProperty.call(input, "itemIntake")) {
    patch.item_intake = sanitizeObject(input.itemIntake) ?? {};
  }
  if (Object.prototype.hasOwnProperty.call(input, "payloadSnapshot")) {
    patch.payload_snapshot = sanitizePayloadSnapshotForQueue(input.payloadSnapshot) ?? null;
  }
  setObjectPatch(patch, "pricing_snapshot", input, "pricingSnapshot");
  setObjectPatch(patch, "public_web_comps_snapshot", input, "publicWebCompsSnapshot");
  setObjectPatch(patch, "manual_comp_inputs", input, "manualCompInputs");
  setObjectPatch(patch, "vendoo_send_status", input, "vendooSendStatus");

  return patch;
}

function toPhotoInsertRow(
  listingId: string,
  photo: ListingQueuePhoto,
  index: number
): Record<string, unknown> {
  return {
    listing_id: listingId,
    sort_order: Number.isInteger(photo.sortOrder) ? photo.sortOrder : index,
    storage_path: photo.storagePath,
    image_url: photo.imageUrl ?? null,
    file_name: photo.name ?? null,
    mime_type: photo.type ?? null,
    size: photo.size ?? null,
  };
}

function queueRecordFromRows(
  row: QueueRow,
  photoRows: PhotoRow[]
): ListingQueueRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: normalizeQueueStatus(row.status),
    ...(row.title ? { title: row.title } : {}),
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    ...(row.category_summary ? { categorySummary: row.category_summary } : {}),
    ...(row.thumbnail_path ? { thumbnailPath: row.thumbnail_path } : {}),
    ...(row.final_list_price ? { finalListPrice: row.final_list_price } : {}),
    itemIntake: (row.item_intake ?? {}) as ListingQueueRecord["itemIntake"],
    ...(row.selling_brief ? { sellingBrief: row.selling_brief } : {}),
    ...(row.final_lpu_output ? { finalLpuOutput: row.final_lpu_output } : {}),
    ...(row.payload_snapshot ? { payloadSnapshot: row.payload_snapshot } : {}),
    ...(row.pricing_snapshot ? { pricingSnapshot: row.pricing_snapshot } : {}),
    ...(row.public_web_comps_snapshot
      ? { publicWebCompsSnapshot: row.public_web_comps_snapshot }
      : {}),
    ...(row.manual_comp_inputs ? { manualCompInputs: row.manual_comp_inputs } : {}),
    ...(row.vendoo_send_status ? { vendooSendStatus: row.vendoo_send_status } : {}),
    ...(row.app_version ? { appVersion: row.app_version } : {}),
    schemaVersion: row.schema_version ?? LISTING_QUEUE_SCHEMA_VERSION,
    photos: photoRows.map(photoFromRow),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    sentToVendooAt: row.sent_to_vendoo_at,
    ...getStagingResponseMetadata(row, isStagingDeployment()),
  };
}

export function getStagingResponseMetadata(
  row: Pick<QueueRow, "environment" | "test_run_id" | "expires_at">,
  staging: boolean
): Pick<ListingQueueRecord, "environment" | "testRunId" | "expiresAt"> {
  if (
    !staging ||
    row.environment !== "staging" ||
    !isExactUuid(row.test_run_id) ||
    !isValidStagingExpiry(row.expires_at)
  ) {
    return {};
  }

  return {
    environment: "staging",
    testRunId: row.test_run_id,
    expiresAt: row.expires_at,
  };
}

function isValidStagingExpiry(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function photoFromRow(row: PhotoRow): ListingQueuePhoto {
  return {
    storagePath: row.storage_path,
    sortOrder: row.sort_order,
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    ...(row.file_name ? { name: row.file_name } : {}),
    ...(row.mime_type ? { type: row.mime_type } : {}),
    ...(row.size !== null ? { size: row.size } : {}),
  };
}

function setStringPatch(
  patch: Record<string, unknown>,
  column: string,
  value: unknown
): void {
  if (typeof value === "undefined") return;
  patch[column] = cleanString(value) || null;
}

function setObjectPatch(
  patch: Record<string, unknown>,
  column: string,
  input: ListingQueueUpdateInput,
  key: keyof ListingQueueUpdateInput
): void {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return;
  patch[column] = sanitizeObject(input[key]) ?? null;
}

function sanitizeObject(value: unknown): JsonObject | undefined {
  const sanitized = sanitizePayloadSnapshotForQueue(value);
  return sanitized;
}

function assertPhotoStoragePaths(photos: unknown): void {
  if (typeof photos === "undefined") return;
  if (!Array.isArray(photos)) {
    throw new ListingQueueServerError(
      "Photo storagePath is required.",
      400,
      "invalid_input"
    );
  }

  for (const photo of photos) {
    if (!hasQueuePhotoStorageReference(photo)) {
      throw new ListingQueueServerError(
        "Photo storagePath is required.",
        400,
        "invalid_input"
      );
    }
  }
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function assertValidId(id: string): void {
  if (!id || typeof id !== "string") {
    throw new ListingQueueServerError("Queue item not found.", 404, "not_found");
  }
}

function assertExactUuid(id: string): void {
  if (!isExactUuid(id)) {
    throw new ListingQueueServerError("Invalid queue item ID.", 400, "invalid_input");
  }
}

function queueColumnsForEnvironment(staging: boolean): string {
  return staging ? STAGING_QUEUE_COLUMNS : QUEUE_COLUMNS;
}

async function deleteStorageObjects(storagePaths: string[]): Promise<void> {
  const uniquePaths = [...new Set(storagePaths.filter(Boolean))];
  if (uniquePaths.length === 0) return;

  const config = getSupabaseConfig();
  const bucket = process.env[SUPABASE_STORAGE_BUCKET_ENV]?.trim() || "lpu-generator-images";
  for (const storagePath of uniquePaths) {
    const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
      {
        method: "DELETE",
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
        },
        cache: "no-store",
      }
    );
    // A prior partial run may already have removed this exact object. Treating
    // 404 as success makes retry safe without ever widening the target.
    if (!response.ok && response.status !== 404) {
      throw new ListingQueueServerError("Unable to delete staging storage object.", 502, "supabase_failed");
    }
  }
}

async function assertStoragePathsExclusiveToListing(
  listingId: string,
  storagePaths: string[]
): Promise<void> {
  for (const storagePath of [...new Set(storagePaths.filter(Boolean))]) {
    const rows = await supabaseRequest<Array<{ listing_id: string }>>({
      path: `/rest/v1/listing_queue_photos?storage_path=eq.${encodeURIComponent(
        storagePath
      )}&select=listing_id`,
      method: "GET",
    });
    if (rows.some((row) => row.listing_id !== listingId)) {
      throw new ListingQueueServerError(
        "Staging storage path is shared by another queue item.",
        409,
        "invalid_input"
      );
    }
  }
}

function stagingCleanupError(
  listingId: string,
  phase: StagingCleanupError["phase"],
  error: unknown
): StagingCleanupError {
  if (error instanceof StagingCleanupError) return error;
  const detail = error instanceof Error ? error.message : "Unknown cleanup failure.";
  return new StagingCleanupError(
    listingId,
    phase,
    `Staging cleanup failed during ${phase} for queue item ${listingId}: ${detail}`
  );
}

function normalizeLimit(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return Math.min(Math.max(value, 1), 100);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) return Math.min(Math.max(parsed, 1), 100);
  }

  return 50;
}

function normalizeOptionalStatus(value: unknown): ListingQueueStatus | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return normalizeQueueStatus(value);
}

function inferRestoredStatus(item: ListingQueueRecord): ListingQueueStatus {
  if (item.status !== "archived") return item.status;
  if (item.payloadSnapshot) return "payload_ready";
  if (item.finalLpuOutput) return "lpu_generated";
  if (item.sellingBrief) return "brief_generated";

  return "intake";
}
