import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/20260803000000_add_listing_queue_staging_metadata.sql");
const env = source("lib/lpu/deploymentEnv.ts");
const server = source("lib/lpu/listingQueueServer.ts");
const route = source("app/api/lpu/staging/listing-queue/[id]/route.ts");

// Production rejection: the staging endpoint has no production behavior.
assert.match(route, /if \(!isStagingDeployment\(\)\) return jsonError\("Not found\."\s*,\s*404\)/);
// Authentication failure is guarded before any hard-delete call.
assert.match(route, /await requireQueueOwnerSession\(\)/);
assert.match(route, /error instanceof QueueAuthError/);
// Wrong-ID confirmation and non-UUID route values are rejected.
assert.match(route, /isExactUuid\(id\)/);
assert.match(route, /!isExactUuid\(confirmedId\) \|\| confirmedId !== id/);
// The destructive helper rejects production and records without staging marking.
assert.match(server, /if \(!isStagingDeployment\(\)\)/);
assert.match(server, /environment=eq\.staging/);
// Exact-record cleanup fetches exact photo metadata, removes its objects first,
// then deletes exact photo and staging record filters.
assert.match(server, /const photos = await listPhotoRows\(id\)/);
assert.match(server, /await assertStoragePathsExclusiveToListing\(/);
assert.match(server, /rows\.some\(\(row\) => row\.listing_id !== listingId\)/);
assert.match(server, /await deleteStorageObjects\(photos\.map\(\(photo\) => photo\.storage_path\)\)/);
assert.match(server, /listing_queue_photos\?listing_id=eq\.\$\{encodeURIComponent\(id\)\}/);
assert.match(server, /listing_queue\?id=eq\.\$\{encodeURIComponent\(id\)\}&environment=eq\.staging/);
// Expiry filtering is staging-only and is not scheduled or invoked by a route.
assert.match(server, /cleanupExpiredStagingListingQueueItems/);
assert.match(server, /params\.set\("environment", "eq\.staging"\)/);
assert.match(server, /params\.set\("expires_at", `lt\.\$\{now\.toISOString\(\)\}`\)/);
assert.match(server, /failures: Array<\{ id: string; phase: StagingCleanupError/);
assert.match(server, /response\.status !== 404/);
assert.match(server, /Staging cleanup failed during \$\{phase\} for queue item \$\{listingId\}/);
assert.equal(/setInterval|cron|schedule|cleanupExpiredStagingListingQueueItems\(\)/.test(route), false);
// Production insertion retains the original projection/payload while staging is additive.
assert.match(server, /queueColumnsForEnvironment\(staging\)/);
assert.match(server, /if \(staging\) \{[\s\S]*row\.environment = metadata\.environment/);
assert.match(server, /title: staging \? prefixStagingTitle/);
assert.match(env, /LPU_DEPLOYMENT_ENV/);
assert.match(env, /=== "staging"[\s\S]*: "production"/);
assert.match(migration, /add column if not exists environment text null/i);
assert.match(migration, /add column if not exists test_run_id uuid null/i);
assert.match(migration, /add column if not exists expires_at timestamptz null/i);

console.log("Staging support checks passed.");
