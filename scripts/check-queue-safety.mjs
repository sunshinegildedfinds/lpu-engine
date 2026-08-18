import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTypeScriptModule(file, { processEnv = {}, requireModule } = {}) {
  const transpiled = ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(
    transpiled,
    {
      exports: loadedModule.exports,
      module: loadedModule,
      process: { env: processEnv },
      require(specifier) {
        if (specifier === "server-only") return {};
        if (requireModule) return requireModule(specifier);
        throw new Error(`Unexpected test import: ${specifier}`);
      },
      Date,
      Map,
      Set,
      URLSearchParams,
    },
    { filename: file }
  );
  return loadedModule.exports;
}

const deploymentProcessEnv = {};
const deployment = loadTypeScriptModule("lib/lpu/deploymentEnv.ts", {
  processEnv: deploymentProcessEnv,
  requireModule: () => ({}),
});
assert.throws(() => deployment.getLpuDeploymentEnvironment(), /is required/);
deploymentProcessEnv.LPU_DEPLOYMENT_ENV = "staging";
assert.equal(deployment.getLpuDeploymentEnvironment(), "staging");
assert.equal(deployment.resolveDeploymentEnvironment(), "staging");
deploymentProcessEnv.LPU_DEPLOYMENT_ENV = "production";
assert.equal(deployment.getLpuDeploymentEnvironment(), "production");
assert.equal(deployment.resolveDeploymentEnvironment(), "production");
for (const invalid of ["", "STAGING", " staging", "production ", "preview"]) {
  deploymentProcessEnv.LPU_DEPLOYMENT_ENV = invalid;
  assert.throws(() => deployment.getLpuDeploymentEnvironment(), /must be exactly/);
  assert.throws(() => deployment.resolveDeploymentEnvironment(), /must be exactly/);
}

const queue = loadTypeScriptModule("lib/lpu/listingQueue.ts");
const digest = "a".repeat(64);
const queueId = "11111111-1111-4111-8111-111111111111";
const receiptInput = {
  queueId,
  expectedStatus: "lpu_generated",
  itemFingerprint: digest.toUpperCase(),
  transformedLpuSha256: digest,
  vendooDraftIdentitySha256: digest,
  verifiedMarketplaces: [
    { marketplace: "depop", status: "verified" },
    { marketplace: "mercari", status: "verified" },
    { marketplace: "poshmark", status: "verified" },
    { marketplace: "etsy", status: "verified" },
    { marketplace: "ebay", status: "verified" },
  ],
  fieldLedgerSha256: digest,
  finalManifestSha256: digest,
  seoReviewSha256: digest,
  completedAt: "2026-08-18T12:00:00+00:00",
};
const receipt = queue.normalizeVendooCompletionReceipt(queueId, receiptInput);
assert.equal(receipt.schemaVersion, 1);
assert.equal(receipt.kind, "vendoo_completion");
assert.equal(receipt.itemFingerprint, digest);
assert.equal(receipt.completedAt, "2026-08-18T12:00:00.000Z");
assert.deepEqual(
  Array.from(receipt.verifiedMarketplaces, (entry) => entry.marketplace),
  ["ebay", "etsy", "poshmark", "mercari", "depop"]
);
assert.equal(JSON.stringify(receipt).includes("grailed"), false);
assert.throws(
  () =>
    queue.normalizeVendooCompletionReceipt(queueId, {
      ...receiptInput,
      queueId: "22222222-2222-4222-8222-222222222222",
    }),
  /does not match/
);
assert.throws(
  () =>
    queue.normalizeVendooCompletionReceipt(queueId, {
      ...receiptInput,
      verifiedMarketplaces: receiptInput.verifiedMarketplaces.slice(0, 4),
    }),
  /Exactly five/
);
assert.throws(
  () =>
    queue.normalizeVendooCompletionReceipt(queueId, {
      ...receiptInput,
      verifiedMarketplaces: receiptInput.verifiedMarketplaces.map((entry, index) =>
        index === 4 ? { marketplace: "etsy", status: "verified" } : entry
      ),
    }),
  /unique and verified/
);
assert.throws(
  () => queue.normalizeVendooCompletionReceipt(queueId, { ...receiptInput, extra: true }),
  /unsupported field/
);
assert.throws(
  () => queue.normalizeVendooCompletionReceipt(queueId, { ...receiptInput, completedAt: "1" }),
  /ISO-8601/
);

