import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const webCompsPath = path.join(rootDir, "lib/lpu/webComps.ts");
const lpuV2PagePath = path.join(rootDir, "app/lpu-v2/page.tsx");

function loadWebComps() {
  const source = fs.readFileSync(webCompsPath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: webCompsPath,
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    console,
    Intl,
    URL,
  };
  sandbox.exports = sandbox.module.exports;

  vm.runInNewContext(transpiled, sandbox, {
    filename: "webComps.vm.cjs",
  });

  return sandbox.module.exports;
}

const {
  WEB_COMPS_MAX_CANDIDATE_SOURCES,
  formatWebCompsSourceCountLabel,
  parseWebCompsModelJson,
  recalculateWebCompsSummary,
} = loadWebComps();

function source(overrides = {}) {
  return {
    url: "https://www.ebay.com/itm/example",
    title: "Sold public comp",
    visiblePrice: 40,
    status: "sold",
    usedInPricing: true,
    similarity: "strong",
    matchType: "full_item",
    matchReasons: ["same item type"],
    mismatchReasons: [],
    ...overrides,
  };
}

function model(overrides = {}) {
  return JSON.stringify({
    suggestedPrice: 44.99,
    suggestedPriceLabel: "$44.99",
    confidence: "High",
    usableSoldResultsUsed: 3,
    targetSoldResultsRequested: 10,
    basis: "Public sold comps.",
    bestOfferCaveatUsed: false,
    sourceUrls: [
      source({ url: "https://www.ebay.com/itm/1", visiblePrice: 35 }),
      source({ url: "https://www.ebay.com/itm/2", visiblePrice: 45 }),
      source({ url: "https://www.ebay.com/itm/3", visiblePrice: 55 }),
    ],
    ...overrides,
  });
}

function selectedIds(result) {
  return result.sourceUrls
    .filter((item) => item.usedInPricing)
    .map((item) => item.id);
}

function applySelection(result, ids) {
  const selected = new Set(ids);
  const sourceUrls = result.sourceUrls.map((item) => ({
    ...item,
    usedInPricing: item.selectableForUserPricing && selected.has(item.id),
  }));
  const summary = recalculateWebCompsSummary(
    { ...result, sourceUrls },
    sourceUrls.filter((item) => item.usedInPricing).map((item) => item.id)
  );

  return {
    ...result,
    ...summary,
    usableSoldResultsUsed: summary.usableSoldResultsUsed,
    sourceUrls,
  };
}

const repairedLabelOnly = parseWebCompsModelJson(
  model({
    suggestedPrice: null,
    suggestedPriceLabel: "Suggested eBay listing price",
  })
);
assert.equal(typeof repairedLabelOnly.suggestedPrice, "number");
assert.match(repairedLabelOnly.suggestedPriceLabel, /^\$\d/);

const moreThanTenCandidates = parseWebCompsModelJson(
  model({
    confidence: "High",
    sourceUrls: Array.from({ length: 15 }, (_, index) =>
      source({
        url: `https://www.ebay.com/itm/strong-${index}`,
        title: `Strong sold comp ${index}`,
        visiblePrice: 25 + index,
      })
    ),
  })
);
assert.equal(moreThanTenCandidates.sourceUrls.length, 15);
assert.equal(moreThanTenCandidates.candidateSourcesReturned, 15);
assert.equal(moreThanTenCandidates.eligibleSoldResultsFound, 15);
assert.equal(moreThanTenCandidates.selectedSoldResultsUsed, 15);
assert.equal(moreThanTenCandidates.usableSoldResultsUsed, 15);

const cappedCandidates = parseWebCompsModelJson(
  model({
    sourceUrls: Array.from(
      { length: WEB_COMPS_MAX_CANDIDATE_SOURCES + 5 },
      (_, index) =>
        source({
          url: `https://www.ebay.com/itm/capped-${index}`,
          title: `Capped sold comp ${index}`,
          visiblePrice: 30 + index,
        })
    ),
  })
);
assert.equal(cappedCandidates.sourceUrls.length, WEB_COMPS_MAX_CANDIDATE_SOURCES);

