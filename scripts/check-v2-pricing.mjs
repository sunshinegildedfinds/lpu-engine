import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const pricingPath = path.join(rootDir, "lib/lpu/pricingResearch.ts");

function loadPricingResearch() {
  const source = fs.readFileSync(pricingPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: pricingPath,
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    URLSearchParams,
  };
  sandbox.exports = sandbox.module.exports;

  vm.runInNewContext(transpiled, sandbox, {
    filename: "pricingResearch.vm.cjs",
  });

  return sandbox.module.exports;
}

const {
  buildPricingResearchFromBrief,
  calculatePricingRecommendation,
} = loadPricingResearch();

function buildInput(overrides = {}) {
  return {
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: brooch
- Material Appearance: silver tone rhinestone

Buyer Search Keywords:
- vintage rhinestone brooch
- silver tone floral pin

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: floral cluster

Evidence Anchors:
- must remain ad context temptinganchor

Claim Limits:
- claim limit temptingclaim

Condition Basis:
- condition basis temptingcondition

Measurement Basis:
- measurement basis temptingmeasurement

Platform Angle Map:
- strategy temptingplatform

Quality Risks:
- confidence temptingrisk`,
    finalOutput: "",
    notes: "",
    knownDetails: "Seller-confirmed vintage.",
    conditionFlaws: "",
    measurements: "",
    markingsLabels: "",
    ...overrides,
  };
}

function allQueryText(generated) {
  return [
    generated.researchKeywords,
    generated.terapeakResearchQuery,
    generated.narrowerResearchQuery,
    generated.broaderResearchQuery,
    generated.ebaySoldCompsUrl,
  ].join(" ");
}

function assertHasAllWords(value, words, message) {
  const normalized = value.toLowerCase();
  for (const word of words) {
    assert(
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalized),
      `${message}: missing ${word} in "${value}"`
    );
  }
}

function assertQueryClean(generated) {
  const queries = [
    generated.researchKeywords,
    generated.terapeakResearchQuery,
    generated.narrowerResearchQuery,
    generated.broaderResearchQuery,
  ];
  const queryText = allQueryText(generated).toLowerCase();

  for (const query of queries) {
    assert(!/^\s*(?:is|are|was|were|but|and|with|item)\b/i.test(query), `Query starts with filler token: ${query}`);
    assert(!/(?:^|\s)-|-\s*$/.test(query), `Query contains dangling hyphen fragment: ${query}`);
    assert(!/\bis\s+but\s+item\b/i.test(query), `Query contains parser artifact: ${query}`);
    assert(!/arrangement of/i.test(query), `Query contains incomplete phrase: ${query}`);
  }

  for (const forbidden of [
    "must remain",
    "ad context",
    "item identity",
    "evidence anchors",
    "claim limits",
    "condition basis",
    "measurement basis",
    "seller-confirmed",
    "photo-derived",
    "source",
    "evidence",
    "derived",
    "visual",
    "safe wording",
    "use in",
    "confidence",
    "provided",
    "appears",
    "shown",
    "supported evidence",
    "claim limit",
    "final copy moves",
    "strategy",
    "but item",
    "is but item",
  ]) {
    assert(!queryText.includes(forbidden), `Query includes forbidden artifact: ${forbidden}`);
  }
}

const structuredBrand = buildPricingResearchFromBrief(
  buildInput({
    knownDetails: "Seller-confirmed vintage.\nBrand: Synthetic Brand",
    markingsLabels: "Unsigned but confirmed it was made by Synthetic Brand",
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: brooch
- Material Appearance: silver tone rhinestone

Buyer Search Keywords:
- vintage rhinestone brooch
- silver tone brooch

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: floral cluster`,
  })
);
assertQueryClean(structuredBrand);
assertHasAllWords(
  structuredBrand.researchKeywords,
  ["synthetic", "brand", "unsigned", "vintage", "brooch"],
  "Structured Known Details and Markings / Labels brand should be protected"
);

const notesAttribution = buildPricingResearchFromBrief(
  buildInput({
    notes: "Confirmed set by Fictional Atelier, unsigned",
    knownDetails: "Seller-confirmed vintage.\nItem Type: demi parure jewelry set\nMaterial Appearance: faux pearl rhinestone gold tone",
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: jewelry set
- Material Appearance: faux pearl rhinestone gold tone

Buyer Search Keywords:
- vintage demi parure jewelry set

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: tassel drop`,
  })
);
assertQueryClean(notesAttribution);
assertHasAllWords(
  notesAttribution.researchKeywords,
  ["fictional", "atelier", "unsigned", "demi", "parure"],
  "Structured Notes attribution should be protected"
);

const strictWhitelist = buildPricingResearchFromBrief(buildInput());
assertQueryClean(strictWhitelist);
assert(!/temptinganchor|temptingclaim|temptingcondition|temptingmeasurement|temptingplatform|temptingrisk/i.test(allQueryText(strictWhitelist)), "Non-whitelisted brief sections should not enter queries.");

const noWholeBriefFallback = buildPricingResearchFromBrief(
  buildInput({
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: bowl
- Material Appearance: ceramic

Evidence Anchors:
- tempting whole brief fallback phrase

Claim Limits:
- tempting claim fallback phrase

Condition Basis:
- tempting condition fallback phrase`,
    knownDetails: "Item Type: bowl\nMaterial Appearance: ceramic",
  })
);
assertQueryClean(noWholeBriefFallback);
assertHasAllWords(noWholeBriefFallback.researchKeywords, ["bowl", "ceramic"], "Allowed Item Identity terms should remain available");
assert(!/tempting|fallback|claim/i.test(allQueryText(noWholeBriefFallback)), "Whole-brief fallback terms should not enter queries.");