const extensionReceipt = queue.normalizePostedToExtensionUnverifiedReceipt({
  schemaVersion: 1,
  kind: "posted_to_extension_unverified",
  verificationStatus: "unverified",
  postedAt: "2026-08-18T12:00:00+00:00",
});
assert.equal(extensionReceipt.kind, "posted_to_extension_unverified");
assert.equal(extensionReceipt.verificationStatus, "unverified");
assert.equal(extensionReceipt.postedAt, "2026-08-18T12:00:00.000Z");
assert.throws(
  () =>
    queue.normalizePostedToExtensionUnverifiedReceipt({
      ...extensionReceipt,
      verificationStatus: "verified",
    }),
  /Invalid posted_to_extension_unverified/
);
assert.throws(
  () =>
    queue.normalizePostedToExtensionUnverifiedReceipt({
      ...extensionReceipt,
      extra: true,
    }),
  /Invalid posted_to_extension_unverified/
);

const idempotency = loadTypeScriptModule("lib/lpu/listingQueueIdempotency.ts", {
  requireModule(specifier) {
    if (specifier === "node:crypto") return { createHash };
    throw new Error(`Unexpected test import: ${specifier}`);
  },
});
const businessRequest = {
  title: "Café",
  photos: [],
  itemIntake: { notes: "", knownDetails: "A" },
  status: "lpu_generated",
  createOperationId: "queue-create-op-001",
  createRequestSha256: "0".repeat(64),
};
assert.equal(
  idempotency.canonicalizeQueueCreateBusinessRequest(businessRequest),
  '{"itemIntake":{"knownDetails":"A","notes":""},"photos":[],"status":"lpu_generated","title":"Café"}'
);
assert.equal(
  idempotency.calculateQueueCreateRequestSha256(businessRequest),
  "35af0ef5864f0720cebc9f2091cb9a9e7874891179b2ab29021fe10d45e3eb5a"
);
assert.equal(
  idempotency.calculateQueueCreateRequestSha256({
    ...businessRequest,
    createOperationId: "another-operation-002",
    createRequestSha256: "f".repeat(64),
  }),
  "35af0ef5864f0720cebc9f2091cb9a9e7874891179b2ab29021fe10d45e3eb5a"
);
assert.notEqual(
  idempotency.calculateQueueCreateRequestSha256({ ...businessRequest, title: "Changed" }),
  "35af0ef5864f0720cebc9f2091cb9a9e7874891179b2ab29021fe10d45e3eb5a"
);
assert.equal(
  idempotency.canonicalizeQueueCreateBusinessRequest({ "😀": 2, "\uE000": 1 }),
  '{"":1,"😀":2}',
  "Key ordering matches Python Unicode code-point order, not JavaScript UTF-16 order."
);

// Cross-language fixture shared with the Python Universal client. Python uses
// json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False).
const universalClientBusinessRequest = {
  status: "lpu_generated",
  title: "Untitled agent listing",
  subtitle: "",
  categorySummary: "",
  finalListPrice: "",
  itemIntake: {
    notes: "",
    knownDetails: "Known",
    conditionFlaws: "Flaw",
    conditionNotes: "Flaw",
    measurements: "2 in",
    markingsLabels: "Maker",
    markings: "Maker",
  },
  sellingBrief: "Selling Brief fixture",
  finalLpuOutput: "Final LP-U fixture",
  payloadSnapshot: null,
  pricingSnapshot: null,
  publicWebCompsSnapshot: null,
  manualCompInputs: null,
  vendooSendStatus: null,
  appVersion: "v2/v2-agent",
  photos: [],
  agentItemFingerprint: "a".repeat(64),
  createOperationId: "queue-create-fixture-0001",
  createRequestSha256: "0".repeat(64),
};
assert.equal(
  idempotency.calculateQueueCreateRequestSha256(universalClientBusinessRequest),
  "27e16c3959dd574eff3ee391586824b01acf44aeadfca9eab23ef17275ab38b3"
);

