import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const routePath = path.join(rootDir, "app/api/lpu/generate/route.ts");

function loadRouteSanitizers() {
  const source = fs.readFileSync(routePath, "utf8");
  const requiredBoundaries = [
    "function sanitizeSellingBriefAfterRepair",
    "function repairFinalFromBriefExactCandidateSuffixes",
    "function cleanupDuplicateMeasurementsFromFinalFromBriefBodies",
    "function cleanupEmptyOptionalBodyLabels",
    "function preserveFinalFromBriefPlatformSectionOrder",
    "export async function POST",
  ];

  for (const boundary of requiredBoundaries) {
    assert(
      source.includes(boundary),
      `Unable to locate route sanitizer boundary: ${boundary}`
    );
  }

  const firstTypeIndex = source.indexOf("type IncomingImage");
  const postIndex = source.indexOf("export async function POST");

  assert(firstTypeIndex > -1, "Unable to locate route helper start boundary.");
  assert(postIndex > firstTypeIndex, "Unable to locate route POST boundary.");

  const helperSource = `${source.slice(firstTypeIndex, postIndex)}
globalThis.__v2Sanitizers = {
  sanitizeSellingBriefAfterRepair,
  repairFinalFromBriefExactCandidateSuffixes,
  cleanupDuplicateMeasurementsFromFinalFromBriefBodies,
  cleanupEmptyOptionalBodyLabels,
  preserveFinalFromBriefPlatformSectionOrder,
};`;

  const transpiled = ts.transpileModule(helperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: routePath,
  }).outputText;

  const sandbox = {
    console,
    process: { env: {} },
    globalThis: {},
  };

  vm.runInNewContext(transpiled, sandbox, {
    filename: "route-v2-sanitizers.vm.cjs",
  });

  assert(
    sandbox.globalThis.__v2Sanitizers,
    "Route sanitizer VM did not expose sanitizer functions."
  );

  return sandbox.globalThis.__v2Sanitizers;
}

const {
  sanitizeSellingBriefAfterRepair,
  repairFinalFromBriefExactCandidateSuffixes,
} = loadRouteSanitizers();

const sellerInput = "Seller notes include no testing caveat authorization.";

