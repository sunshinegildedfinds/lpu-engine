import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const nodeRequire = createRequire(import.meta.url);

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

const { buildLpuPayloadPreview } = loadTsModule(
  path.join(rootDir, "lib/lpu/payloadPreview.ts")
);

function warningCodes(preview) {
  return preview.warnings.map((warning) => warning.code);
}

function assertNoBoundaryText(value, label) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  assert.equal(
    /Approximate Measurements|Ships within one business day|Displays & boxes shown are not included|EBAY|DEPOP|POSHMARK|MERCARI|ETSY/i.test(
      text
    ),
    false,
    `${label} contains boundary text: ${text}`
  );
}

const fullOutput = `EBAY
Title A: Universal Object Title A
Title B: Universal Object Title B
Category: Category > Subcategory > Leaf
Item Specifics:
- Brand: Example Maker
- Type: Example Type
- Size: Medium
- Color: Blue
- Material: Mixed material
- Metal: Silver-tone
- Condition: Pre-owned
- Vintage: Yes
- Custom Specific One: Custom Value One
Description:
Line one.
Line two.
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.

DEPOP
Aesthetic Mode:
Primary: minimal
Secondary: vintage
Attributes:
- Color: blue
Listing:
Brand: Example Maker
Size: Medium
Style: Minimal
Depop body text.
Hashtags: #one #two #three
Optional Brand Hashtags: #maker
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.

POSHMARK
Title: Posh title
Description:
Posh body text.
Search keywords: alpha beta gamma
Style Tags: alpha, beta, gamma
Compact 3-Tag Strategy: alpha beta gamma
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.

MERCARI
Title: Mercari title
Description:
Mercari body text.
Hashtags: #one #two #three
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.

ETSY
Title: Etsy title
Category: Category > Subcategory
Materials: cotton, metal
Attributes / Key Details:
- Color: blue
Tags: tag one, tag two, tag three, tag four, tag five, tag six, tag seven, tag eight, tag nine, tag ten, tag eleven, tag twelve, tag thirteen
Description:
Etsy body text.
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.`;

const preview = buildLpuPayloadPreview({
  finalOutput: fullOutput,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
});

assert.equal(preview.debug.version, "v2");
assert.equal(preview.debug.source.hasSellingBrief, true);
assert.deepEqual(Array.from(preview.debug.platformOrder), [
  "ebay",
  "depop",
  "poshmark",
  "mercari",
  "etsy",
]);
assert.equal(preview.debug.payloadMap.platforms.mercari.rawSection, undefined);
assert.equal(preview.debug.payloadMap.platforms.mercari.section.includes("Mercari title"), true);

const payload = preview.payload;
assert.equal(typeof payload, "object");
assert.equal(payload.version, undefined);
assert.equal(payload.marketplaces.ebay.title, "Universal Object Title A");
assert.equal(payload.marketplaces.ebay.titleA, "Universal Object Title A");
assert.equal(payload.marketplaces.ebay.titleB, "Universal Object Title B");
assert.equal(payload.marketplaces.ebay.description.includes("Line one."), true);
assert.equal(payload.marketplaces.ebay.category, "Category > Subcategory > Leaf");
assert.equal(
  payload.marketplaces.ebay.canonicalVendooCategoryPath,
  "Category > Subcategory > Leaf"
);
assert.equal(payload.marketplaces.ebay.itemSpecifics.brand, "Example Maker");
assert.equal(payload.marketplaces.ebay.itemSpecifics.size, "Medium");
assert.equal(payload.marketplaces.ebay.itemSpecifics.color, "Blue");
assert.equal(payload.marketplaces.ebay.itemSpecifics.material, "Mixed material");
assert.equal(payload.marketplaces.ebay.itemSpecifics.condition, "Pre-owned");
assert.equal(payload.marketplaces.ebay.itemSpecifics.Type, "Example Type");
assert.equal(payload.marketplaces.ebay.itemSpecifics.Metal, "Silver-tone");
assert.equal(
  payload.marketplaces.ebay.itemSpecifics["Custom Specific One"],
  "Custom Value One"
);