const defaultSelection = parseWebCompsModelJson(
  model({
    suggestedPrice: null,
    sourceUrls: [
      ...Array.from({ length: 10 }, (_, index) =>
        source({
          url: `https://www.ebay.com/itm/default-strong-${index}`,
          title: `Default strong comp ${index}`,
          visiblePrice: 40 + index * 5,
          similarity: "strong",
          matchType: "full_item",
        })
      ),
      source({
        url: "https://www.ebay.com/itm/eligible-weak",
        title: "Eligible weak style comp",
        visiblePrice: 25,
        similarity: "weak",
        matchType: "style_only",
        usedInPricing: false,
      }),
    ],
  })
);
const autoSelected = defaultSelection.sourceUrls.filter(
  (item) => item.defaultIncludedInPricing
);
const eligibleWeak = defaultSelection.sourceUrls.find(
  (item) => item.url === "https://www.ebay.com/itm/eligible-weak"
);
assert.equal(autoSelected.length, 10);
assert.equal(defaultSelection.selectedSoldResultsUsed, 10);
assert(autoSelected.every((item) => item.usedInPricing));
assert(autoSelected.every((item) => item.selectableForUserPricing));
assert(autoSelected.every((item) => !item.hardDisabled));
assert.equal(eligibleWeak.eligibleForPricing, true);
assert.equal(eligibleWeak.defaultIncludedInPricing, false);
assert.equal(eligibleWeak.selectableForUserPricing, true);
assert.equal(eligibleWeak.hardDisabled, false);
assert.equal(eligibleWeak.usedInPricing, false);

const selectableAndDisabledSources = parseWebCompsModelJson(
  model({
    sourceUrls: [
      source({
        url: "https://www.ebay.com/itm/active",
        status: "active_or_unclear",
        visiblePrice: 40,
      }),
      source({
        url: "https://www.ebay.com/itm/no-price",
        visiblePrice: null,
      }),
      source({
        url: "https://www.ebay.com/itm/not-comparable",
        visiblePrice: 50,
        similarity: "not_comparable",
        matchType: "unclear",
      }),
      source({
        url: "https://www.ebay.com/itm/excluded-visible",
        status: "excluded",
        visiblePrice: 55,
      }),
      source({
        url: "https://example.com/not-ebay",
        visiblePrice: 60,
      }),
    ],
  })
);
for (const item of selectableAndDisabledSources.sourceUrls) {
  assert.equal(item.eligibleForPricing, false);
  assert.equal(item.defaultIncludedInPricing, false);
  assert.equal(item.usedInPricing, false);
  assert(item.ineligibilityReason);
}
assert.equal(selectableAndDisabledSources.sourceUrls[0].ineligibilityReason, "active/unclear");
assert.equal(selectableAndDisabledSources.sourceUrls[0].selectableForUserPricing, true);
assert.equal(selectableAndDisabledSources.sourceUrls[0].hardDisabled, false);
assert.equal(selectableAndDisabledSources.sourceUrls[0].userOverrideRisk, "high");
assert.equal(selectableAndDisabledSources.sourceUrls[1].ineligibilityReason, "no visible sold price");
assert.equal(selectableAndDisabledSources.sourceUrls[1].selectableForUserPricing, false);
assert.equal(selectableAndDisabledSources.sourceUrls[1].hardDisabled, true);
assert.equal(selectableAndDisabledSources.sourceUrls[2].ineligibilityReason, "not comparable");
assert.equal(selectableAndDisabledSources.sourceUrls[2].selectableForUserPricing, true);
assert.equal(selectableAndDisabledSources.sourceUrls[2].hardDisabled, false);
assert.equal(selectableAndDisabledSources.sourceUrls[2].userOverrideRisk, "high");
assert.equal(selectableAndDisabledSources.sourceUrls[3].ineligibilityReason, "excluded");
assert.equal(selectableAndDisabledSources.sourceUrls[3].selectableForUserPricing, true);
assert.equal(selectableAndDisabledSources.sourceUrls[4].ineligibilityReason, "non-eBay source");
assert.equal(selectableAndDisabledSources.sourceUrls[4].selectableForUserPricing, false);
assert.equal(selectableAndDisabledSources.sourceUrls[4].hardDisabled, true);

