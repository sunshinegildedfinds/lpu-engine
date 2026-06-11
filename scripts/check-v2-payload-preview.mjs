import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
assert.equal(payload.photos, undefined);
assert.equal(payload.imagePayload, undefined);
assert.equal(payload.resolvedPrice, undefined);
assert.equal(payload.fillReadiness.ebay.photosReady, false);
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

function assertV1CompatibleResolvedPrice(value, label) {
  assert.equal(typeof value, "string", `${label} resolvedPrice must be a string`);
  assert.match(
    value,
    /^[$]?\d{1,6}([.,]\d{1,2})?$/,
    `${label} resolvedPrice is not V1-compatible`
  );
  assert.equal(
    /[A-Za-z\s]/.test(value),
    false,
    `${label} resolvedPrice includes invalid currency text`
  );
}

function assertV1CompatibleAdjustedPrice(value, expected, label) {
  assert.equal(typeof value, "string", `${label} adjustedPrice must be a string`);
  assert.equal(value, expected.toFixed(2), `${label} adjustedPrice mismatch`);
  assert.match(
    value,
    /^\d+\.\d{2}$/,
    `${label} adjustedPrice must use V1 cents formatting`
  );
  assert.equal(value.includes("$"), false, `${label} adjustedPrice must not include $`);
}

function assertAdjustedPricePaths(preview, expected, label) {
  const payload = preview.payload;
  assertV1CompatibleAdjustedPrice(payload.etsy?.adjustedPrice, expected, `${label} Etsy`);
  assertV1CompatibleAdjustedPrice(
    payload.marketplaceFields?.etsy?.adjustedPrice,
    expected,
    `${label} marketplaceFields Etsy`
  );
  assertV1CompatibleAdjustedPrice(
    payload.marketplaces?.etsy?.adjustedPrice,
    expected,
    `${label} marketplaces Etsy`
  );
  assertV1CompatibleAdjustedPrice(
    payload.poshmark?.adjustedPrice,
    expected,
    `${label} top-level Poshmark`
  );
  assertV1CompatibleAdjustedPrice(
    payload.marketplaces?.poshmark?.adjustedPrice,
    expected,
    `${label} marketplaces Poshmark`
  );
  assertV1CompatibleAdjustedPrice(
    payload.marketplaceFields?.poshmark?.adjustedPrice,
    expected,
    `${label} marketplaceFields Poshmark`
  );
}

function assertAdjustedPriceOmitted(preview, label) {
  const payload = preview.payload;
  assert.equal(payload.etsy?.adjustedPrice, undefined, `${label} Etsy adjustedPrice`);
  assert.equal(
    payload.marketplaceFields?.etsy?.adjustedPrice,
    undefined,
    `${label} marketplaceFields Etsy adjustedPrice`
  );
  assert.equal(
    payload.marketplaces?.etsy?.adjustedPrice,
    undefined,
    `${label} marketplaces Etsy adjustedPrice`
  );
  assert.equal(
    payload.poshmark?.adjustedPrice,
    undefined,
    `${label} top-level Poshmark adjustedPrice`
  );
  assert.equal(
    payload.marketplaces?.poshmark?.adjustedPrice,
    undefined,
    `${label} marketplaces Poshmark adjustedPrice`
  );
  assert.equal(
    payload.marketplaceFields?.poshmark?.adjustedPrice,
    undefined,
    `${label} marketplaceFields Poshmark adjustedPrice`
  );
}

function buildPricePreview(finalListPriceInput, overrides = {}) {
  return buildLpuPayloadPreview({
    finalOutput: fullOutput,
    hasSellingBrief: true,
    generatedAt: "2026-06-11T00:00:00.000Z",
    finalListPriceInput,
    ...overrides,
  });
}

const validWholeDollarPreview = buildPricePreview("100", {
  suggestedListPrice: "500",
  fastSalePrice: "50",
  bestOfferFloor: "25",
});
assert.equal(validWholeDollarPreview.payload.resolvedPrice, "100");
assertAdjustedPricePaths(validWholeDollarPreview, 100 * 1.15, "valid whole-dollar final list price");

const resolvedPricePreview = buildPricePreview("129.99");
assert.equal(resolvedPricePreview.payload.resolvedPrice, "129.99");
assertV1CompatibleResolvedPrice(
  resolvedPricePreview.payload.resolvedPrice,
  "decimal final list price"
);
assertAdjustedPricePaths(
  resolvedPricePreview,
  129.99 * 1.15,
  "decimal final list price"
);