const sellingBriefFixture = `Universal Selling Brief

Item Identity:
- Item Type: [item type]
- Brand / Maker: Unbranded

Evidence Anchors:
- [item type] shown in provided images with [material appearance].
- [component] appears present in provided images.

Claim Limits:
- No confirmed era; do not assign decade or named historical period.
- Claim Limit: none directly confirming era beyond seller Vintage.
- Blocked Overclaims: insufficient evidence to support specific era classification.

Condition Basis:
- [condition detail].
- functional status not tested.
- not formally tested.

Measurement Basis:
- Approx. 4.5 in wide x 6 in tall from measurement photo.
- Based on the measurement photo.

Buyer Search Keywords: bold statement [item type], statement [item type], beautiful [item type], eye-catching [item type], unique [item type], timeless [item type], classic [item type], stylish [item type], versatile [item type], must-have [item type], rare find, high quality [item type], perfect [item/use], great [item/use], [candidate], [candidate two]

STYLE / THEME / AESTHETIC CANDIDATE BANK
Candidate 1:
- Candidate Term: [candidate]
- Evidence Source: Photo-derived
- Visual Evidence: Supported by visible [material appearance].
- Confidence Level: Confirmed
- Safe Wording: [candidate]
- Use In: eBay Title B, Poshmark Title, Etsy Title, Depop Listing opening
- Claim Limit: insufficient evidence to assign era-specific style or exact decade.

Candidate 2:
- Candidate Term: Rejected unsupported marketing wording
- Evidence Source: Model-generated
- Visual Evidence: Explanation row only.
- Confidence Level: Weak/Do not use
- Safe Wording: N/A
- Use In: Do Not Use
- Rejection Reason: no specific decade and no exact production decade.

Candidate 3:
- Candidate Term: Generic subjective wording
- Evidence Source: Model-generated
- Visual Evidence: Generic praise only.
- Confidence Level: Confirmed
- Safe Wording: Generic subjective wording
- Use In: eBay Title B
- Claim Limit: do not assign named historical period.

Candidate 4:

Candidate 5:
- Candidate Term: Unsupported marketing phrase
- Evidence Source: Model-generated
- Visual Evidence: unsupported marketing phrase only.
- Confidence Level: Weak/Do not use
- Safe Wording: N/A
- Use In: Do Not Use
- Rejection Reason: insufficient evidence to assign specific era.

Candidate 6:
- Candidate Term: floral Cluster
- Evidence Source: Photo-derived
- Visual Evidence: Supported by visible clustered form.
- Confidence Level: Confirmed
- Safe Wording: floral Cluster
- Use In: eBay Description, Etsy Description
- Claim Limit: Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.

Candidate 7:
- Candidate Term: dimensional Cluster
- Evidence Source: Photo-derived
- Visual Evidence: Supported by visible dimensional clustered form.
- Confidence Level: Confirmed
- Safe Wording: dimensional Cluster
- Use In: Etsy Description
- Claim Limit: Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.

Candidate 8:
- Candidate Term: Rhinestone Cluster
- Evidence Source: Photo-derived
- Visual Evidence: Supported by visible rhinestone clustered form.
- Confidence Level: Confirmed
- Safe Wording: Rhinestone Cluster
- Use In: Mercari Description, Etsy Description
- Claim Limit: Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.

Candidate 9:
- Candidate Term: Mid Century cluster brooch
- Evidence Source: Photo-derived
- Visual Evidence: Supported by visible clustered brooch form.
- Confidence Level: Confirmed
- Safe Wording: Mid Century cluster brooch
- Use In: Etsy Description
- Claim Limit: Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.

Candidate 10:
- Candidate Term: unsupported sparkle aura
- Evidence Source: Rejected
- Visual Evidence: unsupported mood phrase only.
- Confidence Level: Weak/Do not use
- Safe Wording: N/A
- Use In: Do Not Use
- Rejection Reason: no visible item details support this descriptor.

Primary Style / Theme / Aesthetic Candidate:
- Candidate Term: [candidate]
- Reason Selected: strongest supported buyer-search descriptor.
- Evidence Anchors: [material appearance].
- Seller Preference: none.
- Use In: eBay Title B, Poshmark Title, Etsy Title, Depop Listing opening
- Claim Limit: beyond seller-confirmed vintage; exact era unavailable.

Platform Angle Map:
- eBay Angle
- Candidate Bank Terms to Use: [candidate], unsupported sparkle aura
- Title / Opening Strategy: use [candidate] only as a safe descriptor; do not use unsupported sparkle aura.
- Description Strategy: describe visible construction, not unsupported sparkle aura.
- Poshmark: preserve Search keywords and style-tag requirements.
- Etsy: use [candidate two] only when supported.

Quality Risks Before Final Listing:
- insufficient evidence to assign era-specific style.
- pin mechanism not tested.
- clasp not tested.
- working status unknown.
- function unknown.`;

const finalOutputFixture = `EBAY
Title A: [item type] [material appearance] [condition detail] [component]
Title B: [candidate] [item type] [dimension label]
Category: [platform] > [item type]
Item Specifics:
- Brand: Unbranded
- Type: [item type]
- Theme: [candidate]
Description:[item type] is unbranded. [component] shown with [material appearance]. [item type] by Unbranded with floral Cluster arrangement.
- Works well for display.
- [component] shown in provided images.
- Approx. 4.5 in wide.
- Based on the measurement photo.
Approximate Measurements:
- Approx. 4.5 in wide x 6 in tall
Please review photos for condition and measurements.

DEPOP
Aesthetic Mode:
Primary: [candidate]
Secondary: [candidate two]
Attributes:
- Type: [item type]
- Condition: [condition detail]
Listing:[item type] from Unbranded. Clasp closure with [component]. Approx 4 1/2 inches across. From measurement photo. Features floral Cluster with [component]. [item type] with detailing [item type].
Hashtags: #[itemtype] #[candidate] #[candidatetwo]
Optional Brand Hashtags: #unbranded
Approximate Measurements:
- Approx. 4.5 in wide x 6 in tall
Please review photos for condition and measurements.

POSHMARK
Title: [candidate] [item type] [material appearance]
Description:[item type] with Unbranded and [material appearance]. with detailing detail. with visual detail.
Condition:[condition phrase], and.
Size:
- Approx. 4.5 in wide x 6 in tall
Based on the measurement photo.
Search keywords: [candidate], [candidate two], [item type]
Style Tags: Boho, Classic, Minimalist
Compact 3-Tag Strategy (Alt Option): Boho, Classic, Minimalist
Approximate Measurements:
- Approx. 4.5 in wide x 6 in tall
Please review photos for condition and measurements.

MERCARI
Title: [candidate] [item type] [material appearance]
Description:[item type] with detailing in [material appearance]. with detailing. with style detail.
- with Rhinestone Cluster arrangement.
- Approx. size: about 4.5 in wide and 6 in tall.
- Based on the measurement photo.
Hashtags: #itemtype #candidate #candidatetwo
Approximate Measurements:
- Approx. 4.5 in wide x 6 in tall
Please review photos for condition and measurements.

ETSY
Title: [candidate] [item type] [material appearance] [component]
Category: [platform] > [item type]
Materials: [material appearance]
Attributes / Key Details:
- Item type: [item type]
- Component: [component]
Tags: [candidate], [candidate two], [item type], [material appearance], [component], [condition detail], [dimension label], generic tag one, generic tag two, generic tag three, generic tag four, generic tag five, generic tag six
Description:[item type] by Unbranded. With a dimensional Cluster look. and no maker mark is. No obvious missing component are, and the structure remains intact. [condition detail], and. floral Cluster construction with [component]. With Rhinestone Cluster arrangement and [material appearance]. Mid Century cluster brooch style details. [item type] from Unbranded. Photo tip: include close-up photos. Works well for display. Measures approximately 4.5 in by 6 in. Based on the measurement photo.
Details:[visible evidence].
Approximate Measurements:
- Approx. 4.5 in wide x 6 in tall
Please review photos for condition and measurements.`;