assert.equal(payload.coreFields.title, "Universal Object Title A");
assert.equal(payload.coreFields.brand, "Example Maker");
assert.equal(payload.marketplaceFields.ebay.titleA, "Universal Object Title A");
assert.equal(payload.marketplaceFields.ebay.itemSpecifics.Type, "Example Type");
assert.equal(payload.marketplaceFields.ebay.itemSpecifics.Metal, "Silver-tone");

assert.equal(payload.marketplaces.depop.listing.includes("Depop body text."), true);
assert.equal(payload.marketplaces.depop.description, payload.marketplaces.depop.listing);
assert.equal(payload.marketplaces.depop.hashtags, "#one #two #three");
assert.equal(payload.marketplaces.depop.optionalBrandHashtags.includes("#maker"), true);
assert.equal(
  payload.marketplaces.depop.optionalBrandHashtags.includes(
    "Ships within one business day"
  ),
  false
);
assert.equal(payload.marketplaces.depop.brand, "Example Maker");
assert.equal(payload.marketplaces.depop.size, "Medium");
assert.equal(payload.marketplaces.depop.style, "Minimal");
assertNoBoundaryText(payload.marketplaces.depop.optionalBrandHashtags, "Depop optionalBrandHashtags");

assert.equal(payload.marketplaces.poshmark.title, "Posh title");
assert.equal(payload.marketplaces.poshmark.description.includes("Posh body text."), true);
assert.equal(
  payload.marketplaces.poshmark.description.includes("Search keywords: alpha beta gamma"),
  false
);
assert.deepEqual(Array.from(payload.marketplaces.poshmark.styleTags).slice(0, 3), [
  "alpha",
  "beta",
  "gamma",
]);
assert.equal(
  payload.marketplaces.poshmark.styleTags.some((tag) =>
    tag.includes("Ships within one business day")
  ),
  false
);
assert.equal(
  payload.marketplaces.poshmark.styleTags.some((tag) =>
    tag.includes("Compact 3-Tag Strategy")
  ),
  false
);
assertNoBoundaryText(payload.marketplaces.poshmark.styleTags, "Poshmark styleTags");

assert.equal(payload.marketplaces.mercari, undefined);
assert.equal(payload.etsy.title, "Etsy title");
assert.equal(payload.etsy.materials, "cotton, metal");
assert.equal(payload.etsy.description.includes("Etsy body text."), true);
assert.equal(payload.etsy.description.includes("Ships within one business day"), false);
assert.equal(payload.etsy.tags.length, 13);
assert.deepEqual(Array.from(payload.marketplaceFields.etsy.tags).slice(0, 2), [
  "tag one",
  "tag two",
]);

assert.equal(preview.debug.rawSections.ebay.includes("Ships within one business day"), true);
assert.equal(preview.payload.marketplaces.ebay.description.includes("Ships within"), false);
assert.doesNotThrow(() => JSON.stringify(preview.payload));
assert.doesNotThrow(() => JSON.stringify(preview.debug));
assert(
  warningCodes(preview).includes("ebay_item_specifics_fillability"),
  "extra eBay item-specific fillability warning was not produced"
);

const partialPreview = buildLpuPayloadPreview({
  finalOutput: `EBAY
Title A: Only a title

ETSY
Tags: one, two`,
  hasSellingBrief: false,
  generatedAt: "2026-06-11T00:00:00.000Z",
});

assert.equal(partialPreview.debug.source.hasSellingBrief, false);
assert.equal(partialPreview.payload.marketplaces.ebay.titleA, "Only a title");
assert.equal(partialPreview.payload.etsy.tags.length, 2);
assert(
  partialPreview.warnings.some(
    (warning) =>
      warning.code === "missing_platform_section" &&
      warning.platform === "depop"
  ),
  "missing Depop platform warning was not produced"
);
assert(
  partialPreview.warnings.some(
    (warning) => warning.code === "missing_field" && warning.platform === "ebay"
  ),
  "missing eBay field warning was not produced"
);
assert(
  partialPreview.warnings.some(
    (warning) => warning.code === "etsy_tags_count" && warning.platform === "etsy"
  ),
  "Etsy tag count warning was not produced"
);

