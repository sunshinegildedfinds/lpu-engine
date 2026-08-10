import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const policyPath = path.join(root, "lib/lpu/stagingLegacyMacImagePolicy.ts");
const routePath = path.join(root, "app/api/lpu/generate/route.ts");
const policySource = fs.readFileSync(policyPath, "utf8");
const routeSource = fs.readFileSync(routePath, "utf8");
const compiled = ts.transpileModule(policySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { Buffer, exports: loaded.exports, module: loaded }, { filename: policyPath });
const policy = loaded.exports;
const jpeg = "data:image/jpeg;base64,/9j/2Q==";
const storage = (value) => value === "lpu/staging/example.jpg";

assert.equal(policy.stagingLegacyMacImageUrls([{ name: "a.jpg", type: "image/jpeg", imageUrl: jpeg }], true, storage).get(0), jpeg);
assert.equal(policy.stagingLegacyMacImageUrls([{ name: "a.jpg", type: "image/jpeg", imageUrl: "https://example.invalid/a.jpg", storagePath: "lpu/staging/example.jpg" }], true, storage).size, 0);
assert.equal(policy.stagingLegacyMacImageUrls([{ name: "x", type: "text/html", imageUrl: "https://example.invalid" }], false, storage).size, 0);
for (const image of [
  { name: "a.jpg", type: "image/jpeg", imageUrl: "data:image/png;base64,/9j/2Q==" },
  { name: "a.jpg", type: "image/jpeg", imageUrl: "data:image/jpeg;base64,%%%" },
  { name: "a.jpg", type: "image/jpeg", imageUrl: "https://example.invalid/a.jpg" },
  { name: "a.svg", type: "image/svg+xml", imageUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
]) assert.throws(() => policy.stagingLegacyMacImageUrls([image], true, storage));
assert.throws(() => policy.stagingLegacyMacImageUrls([
  { name: "a.jpg", type: "image/jpeg", imageUrl: jpeg },
  { name: "b.jpg", type: "image/jpeg", imageUrl: "https://example.invalid/b.jpg", storagePath: "lpu/staging/example.jpg" },
], true, storage));
assert.throws(() => policy.stagingLegacyMacImageUrls(Array.from({ length: 13 }, (_, index) => ({ name: `${index}.jpg`, type: "image/jpeg", imageUrl: jpeg })), true, storage));

const post = routeSource.slice(routeSource.indexOf("export async function POST"));
assert(post.indexOf("await requireQueueOwnerSession()") < post.indexOf("await request.json()"));
assert(post.indexOf("await requireQueueOwnerSession()") < post.indexOf("stagingLegacyMacImageUrls("));
assert.match(routeSource, /if \(legacyMacImageUrl\) return legacyMacImageUrl/);
assert.match(routeSource, /error instanceof StagingLegacyMacImageError[\s\S]*status:\s*400/);
assert.match(policySource, /if \(!staging\) return new Map\(\)/);
console.log("staging legacy Mac image compatibility checks passed");