const finalCategory = buildPricingResearchFromBrief(
  buildInput({
    finalOutput: `EBAY
Category: Collectibles > Decorative Collectibles > Figurines
Description: forbiddenfinalkeyword should never become pricing query text.

POSHMARK
Search Keywords: anotherforbiddenfinalkeyword`,
  })
);
assertQueryClean(finalCategory);
assert.equal(finalCategory.suggestedEbayCategoryConfidence, "Final LP-U derived");
assert.equal(finalCategory.suggestedEbayCategoryPath, "Collectibles > Decorative Collectibles > Figurines");
assert(!/forbiddenfinalkeyword|anotherforbiddenfinalkeyword/i.test(allQueryText(finalCategory)), "Final LP-U body text should not feed pricing queries.");

const compositeItem = buildPricingResearchFromBrief(
  buildInput({
    knownDetails: "Seller-confirmed vintage.\nItem Type: demi parure jewelry set\nMaterial Appearance: faux pearl rhinestone gold tone",
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: demi parure jewelry set
- Material Appearance: faux pearl rhinestone gold tone

Buyer Search Keywords:
- vintage demi parure jewelry set
- necklace earrings set

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: tassel drop`,
  })
);
assertQueryClean(compositeItem);
assertHasAllWords(compositeItem.researchKeywords, ["demi", "parure"], "Composite phrase should be preserved where useful");
assert.match(compositeItem.suggestedEbayCategoryName, /Jewelry Sets/i);

const nonSetConstruction = buildPricingResearchFromBrief(
  buildInput({
    knownDetails: "Seller-confirmed vintage.\nItem Type: brooch\nMaterial Appearance: prong set rhinestone silver tone",
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: brooch
- Material Appearance: prong set rhinestone silver tone

Buyer Search Keywords:
- vintage rhinestone brooch
- prong set stones silver tone brooch

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: floral cluster`,
  })
);
assertQueryClean(nonSetConstruction);
assertHasAllWords(nonSetConstruction.researchKeywords, ["brooch", "rhinestone"], "Construction phrase should preserve true identifiers");
assert(!/\bset\b/i.test(nonSetConstruction.researchKeywords), "Prong set / stones set should not create a set composite query.");
assert(!/Jewelry Sets|Outfits & Sets|Tool Sets|Book Sets|Dinnerware Sets|Game Sets/i.test(nonSetConstruction.suggestedEbayCategoryName), "Construction wording should not infer a set category.");

const blocklistFixture = buildPricingResearchFromBrief(
  buildInput({
    sellingBrief: `Universal Selling Brief

Item Identity:
- Item Type: lamp
- Material Appearance: ceramic

Buyer Search Keywords:
- ceramic table lamp

Evidence Anchors:
- must remain ad context stamped unsigned source evidence visual provided shown

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: ribbed column`,
    knownDetails: "Item Type: lamp\nMaterial Appearance: ceramic",
  })
);
assertQueryClean(blocklistFixture);
assert(!/must remain|ad context/i.test(allQueryText(blocklistFixture)), "Artifact blocklist should remove internal phrases.");

const pricingBase = {
  aiStartingRangeLow: 20,
  aiStartingRangeHigh: 40,
};

const averageOnly = calculatePricingRecommendation({ averageSoldPrice: 30 }, pricingBase);
assert.equal(averageOnly.usedAiFallback, false);
assert.match(averageOnly.basePriceSource, /average/i);

const medianOnly = calculatePricingRecommendation({ medianSoldPrice: 34 }, pricingBase);
assert.equal(medianOnly.usedAiFallback, false);
assert.match(medianOnly.basePriceSource, /median/i);

const lowHighOnly = calculatePricingRecommendation(
  { lowRelevantSold: 20, highRelevantSold: 50 },
  pricingBase
);
assert.equal(lowHighOnly.usedAiFallback, false);
assert.match(lowHighOnly.basePriceSource, /low\/high/i);

const aiFallback = calculatePricingRecommendation({}, pricingBase);
assert.equal(aiFallback.usedAiFallback, true);
assert.match(aiFallback.pricingExplanation, /AI-range fallback/i);
assert.match(aiFallback.pricingExplanation, /No sell-through adjustment/i);

const withSellThrough = calculatePricingRecommendation(
  { medianSoldPrice: 40, sellThroughPercent: 85 },
  pricingBase
);
assert.equal(withSellThrough.usedAiFallback, false);
assert.match(withSellThrough.pricingExplanation, /Manual sell-through adjustment applied/i);

const withoutSellThrough = calculatePricingRecommendation(
  { medianSoldPrice: 40 },
  pricingBase
);
assert.equal(withoutSellThrough.usedAiFallback, false);
assert.match(withoutSellThrough.pricingExplanation, /No sell-through adjustment/i);

console.log("V2 pricing checks passed.");