const blankOptionalPreview = buildLpuPayloadPreview({
  finalOutput: `EBAY
Title A: Boundary Title A
Title B: Boundary Title B
Category: Category > Subcategory > Leaf
Item Specifics:
Brand: Example Brand
Color: Black
Description:
Boundary eBay body.
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.

DEPOP
Listing:
Boundary depop body.
Hashtags: #one #two #three
Optional Brand Hashtags:
Approximate Measurements:
Length: 2 in
Ships within one business day footer: Ships within one business day.

POSHMARK
Title: Boundary posh title
Description:
Boundary posh body.
Search keywords: one two three
Style Tags: polished, classic, minimal
Approximate Measurements:
Length: 3 in
Ships within one business day footer: Ships within one business day.

MERCARI
Title: Boundary mercari title
Description:
Boundary mercari body.
Hashtags: #one #two #three
Approximate Measurements:
Length: 4 in
Ships within one business day footer: Ships within one business day.

ETSY
Title: Boundary etsy title
Category: Category > Subcategory
Materials: mixed
Tags: tag one, tag two, tag three, tag four, tag five, tag six, tag seven, tag eight, tag nine, tag ten, tag eleven, tag twelve, tag thirteen
Description:
Boundary etsy body.
Approximate Measurements:
Length: 5 in
Ships within one business day footer: Ships within one business day.`,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
});

assert.equal(blankOptionalPreview.payload.marketplaces.depop.optionalBrandHashtags, "");
assertNoBoundaryText(
  blankOptionalPreview.payload.marketplaces.depop.optionalBrandHashtags,
  "blank optionalBrandHashtags"
);
assert.equal(blankOptionalPreview.payload.marketplaces.depop.description.includes("MERCARI"), false);
assert.deepEqual(
  Array.from(blankOptionalPreview.payload.marketplaces.poshmark.styleTags),
  ["polished", "classic", "minimal"]
);

const copiedPoshmarkStyleTagsPreview = buildLpuPayloadPreview({
  finalOutput: `POSHMARK

Title:
Example title

Description:
Example description

Search keywords:
example keyword one, example keyword two

Style Tags:
Tag One; Tag Two; Tag Three

Compact 3-Tag Strategy (Alt Option):
Alt One; Alt Two; Alt Three

Approximate Measurements:
Width: approx. 1 inch

Ships within one business day after purchase. Displays & boxes shown are not included.`,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
});

const copiedPoshmarkStyleTagsPayload = copiedPoshmarkStyleTagsPreview.payload;
const expectedCopiedPoshmarkStyleTags = ["Tag One", "Tag Two", "Tag Three"];
assert.deepEqual(
  Array.from(copiedPoshmarkStyleTagsPayload.marketplaces.poshmark.styleTags),
  expectedCopiedPoshmarkStyleTags
);
if (copiedPoshmarkStyleTagsPayload.marketplaceFields.poshmark) {
  assert.deepEqual(
    Array.from(copiedPoshmarkStyleTagsPayload.marketplaceFields.poshmark.styleTags),
    expectedCopiedPoshmarkStyleTags
  );
}

for (const forbidden of [
  "Compact 3-Tag Strategy",
  "Alt One",
  "Alt Two",
  "Alt Three",
  "Approximate Measurements",
  "Ships within one business day",
  "Displays & boxes shown are not included",
]) {
  assert.equal(
    copiedPoshmarkStyleTagsPayload.marketplaces.poshmark.styleTags.some((tag) =>
      tag.includes(forbidden)
    ),
    false,
    `Copied Poshmark styleTags include forbidden text: ${forbidden}`
  );
  if (copiedPoshmarkStyleTagsPayload.marketplaceFields.poshmark) {
    assert.equal(
      copiedPoshmarkStyleTagsPayload.marketplaceFields.poshmark.styleTags.some((tag) =>
        tag.includes(forbidden)
      ),
      false,
      `Copied marketplaceFields Poshmark styleTags include forbidden text: ${forbidden}`
    );
  }
}