const cleanedBrief = sanitizeSellingBriefAfterRepair({
  sellingBrief: sellingBriefFixture,
  sellerInput,
});

const cleanedFinal = repairFinalFromBriefExactCandidateSuffixes({
  lpuOutput: finalOutputFixture,
  sellingBrief: cleanedBrief,
  sellerInput,
});

function assertNotContains(value, banned, label) {
  for (const phrase of banned) {
    assert(
      !value.toLowerCase().includes(phrase.toLowerCase()),
      `${label} still contains banned phrase: ${phrase}`
    );
  }
}

function section(output, platform) {
  const match = output.match(
    new RegExp(
      String.raw`(?:^|\n)${platform}[ \t]*\n([\s\S]*?)(?=\n(?:EBAY|DEPOP|POSHMARK|MERCARI|ETSY)[ \t]*\n|$)`,
      "i"
    )
  );
  assert(match, `Missing platform section: ${platform}`);
  return match[1];
}

function bodyBeforeMeasurements(platformSection, bodyLabel) {
  const match = platformSection.match(
    new RegExp(
      String.raw`${bodyLabel}:([\s\S]*?)(?=\nApproximate Measurements\s*:)`,
      "i"
    )
  );
  assert(match, `Missing ${bodyLabel} body before Approximate Measurements.`);
  return match[1];
}

