export type WebCompsConfidence = "High" | "Medium" | "Low" | "Very Low";

export type WebCompsSourceStatus =
  | "sold"
  | "completed"
  | "best_offer_uncertain"
  | "active_or_unclear"
  | "excluded";

export type WebCompsSimilarity =
  | "strong"
  | "medium"
  | "weak"
  | "not_comparable";

export type WebCompsMatchType =
  | "full_item"
  | "same_item_type"
  | "component_only"
  | "style_only"
  | "brand_only"
  | "material_only"
  | "unclear";

export type WebCompsUserOverrideRisk = "none" | "low" | "medium" | "high";

export type WebCompsItemIntake = {
  notes?: string;
  knownDetails?: string;
  conditionFlaws?: string;
  measurements?: string;
  markingsLabels?: string;
};

export type WebCompsTargetContext = {
  itemType?: string;
  isComposite: boolean;
  componentTerms: string[];
  attributionPhrase?: string;
  isUnsigned?: boolean;
  isVintage?: boolean;
  materialAppearance?: string;
  primaryStyleOrForm?: string;
  conditionNotes?: string;
  measurements?: string;
};

export type WebCompsRequestPayload = {
  pricingQuery: string;
  narrowerQuery?: string;
  broaderQuery?: string;
  ebaySoldCompsUrl?: string;
  sellingBriefSummary?: string;
  itemIntake?: WebCompsItemIntake;
  targetContext?: Partial<WebCompsTargetContext>;
};

export type WebCompsSourceUrl = {
  id: string;
  url: string;
  title: string;
  visiblePrice: number | null;
  status: WebCompsSourceStatus;
  eligibleForPricing: boolean;
  defaultIncludedInPricing: boolean;
  selectableForUserPricing: boolean;
  hardDisabled: boolean;
  userOverrideRisk: WebCompsUserOverrideRisk;
  usedInPricing: boolean;
  ineligibilityReason: string | null;
  similarity: WebCompsSimilarity;
  matchType: WebCompsMatchType;
  matchReasons: string[];
  mismatchReasons: string[];
};

export type WebCompsResult = {
  suggestedPrice: number | null;
  suggestedPriceLabel: string;
  confidence: WebCompsConfidence;
  usableSoldResultsUsed: number;
  targetSoldResultsRequested: 10;
  minimumTargetSoldResults: 10;
  candidateSourcesReturned: number;
  eligibleSoldResultsFound: number;
  selectedSoldResultsUsed: number;
  basis: string;
  bestOfferCaveatUsed: boolean;
  sourceUrls: WebCompsSourceUrl[];
};

type NormalizedModelSourceUrl = Omit<
  WebCompsSourceUrl,
  | "eligibleForPricing"
  | "defaultIncludedInPricing"
  | "selectableForUserPricing"
  | "hardDisabled"
  | "userOverrideRisk"
  | "ineligibilityReason"
>;

export const WEB_COMPS_TARGET_SOLD_RESULTS = 10;
export const WEB_COMPS_MAX_CANDIDATE_SOURCES = 25;

export const WEB_COMPS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "suggestedPrice",
    "suggestedPriceLabel",
    "confidence",
    "usableSoldResultsUsed",
    "targetSoldResultsRequested",
    "basis",
    "bestOfferCaveatUsed",
    "sourceUrls",
  ],
  properties: {
    suggestedPrice: {
      anyOf: [{ type: "number" }, { type: "null" }],
    },
    suggestedPriceLabel: { type: "string" },
    confidence: {
      type: "string",
      enum: ["High", "Medium", "Low", "Very Low"],
    },
    usableSoldResultsUsed: {
      type: "integer",
      minimum: 0,
    },
    targetSoldResultsRequested: {
      type: "integer",
      enum: [WEB_COMPS_TARGET_SOLD_RESULTS],
    },
    basis: { type: "string" },
    bestOfferCaveatUsed: { type: "boolean" },
    sourceUrls: {
      type: "array",
      maxItems: WEB_COMPS_MAX_CANDIDATE_SOURCES,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "url",
          "title",
          "visiblePrice",
          "status",
          "usedInPricing",
          "similarity",
          "matchType",
          "matchReasons",
          "mismatchReasons",
        ],
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          visiblePrice: {
            anyOf: [{ type: "number" }, { type: "null" }],
          },
          status: {
            type: "string",
            enum: [
              "sold",
              "completed",
              "best_offer_uncertain",
              "active_or_unclear",
              "excluded",
            ],
          },
          usedInPricing: { type: "boolean" },
          similarity: {
            type: "string",
            enum: ["strong", "medium", "weak", "not_comparable"],
          },
          matchType: {
            type: "string",
            enum: [
              "full_item",
              "same_item_type",
              "component_only",
              "style_only",
              "brand_only",
              "material_only",
              "unclear",
            ],
          },
          matchReasons: {
            type: "array",
            maxItems: 8,
            items: { type: "string" },
          },
          mismatchReasons: {
            type: "array",
            maxItems: 8,
            items: { type: "string" },
          },
        },
      },
    },
  },
} as const;

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  const trimmed = readString(value);
  return trimmed || undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map(readOptionalString)
    .filter((item): item is string => Boolean(item))
    .slice(0, 12);
}

