import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = source("supabase/migrations/20260803000000_add_listing_queue_staging_metadata.sql");
const env = source("lib/lpu/deploymentEnv.ts");
const server = source("lib/lpu/listingQueueServer.ts");
const route = source("app/api/lpu/staging/listing-queue/[id]/route.ts");
const storagePolicySource = source("lib/lpu/stagingStoragePolicy.ts");
const uploadRoute = source("app/api/lpu/sign-storage-upload/route.ts");
const readRoute = source("app/api/lpu/sign-storage-image/route.ts");
const generateRoute = source("app/api/lpu/generate/route.ts");
const webCompsRoute = source("app/api/lpu/web-comps/route.ts");
const stagingAccessRoute = source("app/api/lpu/staging-access/route.ts");
const lpuPage = source("app/lpu/page.tsx");
const lpuV2Page = source("app/lpu-v2/page.tsx");
const lpuExtensionPage = source("app/lpu-extension/page.tsx");

function loadPolicyModule() {
  const transpiled = ts.transpileModule(storagePolicySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(transpiled, { exports: loadedModule.exports, module: loadedModule }, {
    filename: "lib/lpu/stagingStoragePolicy.ts",
  });
  return loadedModule.exports;
}

const policy = loadPolicyModule();

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

// Private staging Storage policy: supported MIME types, a per-image limit, and
// server-generated paths are enforced before any signed upload is minted.
assert.equal(policy.STAGING_STORAGE_BUCKET, "lpu-generator-images-staging");
assert.equal(policy.STAGING_MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
assert.equal(policy.STAGING_SIGNED_UPLOAD_TTL_SECONDS, 2 * 60 * 60);
assert.equal(policy.validateStagingImageUpload({ mimeType: "image/jpeg", size: 1 }).ok, true);
assert.equal(policy.validateStagingImageUpload({ mimeType: "image/png", size: 1 }).ok, true);
assert.equal(policy.validateStagingImageUpload({ mimeType: "image/webp", size: 1 }).ok, true);
assert.equal(policy.validateStagingImageUpload({ mimeType: "image/gif", size: 1 }).ok, false);
assert.equal(
  policy.validateStagingImageUpload({
    mimeType: "image/jpeg",
    size: policy.STAGING_MAX_UPLOAD_BYTES + 1,
  }).ok,
  false
);
const stagingPath = policy.buildStagingStoragePath(
  "11111111-1111-4111-8111-111111111111",
  "image/jpeg"
);
assert.equal(stagingPath, "lpu/staging/11111111-1111-4111-8111-111111111111.jpg");
assert.equal(policy.isStagingStoragePath("../lpu/staging/file.jpg"), false);
assert.equal(policy.isStagingStoragePath("lpu/staging/../../private.jpg"), false);
assert.throws(() => policy.getRequiredStagingStorageBucket("another-bucket"));
assert.equal(
  policy.hasRequiredStagingBucketConfiguration({
    id: policy.STAGING_STORAGE_BUCKET,
    public: false,
    file_size_limit: policy.STAGING_MAX_UPLOAD_BYTES,
    allowed_mime_types: ["image/webp", "image/jpeg", "image/png"],
  }),
  true
);
assert.equal(
  policy.hasRequiredStagingBucketConfiguration({
    id: policy.STAGING_STORAGE_BUCKET,
    public: true,
    file_size_limit: policy.STAGING_MAX_UPLOAD_BYTES,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  }),
  false
);
assert.equal(
  policy.hasRequiredStagingBucketConfiguration({
    id: policy.STAGING_STORAGE_BUCKET,
    public: false,
    file_size_limit: policy.STAGING_MAX_UPLOAD_BYTES + 1,
    allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
  }),
  false
);
assert.equal(policy.getProductionStorageBucket("production-bucket"), "production-bucket");
assert.equal(policy.isValidStagingSignedReadRequest(stagingPath, 60), true);
assert.equal(policy.isValidStagingSignedReadRequest(stagingPath, 0), false);
assert.equal(
  policy.isValidStagingSignedReadRequest(
    stagingPath,
    policy.STAGING_SIGNED_READ_TTL_SECONDS + 1
  ),
  false
);
assert.equal(policy.isValidStagingSignedReadRequest("lpu/staging/../../bad.jpg", 60), false);

// Staging uses authenticated, server-selected signed upload/read capabilities;
// production keeps the existing browser upload route when this endpoint is 404.
assert.match(uploadRoute, /if \(!isStagingDeployment\(\)\) return jsonError\("Not found\."\s*,\s*404\)/);
assert.match(uploadRoute, /await requireQueueOwnerSession\(\)/);
assert.match(uploadRoute, /getRequiredStagingStorageBucket/);
assert.match(uploadRoute, /hasRequiredStagingBucketConfiguration/);
assert.match(uploadRoute, /\/storage\/v1\/bucket\//);
assert.match(uploadRoute, /buildStagingStoragePath\(randomUUID\(\)/);
assert.match(uploadRoute, /\/storage\/v1\/object\/upload\/sign\//);
assert.equal(/storagePath\?:/.test(uploadRoute), false);
assert.match(readRoute, /if \(staging\) \{[\s\S]*await requireQueueOwnerSession\(\)/);
assert.match(readRoute, /isValidStagingSignedReadRequest/);
assert.match(generateRoute, /if \(staging && !isStagingStoragePath\(storagePath\)\) return ""/);
for (const browserSource of [lpuPage, lpuV2Page]) {
  assert.match(browserSource, /sign-storage-upload/);
  assert.match(browserSource, /signingResponse\.status !== 404/);
  assert.equal(/SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/.test(browserSource), false);
}

// Staging generation and web-comps reject an unauthenticated request before
// reading its body, signing a Storage URL, or creating an OpenAI client.
function postSource(routeSource) {
  return routeSource.slice(routeSource.indexOf("export async function POST"));
}

const generatePost = postSource(generateRoute);
const generateSessionCheck = generatePost.indexOf("await requireQueueOwnerSession()");
assert(generateSessionCheck >= 0, "Generate requires a staging queue session.");
assert(generateSessionCheck < generatePost.indexOf("await request.json()"));
assert(generateSessionCheck < generatePost.indexOf("resolveGeneratorImageUrl"));
assert(generateSessionCheck < generatePost.indexOf("await generateSellingBrief"));
assert(generateSessionCheck < generatePost.indexOf("await generateValidatedLpuOutput"));
assert.match(generatePost, /error instanceof QueueAuthError[\s\S]*status:\s*401/);

const webCompsPost = postSource(webCompsRoute);
const webCompsSessionCheck = webCompsPost.indexOf("await requireQueueOwnerSession()");
assert(webCompsSessionCheck >= 0, "Web comps requires a staging queue session.");
assert(webCompsSessionCheck < webCompsPost.indexOf("await request.json()"));
assert(webCompsSessionCheck < webCompsPost.indexOf("getOpenAIClient()"));
assert(webCompsSessionCheck < webCompsPost.indexOf("openai.responses.create"));
assert.match(webCompsPost, /error instanceof QueueAuthError[\s\S]*,\s*401\)/);

// The browser checks the staging-only status route first. Its intentional 404
// preserves production behavior; any staging authentication failure stops the
// upload/generation or web-comps request.
assert.match(stagingAccessRoute, /if \(!isStagingDeployment\(\)\)/);
assert.match(stagingAccessRoute, /status:\s*404/);
assert.match(stagingAccessRoute, /await requireQueueOwnerSession\(\)/);
assert.match(stagingAccessRoute, /error instanceof QueueAuthError[\s\S]*status:\s*401/);
for (const browserSource of [lpuPage, lpuV2Page, lpuExtensionPage]) {
  const sessionCheck = browserSource.indexOf("await requireStagingSessionBeforeCostlyRequest()");
  assert(sessionCheck >= 0, "Browser flow checks staging access before costly work.");
  assert.match(browserSource, /response\.status === 404 \|\| response\.ok/);
  assert.equal(/VERCEL_AUTOMATION|vercel-protection-bypass|bypass/i.test(browserSource), false);
}
assert(
  lpuPage.indexOf("await requireStagingSessionBeforeCostlyRequest()") <
    lpuPage.indexOf('fetch("/api/lpu/generate"'),
  "LPU checks staging access before generation."
);
assert(
  lpuExtensionPage.indexOf("await requireStagingSessionBeforeCostlyRequest()") <
    lpuExtensionPage.indexOf('fetch("/api/lpu/generate"'),
  "Extension checks staging access before generation."
);
assert(
  lpuV2Page.indexOf("await requireStagingSessionBeforeCostlyRequest()") <
    lpuV2Page.indexOf('fetch("/api/lpu/generate"'),
  "V2 checks staging access before generation."
);
assert(
  lpuV2Page.indexOf("await requireStagingSessionBeforeCostlyRequest()") <
    lpuV2Page.indexOf('fetch("/api/lpu/web-comps"'),
  "V2 checks staging access before web comps."
);

console.log("Staging support checks passed.");