function firstBodyLine(body) {
  return (
    body
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function assertBodyStartsWithIdentity(platform, bodyLabel, body) {
  const firstLine = firstBodyLine(body);

  assert(firstLine, `${platform} ${bodyLabel} body is empty.`);
  assert(
    !/^(?:[-*•]|\d+[.)])\s+/.test(firstLine),
    `${platform} ${bodyLabel} starts with bullets only.`
  );
  assert(
    !/^(?:with|and|plus|featuring|features|finished with|condition|closure|hardware|component|color|material|pattern|motif|clasp|zipper|button|strap|handle)\b/i.test(
      firstLine
    ),
    `${platform} ${bodyLabel} starts with a fragment: ${firstLine}`
  );
  assert(
    firstLine.includes("[item type]"),
    `${platform} ${bodyLabel} does not start with item identity: ${firstLine}`
  );
}

function assertOrdered(value, labels, label) {
  let previous = -1;
  for (const expected of labels) {
    const index = value.indexOf(expected);
    assert(index > -1, `${label} missing ordered token: ${expected}`);
    assert(index > previous, `${label} order regressed at token: ${expected}`);
    previous = index;
  }
}

function assertProtectedLinePreserved(output, line) {
  assert(output.includes(line), `Protected line was rewritten or removed: ${line}`);
}

function assertBodyLabelHasOwnLine(platformSection, bodyLabel, label) {
  const escapedLabel = bodyLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert(
    new RegExp(String.raw`(^|\n)${escapedLabel}:[ \t]*(?:\n|$)`, "i").test(
      platformSection
    ),
    `${label} ${bodyLabel} label is not on its own line.`
  );
  assert(
    !new RegExp(String.raw`(^|\n)${escapedLabel}:[ \t]*[^\n\s]`, "i").test(
      platformSection
    ),
    `${label} still has joined ${bodyLabel} body text.`
  );
}

assert(cleanedBrief.includes("Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported."));
const buyerSearchKeywordsMatch = cleanedBrief.match(/^Buyer Search Keywords:\s*(.+)$/im);
assert(buyerSearchKeywordsMatch, "Missing cleaned Buyer Search Keywords line.");
const buyerSearchKeywords = buyerSearchKeywordsMatch[1];
assert(
  buyerSearchKeywords.includes("[candidate]") &&
    buyerSearchKeywords.includes("[candidate two]"),
  "Cleaned Buyer Search Keywords did not preserve supported candidate terms."
);
assert(!cleanedBrief.includes("Candidate 4:"), "Orphan candidate heading survived.");
assert(cleanedBrief.includes("Candidate Term: [candidate]"));
assert(cleanedBrief.includes("Safe Wording: [candidate]"));
assert(cleanedBrief.includes("Candidate Term: floral Cluster"));
assert(cleanedBrief.includes("Safe Wording: floral Cluster"));
assert(cleanedBrief.includes("Candidate Term: dimensional Cluster"));
assert(cleanedBrief.includes("Safe Wording: dimensional Cluster"));
assert(cleanedBrief.includes("Candidate Term: Rhinestone Cluster"));
assert(cleanedBrief.includes("Safe Wording: Rhinestone Cluster"));
assert(cleanedBrief.includes("Candidate Term: Mid Century cluster brooch"));
assert(cleanedBrief.includes("Safe Wording: Mid Century cluster brooch"));
assert(cleanedBrief.includes("functional status not tested") === false);

assertNotContains(
  cleanedBrief,
  [
    "No confirmed era",
    "do not assign decade",
    "do not assign named historical period",
    "none directly confirming era beyond seller Vintage",
    "insufficient evidence to support specific era classification",
    "insufficient evidence to assign era-specific style",
    "insufficient evidence to assign specific era",
    "beyond seller-confirmed vintage",
    "exact decade",
    "exact era",
    "no specific decade",
    "no exact production decade",
    "functional status not tested",
    "functionality not tested",
    "pin mechanism not tested",
    "clasp not tested",
    "not formally tested",
    "working status unknown",
    "function unknown",
    "bold statement [item type]",
    "statement",
    "statement [item type]",
    "beautiful [item type]",
    "eye-catching [item type]",
    "unique [item type]",
    "timeless [item type]",
    "classic [item type]",
    "stylish [item type]",
    "versatile [item type]",
    "must-have [item type]",
    "rare find",
    "high quality [item type]",
    "perfect [item/use]",
    "great [item/use]",
    "Candidate Term: Rejected unsupported marketing wording",
    "Candidate Term: Generic subjective wording",
    "Candidate Term: Unsupported marketing phrase",
  ],
  "Cleaned Selling Brief"
);

const platformAngleMapMatch = cleanedBrief.match(
  /Platform Angle Map:([\s\S]*?)(?=\nQuality Risks Before Final Listing:|$)/i
);
assert(platformAngleMapMatch, "Missing Platform Angle Map section.");
assert(
  !platformAngleMapMatch[1].toLowerCase().includes("unsupported sparkle aura"),
  "Rejected candidate leaked into Platform Angle Map."
);

for (const platform of ["EBAY", "DEPOP", "POSHMARK", "MERCARI", "ETSY"]) {
  const platformSection = section(cleanedFinal, platform);
  assert(
    platformSection.includes("Approximate Measurements:\n- Approx. 4.5 in wide x 6 in tall"),
    `${platform} Approximate Measurements block was removed or rewritten.`
  );
}

const bannedMeasurementBodyPatterns = [
  /\bApprox\.?\s+(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)(?:\s*(?:-|–|to)\s*(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+))?(?:\s*(?:"|”|in|inches|cm|mm))?(?:\s*(?:x|by)\s*(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)(?:\s*(?:"|”|in|inches|cm|mm))?)*(?:\s+(?:wide|tall|high|long|across))?\b/i,
  /\bApproximate(?:ly)?\s+(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)/i,
  /\bMeasures?\s+approx(?:imately)?\.?\s+(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)/i,
  /\bMeasuring\s+approx(?:imately)?\.?\s+(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)/i,
  /\bApprox\.?\s+size\s*:\s*(?:about\s+)?(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)/i,
  /^\s*Size\s*:\s*$/im,
  /\bApprox(?:imate)? size listed below\b/i,
  /\bSee measurements below\b/i,
  /\bBased on the measurement photo\b/i,
  /\bFrom measurement photo\b/i,
];