const duplicateSources = parseWebCompsModelJson(
  model({
    sourceUrls: [
      source({ url: "https://www.ebay.com/itm/duplicate", visiblePrice: 40 }),
      source({ url: "https://www.ebay.com/itm/duplicate", visiblePrice: 50 }),
    ],
  })
);
assert.equal(duplicateSources.sourceUrls[0].hardDisabled, false);
assert.equal(duplicateSources.sourceUrls[1].hardDisabled, true);
assert.equal(duplicateSources.sourceUrls[1].selectableForUserPricing, false);
assert.equal(duplicateSources.sourceUrls[1].ineligibilityReason, "duplicate source");

const initialPriceUsesDefaults = parseWebCompsModelJson(
  model({
    suggestedPrice: null,
    sourceUrls: [
      source({ url: "https://www.ebay.com/itm/low", visiblePrice: 20 }),
      source({ url: "https://www.ebay.com/itm/mid", visiblePrice: 40 }),
      source({ url: "https://www.ebay.com/itm/high", visiblePrice: 60 }),
    ],
  })
);
assert.equal(initialPriceUsesDefaults.selectedSoldResultsUsed, 3);
assert.equal(initialPriceUsesDefaults.suggestedPrice, 39.99);

const toggledOff = applySelection(
  initialPriceUsesDefaults,
  selectedIds(initialPriceUsesDefaults).slice(0, 2)
);
assert.equal(toggledOff.selectedSoldResultsUsed, 2);
assert.notEqual(toggledOff.suggestedPrice, initialPriceUsesDefaults.suggestedPrice);

const toggledOn = applySelection(defaultSelection, [
  ...selectedIds(defaultSelection),
  eligibleWeak.id,
]);
assert.equal(toggledOn.selectedSoldResultsUsed, 11);
assert.notEqual(toggledOn.suggestedPrice, defaultSelection.suggestedPrice);

const zeroSelected = applySelection(initialPriceUsesDefaults, []);
assert.equal(zeroSelected.suggestedPrice, null);
assert.equal(zeroSelected.suggestedPriceLabel, "Not enough selected comp evidence");
assert.equal(zeroSelected.confidence, "Very Low");
assert.equal(zeroSelected.selectedSoldResultsUsed, 0);

const hardDisabledSelection = applySelection(selectableAndDisabledSources, [
  selectableAndDisabledSources.sourceUrls[1].id,
  selectableAndDisabledSources.sourceUrls[4].id,
]);
assert.equal(hardDisabledSelection.suggestedPrice, null);
assert.equal(hardDisabledSelection.selectedSoldResultsUsed, 0);

const activeOverrideOnly = applySelection(selectableAndDisabledSources, [
  selectableAndDisabledSources.sourceUrls[0].id,
]);
assert.equal(activeOverrideOnly.selectedSoldResultsUsed, 1);
assert.equal(activeOverrideOnly.usableSoldResultsUsed, 0);
assert.equal(activeOverrideOnly.suggestedPrice, 39.99);
assert.equal(activeOverrideOnly.confidence, "Very Low");

const notComparableOverrideOnly = applySelection(selectableAndDisabledSources, [
  selectableAndDisabledSources.sourceUrls[2].id,
]);
assert.equal(notComparableOverrideOnly.selectedSoldResultsUsed, 1);
assert.equal(notComparableOverrideOnly.usableSoldResultsUsed, 0);
assert.equal(notComparableOverrideOnly.confidence, "Very Low");

const strongDominatesNotComparable = parseWebCompsModelJson(
  model({
    sourceUrls: [
      ...Array.from({ length: 4 }, (_, index) =>
        source({
          url: `https://www.ebay.com/itm/dominant-strong-${index}`,
          visiblePrice: 40 + index * 5,
          similarity: "strong",
          matchType: "full_item",
        })
      ),
      source({
        url: "https://www.ebay.com/itm/not-comparable-dominated",
        visiblePrice: 70,
        similarity: "not_comparable",
        matchType: "unclear",
      }),
    ],
  })
);
const dominatedOverride = applySelection(strongDominatesNotComparable, [
  ...selectedIds(strongDominatesNotComparable),
  strongDominatesNotComparable.sourceUrls[4].id,
]);
assert.equal(dominatedOverride.selectedSoldResultsUsed, 5);
assert.equal(dominatedOverride.confidence, "Low");

