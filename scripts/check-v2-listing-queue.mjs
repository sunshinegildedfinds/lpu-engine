import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
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

console.log("V2 listing queue checks passed.");