const bannedAwkwardCandidateBodyPatterns = [
  /\bwith\s+floral Cluster\b/i,
  /\bwith\s+a\s+dimensional Cluster\b/i,
  /\bwith\s+dimensional Cluster\b/i,
  /\bfloral Cluster\s+arrangement\b/i,
  /\bfeatures\s+floral Cluster\s+with\b/i,
  /\bfloral Cluster-(?:inspired)\b/i,
  /\bfloral Cluster\s+(?:styling|look|design)\b/i,
  /\bwith\s+Rhinestone Cluster\s+arrangement\b/i,
  /\bRhinestone Cluster\s+arrangement\b/i,
  /\bMid Century cluster brooch\s+style\b/i,
  /\bfloral Cluster\s+construction\b/i,
];

const bannedDanglingBodyGrammarPatterns = [
  /\b(?:is|are)\s*(?:[,.;:]|$)/i,
  /(?:^|[.!?]\s*)and\s*(?:[.!?]|$)/i,
  /,\s*and\s*(?:[.!?]|$)/i,
  /\b(?:and\s+)?no\s+(?:visible\s+)?(?:maker|mark|brand|label|stamp|signature|manufacturer|designer)(?:\s+mark)?\s+is\s*(?:[,.;:]|$)/i,
  /\bno\s+obvious\s+missing\s+(?:component|components|part|parts|piece|pieces|accessory|accessories|hardware|closure|label|tag|elements?)\s+are\b/i,
];

const bodyChecks = [
  ["EBAY", "Description"],
  ["DEPOP", "Listing"],
  ["POSHMARK", "Description"],
  ["MERCARI", "Description"],
  ["ETSY", "Description"],
];

for (const [platform, bodyLabel] of bodyChecks) {
  const platformSection = section(cleanedFinal, platform);
  assertBodyLabelHasOwnLine(platformSection, bodyLabel, platform);
  const body = bodyBeforeMeasurements(platformSection, bodyLabel);
  assertBodyStartsWithIdentity(platform, bodyLabel, body);
  assert(
    /\[(?:material appearance|condition detail|component)\]|\bUnbranded\b/i.test(
      body
    ),
    `${platform} ${bodyLabel} is missing a useful evidence anchor.`
  );
  for (const pattern of bannedMeasurementBodyPatterns) {
    assert(
      !pattern.test(body),
      `${platform} ${bodyLabel} still contains duplicate measurement body copy matching ${pattern}`
    );
  }
  for (const pattern of bannedAwkwardCandidateBodyPatterns) {
    assert(
      !pattern.test(body),
      `${platform} ${bodyLabel} still contains awkward candidate body copy matching ${pattern}`
    );
  }
  for (const pattern of bannedDanglingBodyGrammarPatterns) {
    assert(
      !pattern.test(body),
      `${platform} ${bodyLabel} still contains dangling body grammar matching ${pattern}`
    );
  }
  assert(
    !/^(?:works well|pairs well|perfect gift|great for collectors|statement piece|timeless|beautiful|unique find|must-have)\b/im.test(
      body
    ),
    `${platform} ${bodyLabel} still contains generic filler.`
  );
  assert(
    !/\[[^\]]*item type[^\]]*\]\s+(?:with|by|from)\s+Unbranded\b/i.test(body),
    `${platform} ${bodyLabel} still contains awkward Unbranded identity prose.`
  );
  assert(
    !/\[[^\]]*item type[^\]]*\]\s+is\s+unbranded\b/i.test(body),
    `${platform} ${bodyLabel} still starts with weak Unbranded-only identity prose.`
  );
  assert(
    !/\[[^\]]*item type[^\]]*\]\s+with\s+(?:detailing|visual detail|design)\b/i.test(
      body
    ),
    `${platform} ${bodyLabel} still contains a weak generated opening.`
  );
  assert(
    !/\b(?:with\s+detailing|with\s+detailing\s+detail|with\s+detail\s+detail|with\s+design\s+detail|with\s+visual\s+detail|with\s+style\s+detail|with\s+look\s+detail|\[[^\]]*item type[^\]]*\]\s+with\s+detailing\s+\[[^\]]*item type[^\]]*\])\b/i.test(
      body
    ),
    `${platform} ${bodyLabel} still contains vague detail/design/style fallback copy.`
  );
}