const server = source("lib/lpu/listingQueueServer.ts");
const createRoute = source("app/api/lpu/listing-queue/route.ts");
const queueAuthLoginRoute = source("app/api/lpu/queue-auth/login/route.ts");
const completionRoute = source(
  "app/api/lpu/listing-queue/[id]/vendoo-completion/route.ts"
);
const migration = source(
  "supabase/migrations/20260818000000_harden_queue_completion.sql"
);

assert.match(server, /if \(!operationId && !requestSha256 && !itemFingerprint\) return undefined/);
assert.match(server, /agentItemFingerprint, createOperationId, and createRequestSha256 must be provided together/);
assert.match(server, /getQueueRowByCreateOperationId/);
assert.match(server, /reconcileQueueCreateReplay/);
assert.match(server, /error\.code !== "conflict"/);
assert.match(server, /Idempotent autonomous Queue creation cannot include Queue photo rows/);
assert.match(server, /Idempotent autonomous Queue requests cannot contain JSON numbers/);
assert.match(server, /Autonomous Queue photo rows are immutable/);
assert.match(createRoute, /item: result\.item, replayed: result\.replayed/);
assert.match(createRoute, /result\.replayed \? 200 : 201/);

const environmentResolutionIndex = queueAuthLoginRoute.indexOf(
  "const deploymentEnvironment = resolveDeploymentEnvironment()"
);
assert(environmentResolutionIndex >= 0);
assert(
  environmentResolutionIndex < queueAuthLoginRoute.indexOf("createSignedOwnerSession()"),
  "Queue login must resolve the exact deployment environment before issuing a session."
);
assert.match(
  queueAuthLoginRoute,
  /authenticated:\s*true,\s*deploymentEnvironment,\s*expiresAt:/
);

const authIndex = completionRoute.indexOf("await requireQueueOwnerSession()");
assert(authIndex >= 0);
assert(authIndex < completionRoute.indexOf("await request.json()"));
assert.match(completionRoute, /completeListingQueueVendoo\(id, body\)/);
assert.match(server, /\/rest\/v1\/rpc\/complete_listing_queue_vendoo/);
assert.match(server, /status=neq\.sent_to_vendoo/);
assert.match(server, /Vendoo completion must use the dedicated completion endpoint/);
assert.match(server, /An extension-post receipt must keep the Queue item payload_ready/);
assert.match(server, /normalizePostedToExtensionUnverifiedReceipt/);
assert.match(server, /queueEnvironmentFilter\(staging\)/);
assert.match(server, /p_expected_environment: staging \? "staging" : "production"/);
assert.match(server, /getRequiredStagingStorageBucket/);
assert.match(server, /isStagingStoragePath/);
assert.match(server, /Staging storage path is invalid/);
assert.equal(/\|\| "lpu-generator-images"/.test(server), false);

assert.match(migration, /set search_path = ''[\s\S]*new\.updated_at = pg_catalog\.now\(\)/);
assert.match(migration, /create unique index if not exists listing_queue_create_operation_id_uidx/);
assert.match(migration, /listing_queue_create_idempotency_bundle_check/);
assert.match(migration, /agent_item_fingerprint/);
assert.match(migration, /create unique index if not exists listing_queue_staging_storage_path_uidx/);
assert.match(migration, /security invoker/);
assert.match(migration, /for update/);
assert.match(migration, /p_expected_environment = 'staging'[\s\S]*queue_row\.environment is distinct from 'staging'/);
assert.match(migration, /p_expected_environment = 'production'[\s\S]*queue_row\.environment is not null/);
assert.match(migration, /pg_catalog\.sha256/);
assert.match(migration, /queue_row\.vendoo_send_status = p_receipt/);
assert.match(migration, /p_receipt ->> 'itemFingerprint' is distinct from queue_row\.agent_item_fingerprint/);
assert.match(migration, /p_receipt ->> 'seoReviewSha256'[\s\S]*\^\[0-9a-f\]\{64\}\$/);
assert.match(migration, /set status = 'sent_to_vendoo',[\s\S]*vendoo_send_status = p_receipt,[\s\S]*sent_to_vendoo_at = server_completed_at/);
assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
assert.match(migration, /grant execute on function[\s\S]*to service_role/);
assert.equal(/set\s+(final_lpu_output|selling_brief|payload_snapshot)\s*=/i.test(migration), false);

console.log("Queue safety and completion checks passed.");