export function parseWebCompsRequestBody(
  body: unknown
): WebCompsRequestPayload {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const source = body as Record<string, unknown>;
  const pricingQuery = readString(source.pricingQuery);

  if (!pricingQuery) {
    throw new Error("pricingQuery is required.");
  }

  const itemIntakeSource =
    source.itemIntake && typeof source.itemIntake === "object"
      ? (source.itemIntake as Record<string, unknown>)
      : {};

  const targetContextSource =
    source.targetContext && typeof source.targetContext === "object"
      ? (source.targetContext as Record<string, unknown>)
      : {};

  const payload: WebCompsRequestPayload = {
    pricingQuery,
    narrowerQuery: readOptionalString(source.narrowerQuery),
    broaderQuery: readOptionalString(source.broaderQuery),
    ebaySoldCompsUrl: readOptionalString(source.ebaySoldCompsUrl),
    sellingBriefSummary: readOptionalString(source.sellingBriefSummary),
    itemIntake: {
      notes: readOptionalString(itemIntakeSource.notes),
      knownDetails: readOptionalString(itemIntakeSource.knownDetails),
      conditionFlaws: readOptionalString(itemIntakeSource.conditionFlaws),
      measurements: readOptionalString(itemIntakeSource.measurements),
      markingsLabels: readOptionalString(itemIntakeSource.markingsLabels),
    },
    targetContext: {
      itemType: readOptionalString(targetContextSource.itemType),
      isComposite: readOptionalBoolean(targetContextSource.isComposite),
      componentTerms: readStringArray(targetContextSource.componentTerms),
      attributionPhrase: readOptionalString(
        targetContextSource.attributionPhrase
      ),
      isUnsigned: readOptionalBoolean(targetContextSource.isUnsigned),
      isVintage: readOptionalBoolean(targetContextSource.isVintage),
      materialAppearance: readOptionalString(
        targetContextSource.materialAppearance
      ),
      primaryStyleOrForm: readOptionalString(
        targetContextSource.primaryStyleOrForm
      ),
      conditionNotes: readOptionalString(targetContextSource.conditionNotes),
      measurements: readOptionalString(targetContextSource.measurements),
    },
  };

  return payload;
}

function isConfidence(value: unknown): value is WebCompsConfidence {
  return (
    value === "High" ||
    value === "Medium" ||
    value === "Low" ||
    value === "Very Low"
  );
}

function isSourceStatus(value: unknown): value is WebCompsSourceStatus {
  return (
    value === "sold" ||
    value === "completed" ||
    value === "best_offer_uncertain" ||
    value === "active_or_unclear" ||
    value === "excluded"
  );
}

function isSimilarity(value: unknown): value is WebCompsSimilarity {
  return (
    value === "strong" ||
    value === "medium" ||
    value === "weak" ||
    value === "not_comparable"
  );
}

function isMatchType(value: unknown): value is WebCompsMatchType {
  return (
    value === "full_item" ||
    value === "same_item_type" ||
    value === "component_only" ||
    value === "style_only" ||
    value === "brand_only" ||
    value === "material_only" ||
    value === "unclear"
  );
}

function readNullableNumber(value: unknown): number | null {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stableHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function createStableSourceId(url: string, title: string): string {
  const normalizedUrl = url.trim().toLowerCase();
  const hashInput = normalizedUrl || `${normalizedUrl}|${title.trim().toLowerCase()}`;
  return `web-comp-${stableHash(hashInput)}`;
}

export function normalizeWebCompsSourceIds<
  T extends { id: string; url: string; title: string },
>(sourceUrls: T[]): T[] {
  const seenBaseIds = new Map<string, number>();
  const usedIds = new Set<string>();

  return sourceUrls.map((sourceUrl, index) => {
    const baseId =
      sourceUrl.id.trim() || createStableSourceId(sourceUrl.url, sourceUrl.title);
    const occurrence = seenBaseIds.get(baseId) ?? 0;
    seenBaseIds.set(baseId, occurrence + 1);

    let nextId = baseId;
    if (occurrence > 0 || usedIds.has(nextId)) {
      const suffixSeed = [
        sourceUrl.url.trim().toLowerCase(),
        sourceUrl.title.trim().toLowerCase(),
        String(index),
        String(occurrence + 1),
      ].join("|");
      let suffixAttempt = occurrence + 1;
      nextId = `${baseId}-${suffixAttempt}-${stableHash(suffixSeed)}`;

      while (usedIds.has(nextId)) {
        suffixAttempt += 1;
        nextId = `${baseId}-${suffixAttempt}-${stableHash(
          `${suffixSeed}|${suffixAttempt}`
        )}`;
      }
    }

    usedIds.add(nextId);
    return nextId === sourceUrl.id ? sourceUrl : { ...sourceUrl, id: nextId };
  });
}

function readPositiveNumber(value: unknown): number | null {
  const number = readNullableNumber(value);
  return number !== null && number > 0 ? number : null;
}

function forceWeakSimilarity(
  similarity: WebCompsSimilarity
): WebCompsSimilarity {
  return similarity === "not_comparable" ? similarity : "weak";
}

function normalizeSourceUrl(
  value: unknown,
  targetContext: WebCompsTargetContext
): NormalizedModelSourceUrl | null {
  if (!value || typeof value !== "object") return null;

  const source = value as Record<string, unknown>;
  const url = readString(source.url);
  const title = readString(source.title);
  const status = source.status;
  const rawSimilarity = source.similarity;
  const rawMatchType = source.matchType;

  if (!url || !title || !isSourceStatus(status)) {
    return null;
  }

  const matchType = isMatchType(rawMatchType) ? rawMatchType : "unclear";
  let similarity: WebCompsSimilarity = isSimilarity(rawSimilarity)
    ? rawSimilarity
    : "not_comparable";

  if (matchType === "component_only" && targetContext.isComposite) {
    similarity = forceWeakSimilarity(similarity);
  }

  if (
    !targetContext.isComposite &&
    (matchType === "component_only" ||
      matchType === "brand_only" ||
      matchType === "material_only" ||
      matchType === "style_only") &&
    similarity !== "not_comparable"
  ) {
    similarity = "weak";
  }

  if (status === "active_or_unclear" || status === "excluded") {
    similarity = "not_comparable";
  }

  if (readPositiveNumber(source.visiblePrice) === null) {
    similarity = "not_comparable";
  }

  return {
    id: createStableSourceId(url, title),
    url,
    title,
    visiblePrice: readPositiveNumber(source.visiblePrice),
    status,
    usedInPricing: source.usedInPricing === true,
    similarity,
    matchType,
    matchReasons: readStringArray(source.matchReasons),
    mismatchReasons: readStringArray(source.mismatchReasons),
  };
}

function getUrlIneligibilityReason(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "ebay.com" || host.endsWith(".ebay.com")
      ? null
      : "non-eBay source";
  } catch {
    return "malformed source";
  }
}