const currencyResolvedPricePreview = buildPricePreview("$129.99");
assert.equal(currencyResolvedPricePreview.payload.resolvedPrice, "129.99");
assertV1CompatibleResolvedPrice(
  currencyResolvedPricePreview.payload.resolvedPrice,
  "currency final list price"
);
assertAdjustedPricePaths(
  currencyResolvedPricePreview,
  129.99 * 1.15,
  "currency final list price"
);

const wholeNumberResolvedPricePreview = buildPricePreview("130");
assert.equal(wholeNumberResolvedPricePreview.payload.resolvedPrice, "130");
assertV1CompatibleResolvedPrice(
  wholeNumberResolvedPricePreview.payload.resolvedPrice,
  "whole-number final list price"
);

for (const invalidFinalListPriceInput of ["", "abc", "0", "-5", "NaN"]) {
  const invalidPricePreview = buildPricePreview(invalidFinalListPriceInput);
  assert.equal(
    invalidPricePreview.payload.resolvedPrice,
    undefined,
    `invalid final list price ${invalidFinalListPriceInput} should omit resolvedPrice`
  );
  assertAdjustedPriceOmitted(
    invalidPricePreview,
    `invalid final list price ${invalidFinalListPriceInput}`
  );
  assert.equal(
    warningCodes(invalidPricePreview).includes("invalid_final_list_price"),
    invalidFinalListPriceInput.trim().length > 0,
    `invalid final list price ${invalidFinalListPriceInput} warning behavior was incorrect`
  );
}

const otherPricingFieldsPreview = buildLpuPayloadPreview({
  finalOutput: fullOutput,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
  finalListPriceInput: "129.99",
  suggestedListPrice: "201.25",
  fastSalePrice: "75.50",
  bestOfferFloor: "61.00",
});
assert.equal(
  otherPricingFieldsPreview.payload.resolvedPrice,
  "129.99",
  "resolvedPrice must use editable Final List Price instead of other pricing fields"
);
assertAdjustedPricePaths(
  otherPricingFieldsPreview,
  129.99 * 1.15,
  "other pricing fields ignored"
);

const missingFinalPriceWithOtherPricingFieldsPreview = buildLpuPayloadPreview({
  finalOutput: fullOutput,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
  suggestedListPrice: "201.25",
  fastSalePrice: "75.50",
  bestOfferFloor: "61.00",
});
assert.equal(
  missingFinalPriceWithOtherPricingFieldsPreview.payload.resolvedPrice,
  undefined,
  "resolvedPrice must not fall back to suggestedListPrice, fastSalePrice, or bestOfferFloor"
);
assertAdjustedPriceOmitted(
  missingFinalPriceWithOtherPricingFieldsPreview,
  "missing final price with other pricing fields"
);

assert.doesNotThrow(() => JSON.stringify(resolvedPricePreview.payload));
assert.equal(typeof resolvedPricePreview.payload.marketplaces.ebay, "object");
assert.equal(typeof resolvedPricePreview.payload.coreFields, "object");
assert.equal(typeof resolvedPricePreview.payload.marketplaceFields, "object");
assert.equal(
  resolvedPricePreview.payload.marketplaces.ebay.itemSpecifics.Type,
  "Example Type"
);
assert.equal(
  resolvedPricePreview.payload.marketplaces.ebay.itemSpecifics.Metal,
  "Silver-tone"
);
assertNoBoundaryText(
  resolvedPricePreview.payload.marketplaces.poshmark.styleTags,
  "resolved price preview Poshmark styleTags"
);
assertNoBoundaryText(
  resolvedPricePreview.payload.marketplaces.depop.optionalBrandHashtags,
  "resolved price preview Depop optionalBrandHashtags"
);

const universalPhotos = [
  {
    name: "photo-one.jpg",
    type: "image/jpeg",
    size: 12345,
    dataUrl: "data:image/jpeg;base64,AAAA",
  },
  {
    name: "photo-two.png",
    type: "image/png",
    size: 23456,
    dataUrl: "data:image/png;base64,BBBB",
    storagePath: "example/path/photo-two.png",
    imageUrl: "https://example.invalid/photo-two.png",
    signedUrl: "https://example.invalid/signed/photo-two.png",
  },
];

const photoPreview = buildLpuPayloadPreview({
  finalOutput: fullOutput,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
  photos: universalPhotos,
});