const weakComponentOnly = parseWebCompsModelJson(
  model({
    confidence: "High",
    sourceUrls: Array.from({ length: 6 }, (_, index) =>
      source({
        url: `https://www.ebay.com/itm/component-${index}`,
        title: `Component-only comp ${index}`,
        visiblePrice: 20 + index,
        similarity: "weak",
        matchType: "component_only",
      })
    ),
  }),
  { itemType: "multi-piece resale item", isComposite: true, componentTerms: [] }
);
assert.equal(weakComponentOnly.selectedSoldResultsUsed, 6);
assert.notEqual(weakComponentOnly.confidence, "High");
assert(weakComponentOnly.sourceUrls.every((item) => item.selectableForUserPricing));
assert(weakComponentOnly.sourceUrls.every((item) => item.userOverrideRisk === "medium"));

const bestOfferUncertain = parseWebCompsModelJson(
  model({
    confidence: "High",
    sourceUrls: [
      source({
        url: "https://www.ebay.com/itm/offer",
        status: "best_offer_uncertain",
        visiblePrice: 70,
      }),
    ],
  })
);
assert.equal(bestOfferUncertain.bestOfferCaveatUsed, true);
assert.notEqual(bestOfferUncertain.confidence, "High");
assert.equal(bestOfferUncertain.sourceUrls[0].selectableForUserPricing, true);
assert.equal(bestOfferUncertain.sourceUrls[0].userOverrideRisk, "low");

const bestOfferOverride = applySelection(bestOfferUncertain, [
  bestOfferUncertain.sourceUrls[0].id,
]);
assert.equal(bestOfferOverride.confidence, "Low");

const firstSearch = parseWebCompsModelJson(
  model({
    sourceUrls: [
      source({ url: "https://www.ebay.com/itm/first-a", visiblePrice: 30 }),
      source({ url: "https://www.ebay.com/itm/first-b", visiblePrice: 40 }),
    ],
  })
);
const manuallyChangedFirstSearch = applySelection(firstSearch, [
  firstSearch.sourceUrls[0].id,
]);
const secondSearch = parseWebCompsModelJson(
  model({
    sourceUrls: [
      source({ url: "https://www.ebay.com/itm/second-a", visiblePrice: 50 }),
      source({ url: "https://www.ebay.com/itm/second-b", visiblePrice: 60 }),
      source({ url: "https://www.ebay.com/itm/second-c", visiblePrice: 70 }),
    ],
  })
);
assert.equal(manuallyChangedFirstSearch.selectedSoldResultsUsed, 1);
assert.equal(secondSearch.selectedSoldResultsUsed, 3);
assert.deepEqual(
  selectedIds(secondSearch),
  secondSearch.sourceUrls
    .filter((item) => item.defaultIncludedInPricing)
    .map((item) => item.id)
);

const pageSource = fs.readFileSync(lpuV2PagePath, "utf8");
assert(
  pageSource.includes('fetch("/api/lpu/web-comps"'),
  "V2 page should keep web-comps search behind the explicit fetch action."
);
assert.equal(
  (pageSource.match(/fetch\("\/api\/lpu\/web-comps"/g) || []).length,
  1,
  "Toggling sources should not add another web-comps fetch path."
);
assert(
  pageSource.includes("toggleWebCompSource"),
  "V2 page should expose a local source toggle handler."
);
assert(
  pageSource.includes("disabled={!source.selectableForUserPricing}"),
  "Only non-selectable sources should be disabled in the UI."
);
assert(
  pageSource.includes("source.id === sourceId && source.selectableForUserPricing"),
  "The local toggle handler should allow every user-selectable source."
);
assert(
  pageSource.includes('label="Sources Used"'),
  "Selected source counts should not be labeled as verified sold results."
);
assert(
  /<details\s+className=/.test(pageSource) && !/<details[^>]*\sopen[=>\s]/.test(pageSource),
  "Sources details should be collapsed by default."
);
assert.equal(
  formatWebCompsSourceCountLabel(4, 10),
  "4 selected / target 10+ usable comps"
);

console.log("V2 web comps checks passed.");