function getHardDisabledReason(
  source: Pick<WebCompsSourceUrl, "url" | "visiblePrice">,
  isDuplicate: boolean
): string | null {
  const urlReason = getUrlIneligibilityReason(source.url);
  if (urlReason) return urlReason;
  if (source.visiblePrice === null || source.visiblePrice <= 0) {
    return "no visible sold price";
  }
  if (isDuplicate) return "duplicate source";
  return null;
}

function getIneligibilityReason(
  source: Pick<
    WebCompsSourceUrl,
    "url" | "visiblePrice" | "status" | "similarity"
  >
): string | null {
  const urlReason = getUrlIneligibilityReason(source.url);
  if (urlReason) return urlReason;
  if (source.visiblePrice === null || source.visiblePrice <= 0) {
    return "no visible sold price";
  }
  if (source.status === "active_or_unclear") return "active/unclear";
  if (source.status === "excluded") return "excluded";
  if (source.similarity === "not_comparable") return "not comparable";
  if (
    source.status !== "sold" &&
    source.status !== "completed" &&
    source.status !== "best_offer_uncertain"
  ) {
    return "not sold/completed";
  }

  return null;
}

function isEligibleSource(source: WebCompsSourceUrl): boolean {
  return source.eligibleForPricing;
}

function isValidUsedSource(source: WebCompsSourceUrl): boolean {
  return source.usedInPricing && isEligibleSource(source);
}

function similarityRank(source: WebCompsSourceUrl): number {
  switch (source.similarity) {
    case "strong":
      return 3;
    case "medium":
      return 2;
    case "weak":
      return 1;
    case "not_comparable":
      return 0;
  }
}

function isWeakOrComponentOnly(source: WebCompsSourceUrl): boolean {
  return source.similarity === "weak" || source.matchType === "component_only";
}

function riskRank(risk: WebCompsUserOverrideRisk): number {
  switch (risk) {
    case "none":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
  }
}

function maxRisk(
  current: WebCompsUserOverrideRisk,
  next: WebCompsUserOverrideRisk
): WebCompsUserOverrideRisk {
  return riskRank(next) > riskRank(current) ? next : current;
}

function getUserOverrideRisk(
  source: Pick<
    WebCompsSourceUrl,
    | "eligibleForPricing"
    | "hardDisabled"
    | "status"
    | "similarity"
    | "matchType"
  >,
  targetContext: WebCompsTargetContext
): WebCompsUserOverrideRisk {
  if (source.hardDisabled) return "high";

  let risk: WebCompsUserOverrideRisk = source.eligibleForPricing
    ? "none"
    : "medium";

  if (source.status === "active_or_unclear" || source.status === "excluded") {
    risk = maxRisk(risk, "high");
  }

  if (source.similarity === "not_comparable") {
    risk = maxRisk(risk, "high");
  } else if (source.similarity === "weak") {
    risk = maxRisk(risk, "medium");
  }

  if (source.status === "best_offer_uncertain") {
    risk = maxRisk(risk, "low");
  }

  if (targetContext.isComposite && source.matchType === "component_only") {
    risk = maxRisk(risk, "medium");
  }

  return risk;
}

function confidenceRank(confidence: WebCompsConfidence): number {
  switch (confidence) {
    case "Very Low":
      return 0;
    case "Low":
      return 1;
    case "Medium":
      return 2;
    case "High":
      return 3;
  }
}

function confidenceFromRank(rank: number): WebCompsConfidence {
  if (rank >= 3) return "High";
  if (rank === 2) return "Medium";
  if (rank === 1) return "Low";
  return "Very Low";
}

function capConfidence(
  confidence: WebCompsConfidence,
  maxConfidence: WebCompsConfidence
): WebCompsConfidence {
  return confidenceFromRank(
    Math.min(confidenceRank(confidence), confidenceRank(maxConfidence))
  );
}