assert.equal(typeof photoPreview.payload, "object");
assert.equal(photoPreview.payload.marketplaces.ebay.title, "Universal Object Title A");
assert(Array.isArray(photoPreview.payload.photos), "payload.photos was not produced");
assert.equal(photoPreview.payload.photos.length, universalPhotos.length);
assert.deepEqual(
  photoPreview.payload.photos.map((photo) => photo.name),
  universalPhotos.map((photo) => photo.name),
  "photo order was not preserved"
);
for (const [index, expectedPhoto] of universalPhotos.entries()) {
  const actualPhoto = photoPreview.payload.photos[index];
  assert.equal(actualPhoto.name, expectedPhoto.name);
  assert.equal(actualPhoto.type, expectedPhoto.type);
  assert.equal(actualPhoto.size, expectedPhoto.size);
  assert.equal(actualPhoto.dataUrl, expectedPhoto.dataUrl);
  assert.equal(actualPhoto.storagePath ?? "", expectedPhoto.storagePath ?? "");
  assert.equal(actualPhoto.imageUrl ?? "", expectedPhoto.imageUrl ?? "");
  assert.equal(actualPhoto.signedUrl ?? "", expectedPhoto.signedUrl ?? "");
}
assert(Array.isArray(photoPreview.payload.imagePayload?.photos));
assert.equal(photoPreview.payload.imagePayload.count, universalPhotos.length);
assert.equal(photoPreview.payload.imagePayload.photos.length, universalPhotos.length);
assert.equal(photoPreview.payload.fillReadiness.ebay.photosReady, true);
assert.doesNotThrow(() => JSON.stringify(photoPreview.payload));

const invalidPhotoPreview = buildLpuPayloadPreview({
  finalOutput: fullOutput,
  hasSellingBrief: true,
  generatedAt: "2026-06-11T00:00:00.000Z",
  photos: [
    ...universalPhotos,
    {
      name: "metadata-only.jpg",
      type: "image/jpeg",
      size: 34567,
    },
  ],
});
assert.equal(invalidPhotoPreview.payload.photos.length, universalPhotos.length);
assert.equal(
  invalidPhotoPreview.payload.photos.some((photo) => photo.name === "metadata-only.jpg"),
  false,
  "invalid photo entry without data or references was not omitted"
);
assert(
  invalidPhotoPreview.warnings.some((warning) => warning.code === "invalid_photo_payload"),
  "invalid photo payload warning was not produced"
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

const lpuV2PageSource = fs.readFileSync(
  path.join(rootDir, "app/lpu-v2/page.tsx"),
  "utf8"
);
assert(
  lpuV2PageSource.includes(
    'import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";'
  ),
  "V2 page does not import sendVendooPayloadToExtension"
);
assert(
  lpuV2PageSource.includes(
    'import type { VendooPhotoPayload } from "@/lib/vendoo/extensionPayload";'
  ),
  "V2 page does not use the existing VendooPhotoPayload type"
);
assert(
  /function\s+fileToDataUrl\s*\(\s*file:\s*File\s*\)/.test(lpuV2PageSource),
  "V2 page does not prepare selected File objects as data URLs"
);
assert(
  /photos:\s*vendooPhotos/.test(lpuV2PageSource),
  "V2 payload preview does not pass prepared Vendoo photos into buildLpuPayloadPreview"
);
assert(
  /finalListPriceInput\s*,/.test(lpuV2PageSource),
  "V2 payload preview does not pass finalListPriceInput into buildLpuPayloadPreview"
);
assert(
  /\[\s*[\s\S]*finalListPriceInput[\s\S]*\]\s*\)\s*;/.test(lpuV2PageSource),
  "V2 payload preview memo does not update when finalListPriceInput changes"
);
assert(
  /sendVendooPayloadToExtension\(\s*payloadPreview\.payload\s*\)/.test(
    lpuV2PageSource
  ),
  "V2 page does not send payloadPreview.payload through sendVendooPayloadToExtension"
);
assert.equal(
  /chrome\.runtime/.test(lpuV2PageSource),
  false,
  "V2 page must not call chrome.runtime directly"
);

const changedFiles = execFileSync("git", ["diff", "--name-only"], {
  cwd: rootDir,
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);
assert.equal(
  changedFiles.some((filePath) =>
    filePath.startsWith("listing-writer-app/extension/vendoo-fill/")
  ),
  false,
  "V2 payload preview work must not modify extension files"
);

console.log("V2 payload preview compatibility checks passed.");