assert(
  !/(^|\n)(?:Condition|Details):[ \t]*[^\n\s]/i.test(cleanedFinal),
  "Condition/Details labels still have joined body text."
);

const etsyBody = bodyBeforeMeasurements(section(cleanedFinal, "ETSY"), "Description").trim();
assert(
  etsyBody.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => sentence.trim()).length >= 2,
  "Etsy Description was thinned too aggressively."
);
assert(
  /\[component\]|\[material appearance\]|visible construction|visible detailing/i.test(
    etsyBody
  ),
  "Etsy Description did not preserve useful evidence after awkward candidate repair."
);
assert(
  /No maker mark is present\./i.test(etsyBody),
  "Etsy Description did not repair maker/mark dangling grammar."
);
assert(
  /No obvious missing component shown, and the structure remains intact\./i.test(
    etsyBody
  ),
  "Etsy Description did not repair missing-component dangling grammar."
);
assert(
  !/^(?:works well|pairs well|perfect gift|great for collectors|statement piece|timeless|beautiful|unique find|must-have)\b/i.test(
    etsyBody
  ),
  "Etsy Description starts with a generic fragment."
);
assertNotContains(
  etsyBody,
  ["Photo tip", "Photo tips", "Video idea", "Video ideas", "include close-up photos"],
  "Etsy Description"
);

assertOrdered(
  cleanedFinal,
  ["EBAY", "DEPOP", "POSHMARK", "MERCARI", "ETSY"],
  "Platform order"
);
assertOrdered(section(cleanedFinal, "EBAY"), ["Title A:", "Title B:", "Category:", "Item Specifics:", "Description:", "Approximate Measurements:", "Please review photos for condition and measurements."], "eBay order");
assertOrdered(section(cleanedFinal, "DEPOP"), ["Listing:", "Hashtags:", "Optional Brand Hashtags:", "Approximate Measurements:", "Please review photos for condition and measurements."], "Depop order");
assertOrdered(section(cleanedFinal, "POSHMARK"), ["Description:", "Search keywords:", "Style Tags:", "Compact 3-Tag Strategy (Alt Option):", "Approximate Measurements:", "Please review photos for condition and measurements."], "Poshmark order");
assertOrdered(section(cleanedFinal, "MERCARI"), ["Description:", "Hashtags:", "Approximate Measurements:", "Please review photos for condition and measurements."], "Mercari order");
assertOrdered(section(cleanedFinal, "ETSY"), ["Title:", "Category:", "Materials:", "Attributes / Key Details:", "Tags:", "Description:", "Approximate Measurements:", "Please review photos for condition and measurements."], "Etsy order");

for (const protectedLine of [
  "Title A: [item type] [material appearance] [condition detail] [component]",
  "Title B: [candidate] [item type] [dimension label]",
  "Category: [platform] > [item type]",
  "- Brand: Unbranded",
  "- Type: [item type]",
  "- Theme: [candidate]",
  "Primary: [candidate]",
  "Secondary: [candidate two]",
  "- Condition: [condition detail]",
  "Hashtags: #[itemtype] #[candidate] #[candidatetwo]",
  "Optional Brand Hashtags: #unbranded",
  "Search keywords: [candidate], [candidate two], [item type]",
  "Style Tags: Boho, Classic, Minimalist",
  "Compact 3-Tag Strategy (Alt Option): Boho, Classic, Minimalist",
  "Hashtags: #itemtype #candidate #candidatetwo",
  "Materials: [material appearance]",
  "- Item type: [item type]",
  "- Component: [component]",
  "Tags: [candidate], [candidate two], [item type], [material appearance], [component], [condition detail], [dimension label], generic tag one, generic tag two, generic tag three, generic tag four, generic tag five, generic tag six",
  "Please review photos for condition and measurements.",
]) {
  assertProtectedLinePreserved(cleanedFinal, protectedLine);
}

assertNotContains(cleanedFinal, ["provided images", "functional status not tested"], "Cleaned final LP-U");

console.log("V2 sanitizer regression check passed.");