function maxConfidenceForUsableCount(count: number): WebCompsConfidence {
  if (count >= WEB_COMPS_TARGET_SOLD_RESULTS) return "High";
  if (count >= 3) return "Medium";
  if (count >= 1) return "Low";
  return "Very Low";
}

function maxConfidenceForSimilarity(
  sources: WebCompsSourceUrl[],
  targetContext: WebCompsTargetContext
): WebCompsConfidence {
  const count = sources.length;
  if (count === 0) return "Very Low";

  const weakOrComponentOnlyCount = sources.filter(isWeakOrComponentOnly).length;
  const strongOrMediumCount = sources.filter(
    (source) => source.similarity === "strong" || source.similarity === "medium"
  ).length;
  const fullItemStrongCount = sources.filter(
    (source) => source.similarity === "strong" && source.matchType === "full_item"
  ).length;
  const bestOfferCount = sources.filter(
    (source) => source.status === "best_offer_uncertain"
  ).length;

  if (count <= 2 && weakOrComponentOnlyCount === count) return "Very Low";
  if (count <= 2) return fullItemStrongCount > 0 ? "Low" : "Low";
  if (weakOrComponentOnlyCount === count) return "Low";
  if (targetContext.isComposite && weakOrComponentOnlyCount === count) {
    return "Low";
  }
  if (bestOfferCount > count / 2 && count < 5) return "Low";
  if (count < 3) return "Low";
  if (strongOrMediumCount >= 10) return "High";
  if (strongOrMediumCount >= 6) {
    return weakOrComponentOnlyCount <= Math.floor(count / 3) ? "High" : "Medium";
  }
  if (strongOrMediumCount >= 3) return "Medium";
  return "Low";
}

function median(values: number[]): number | null {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) return sorted[middle];

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundToListingPrice(value: number): number {
  if (value < 25) {
    return Math.max(0.99, Math.round(value) - 0.01);
  }

  if (value <= 100) {
    const lowerBase = Math.floor(value / 5) * 5;
    const candidates = [
      lowerBase - 0.01,
      lowerBase + 4.99,
      lowerBase + 9.99,
    ].filter((candidate) => candidate > 0);

    return candidates.reduce((nearest, candidate) =>
      Math.abs(candidate - value) < Math.abs(nearest - value)
        ? candidate
        : nearest
    );
  }

  const increment = value < 250 ? 5 : 10;
  return Math.max(increment, Math.round(value / increment) * increment);
}

function calculateFallbackSuggestedPrice(
  sources: WebCompsSourceUrl[]
): number | null {
  const adjustedPrices = sources
    .map((source) => {
      if (source.visiblePrice === null) return null;
      return source.status === "best_offer_uncertain"
        ? source.visiblePrice * 0.9
        : source.visiblePrice;
    })
    .filter((price): price is number => price !== null && price > 0);

  const medianPrice = median(adjustedPrices);
  return medianPrice === null ? null : roundToListingPrice(medianPrice);
}

function normalizeSourceDefaults(
  rawSourceUrls: NormalizedModelSourceUrl[],
  targetContext: WebCompsTargetContext
): WebCompsSourceUrl[] {
  const seenSourceUrls = new Set<string>();
  const candidateSources = normalizeWebCompsSourceIds(
    rawSourceUrls.slice(0, WEB_COMPS_MAX_CANDIDATE_SOURCES)
  )
    .map((sourceUrl) => {
      const normalizedUrl = sourceUrl.url.trim().toLowerCase();
      const isDuplicate = seenSourceUrls.has(normalizedUrl);
      seenSourceUrls.add(normalizedUrl);

      const hardDisabledReason = getHardDisabledReason(
        sourceUrl,
        isDuplicate
      );
      const pricingIneligibilityReason =
        hardDisabledReason || getIneligibilityReason(sourceUrl);
      const hardDisabled = hardDisabledReason !== null;
      const eligibleForPricing = pricingIneligibilityReason === null;
      const selectableForUserPricing = hardDisabledReason === null;

      return {
        ...sourceUrl,
        eligibleForPricing,
        selectableForUserPricing,
        hardDisabled,
        userOverrideRisk: getUserOverrideRisk(
          {
            ...sourceUrl,
            eligibleForPricing,
            hardDisabled,
          },
          targetContext
        ),
        defaultIncludedInPricing: false,
        ineligibilityReason: pricingIneligibilityReason,
      };
    });

  const eligibleSources = candidateSources.filter(isEligibleSource);
  const strongerSources = eligibleSources.filter(
    (sourceUrl) =>
      sourceUrl.similarity === "strong" || sourceUrl.similarity === "medium"
  );
  const includeWeakSources =
    strongerSources.length < WEB_COMPS_TARGET_SOLD_RESULTS ||
    (targetContext.isComposite && strongerSources.length === 0);

  const selectedIds = new Set(
    [...eligibleSources]
      .filter((sourceUrl) => {
        if (sourceUrl.similarity === "weak" || sourceUrl.matchType === "component_only") {
          return includeWeakSources || sourceUrl.usedInPricing;
        }

        return true;
      })
      .sort((a, b) => {
        const rankDifference = similarityRank(b) - similarityRank(a);
        if (rankDifference !== 0) return rankDifference;

        if (targetContext.isComposite) {
          if (a.matchType === "component_only" && b.matchType !== "component_only") {
            return 1;
          }
          if (b.matchType === "component_only" && a.matchType !== "component_only") {
            return -1;
          }
        }

        return 0;
      })
      .map((sourceUrl) => sourceUrl.id)
  );

  return candidateSources.map((sourceUrl) => ({
    ...sourceUrl,
    defaultIncludedInPricing:
      sourceUrl.eligibleForPricing && selectedIds.has(sourceUrl.id),
    usedInPricing: sourceUrl.eligibleForPricing && selectedIds.has(sourceUrl.id),
  }));
}

