import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const modelSource = source("lib/lpu/openaiModels.ts");
const generateRoute = source("app/api/lpu/generate/route.ts");
const webCompsRoute = source("app/api/lpu/web-comps/route.ts");
const browserSources = [
  source("app/lpu/page.tsx"),
  source("app/lpu-v2/page.tsx"),
  source("app/lpu-extension/page.tsx"),
];

function loadModels(environment = {}) {
  const compiled = ts.transpileModule(modelSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: loadedModule.exports,
    module: loadedModule,
    process: { env: environment },
  }, { filename: "lib/lpu/openaiModels.ts" });
  return loadedModule.exports;
}

const defaults = loadModels();
assert.equal(defaults.getLpuOpenAIGenerationModel(), "gpt-5.6-sol");
assert.equal(defaults.getLpuOpenAIWebCompsModel(), "gpt-5.6-terra");
assert.equal(
  loadModels({ LPU_OPENAI_GENERATION_MODEL: "gpt-5.6-sol" }).getLpuOpenAIGenerationModel(),
  "gpt-5.6-sol"
);
assert.throws(
  () => loadModels({ LPU_OPENAI_GENERATION_MODEL: "gpt-5.3-chat-latest" }).getLpuOpenAIGenerationModel(),
  /not an approved server model/
);
assert.throws(
  () => loadModels({ LPU_OPENAI_WEB_COMPS_MODEL: "gpt-5.6-sol" }).getLpuOpenAIWebCompsModel(),
  /not an approved server model/
);

assert.equal(/gpt-5\.3-chat-latest/.test(generateRoute), false);
assert.equal(/gpt-5\.3-chat-latest/.test(webCompsRoute), false);
assert.match(generateRoute, /getLpuOpenAIGenerationModel/);
assert.match(generateRoute, /export const maxDuration = 540/);
assert.equal((generateRoute.match(/model:\s*getLpuOpenAIGenerationModel\(\)/g) ?? []).length, 11);
assert.match(webCompsRoute, /getLpuOpenAIWebCompsModel/);
assert.match(webCompsRoute, /model:\s*getLpuOpenAIWebCompsModel\(\)/);
assert.equal(/NEXT_PUBLIC_LPU_OPENAI/.test(modelSource), false);
for (const browserSource of browserSources) {
  assert.equal(/LPU_OPENAI_GENERATION_MODEL|LPU_OPENAI_WEB_COMPS_MODEL|gpt-5\.6-(?:sol|terra)/.test(browserSource), false);
}

console.log("OpenAI generation model checks passed.");
