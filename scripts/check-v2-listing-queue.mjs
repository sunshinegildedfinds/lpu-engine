import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const nodeRequire = createRequire(import.meta.url);
const migrationDir = path.join(rootDir, "supabase/migrations");
const migrationFiles = fs
  .readdirSync(migrationDir)
  .filter((file) => /_create_listing_queue\.sql$/.test(file))
  .sort();
const migrationPath = path.join(migrationDir, migrationFiles.at(-1) ?? "");

assert(migrationFiles.length > 0, "Migration file exists.");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function resolveTsModule(request, fromFile) {
  if (request.startsWith("@/")) {
    return path.join(rootDir, `${request.slice(2)}.ts`);
  }

  if (request.startsWith(".")) {
    return path.resolve(path.dirname(fromFile), `${request}.ts`);
  }

  return request;
}

function loadTsModule(filePath, cache = new Map()) {
  const resolvedPath = path.resolve(filePath);
  if (cache.has(resolvedPath)) return cache.get(resolvedPath).exports;

  const source = fs.readFileSync(resolvedPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: resolvedPath,
  }).outputText;

  const loadedModule = { exports: {} };
  cache.set(resolvedPath, loadedModule);

  const sandbox = {
    exports: loadedModule.exports,
    module: loadedModule,
    console,
    require: (request) => {
      const resolvedRequest = resolveTsModule(request, resolvedPath);
      if (resolvedRequest.endsWith(".ts")) {
        return loadTsModule(resolvedRequest, cache);
      }
      return nodeRequire(resolvedRequest);
    },
  };

  vm.runInNewContext(transpiled, sandbox, {
    filename: resolvedPath,
  });

  return loadedModule.exports;
}

const {
  LISTING_QUEUE_STATUSES,
  createListingQueueDraftFromSnapshot,
  hasQueuePhotoStorageReference,
  isSerializableQueueRecord,
  normalizeQueueStatus,
  sanitizePayloadSnapshotForQueue,
  sanitizeQueuePhotosForStorage,
  stripUnsafePhotoDataForQueue,
} = loadTsModule(path.join(rootDir, "lib/lpu/listingQueue.ts"));

function assertNoUnsafeStorageKeys(value, label) {
  const json = JSON.stringify(value);
  assert.equal(json.includes("dataUrl"), false, `${label} includes dataUrl`);
  assert.equal(json.includes("signedUrl"), false, `${label} includes signedUrl`);
}