const COMPOSITE_INDICATOR_PATTERNS = [
  /\bset\b/i,
  /\bmatching\s+set\b/i,
  /\bdemi[-\s]?parure\b/i,
  /\bparure\b/i,
  /\bpair\b/i,
  /\bkit\b/i,
  /\blot\b/i,
  /\bbundle\b/i,
  /\bcollection\b/i,
  /\boutfit\b/i,
  /\bensemble\b/i,
  /\bmulti[-\s]?piece\b/i,
  /\btwo[-\s]?piece\b/i,
  /\bthree[-\s]?piece\b/i,
  /\bfour[-\s]?piece\b/i,
  /\bfive[-\s]?piece\b/i,
  /\bincludes?\b.+\b(and|with|plus|\+)\b/i,
  /\b\w+\s+(and|with|plus|\+)\s+\w+\b/i,
];

function compactTextParts(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

function extractComponentTerms(text: string): string[] {
  const components = new Set<string>();
  const patterns = [
    /\bincludes?\s+([^.;\n]+)/gi,
    /\bwith\s+([^.;\n]+)/gi,
    /\bset\s+of\s+([^.;\n]+)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const terms = match[1]
        .split(/\s*(?:,|\/|\+|&|\band\b|\bplus\b|\bwith\b)\s*/i)
        .map((term) => term.trim().replace(/^\d+\s*/, ""))
        .filter((term) => term.length >= 3 && term.length <= 40);

      for (const term of terms) {
        components.add(term);
      }
    }
  }

  return [...components].slice(0, 12);
}

function inferTargetContext(
  payload?: WebCompsRequestPayload | WebCompsTargetContext
): WebCompsTargetContext {
  if (!payload) {
    return { isComposite: false, componentTerms: [] };
  }

  if ("isComposite" in payload && !("pricingQuery" in payload)) {
    return {
      isComposite: payload.isComposite,
      componentTerms: payload.componentTerms || [],
      itemType: payload.itemType,
      attributionPhrase: payload.attributionPhrase,
      isUnsigned: payload.isUnsigned,
      isVintage: payload.isVintage,
      materialAppearance: payload.materialAppearance,
      primaryStyleOrForm: payload.primaryStyleOrForm,
      conditionNotes: payload.conditionNotes,
      measurements: payload.measurements,
    };
  }

  const requestPayload = payload as WebCompsRequestPayload;
  const intake = requestPayload.itemIntake || {};
  const combinedText = compactTextParts([
    requestPayload.pricingQuery,
    requestPayload.narrowerQuery,
    requestPayload.broaderQuery,
    requestPayload.sellingBriefSummary,
    intake.notes,
    intake.knownDetails,
    intake.conditionFlaws,
    intake.measurements,
    intake.markingsLabels,
  ]);
  const lowerText = combinedText.toLowerCase();
  const provided = requestPayload.targetContext || {};
  const isComposite =
    provided.isComposite ??
    COMPOSITE_INDICATOR_PATTERNS.some((pattern) => pattern.test(combinedText));

  return {
    itemType: provided.itemType || requestPayload.pricingQuery,
    isComposite,
    componentTerms:
      provided.componentTerms && provided.componentTerms.length
        ? provided.componentTerms
        : extractComponentTerms(combinedText),
    attributionPhrase: provided.attributionPhrase || intake.markingsLabels,
    isUnsigned:
      provided.isUnsigned ??
      /\bunsigned\b|\bno\s+(maker|brand|mark|signature)\b/i.test(combinedText),
    isVintage: provided.isVintage ?? /\bvintage\b|\bantique\b/i.test(lowerText),
    materialAppearance:
      provided.materialAppearance || intake.knownDetails || intake.notes,
    primaryStyleOrForm:
      provided.primaryStyleOrForm || requestPayload.pricingQuery,
    conditionNotes: provided.conditionNotes || intake.conditionFlaws,
    measurements: provided.measurements || intake.measurements,
  };
}