const itemSpecificsPreview = buildLpuPayloadPreview({
  finalOutput: `EBAY
Title A: Specifics Title A
Title B: Specifics Title B
Category: Jewelry & Watches > Fashion Jewelry > Brooches & Pins
Item Specifics:
Brand: Example Brand
Type: Example Type
Material: Example Material
Metal: Example Metal
Color: Example Color
Style: Example Style
Theme: Example Theme
Closure: Example Closure
Department: Example Department
Vintage: Yes
Handmade: No
Signed: No
Shape: Example Shape
Condition: Pre-owned
Country/Region of Manufacture: Not specified
Custom Specific One: Custom Value One
Custom Specific Two: Custom Value Two
Approximate Measurements:
Length: 1 in
Ships within one business day footer: Ships within one business day.

DEPOP
Listing:
Depop body.
Hashtags: #one #two #three
Optional Brand Hashtags:

POSHMARK
Title: Posh title
Description:
Posh body.
Search keywords: one two three
Style Tags: one, two, three

MERCARI
Title: Mercari title
Description:
Mercari body.
Hashtags: #one #two #three

ETSY
Title: Etsy title
Category: Category > Subcategory
Materials: mixed
Tags: tag one, tag two, tag three, tag four, tag five, tag six, tag seven, tag eight, tag nine, tag ten, tag eleven, tag twelve, tag thirteen
Description:
Etsy body.`,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
});

const completeSpecifics = itemSpecificsPreview.payload.marketplaces.ebay.itemSpecifics;
const expectedSpecifics = {
  Brand: "Example Brand",
  Type: "Example Type",
  Material: "Example Material",
  Metal: "Example Metal",
  Color: "Example Color",
  Style: "Example Style",
  Theme: "Example Theme",
  Closure: "Example Closure",
  Department: "Example Department",
  Vintage: "Yes",
  Handmade: "No",
  Signed: "No",
  Shape: "Example Shape",
  Condition: "Pre-owned",
  "Country/Region of Manufacture": "Not specified",
  "Custom Specific One": "Custom Value One",
  "Custom Specific Two": "Custom Value Two",
};

for (const [key, value] of Object.entries(expectedSpecifics)) {
  assert.equal(completeSpecifics[key], value, `missing preserved item specific ${key}`);
  assert.equal(
    itemSpecificsPreview.payload.marketplaceFields.ebay.itemSpecifics[key],
    value,
    `missing marketplaceFields item specific ${key}`
  );
}
assertNoBoundaryText(Object.values(completeSpecifics), "complete eBay itemSpecifics");
assert(
  warningCodes(itemSpecificsPreview).includes("ebay_item_specifics_fillability"),
  "fillability warning was not produced for extra item specifics"
);

const contaminatedPreview = buildLpuPayloadPreview({
  finalOutput: `EBAY
Title A: Contaminated Title A
Title B: Contaminated Title B
Category: Category > Subcategory > Leaf
Item Specifics:
Brand: Example Brand
Color: Blue
Broken item specific row
Description:
Contaminated body.

DEPOP
Listing:
Depop body.
Hashtags: #one #two #three
Optional Brand Hashtags: Approximate Measurements: Length: 2 in

POSHMARK
Title: Posh title
Description:
Posh body.
Search keywords: one two three
Style Tags: one, Approximate Measurements: 3 in, three

MERCARI
Title: Mercari title
Description:
Mercari body.
Hashtags: #one #two #three

ETSY
Title: Etsy title
Category: Category > Subcategory
Materials: mixed
Tags: tag one, tag two, tag three, tag four, tag five, tag six, tag seven, tag eight, tag nine, tag ten, tag eleven, tag twelve, tag thirteen
Description:
Etsy body.`,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
});

assert(
  contaminatedPreview.warnings.some((warning) =>
    ["field_boundary_contamination", "unparsed_item_specific"].includes(warning.code)
  ),
  "contaminated fixture did not produce contamination warnings"
);

console.log("V2 payload preview compatibility checks passed.");