assert.match(migrationSql, /create table if not exists public\.listing_queue\s*\(/i);
assert.match(migrationSql, /create table if not exists public\.listing_queue_photos\s*\(/i);
assert.match(migrationSql, /create extension if not exists pgcrypto/i);
assert.match(migrationSql, /create or replace function public\.set_updated_at/i);
assert.match(migrationSql, /create trigger listing_queue_set_updated_at/i);
assert.match(migrationSql, /alter table public\.listing_queue enable row level security/i);
assert.match(migrationSql, /alter table public\.listing_queue_photos enable row level security/i);
assert.equal(/create policy|for all|to anon|using\s*\(\s*true\s*\)/i.test(migrationSql), false);
assert.equal(/\bsigned_url\b/i.test(migrationSql), false);
assert.equal(/\bdata_url\b/i.test(migrationSql), false);
assert.equal(/\bwidth\b/i.test(migrationSql), false);
assert.equal(/\bheight\b/i.test(migrationSql), false);
assert.match(migrationSql, /storage_path text not null/i);
assert.match(migrationSql, /user_id uuid null/i);

const unsafeFileLike = {
  name: "local.jpg",
  type: "image/jpeg",
  size: 10,
  arrayBuffer() {
    return Promise.resolve(new ArrayBuffer(0));
  },
  stream() {
    return {};
  },
  text() {
    return Promise.resolve("");
  },
};

const rawPhotos = [
  {
    sortOrder: 2,
    storagePath: "lpu/second.jpg",
    imageUrl: "https://example.invalid/second.jpg",
    name: "second.jpg",
    type: "image/jpeg",
    size: 222,
    dataUrl: "data:image/jpeg;base64,second",
    signedUrl: "https://example.invalid/signed-second",
    file: unsafeFileLike,
  },
  {
    sortOrder: 1,
    storagePath: "lpu/first.jpg",
    imageUrl: "https://example.invalid/first.jpg",
    name: "first.jpg",
    type: "image/jpeg",
    size: 111,
    dataUrl: "data:image/jpeg;base64,first",
    signedUrl: "https://example.invalid/signed-first",
  },
  {
    sortOrder: 3,
    imageUrl: "https://example.invalid/local-only.jpg",
    name: "local-only.jpg",
    dataUrl: "data:image/jpeg;base64,local",
  },
];

const photos = sanitizeQueuePhotosForStorage(rawPhotos);
assert.deepEqual(
  photos.map((photo) => photo.sortOrder),
  [1, 2]
);
assert.deepEqual(JSON.parse(JSON.stringify(photos[0])), {
  storagePath: "lpu/first.jpg",
  sortOrder: 1,
  imageUrl: "https://example.invalid/first.jpg",
  name: "first.jpg",
  type: "image/jpeg",
  size: 111,
});
assert.equal(hasQueuePhotoStorageReference(photos[0]), true);
assert.equal(hasQueuePhotoStorageReference(rawPhotos[2]), false);
assertNoUnsafeStorageKeys(photos, "queue photos");

const strippedPhoto = stripUnsafePhotoDataForQueue(rawPhotos[0]);
assertNoUnsafeStorageKeys(strippedPhoto, "stripped photo");
assert.equal(JSON.stringify(strippedPhoto).includes("file"), false);

const payloadSnapshot = sanitizePayloadSnapshotForQueue({
  resolvedPrice: "44.99",
  photos: rawPhotos,
  imagePayload: {
    count: 2,
    photos: rawPhotos,
  },
  nested: {
    dataUrl: "data:image/png;base64,nested",
    signedUrl: "https://example.invalid/signed-nested",
  },
});

assert(payloadSnapshot, "Payload snapshot should sanitize to an object.");
assert.equal(payloadSnapshot.resolvedPrice, "44.99");
assertNoUnsafeStorageKeys(payloadSnapshot, "payload snapshot");
assert.equal(payloadSnapshot.imagePayload.count, 2);
assert.equal(Array.isArray(payloadSnapshot.photos), true);
assert.equal(Array.isArray(payloadSnapshot.imagePayload.photos), true);
assert.equal(payloadSnapshot.photos[0].storagePath, "lpu/second.jpg");
assert.equal(payloadSnapshot.photos[0].imageUrl, "https://example.invalid/second.jpg");
assert.equal(payloadSnapshot.photos[0].name, "second.jpg");
assert.equal(payloadSnapshot.photos[0].type, "image/jpeg");
assert.equal(payloadSnapshot.photos[0].size, 222);

const draft = createListingQueueDraftFromSnapshot({
  itemIntake: {
    notes: "Seller notes",
    knownDetails: "Known detail",
    conditionNotes: "Condition note",
    measurements: "Measurements",
    markings: "Markings",
  },
  sellingBrief: "Selling Brief text",
  finalLpuOutput: "Final LP-U text",
  finalListPrice: "44.99",
  payloadSnapshot,
  pricingSnapshot: { suggestedListPrice: 44.99 },
  publicWebCompsSnapshot: { confidence: "Medium" },
  manualCompInputs: { averageSoldPrice: "40" },
  vendooSendStatus: { status: "idle" },
  photos: rawPhotos,
});

assert.equal(draft.status, "payload_ready");
assert.equal(draft.itemIntake.notes, "Seller notes");
assert.equal(draft.sellingBrief, "Selling Brief text");
assert.equal(draft.finalLpuOutput, "Final LP-U text");
assert.equal(draft.finalListPrice, "44.99");
assert.equal(draft.pricingSnapshot.suggestedListPrice, 44.99);
assert.equal(draft.publicWebCompsSnapshot.confidence, "Medium");
assert.equal(draft.manualCompInputs.averageSoldPrice, "40");
assert.equal(draft.vendooSendStatus.status, "idle");
assert.equal(draft.thumbnailPath, "lpu/first.jpg");
assert.equal(JSON.stringify(draft).includes("data:image"), false);
assertNoUnsafeStorageKeys(draft, "queue draft");
assert.equal(isSerializableQueueRecord(draft), true);
assert.doesNotThrow(() => JSON.stringify(draft));

const minimalDraft = createListingQueueDraftFromSnapshot({
  itemIntake: { notes: "Only intake" },
  photos: [],
});
assert.equal(minimalDraft.status, "intake");
assert.equal(minimalDraft.itemIntake.notes, "Only intake");
assert.equal(isSerializableQueueRecord(minimalDraft), true);

for (const status of LISTING_QUEUE_STATUSES) {
  assert.equal(normalizeQueueStatus(status), status);
}
assert.equal(normalizeQueueStatus("not_real"), "intake");
assert.equal(normalizeQueueStatus(null), "intake");

const cyclic = {};
cyclic.self = cyclic;
assert.equal(isSerializableQueueRecord(cyclic), false);
assert.equal(isSerializableQueueRecord({ file: unsafeFileLike }), false);
assert.equal(isSerializableQueueRecord({ photos: [{ dataUrl: "data:image/png;base64,bad" }] }), false);

const helperSource = fs.readFileSync(path.join(rootDir, "lib/lpu/listingQueue.ts"), "utf8");
assert.equal(/from\s+["']react["']|from\s+["']next\//.test(helperSource), false);
assert.equal(/supabase|fetch\(|XMLHttpRequest|OpenAI|FileReader|window\.|document\./.test(helperSource), false);

const queueAuthPath = path.join(rootDir, "lib/lpu/queueAuth.ts");
const queueAuthLoginRoutePath = path.join(
  rootDir,
  "app/api/lpu/queue-auth/login/route.ts"
);
const queueAuthStatusRoutePath = path.join(
  rootDir,
  "app/api/lpu/queue-auth/status/route.ts"
);
const queueAuthLogoutRoutePath = path.join(
  rootDir,
  "app/api/lpu/queue-auth/logout/route.ts"
);
const listingQueueCrudRouteDir = path.join(rootDir, "app/api/lpu/listing-queue");
const listingQueueServerPath = path.join(rootDir, "lib/lpu/listingQueueServer.ts");
const lpuV2PagePath = path.join(rootDir, "app/lpu-v2/page.tsx");
const listingQueueCollectionRoutePath = path.join(
  listingQueueCrudRouteDir,
  "route.ts"
);
const listingQueueItemRoutePath = path.join(
  listingQueueCrudRouteDir,
  "[id]/route.ts"
);
const listingQueueRestoreRoutePath = path.join(
  listingQueueCrudRouteDir,
  "[id]/restore/route.ts"
);

assert.equal(fs.existsSync(queueAuthPath), true, "Queue auth helper exists.");
assert.equal(
  fs.existsSync(queueAuthLoginRoutePath),
  true,
  "Queue auth login route exists."
);
assert.equal(
  fs.existsSync(queueAuthStatusRoutePath),
  true,
  "Queue auth status route exists."
);
assert.equal(
  fs.existsSync(queueAuthLogoutRoutePath),
  true,
  "Queue auth logout route exists."
);
assert.equal(
  fs.existsSync(listingQueueCrudRouteDir),
  true,
  "Listing queue CRUD route directory exists."
);
assert.equal(
  fs.existsSync(listingQueueServerPath),
  true,
  "Listing queue server helper exists."
);
assert.equal(fs.existsSync(lpuV2PagePath), true, "V2 page exists.");
assert.equal(
  fs.existsSync(listingQueueCollectionRoutePath),
  true,
  "Listing queue collection route exists."
);
assert.equal(
  fs.existsSync(listingQueueItemRoutePath),
  true,
  "Listing queue item route exists."
);
assert.equal(
  fs.existsSync(listingQueueRestoreRoutePath),
  true,
  "Listing queue restore route exists."
);

const queueAuthSource = fs.readFileSync(queueAuthPath, "utf8");
const queueAuthRouteSources = [
  fs.readFileSync(queueAuthLoginRoutePath, "utf8"),
  fs.readFileSync(queueAuthStatusRoutePath, "utf8"),
  fs.readFileSync(queueAuthLogoutRoutePath, "utf8"),
];

assert.match(queueAuthSource, /LPU_QUEUE_OWNER_SECRET/);
assert.match(queueAuthSource, /LPU_QUEUE_SESSION_SECRET/);
assert.match(queueAuthSource, /httpOnly:\s*true/);
assert.match(queueAuthSource, /sameSite:\s*["'](?:strict|lax)["']/i);
assert.match(queueAuthSource, /createHmac|subtle\.sign|HMAC/i);
assert.match(queueAuthSource, /requireQueueOwnerSession/);
assert.match(queueAuthSource, /clearQueueOwnerSession/);
assert.equal(/console\.(log|info|warn|error)|process\.env\[[^\]]+\][^;\n]*console/i.test(queueAuthSource), false);
assert.equal(/NEXT_PUBLIC_|SUPABASE_SERVICE_ROLE_KEY/.test(queueAuthSource), false);
assert.equal(/supabase|fetch\(|XMLHttpRequest|OpenAI|FileReader|window\.|document\./i.test(queueAuthSource), false);
assert.equal(/from\s+["']react["']/.test(queueAuthSource), false);

for (const routeSource of queueAuthRouteSources) {
  assert.equal(/supabase|SUPABASE_|@supabase/i.test(routeSource), false);
  assert.equal(/listingQueueServer|listing_queue|listing-queue/i.test(routeSource), false);
  assert.equal(/extension|vendoo-fill|content-vendoo|content-app/i.test(routeSource), false);
  assert.equal(/OpenAI|openai|responses\.create|chat\.completions/i.test(routeSource), false);
  assert.equal(/from\s+["']react["']|window\.|document\.|localStorage|sessionStorage/i.test(routeSource), false);
}

assert.match(queueAuthRouteSources[0], /export async function POST/);
assert.match(queueAuthRouteSources[0], /setQueueOwnerSessionCookie/);
assert.match(queueAuthRouteSources[1], /export async function GET/);
assert.match(queueAuthRouteSources[1], /requireQueueOwnerSession/);
assert.match(queueAuthRouteSources[2], /export async function POST/);
assert.match(queueAuthRouteSources[2], /clearQueueOwnerSession/);

const listingQueueServerSource = fs.readFileSync(listingQueueServerPath, "utf8");
const listingQueueCollectionRouteSource = fs.readFileSync(
  listingQueueCollectionRoutePath,
  "utf8"
);
const listingQueueItemRouteSource = fs.readFileSync(
  listingQueueItemRoutePath,
  "utf8"
);
const listingQueueRestoreRouteSource = fs.readFileSync(
  listingQueueRestoreRoutePath,
  "utf8"
);
const listingQueueRouteSources = [
  listingQueueCollectionRouteSource,
  listingQueueItemRouteSource,
  listingQueueRestoreRouteSource,
];

assert.match(listingQueueServerSource, /import\s+["']server-only["']/);
assert.match(listingQueueServerSource, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(listingQueueServerSource, /NEXT_PUBLIC_SUPABASE_URL/);
assert.match(listingQueueServerSource, /fetch\(/);
assert.match(listingQueueServerSource, /\/rest\/v1\/listing_queue/);
assert.match(listingQueueServerSource, /\/rest\/v1\/listing_queue_photos/);
assert.equal(/@supabase\/supabase-js/.test(listingQueueServerSource), false);
assert.equal(/OpenAI|openai|responses\.create|chat\.completions/.test(listingQueueServerSource), false);
assert.equal(/from\s+["']react["']|window\.|document\.|localStorage|sessionStorage|FileReader/.test(listingQueueServerSource), false);
assert.equal(/extension|vendoo-fill|content-vendoo|content-app/.test(listingQueueServerSource), false);
assert.equal(/console\.(log|info|warn|error)/.test(listingQueueServerSource), false);
assert.match(listingQueueServerSource, /createListingQueueDraftFromSnapshot/);
assert.match(listingQueueServerSource, /sanitizePayloadSnapshotForQueue/);
assert.match(listingQueueServerSource, /sanitizeQueuePhotosForStorage/);
assert.match(listingQueueServerSource, /hasQueuePhotoStorageReference/);
assert.match(listingQueueServerSource, /Photo storagePath is required/);
assert.equal(/signed_url|data_url/i.test(listingQueueServerSource), false);
assert.match(listingQueueServerSource, /archiveListingQueueItem/);
assert.match(listingQueueServerSource, /status:\s*["']archived["']/);
assert.match(listingQueueServerSource, /archived_at/);
assert.match(listingQueueServerSource, /restoreListingQueueItem/);
assert.match(listingQueueServerSource, /archived_at:\s*null/);

for (const routeSource of listingQueueRouteSources) {
  assert.match(routeSource, /requireQueueOwnerSession/);
  assert.match(routeSource, /QueueAuthError/);
  assert.equal(/SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL/.test(routeSource), false);
  assert.equal(/@supabase\/supabase-js|\/rest\/v1\/|fetch\(/.test(routeSource), false);
  assert.equal(/extension|vendoo-fill|content-vendoo|content-app/.test(routeSource), false);
  assert.equal(/OpenAI|openai|responses\.create|chat\.completions/.test(routeSource), false);
  assert.equal(/from\s+["']react["']|window\.|document\.|localStorage|sessionStorage|FileReader/.test(routeSource), false);
}

assert.match(listingQueueCollectionRouteSource, /export async function GET/);
assert.match(listingQueueCollectionRouteSource, /export async function POST/);
assert.match(listingQueueCollectionRouteSource, /listListingQueueItems/);
assert.match(listingQueueCollectionRouteSource, /createListingQueueItem/);
assert.match(listingQueueCollectionRouteSource, /Invalid JSON body/);

assert.match(listingQueueItemRouteSource, /export async function GET/);
assert.match(listingQueueItemRouteSource, /export async function PATCH/);
assert.match(listingQueueItemRouteSource, /export async function DELETE/);
assert.match(listingQueueItemRouteSource, /getListingQueueItem/);
assert.match(listingQueueItemRouteSource, /updateListingQueueItem/);
assert.match(listingQueueItemRouteSource, /archiveListingQueueItem/);
assert.equal(/deleteListingQueueItem|hardDelete|from\(["']listing_queue["']\)\.delete/i.test(listingQueueItemRouteSource), false);
assert.match(listingQueueItemRouteSource, /Invalid JSON body/);

assert.match(listingQueueRestoreRouteSource, /export async function POST/);
assert.match(listingQueueRestoreRouteSource, /restoreListingQueueItem/);

const lpuV2PageSource = fs.readFileSync(lpuV2PagePath, "utf8");
assert.match(lpuV2PageSource, /\/api\/lpu\/queue-auth\/status/);
assert.match(lpuV2PageSource, /\/api\/lpu\/queue-auth\/login/);
assert.match(lpuV2PageSource, /\/api\/lpu\/queue-auth\/logout/);
assert.match(lpuV2PageSource, /\/api\/lpu\/listing-queue/);
assert.match(lpuV2PageSource, /Save Current Listing to Queue/);
assert.match(lpuV2PageSource, /Update Loaded Queue Item/);
assert.match(lpuV2PageSource, /queueLoadingItemId === item\.id[\s\S]*\?\s*["']Loading\.\.\.["'][\s\S]*:\s*["']Load["']/);
assert.match(lpuV2PageSource, /queueLoadStatus/);
assert.match(lpuV2PageSource, /queueLoadError/);
assert.match(lpuV2PageSource, /queueLoadingItemId/);
assert.match(lpuV2PageSource, /activeQueueItemId/);
assert.match(lpuV2PageSource, /setActiveQueueItemId/);
assert.match(lpuV2PageSource, /queueUpdateStatus/);
assert.match(lpuV2PageSource, /queueUpdateError/);
assert.match(lpuV2PageSource, /queueUpdatingItemId/);
assert.match(lpuV2PageSource, /queueSendingItemId/);
assert.match(lpuV2PageSource, /queueSendStatus/);
assert.match(lpuV2PageSource, /queueSendError/);
assert.equal(/@supabase\/supabase-js|SUPABASE_SERVICE_ROLE_KEY/.test(lpuV2PageSource), false);
assert.equal(/localStorage|sessionStorage/.test(lpuV2PageSource), false);
assert.match(lpuV2PageSource, /Send to Vendoo/);

const queueSnapshotBuilderMatch = lpuV2PageSource.match(
  /function buildCurrentQueueSnapshotBody\(\): CurrentQueueSnapshotBody \| null \{[\s\S]*?\n  \}\n\n  function hasUnsavedWorkspaceContent/
);
assert(queueSnapshotBuilderMatch, "V2 page has current queue snapshot builder.");
assert.match(
  queueSnapshotBuilderMatch[0],
  /stripUnsafePhotoDataForQueue\(payloadPreview\.payload\)/
);
assert.match(queueSnapshotBuilderMatch[0], /status:\s*payloadSnapshot \? ["']payload_ready["'] : ["']lpu_generated["']/);
assert.match(queueSnapshotBuilderMatch[0], /title/);
assert.match(queueSnapshotBuilderMatch[0], /subtitle:\s*categorySummary/);
assert.match(queueSnapshotBuilderMatch[0], /categorySummary/);
assert.match(queueSnapshotBuilderMatch[0], /thumbnailPath:\s*queuePhotoMetadata\[0\]\?\.storagePath/);
assert.match(queueSnapshotBuilderMatch[0], /finalListPrice:\s*finalListPriceInput\.trim\(\)/);
assert.match(queueSnapshotBuilderMatch[0], /itemIntake:\s*\{/);
assert.match(queueSnapshotBuilderMatch[0], /sellingBrief/);
assert.match(queueSnapshotBuilderMatch[0], /finalLpuOutput:\s*output/);
assert.match(queueSnapshotBuilderMatch[0], /payloadSnapshot/);
assert.match(queueSnapshotBuilderMatch[0], /pricingSnapshot/);
assert.match(queueSnapshotBuilderMatch[0], /publicWebCompsSnapshot/);
assert.match(queueSnapshotBuilderMatch[0], /manualCompInputs/);
assert.match(queueSnapshotBuilderMatch[0], /vendooSendStatus/);
assert.match(queueSnapshotBuilderMatch[0], /photos:\s*queuePhotoMetadata/);
assert.equal(/dataUrl|signedUrl|ownerSecret|queueOwnerSecret/i.test(queueSnapshotBuilderMatch[0]), false);

const queueSaveFunctionMatch = lpuV2PageSource.match(
  /async function saveCurrentListingToQueue\(\) \{[\s\S]*?\n  \}\n\n  async function updateLoadedQueueItem/
);
assert(queueSaveFunctionMatch, "V2 page has saveCurrentListingToQueue handler.");
assert.match(queueSaveFunctionMatch[0], /fetch\(["']\/api\/lpu\/listing-queue["']/);
assert.match(queueSaveFunctionMatch[0], /method:\s*["']POST["']/);
assert.match(queueSaveFunctionMatch[0], /const snapshotBody = buildCurrentQueueSnapshotBody\(\)/);
assert.match(queueSaveFunctionMatch[0], /body:\s*JSON\.stringify\(snapshotBody\)/);
assert.match(queueSaveFunctionMatch[0], /setActiveQueueItem\(data\.item\)/);
assert.equal(/dataUrl|signedUrl/.test(queueSaveFunctionMatch[0]), false);

const queuePhotoGeneratorRestoreMatch = lpuV2PageSource.match(
  /function queuePhotosToGeneratorImageReferences\([\s\S]*?\n\}/
);
assert(
  queuePhotoGeneratorRestoreMatch,
  "V2 page has queuePhotosToGeneratorImageReferences helper."
);
assert.match(queuePhotoGeneratorRestoreMatch[0], /storagePath/);
assert.match(queuePhotoGeneratorRestoreMatch[0], /imageUrl/);
assert.match(queuePhotoGeneratorRestoreMatch[0], /fileName/);
assert.match(queuePhotoGeneratorRestoreMatch[0], /mimeType/);
assert.equal(/dataUrl|signedUrl|new File|FileReader/.test(queuePhotoGeneratorRestoreMatch[0]), false);

const queuePhotoVendooRestoreMatch = lpuV2PageSource.match(
  /function queuePhotosToVendooPhotos\([\s\S]*?\n\}/
);
assert(queuePhotoVendooRestoreMatch, "V2 page has queuePhotosToVendooPhotos helper.");
assert.match(queuePhotoVendooRestoreMatch[0], /storagePath/);
assert.match(queuePhotoVendooRestoreMatch[0], /imageUrl/);
assert.match(queuePhotoVendooRestoreMatch[0], /fileName/);
assert.match(queuePhotoVendooRestoreMatch[0], /mimeType/);
assert.equal(/dataUrl|signedUrl|new File|FileReader/.test(queuePhotoVendooRestoreMatch[0]), false);

const queuedPayloadBuilderMatch = lpuV2PageSource.match(
  /function buildQueuedVendooPayload\([\s\S]*?\n  \}\n\n  function hasUnsavedWorkspaceContent/
);
assert(queuedPayloadBuilderMatch, "V2 page has queued Vendoo payload builder.");
const queuedPayloadBuilderSource = queuedPayloadBuilderMatch[0];
assert.match(queuedPayloadBuilderSource, /finalLpuOutput/);
assert.match(queuedPayloadBuilderSource, /readSavedFinalListPrice\(item\)/);
assert.match(queuedPayloadBuilderSource, /queuePhotosToVendooPhotos\(item\.photos\)/);
assert.match(queuedPayloadBuilderSource, /buildLpuPayloadPreview\(\{/);
assert.match(queuedPayloadBuilderSource, /finalOutput/);
assert.match(queuedPayloadBuilderSource, /hasSellingBrief/);
assert.match(queuedPayloadBuilderSource, /finalListPriceInput/);
assert.match(queuedPayloadBuilderSource, /photos/);
assert.equal(/payloadSnapshot/.test(queuedPayloadBuilderSource), false);
assert.equal(/dataUrl|signedUrl|FileReader|new File|sign-storage-image|supabase/i.test(queuedPayloadBuilderSource), false);

const queuedSendFunctionMatch = lpuV2PageSource.match(
  /async function sendQueuedItemToVendoo\(id: string\) \{[\s\S]*?\n  \}\n\n  function handleFileChange/
);
assert(queuedSendFunctionMatch, "V2 page has queued Vendoo send handler.");
const queuedSendFunctionSource = queuedSendFunctionMatch[0];
assert.match(queuedSendFunctionSource, /queueAuthenticated/);
assert.match(queuedSendFunctionSource, /\/api\/lpu\/listing-queue\/\$\{encodeURIComponent\(id\)\}/);
assert.match(queuedSendFunctionSource, /method:\s*["']GET["']/);
assert.match(queuedSendFunctionSource, /cache:\s*["']no-store["']/);
assert.match(queuedSendFunctionSource, /response\.status === 401 \|\| response\.status === 403/);
assert.match(queuedSendFunctionSource, /setQueueAuthenticated\(false\)/);
assert.match(queuedSendFunctionSource, /setQueueItems\(\[\]\)/);
assert.match(queuedSendFunctionSource, /clearActiveQueueItem\(\)/);
assert.match(queuedSendFunctionSource, /buildQueuedVendooPayload\(data\.item\)/);
assert.match(queuedSendFunctionSource, /sendVendooPayloadToExtension\(payload\)/);
assert.match(queuedSendFunctionSource, /Payload send message posted/);
assert.match(queuedSendFunctionSource, /method:\s*["']PATCH["']/);
assert.match(queuedSendFunctionSource, /status:\s*["']sent_to_vendoo["']/);
assert.match(queuedSendFunctionSource, /vendooSendStatus/);
assert.match(queuedSendFunctionSource, /sentAt/);
assert.match(queuedSendFunctionSource, /await loadQueueItems\(\)/);
assert.equal(/sentToVendooAt/.test(queuedSendFunctionSource), false);
assert.equal(/payloadSnapshot/.test(queuedSendFunctionSource), false);
assert.equal(/dataUrl|signedUrl|new File|FileReader|sign-storage-image/.test(queuedSendFunctionSource), false);
assert.equal(/loadQueueItemToWorkspace/.test(queuedSendFunctionSource), false);
assert.equal(/setActiveQueueItemId|setActiveQueueItem\(/.test(queuedSendFunctionSource), false);
assert.equal(/\/restore/.test(queuedSendFunctionSource), false);
assert.equal(/method:\s*["']DELETE["']/.test(queuedSendFunctionSource), false);
assert.equal(/method:\s*["']POST["']/.test(queuedSendFunctionSource), false);
assert.equal(/@supabase\/supabase-js|SUPABASE_SERVICE_ROLE_KEY/.test(queuedSendFunctionSource), false);

const queueCardActionsMatch = lpuV2PageSource.match(
  /queueItems\.map\(\(item\) => \{[\s\S]*?<\/article>/
);
assert(queueCardActionsMatch, "V2 page renders queue cards.");
assert.match(queueCardActionsMatch[0], /Send to Vendoo/);
assert.match(queueCardActionsMatch[0], /sendQueuedItemToVendoo\(item\.id \|\| ["']["']\)/);
assert.match(queueCardActionsMatch[0], /queueSendingItemId === item\.id/);
assert.match(queueCardActionsMatch[0], /queueSendStatus/);
assert.match(queueCardActionsMatch[0], /queueSendError/);

assert.match(lpuV2PageSource, /function restoreManualPricingForm/);
assert.match(lpuV2PageSource, /manualPricingValueToString/);
assert.match(lpuV2PageSource, /function hasUnsavedWorkspaceContent/);
assert.match(lpuV2PageSource, /window\.confirm\(\s*["']Loading this queued listing will replace the current workspace\. Continue\?["']\s*\)/);

const queueLoadFunctionMatch = lpuV2PageSource.match(
  /async function loadQueueItemToWorkspace\(id: string\) \{[\s\S]*?\n  \}\n\n  async function saveCurrentListingToQueue/
);
assert(queueLoadFunctionMatch, "V2 page has loadQueueItemToWorkspace handler.");
const queueLoadFunctionSource = queueLoadFunctionMatch[0];
assert.match(queueLoadFunctionSource, /\/api\/lpu\/listing-queue\/\$\{encodeURIComponent\(id\)\}/);
assert.match(queueLoadFunctionSource, /method:\s*["']GET["']/);
assert.match(queueLoadFunctionSource, /cache:\s*["']no-store["']/);
assert.match(queueLoadFunctionSource, /response\.status === 401 \|\| response\.status === 403/);
assert.match(queueLoadFunctionSource, /setQueueAuthenticated\(false\)/);
assert.match(queueLoadFunctionSource, /setQueueItems\(\[\]\)/);
assert.match(queueLoadFunctionSource, /setNotes\(readQueueObjectString\(itemIntake, \["notes"\]\)\)/);
assert.match(queueLoadFunctionSource, /setKnownDetails\(readQueueObjectString\(itemIntake, \["knownDetails"\]\)\)/);
assert.match(queueLoadFunctionSource, /setConditionNotes\(/);
assert.match(queueLoadFunctionSource, /"conditionNotes", "conditionFlaws"/);
assert.match(queueLoadFunctionSource, /setMeasurements\(readQueueObjectString\(itemIntake, \["measurements"\]\)\)/);
assert.match(queueLoadFunctionSource, /setMarkings\(/);
assert.match(queueLoadFunctionSource, /"markings", "markingsLabels"/);
assert.match(queueLoadFunctionSource, /setSellingBrief\(cleanQueueString\(item\.sellingBrief\)\)/);
assert.match(queueLoadFunctionSource, /setOutput\(cleanQueueString\(item\.finalLpuOutput\)\)/);
assert.match(queueLoadFunctionSource, /setManualPricingForm\(restoreManualPricingForm\(item\.manualCompInputs\)\)/);
assert.match(queueLoadFunctionSource, /isWebCompsResultState\(\s*item\.publicWebCompsSnapshot\s*\)/);
assert.match(queueLoadFunctionSource, /setWebCompsResult\(restoredWebCompsResult\)/);
assert.match(queueLoadFunctionSource, /readSavedFinalListPrice\(item\)/);
assert.match(queueLoadFunctionSource, /setFinalListPriceInput\(restoredFinalListPrice\)/);
assert.match(queueLoadFunctionSource, /setFinalListPriceManuallyEdited\(Boolean\(restoredFinalListPrice\)\)/);
assert.match(queueLoadFunctionSource, /setFiles\(\[\]\)/);
assert.match(queueLoadFunctionSource, /setUploadedImageReferences\(queuePhotosToGeneratorImageReferences\(item\.photos\)\)/);
assert.match(queueLoadFunctionSource, /setVendooPhotos\(queuePhotosToVendooPhotos\(item\.photos\)\)/);
assert.match(queueLoadFunctionSource, /setPayloadCopyStatus\(["']["']\)/);
assert.match(queueLoadFunctionSource, /setVendooSendStatus\(["']idle["']\)/);
assert.match(queueLoadFunctionSource, /setVendooSendMessage\(["']["']\)/);
assert.match(queueLoadFunctionSource, /setVendooPhotoWarnings\(\[\]\)/);
assert.match(queueLoadFunctionSource, /setActiveQueueItem\(item\)/);
assert.equal(/sendVendooPayloadToExtension/.test(queueLoadFunctionSource), false);
assert.equal(/\/restore/.test(queueLoadFunctionSource), false);
assert.equal(/method:\s*["'](?:POST|PATCH|DELETE)["']/.test(queueLoadFunctionSource), false);

const queueUpdateFunctionMatch = lpuV2PageSource.match(
  /async function updateLoadedQueueItem\(\) \{[\s\S]*?\n  \}\n\n  async function sendQueuedItemToVendoo/
);
assert(queueUpdateFunctionMatch, "V2 page has updateLoadedQueueItem handler.");
const queueUpdateFunctionSource = queueUpdateFunctionMatch[0];
assert.match(queueUpdateFunctionSource, /activeQueueItemId/);
assert.match(
  queueUpdateFunctionSource,
  /\/api\/lpu\/listing-queue\/\$\{encodeURIComponent\(activeQueueItemId\)\}/
);
assert.match(queueUpdateFunctionSource, /method:\s*["']PATCH["']/);
assert.match(queueUpdateFunctionSource, /const snapshotBody = buildCurrentQueueSnapshotBody\(\)/);
assert.match(queueUpdateFunctionSource, /body:\s*JSON\.stringify\(snapshotBody\)/);
assert.match(queueUpdateFunctionSource, /response\.status === 401 \|\| response\.status === 403/);
assert.match(queueUpdateFunctionSource, /setQueueAuthenticated\(false\)/);
assert.match(queueUpdateFunctionSource, /setQueueItems\(\[\]\)/);
assert.match(queueUpdateFunctionSource, /clearActiveQueueItem\(\)/);
assert.match(queueUpdateFunctionSource, /setActiveQueueItem\(data\.item\)/);
assert.match(queueUpdateFunctionSource, /await loadQueueItems\(\)/);
assert.equal(/fetch\(["']\/api\/lpu\/listing-queue["']/.test(queueUpdateFunctionSource), false);
assert.equal(/method:\s*["']POST["']/.test(queueUpdateFunctionSource), false);
assert.equal(/\/restore/.test(queueUpdateFunctionSource), false);
assert.equal(/method:\s*["']DELETE["']/.test(queueUpdateFunctionSource), false);
assert.equal(/sendVendooPayloadToExtension/.test(queueUpdateFunctionSource), false);
assert.equal(/sent_to_vendoo/.test(queueUpdateFunctionSource), false);

const changedFiles = execFileSync("git", ["diff", "--name-only"], {
  cwd: rootDir,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean);
const allowedChangedFiles = new Set([
  "app/lpu-v2/page.tsx",
  "scripts/check-v2-listing-queue.mjs",
]);
const unexpectedChangedFiles = changedFiles.filter(
  (file) => !allowedChangedFiles.has(file)
);
const forbiddenChangedFiles = changedFiles.filter(
  (file) =>
    file === "app/lpu/page.tsx" ||
    file.startsWith("listing-writer-app/extension/") ||
    file.startsWith("components/vendoo/") ||
    file.startsWith("lib/vendoo/") ||
    file === "lib/sendVendooPayloadToExtension.ts"
);

assert.deepEqual(unexpectedChangedFiles, [], "Only intended V2 queue UI/check files changed.");
assert.deepEqual(forbiddenChangedFiles, [], "No V1 UI, Vendoo, or extension files changed.");

console.log("V2 listing queue checks passed.");