export function formatWebCompsPriceLabel(price: number | null): string {
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return "Not enough public sold evidence";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

export function formatWebCompsSourceCountLabel(
  selectedSoldResultsUsed: number,
  minimumTargetSoldResults = WEB_COMPS_TARGET_SOLD_RESULTS
): string {
  return `${selectedSoldResultsUsed} selected / target ${minimumTargetSoldResults}+ usable comps`;
}

export function recalculateWebCompsSummary(
  result: WebCompsResult,
  selectedSourceIds: string[]
): Pick<
  WebCompsResult,
  | "suggestedPrice"
  | "suggestedPriceLabel"
  | "confidence"
  | "usableSoldResultsUsed"
  | "selectedSoldResultsUsed"
  | "minimumTargetSoldResults"
  | "candidateSourcesReturned"
  | "eligibleSoldResultsFound"
  | "bestOfferCaveatUsed"
> {
  const selectedIds = new Set(selectedSourceIds);
  const selectedSources = result.sourceUrls.filter(
    (sourceUrl) => selectedIds.has(sourceUrl.id) && sourceUrl.selectableForUserPricing
  );
  const selectedSourceCount = selectedSources.length;
  const eligibleSelectedSources = selectedSources.filter(isEligibleSource);
  const usableSoldResultsUsed = eligibleSelectedSources.length;
  const candidateSourcesReturned = result.sourceUrls.length;
  const eligibleSoldResultsFound =
    result.eligibleSoldResultsFound ??
    result.sourceUrls.filter((sourceUrl) => sourceUrl.eligibleForPricing).length;
  const hasBestOfferUncertainty = selectedSources.some(
    (sourceUrl) => sourceUrl.status === "best_offer_uncertain"
  );

  if (selectedSourceCount === 0) {
    return {
      suggestedPrice: null,
      suggestedPriceLabel: "Not enough selected comp evidence",
      confidence: "Very Low",
      usableSoldResultsUsed: 0,
      selectedSoldResultsUsed: 0,
      minimumTargetSoldResults: WEB_COMPS_TARGET_SOLD_RESULTS,
      candidateSourcesReturned,
      eligibleSoldResultsFound,
      bestOfferCaveatUsed: false,
    };
  }

  const suggestedPrice = calculateFallbackSuggestedPrice(selectedSources);
  let confidence = capConfidence(
    "High",
    maxConfidenceForUsableCount(selectedSourceCount)
  );
  confidence = capConfidence(
    confidence,
    maxConfidenceForSimilarity(
      selectedSources,
      { isComposite: false, componentTerms: [] }
    )
  );

  if (hasBestOfferUncertainty) {
    confidence = capConfidence(confidence, "Medium");
  }

  const bestOfferCount = selectedSources.filter(
    (sourceUrl) => sourceUrl.status === "best_offer_uncertain"
  ).length;
  if (bestOfferCount > selectedSources.length / 2 && selectedSourceCount < 5) {
    confidence = capConfidence(confidence, "Low");
  }

  const overriddenSources = selectedSources.filter(
    (sourceUrl) => !sourceUrl.eligibleForPricing
  );
  const activeOrUnclearCount = selectedSources.filter(
    (sourceUrl) => sourceUrl.status === "active_or_unclear"
  ).length;
  const notComparableCount = selectedSources.filter(
    (sourceUrl) => sourceUrl.similarity === "not_comparable"
  ).length;
  const componentOnlyCount = selectedSources.filter(
    (sourceUrl) => sourceUrl.matchType === "component_only"
  ).length;
  const strongOrMediumEligibleCount = eligibleSelectedSources.filter(
    (sourceUrl) =>
      sourceUrl.similarity === "strong" || sourceUrl.similarity === "medium"
  ).length;
  const highRiskOverrideCount = overriddenSources.filter(
    (sourceUrl) => sourceUrl.userOverrideRisk === "high"
  ).length;

  if (overriddenSources.length > 0) {
    confidence = capConfidence(confidence, "Low");
  }

  if (activeOrUnclearCount > 0) {
    confidence = capConfidence(
      confidence,
      activeOrUnclearCount >= selectedSourceCount / 2 ? "Very Low" : "Low"
    );
  }

  if (notComparableCount > 0) {
    confidence = capConfidence(
      confidence,
      strongOrMediumEligibleCount >= 3 && notComparableCount < strongOrMediumEligibleCount
        ? "Low"
        : "Very Low"
    );
  }

  if (componentOnlyCount > 0 && componentOnlyCount === selectedSourceCount) {
    confidence = capConfidence(confidence, "Low");
  }

  if (highRiskOverrideCount > 0 && strongOrMediumEligibleCount < 3) {
    confidence = capConfidence(confidence, "Very Low");
  }

  return {
    suggestedPrice,
    suggestedPriceLabel: formatWebCompsPriceLabel(suggestedPrice),
    confidence: suggestedPrice === null ? "Very Low" : confidence,
    usableSoldResultsUsed,
    selectedSoldResultsUsed: selectedSourceCount,
    minimumTargetSoldResults: WEB_COMPS_TARGET_SOLD_RESULTS,
    candidateSourcesReturned,
    eligibleSoldResultsFound,
    bestOfferCaveatUsed: hasBestOfferUncertainty,
  };
}

export function parseWebCompsModelJson(
  rawJson: string,
  payload?: WebCompsRequestPayload | WebCompsTargetContext
): WebCompsResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("OpenAI returned an invalid web comps result.");
  }

  const source = parsed as Record<string, unknown>;
  const confidence = source.confidence;
  const targetContext = inferTargetContext(payload);

  if (!isConfidence(confidence)) {
    throw new Error("OpenAI returned an invalid confidence value.");
  }

  const rawSourceUrls = Array.isArray(source.sourceUrls)
    ? source.sourceUrls
        .map((sourceUrl) => normalizeSourceUrl(sourceUrl, targetContext))
        .filter((item): item is NormalizedModelSourceUrl => Boolean(item))
    : [];
  const sourceUrls = normalizeSourceDefaults(rawSourceUrls, targetContext);

  const validUsedSources = sourceUrls.filter(isValidUsedSource);
  const usableSoldResultsUsed = validUsedSources.length;
  const candidateSourcesReturned = sourceUrls.length;
  const eligibleSoldResultsFound = sourceUrls.filter(isEligibleSource).length;
  const hasBestOfferUncertainty = validUsedSources.some(
    (sourceUrl) => sourceUrl.status === "best_offer_uncertain"
  );
  const suggestedPrice =
    usableSoldResultsUsed === 0
      ? null
      : calculateFallbackSuggestedPrice(validUsedSources);

  let normalizedConfidence: WebCompsConfidence =
    usableSoldResultsUsed === 0
      ? "Very Low"
      : capConfidence(
          confidence,
          maxConfidenceForUsableCount(usableSoldResultsUsed)
        );

  normalizedConfidence = capConfidence(
    normalizedConfidence,
    maxConfidenceForSimilarity(validUsedSources, targetContext)
  );

  if (hasBestOfferUncertainty) {
    normalizedConfidence = capConfidence(normalizedConfidence, "Medium");
  }

  const bestOfferCount = validUsedSources.filter(
    (sourceUrl) => sourceUrl.status === "best_offer_uncertain"
  ).length;
  if (bestOfferCount > validUsedSources.length / 2 && usableSoldResultsUsed < 5) {
    normalizedConfidence = capConfidence(normalizedConfidence, "Low");
  }

  return {
    suggestedPrice,
    suggestedPriceLabel: formatWebCompsPriceLabel(suggestedPrice),
    confidence: suggestedPrice === null ? "Very Low" : normalizedConfidence,
    usableSoldResultsUsed,
    targetSoldResultsRequested: WEB_COMPS_TARGET_SOLD_RESULTS,
    minimumTargetSoldResults: WEB_COMPS_TARGET_SOLD_RESULTS,
    candidateSourcesReturned,
    eligibleSoldResultsFound,
    selectedSoldResultsUsed: usableSoldResultsUsed,
    basis: readString(source.basis) || "",
    bestOfferCaveatUsed:
      source.bestOfferCaveatUsed === true || hasBestOfferUncertainty,
    sourceUrls,
  };
}

function formatPromptSection(name: string, value?: string): string {
  return value?.trim() ? `${name}:\n${value.trim()}` : `${name}:\nNot provided`;
}

export function buildWebCompsPrompt(payload: WebCompsRequestPayload): string {
  const itemIntake = payload.itemIntake || {};
  const targetContext = inferTargetContext(payload);

  return `Find public eBay sold/completed comps for resale pricing.

Use only public ebay.com pages/results surfaced by OpenAI web search. Do not use authenticated eBay data, eBay API data, browser automation, direct scraping, Terapeak/Product Research data, or hidden accepted offer prices.

Search plan:
- Search only ebay.com public pages/results.
- Prioritize sold/completed result evidence.
- Prioritize eBay item pages or eBay result pages with visible sold/completed language.
- Use the Pricing Research query first.
- Use narrower/broader query variants only if needed.
- Attempt to find at least ${WEB_COMPS_TARGET_SOLD_RESULTS} usable public eBay sold/completed comps when available.
- Return more than ${WEB_COMPS_TARGET_SOLD_RESULTS} candidate sources when useful, up to ${WEB_COMPS_MAX_CANDIDATE_SOURCES} candidate sources.
- Include enough candidate sources so the user can choose which to include.
- For every potential source, classify similarity to the target item.
- Classify each source as eligible or ineligible for pricing through status, price visibility, and similarity.
- For composite/set targets, distinguish full-set/full-item comps from component-only comps.
- If fewer than ${WEB_COMPS_TARGET_SOLD_RESULTS} usable public sold/completed results are found, still return a suggested price using the usable results found.
- Always report the number of usable sold/completed results used.
- Always return usableSoldResultsUsed as the count of usable public eBay sold/completed results used. Do not phrase it as "out of ${WEB_COMPS_TARGET_SOLD_RESULTS}".

Comp inclusion rules:
- Exclude active listings from sold-comp pricing.
- Exclude non-eBay domains.
- Exclude unrelated listings.
- Do not use non-comparable sources in pricing.
- Do not mark weak/component-only comps as strong.
- Do not mark active/unclear listings as usedInPricing.
- Do not treat active/unclear listings as sold comps.
- Exclude pages where sold/completed status is not visible or reasonably supported.
- Do not use sources without visible numeric price.
- Active/unclear listings may appear in sourceUrls for diagnostics only, but must not be counted in usableSoldResultsUsed.
- Unclear status listings must not be used as primary sold comps.
- Do not invent sold prices.
- Do not infer hidden Best Offer prices.
- Do not use hidden prices.
- Do not claim sell-through rate.
- Do not claim all eBay sold listings were reviewed.
- Do not say or imply verified Terapeak data.

Similarity rules for each source:
- Return similarity as one of: strong, medium, weak, not_comparable.
- Return matchType as one of: full_item, same_item_type, component_only, style_only, brand_only, material_only, unclear.
- Include concise matchReasons and mismatchReasons arrays.
- strong means same item type/composite status with similar material/style/brand/condition/scale where relevant.
- medium means same item type with important differences, or same composite type missing one secondary detail.
- weak means component-only, style-only, material-only, or missing major target identifiers.
- not_comparable means unrelated item, active/unclear, wrong item type, wrong material class, hidden/no visible price, or no sold/completed evidence.

Composite/set rules:
- If the target is a composite/set, full-set/full-item comps are strongest.
- Same composite type comps are strongest.
- Component-only comps are weak unless clearly the main/valuable component and no full-set comps are found.
- Component-only comps must not be treated as equivalent to full-set comps.
- Component-only comps may contribute to pricing only with Low or Very Low confidence unless supported by stronger comps.
- If all used comps are component-only, confidence must be Very Low or Low.
- If only 1-2 comps are found and they are component-only or weak, confidence must be Very Low.
- If 1-2 comps are found and at least one is a strong full-item/full-set match, confidence may be Low.

Non-composite rules:
- Same item type is required for strong or medium use.
- Related accessory or component-only listings should be weak or not_comparable.
- Material-only or style-only matches should be weak unless item type also matches.

Best Offer rules:
- Best Offer displayed price must not be treated as a guaranteed final accepted price.
- Best Offer uncertain comps may be eligible only with a visible price and must lower confidence.
- If Best Offer uncertainty affects the result, set bestOfferCaveatUsed to true.

Pricing logic:
- Use usable sold/completed comp prices only.
- Weight by similarity to item type, brand/attribution, material, style, size, condition, completeness, and supplied item context.
- Downweight Best Offer uncertainty.
- Exclude materially different items unless clearly identified as weak comps.
- Return one suggested listing price using listing-friendly pricing such as 29.99, 34.99, 44.95, or 49.99.
- suggestedPrice must be a number or null.
- If at least one usable public eBay sold/completed result with a visible price is used, suggestedPrice must be numeric.
- suggestedPriceLabel must be a currency string derived from suggestedPrice, such as "$44.99".
- Do not return labels like "Suggested eBay listing price" instead of a numeric suggestedPrice.
- If fewer than ${WEB_COMPS_TARGET_SOLD_RESULTS} usable results are found, still return a suggestedPrice using the usable results found.

Confidence rules:
- If ${WEB_COMPS_TARGET_SOLD_RESULTS} usable sold/completed results are found, confidence may be High only if similarity is strong.
- If 6-9 usable results are found, confidence should usually be Medium unless comps are weak.
- If 3-5 usable results are found, confidence should usually be Low or Medium depending on similarity.
- If 1-2 usable results are found, return a suggested price but confidence must be Low or Very Low.
- If 0 usable results are found, suggestedPrice must be null, suggestedPriceLabel must be "Not enough public sold evidence", confidence must be Very Low, and usableSoldResultsUsed must be 0.
- Best Offer uncertainty should reduce confidence.
- Confidence may be Medium only with enough medium/strong comps.
- Confidence may be High only with close matches and enough results.
- All or mostly Best Offer uncertain comps should reduce confidence.

Return JSON only in the requested schema.

${formatPromptSection("Target item type", targetContext.itemType)}
${formatPromptSection(
  "Target composite/set status",
  targetContext.isComposite ? "Composite/set or multi-piece item" : "Single item"
)}
${formatPromptSection(
  "Target component terms",
  targetContext.componentTerms.join(", ")
)}
${formatPromptSection("Target brand/maker/attribution", targetContext.attributionPhrase)}
${formatPromptSection(
  "Target unsigned status",
  targetContext.isUnsigned === undefined
    ? undefined
    : targetContext.isUnsigned
      ? "Unsigned or no maker mark"
      : "Signed/marked or unknown"
)}
${formatPromptSection(
  "Target vintage status",
  targetContext.isVintage === undefined
    ? undefined
    : targetContext.isVintage
      ? "Vintage/antique indicated"
      : "Vintage/antique not indicated"
)}
${formatPromptSection("Target material/material appearance", targetContext.materialAppearance)}
${formatPromptSection("Target primary style/form", targetContext.primaryStyleOrForm)}
${formatPromptSection("Target condition notes", targetContext.conditionNotes)}
${formatPromptSection("Target measurements/size", targetContext.measurements)}
${formatPromptSection("Pricing Research query", payload.pricingQuery)}
${formatPromptSection("Narrower query", payload.narrowerQuery)}
${formatPromptSection("Broader query", payload.broaderQuery)}
${formatPromptSection("Public eBay sold search URL", payload.ebaySoldCompsUrl)}
${formatPromptSection("Selling Brief summary", payload.sellingBriefSummary)}
${formatPromptSection("Item Intake - Notes", itemIntake.notes)}
${formatPromptSection("Item Intake - Known Details", itemIntake.knownDetails)}
${formatPromptSection("Item Intake - Condition / Flaws", itemIntake.conditionFlaws)}
${formatPromptSection("Item Intake - Measurements", itemIntake.measurements)}
${formatPromptSection("Item Intake - Markings / Labels", itemIntake.markingsLabels)}`;
}

export function createEmptyWebCompsResult(): WebCompsResult {
  return {
    suggestedPrice: null,
    suggestedPriceLabel: "Not enough public sold evidence",
    confidence: "Very Low",
    usableSoldResultsUsed: 0,
    targetSoldResultsRequested: WEB_COMPS_TARGET_SOLD_RESULTS,
    minimumTargetSoldResults: WEB_COMPS_TARGET_SOLD_RESULTS,
    candidateSourcesReturned: 0,
    eligibleSoldResultsFound: 0,
    selectedSoldResultsUsed: 0,
    basis: "No usable public eBay sold/completed evidence was found.",
    bestOfferCaveatUsed: false,
    sourceUrls: [],
  };
}
