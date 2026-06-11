import {
  buildPayloadMap,
  type PlatformKey,
  type StructuredPayloadMap,
} from "@/lib/lpu/payloadMap";
import {
  buildVendooExtensionPayload,
  type EbayItemSpecifics,
  type VendooExtensionPayload,
  type VendooPhotoPayload,
} from "@/lib/vendoo/extensionPayload";

export type PayloadWarning = {
  code: string;
  message: string;
  platform?: PlatformKey;
  field?: string;
};

export type PayloadPlatformKey = PlatformKey;

export type LpuPayloadPreview = {
  payload: VendooExtensionPayload;
  warnings: PayloadWarning[];
  debug: {
    version: "v2";
    generatedAt: string;
    source: {
      mode: "finalFromBrief";
      hasSellingBrief: boolean;
      hasFinalOutput: boolean;
    };
    platformOrder: PlatformKey[];
    payloadMap: StructuredPayloadMap;
    rawSections: Partial<Record<PlatformKey, string>>;
    rawText: string;
  };
};

const PLATFORM_HEADINGS: Array<{ key: PlatformKey; label: string }> = [
  { key: "ebay", label: "EBAY" },
  { key: "depop", label: "DEPOP" },
  { key: "poshmark", label: "POSHMARK" },
  { key: "mercari", label: "MERCARI" },
  { key: "etsy", label: "ETSY" },
];

const BOUNDARY_FIELD_LABELS = [
  "Title A",
  "Title B",
  "Title",
  "Category",
  "Category Path",
  "Canonical Vendoo Category Path",
  "Canonical Category Path",
  "Vendoo Category Path",
  "Item Specifics",
  "Attributes",
  "Attributes / Key Details",
  "Materials",
  "Tags",
  "Hashtags",
  "Optional Brand Hashtags",
  "Aesthetic Mode",
  "Listing",
  "Description",
  "Condition",
  "Search keywords",
  "Search Keywords",
  "Style Tags",
  "Compact 3-Tag Strategy",
  "Approximate Measurements",
  "Ships within one business day footer",
];

const FOOTER_BOUNDARY_PATTERNS = [
  /ships\s+within\s+one\s+business\s+day/i,
  /displays?\s*&\s*boxes\s+shown\s+are\s+not\s+included/i,
];

const CONTAMINATION_PATTERNS = [
  /\b(?:EBAY|DEPOP|POSHMARK|MERCARI|ETSY)\b/,
  /\bApproximate\s+Measurements\s*:/i,
  /\b(?:Length|Width|Height|Chest|Waist|Inseam|Rise|Sleeve|Shoulder)\s*:\s*[^,\n;]+(?:in|inch|inches|cm)\b/i,
  /\bShips\s+within\s+one\s+business\s+day\b/i,
  /\bDisplays?\s*&\s*boxes\s+shown\s+are\s+not\s+included\b/i,
  /\b(?:Title A|Title B|Title|Category|Item Specifics|Attributes|Materials|Tags|Hashtags|Optional Brand Hashtags|Aesthetic Mode|Listing|Description|Condition|Search keywords|Style Tags|Compact 3-Tag Strategy)\s*:/i,
];

const KNOWN_EXTENSION_ITEM_SPECIFIC_ALIASES: Array<{
  key: keyof EbayItemSpecifics;
  aliases: string[];
}> = [
  { key: "brand", aliases: ["Brand", "Maker", "Signed/Maker", "Signed Maker"] },
  { key: "size", aliases: ["Size"] },
  { key: "color", aliases: ["Color", "Colour"] },
  { key: "condition", aliases: ["Condition", "Item Condition"] },
  {
    key: "signedMaker",
    aliases: ["Signed/Maker", "Signed Maker", "Maker", "Designer"],
  },
  { key: "material", aliases: ["Material"] },
  { key: "styleType", aliases: ["Style/Type", "Style Type"] },
  { key: "fabricType", aliases: ["Fabric Type", "Fabric"] },
  { key: "department", aliases: ["Department", "Jewelry Department"] },
  { key: "jewelryDepartment", aliases: ["Jewelry Department"] },
  { key: "occasion", aliases: ["Occasion"] },
  { key: "style", aliases: ["Style"] },
  { key: "features", aliases: ["Features", "Feature"] },
  { key: "closure", aliases: ["Closure"] },
  { key: "accents", aliases: ["Accents", "Accent"] },
  { key: "theme", aliases: ["Theme", "Style Theme"] },
  { key: "pattern", aliases: ["Pattern"] },
  { key: "dressLength", aliases: ["Dress Length"] },
  { key: "neckline", aliases: ["Neckline"] },
  { key: "sleeveLength", aliases: ["Sleeve Length"] },
  { key: "sleeveType", aliases: ["Sleeve Type"] },
  { key: "fit", aliases: ["Fit"] },
  { key: "sizeType", aliases: ["Size Type"] },
  { key: "vintage", aliases: ["Vintage"] },
  { key: "handmade", aliases: ["Handmade", "Hand Made"] },
  { key: "signed", aliases: ["Signed"] },
  { key: "setIncludes", aliases: ["Set Includes", "Includes"] },
  { key: "baseMetal", aliases: ["Base Metal"] },
  {
    key: "countryRegionOfManufacture",
    aliases: [
      "Country/Region of Manufacture",
      "Country of Manufacture",
      "Region of Manufacture",
    ],
  },
  { key: "mainStone", aliases: ["Main Stone"] },
  { key: "mainStoneColor", aliases: ["Main Stone Color"] },
  { key: "mainStoneCreation", aliases: ["Main Stone Creation"] },
  { key: "shape", aliases: ["Shape"] },
];

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\-:;,.]+/, "")
    .replace(/[\s\-:;,.]+$/, "");
}

function normalizeToken(value: string): string {
  return normalizeValue(value).toLowerCase();
}

function normalizeHeading(line: string): string {
  return line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/[*_`]/g, "")
    .replace(/:$/, "")
    .trim()
    .toUpperCase();
}

function normalizeLabel(value: string): string {
  return normalizeToken(value.replace(/:$/, ""));
}

function toCamelCaseKey(value: string): string {
  const words = normalizeValue(value)
    .replace(/[/()]+/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return "";

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return lower;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
}

function isPlatformHeading(line: string): PlatformKey | null {
  const normalized = normalizeHeading(line);
  return PLATFORM_HEADINGS.find((heading) => heading.label === normalized)?.key ?? null;
}

function isLabelLine(line: string, labels: readonly string[]): boolean {
  const raw = line.trim();
  const normalizedLine = normalizeLabel(raw);

  return labels.some((label) => {
    const normalizedLabel = normalizeLabel(label);
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const labelWithOptionalQualifier = new RegExp(
      `^${escapedLabel}\\s*(?:\\([^)]*\\)\\s*)?:`,
      "i"
    );
    return (
      normalizedLine === normalizedLabel ||
      raw.startsWith(`${label}:`) ||
      labelWithOptionalQualifier.test(raw)
    );
  });
}

function isFooterBoundaryLine(line: string): boolean {
  return FOOTER_BOUNDARY_PATTERNS.some((pattern) => pattern.test(line));
}

function isBoundaryLine(line: string): boolean {
  if (!line.trim()) return false;
  return (
    Boolean(isPlatformHeading(line)) ||
    isLabelLine(line, BOUNDARY_FIELD_LABELS) ||
    isFooterBoundaryLine(line)
  );
}

function isItemSpecificBoundaryLine(line: string): boolean {
  if (!line.trim()) return false;
  return (
    Boolean(isPlatformHeading(line)) ||
    isLabelLine(line, [
      "Title A",
      "Title B",
      "Title",
      "Category",
      "Description",
      "Approximate Measurements",
      "Ships within one business day footer",
    ]) ||
    isFooterBoundaryLine(line)
  );
}

function valueLooksContaminated(value: string): boolean {
  return CONTAMINATION_PATTERNS.some((pattern) => pattern.test(value));
}

function collectLabeledBlock(section: string, labels: readonly string[]): string {
  if (!section.trim()) return "";

  const lines = normalizeLineBreaks(section).split("\n");
  const startIndex = lines.findIndex((line) => isLabelLine(line, labels));
  if (startIndex < 0) return "";

  const startLine = lines[startIndex].trim();
  const colonIndex = startLine.indexOf(":");
  const sameLineValue =
    colonIndex >= 0 ? normalizeValue(startLine.slice(colonIndex + 1)) : "";
  const collected: string[] = [];
  if (sameLineValue) collected.push(sameLineValue);

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const current = lines[index];
    if (isBoundaryLine(current)) break;
    collected.push(current);
  }

  return collected.join("\n").trim();
}

export function parsePlatformSections(
  rawText: string
): {
  sections: Partial<Record<PlatformKey, string>>;
  order: PlatformKey[];
} {
  const lines = normalizeLineBreaks(rawText).split("\n");
  const headingIndexes: Array<{ key: PlatformKey; index: number }> = [];

  lines.forEach((line, index) => {
    const key = isPlatformHeading(line);
    if (key) headingIndexes.push({ key, index });
  });

  const sections: Partial<Record<PlatformKey, string>> = {};
  const order: PlatformKey[] = [];

  headingIndexes.forEach((heading, index) => {
    const nextHeadingIndex = headingIndexes[index + 1]?.index ?? lines.length;
    sections[heading.key] = lines.slice(heading.index, nextHeadingIndex).join("\n").trim();
    order.push(heading.key);
  });

  return { sections, order };
}

function extractSingleLineValue(section: string, labels: readonly string[]): string {
  const block = collectLabeledBlock(section, labels);
  const firstLine = block
    .split("\n")
    .map((line) => normalizeValue(line))
    .find(Boolean);

  return firstLine ?? "";
}

function extractItemSpecificLines(section: string): string[] {
  const lines = normalizeLineBreaks(section).split("\n");
  const startIndex = lines.findIndex((line) => isLabelLine(line, ["Item Specifics"]));

  if (startIndex < 0) return [];

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const current = lines[index];
    if (isItemSpecificBoundaryLine(current)) break;
    if (current.trim()) collected.push(current.trim());
  }

  return collected;
}

function parseItemSpecificMap(
  section: string,
  warnings?: PayloadWarning[]
): Map<string, string> {
  const fields = new Map<string, string>();

  for (const line of extractItemSpecificLines(section)) {
    const cleaned = line.trim().replace(/^[-*]\s+/, "");
    const separatorIndex = cleaned.indexOf(":");
    if (separatorIndex <= 0) {
      if (warnings) {
        addWarning(
          warnings,
          "unparsed_item_specific",
          `Could not parse eBay item specific row: ${cleaned}`,
          "ebay",
          "itemSpecifics"
        );
      }
      continue;
    }

    const key = normalizeLabel(cleaned.slice(0, separatorIndex));
    const value = normalizeValue(cleaned.slice(separatorIndex + 1));
    if (!key || !value || fields.has(key)) continue;
    fields.set(key, value);
  }

  return fields;
}

function parseCompleteItemSpecifics(
  section: string,
  warnings: PayloadWarning[]
): EbayItemSpecifics & Record<string, string> {
  const itemSpecifics: EbayItemSpecifics & Record<string, string> = {
    brand: "",
    size: "",
    color: "",
  };

  for (const line of extractItemSpecificLines(section)) {
    const cleaned = line.trim().replace(/^[-*]\s+/, "");
    const separatorIndex = cleaned.indexOf(":");
    if (separatorIndex <= 0) {
      addWarning(
        warnings,
        "unparsed_item_specific",
        `Could not parse eBay item specific row: ${cleaned}`,
        "ebay",
        "itemSpecifics"
      );
      continue;
    }

    const displayKey = normalizeValue(cleaned.slice(0, separatorIndex));
    const value = normalizeValue(cleaned.slice(separatorIndex + 1));
    if (!displayKey || !value) continue;

    itemSpecifics[displayKey] = value;
    const camelKey = toCamelCaseKey(displayKey);
    if (camelKey && !(camelKey in itemSpecifics)) {
      itemSpecifics[camelKey] = value;
    }
  }

  for (const field of KNOWN_EXTENSION_ITEM_SPECIFIC_ALIASES) {
    const value =
      field.aliases
        .map((alias) => itemSpecifics[alias] || itemSpecifics[toCamelCaseKey(alias)])
        .find((candidate) => typeof candidate === "string" && candidate.trim()) ?? "";
    if (value) itemSpecifics[field.key] = value;
  }

  return itemSpecifics;
}

function parseVendooBaseTags(raw: string | undefined): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  const tokens = raw
    .split(/\r?\n|,|;/)
    .map((token) => token.trim().replace(/^#+/, ""))
    .map((token) => token.replace(/\s+/g, " "))
    .filter(Boolean);

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function buildPreviewPayloadMap(
  output: string,
  sections: Partial<Record<PlatformKey, string>>
): StructuredPayloadMap {
  const ebaySection = sections.ebay ?? "";
  const depopSection = sections.depop ?? "";
  const poshmarkSection = sections.poshmark ?? "";
  const mercariSection = sections.mercari ?? "";
  const etsySection = sections.etsy ?? "";
  const etsyCategoryRaw = collectLabeledBlock(etsySection, ["Category Path", "Category"]);
  const etsyCategory = etsyCategoryRaw
    .split("\n")
    .map((line) => normalizeValue(line))
    .find(Boolean) ?? "";

  return {
    fullOutput: output,
    platforms: {
      ebay: {
        section: ebaySection,
        titleA: collectLabeledBlock(ebaySection, ["Title A"]),
        titleB: collectLabeledBlock(ebaySection, ["Title B"]),
        description: collectLabeledBlock(ebaySection, ["Description"]),
      },
      depop: {
        section: depopSection,
        listing: collectLabeledBlock(depopSection, ["Listing"]),
        hashtags: collectLabeledBlock(depopSection, ["Hashtags"]),
        optionalBrandHashtags: collectLabeledBlock(depopSection, [
          "Optional Brand Hashtags",
        ]),
      },
      poshmark: {
        section: poshmarkSection,
        title: collectLabeledBlock(poshmarkSection, ["Title"]),
        description: collectLabeledBlock(poshmarkSection, ["Description"]),
        styleTags: collectLabeledBlock(poshmarkSection, ["Style Tags", "Style tags"]),
        categoryPath: collectLabeledBlock(poshmarkSection, [
          "Category Path",
          "Category",
        ]),
      },
      mercari: {
        section: mercariSection,
        title: collectLabeledBlock(mercariSection, ["Title"]),
        description: collectLabeledBlock(mercariSection, ["Description"]),
        hashtags: collectLabeledBlock(mercariSection, ["Hashtags"]),
      },
      etsy: {
        section: etsySection,
        title: collectLabeledBlock(etsySection, ["Title"]),
        tags: collectLabeledBlock(etsySection, ["Tags"]),
        description: collectLabeledBlock(etsySection, ["Description"]),
        categoryPath: etsyCategory,
      },
    },
  };
}

function deriveCanonicalCategoryPath(value: string): string {
  const normalized = value
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" > ");
  if (!normalized) return "";

  return normalized.split(">").filter(Boolean).length >= 3 ? normalized : "";
}

function extractDepopSingleLineValue(section: string, labels: readonly string[]): string {
  return extractSingleLineValue(section, labels);
}

function addWarning(
  warnings: PayloadWarning[],
  code: string,
  message: string,
  platform?: PlatformKey,
  field?: string
) {
  warnings.push({ code, message, platform, field });
}

function addMissingWarning(
  warnings: PayloadWarning[],
  platform: PlatformKey,
  field: string,
  label: string
) {
  addWarning(warnings, "missing_field", `Missing ${label}`, platform, field);
}

function normalizeFinalListPriceInput(value?: string | null): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";

  const withoutCurrency = raw.replace(/^\$/, "").trim();
  if (!withoutCurrency || /[^\d.,]/.test(withoutCurrency)) return "";

  let normalized = withoutCurrency;
  const hasDot = normalized.includes(".");
  const commaCount = (normalized.match(/,/g) ?? []).length;
  const commaDecimalMatch = normalized.match(/^(\d+),(\d{1,2})$/);

  if (hasDot) {
    normalized = normalized.replace(/,/g, "");
  } else if (commaDecimalMatch && commaCount === 1) {
    normalized = `${commaDecimalMatch[1]}.${commaDecimalMatch[2]}`;
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  const match = normalized.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return "";

  const integerPart = match[1].replace(/^0+(\d)/, "$1");
  const decimalPart = match[2];
  const resolvedPrice = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
  const numericPrice = Number(resolvedPrice);

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return "";
  return resolvedPrice;
}

function formatAdjustedPriceForPayload(value: number): string {
  return value.toFixed(2);
}

function addWarningsForPayloadMap(
  payloadMap: StructuredPayloadMap,
  sections: Partial<Record<PlatformKey, string>>,
  warnings: PayloadWarning[]
) {
  for (const heading of PLATFORM_HEADINGS) {
    if (!sections[heading.key]?.trim()) {
      addWarning(
        warnings,
        "missing_platform_section",
        `Platform section missing: ${heading.label}`,
        heading.key
      );
    }
  }

  if (!payloadMap.platforms.ebay.titleA) {
    addMissingWarning(warnings, "ebay", "titleA", "eBay Title A");
  }
  if (!payloadMap.platforms.ebay.titleB) {
    addMissingWarning(warnings, "ebay", "titleB", "eBay Title B");
  }
  if (!payloadMap.platforms.ebay.description) {
    addMissingWarning(warnings, "ebay", "description", "eBay description");
  }

  const ebayCategory = extractSingleLineValue(payloadMap.platforms.ebay.section, [
    "Category",
    "eBay Category",
  ]);
  if (!ebayCategory) addMissingWarning(warnings, "ebay", "category", "eBay category");
  if (
    payloadMap.platforms.ebay.section.includes("Item Specifics") &&
    parseItemSpecificMap(payloadMap.platforms.ebay.section).size === 0
  ) {
    addWarning(
      warnings,
      "could_not_parse_item_specifics",
      "Could not parse item specifics",
      "ebay",
      "itemSpecifics"
    );
  }

  addContaminationWarnings(payloadMap, warnings);

  if (!payloadMap.platforms.depop.listing) {
    addMissingWarning(warnings, "depop", "listing", "Depop listing");
  }
  if (!payloadMap.platforms.depop.hashtags) {
    addMissingWarning(warnings, "depop", "hashtags", "Depop hashtags");
  }

  if (!payloadMap.platforms.poshmark.title) {
    addMissingWarning(warnings, "poshmark", "title", "Poshmark title");
  }
  if (!payloadMap.platforms.poshmark.description) {
    addMissingWarning(warnings, "poshmark", "description", "Poshmark description");
  }
  const poshmarkSearchKeywords = extractSingleLineValue(
    payloadMap.platforms.poshmark.section,
    ["Search keywords", "Search Keywords"]
  );
  if (!poshmarkSearchKeywords) {
    addMissingWarning(
      warnings,
      "poshmark",
      "searchKeywords",
      "Poshmark Search keywords line"
    );
  }

  if (!payloadMap.platforms.mercari.title) {
    addMissingWarning(warnings, "mercari", "title", "Mercari title");
  }
  if (!payloadMap.platforms.mercari.description) {
    addMissingWarning(warnings, "mercari", "description", "Mercari description");
  }
  if (!payloadMap.platforms.mercari.hashtags) {
    addMissingWarning(warnings, "mercari", "hashtags", "Mercari hashtags");
  }

  if (!payloadMap.platforms.etsy.title) {
    addMissingWarning(warnings, "etsy", "title", "Etsy title");
  }
  if (!payloadMap.platforms.etsy.tags) {
    addMissingWarning(warnings, "etsy", "tags", "Etsy tags");
  }
  if (!payloadMap.platforms.etsy.description) {
    addMissingWarning(warnings, "etsy", "description", "Etsy description");
  }

  const etsyTags = parseVendooBaseTags(payloadMap.platforms.etsy.tags);
  if (payloadMap.platforms.etsy.tags && etsyTags.length !== 13) {
    addWarning(
      warnings,
      "etsy_tags_count",
      `Etsy tags count is ${etsyTags.length}; expected exactly 13`,
      "etsy",
      "tags"
    );
  }
  etsyTags
    .filter((tag) => tag.length > 20)
    .forEach((tag) => {
      addWarning(
        warnings,
        "etsy_tag_too_long",
        `Etsy tag is longer than 20 characters: ${tag}`,
        "etsy",
        "tags"
      );
    });

  for (const platform of PLATFORM_HEADINGS.map((heading) => heading.key)) {
    const section = payloadMap.platforms[platform].section;
    if (
      section.trim() &&
      !/approximate\s+measurements\s*:/i.test(section)
    ) {
      addMissingWarning(
        warnings,
        platform,
        "approximateMeasurements",
        `${PLATFORM_HEADINGS.find((heading) => heading.key === platform)?.label} Approximate Measurements block`
      );
    }
  }
}

function addContaminationWarning(
  warnings: PayloadWarning[],
  platform: PlatformKey,
  field: string,
  message: string
) {
  addWarning(warnings, "field_boundary_contamination", message, platform, field);
}

function addContaminationWarnings(
  payloadMap: StructuredPayloadMap,
  warnings: PayloadWarning[]
) {
  const checks: Array<{
    platform: PlatformKey;
    field: string;
    value: string | string[];
    list?: boolean;
  }> = [
    { platform: "ebay", field: "titleA", value: payloadMap.platforms.ebay.titleA },
    { platform: "ebay", field: "titleB", value: payloadMap.platforms.ebay.titleB },
    { platform: "ebay", field: "description", value: payloadMap.platforms.ebay.description },
    { platform: "depop", field: "listing", value: payloadMap.platforms.depop.listing },
    { platform: "depop", field: "hashtags", value: payloadMap.platforms.depop.hashtags, list: true },
    {
      platform: "depop",
      field: "optionalBrandHashtags",
      value: payloadMap.platforms.depop.optionalBrandHashtags,
      list: true,
    },
    { platform: "poshmark", field: "title", value: payloadMap.platforms.poshmark.title },
    {
      platform: "poshmark",
      field: "description",
      value: payloadMap.platforms.poshmark.description,
    },
    {
      platform: "poshmark",
      field: "styleTags",
      value: parseVendooBaseTags(payloadMap.platforms.poshmark.styleTags),
      list: true,
    },
    { platform: "mercari", field: "title", value: payloadMap.platforms.mercari.title },
    {
      platform: "mercari",
      field: "description",
      value: payloadMap.platforms.mercari.description,
    },
    {
      platform: "mercari",
      field: "hashtags",
      value: payloadMap.platforms.mercari.hashtags,
      list: true,
    },
    { platform: "etsy", field: "title", value: payloadMap.platforms.etsy.title },
    {
      platform: "etsy",
      field: "tags",
      value: parseVendooBaseTags(payloadMap.platforms.etsy.tags),
      list: true,
    },
    { platform: "etsy", field: "description", value: payloadMap.platforms.etsy.description },
  ];

  for (const check of checks) {
    const values = Array.isArray(check.value) ? check.value : [check.value];
    if (!values.some((value) => valueLooksContaminated(String(value ?? "")))) continue;
    addContaminationWarning(
      warnings,
      check.platform,
      check.field,
      `${check.field} contains text that looks like a later section, measurement, footer, or platform boundary.`
    );
  }
}

function addItemSpecificFillabilityWarning(
  itemSpecifics: Record<string, string>,
  warnings: PayloadWarning[]
) {
  const knownKeys = new Set<string>();
  for (const field of KNOWN_EXTENSION_ITEM_SPECIFIC_ALIASES) {
    knownKeys.add(String(field.key));
    field.aliases.forEach((alias) => {
      knownKeys.add(alias);
      knownKeys.add(toCamelCaseKey(alias));
    });
  }

  const extraKeys = Object.keys(itemSpecifics).filter((key) => {
    if (!itemSpecifics[key]?.trim()) return false;
    return !knownKeys.has(key);
  });

  if (!extraKeys.length) return;

  addWarning(
    warnings,
    "ebay_item_specifics_fillability",
    `Full eBay Item Specifics are preserved in payload preview; some keys may not autofill until extension field matching supports them. Extra keys: ${extraKeys
      .slice(0, 8)
      .join(", ")}${extraKeys.length > 8 ? ", ..." : ""}`,
    "ebay",
    "itemSpecifics"
  );
}

function mergeCompleteEbayItemSpecifics(
  payload: VendooExtensionPayload,
  itemSpecifics: EbayItemSpecifics & Record<string, string>
): VendooExtensionPayload {
  const merged = {
    ...payload.marketplaces.ebay.itemSpecifics,
    ...itemSpecifics,
  };

  const ebay = {
    ...payload.marketplaces.ebay,
    itemSpecifics: merged,
  };

  return {
    ...payload,
    marketplaces: {
      ...payload.marketplaces,
      ebay,
    },
    marketplaceFields: {
      ...payload.marketplaceFields,
      ebay,
    },
  };
}

function mergeCleanPoshmarkStyleTags(
  payload: VendooExtensionPayload,
  styleTags: string[]
): VendooExtensionPayload {
  if (!payload.marketplaces.poshmark && !payload.marketplaceFields?.poshmark) {
    return payload;
  }

  const marketplaces: VendooExtensionPayload["marketplaces"] = {
    ...payload.marketplaces,
    ebay: payload.marketplaces.ebay,
    ...(payload.marketplaces.poshmark
      ? {
          poshmark: {
            ...payload.marketplaces.poshmark,
            styleTags,
          },
        }
      : {}),
  };
  const marketplaceFields = payload.marketplaceFields?.poshmark
    ? {
        ...payload.marketplaceFields,
        ebay: payload.marketplaceFields.ebay,
        poshmark: {
          ...payload.marketplaceFields.poshmark,
          styleTags,
        },
      }
    : payload.marketplaceFields;

  return {
    ...payload,
    marketplaces,
    ...(marketplaceFields ? { marketplaceFields } : {}),
  };
}

function buildExtensionPayloadFromPayloadMap(
  payloadMap: StructuredPayloadMap,
  completeItemSpecifics: EbayItemSpecifics & Record<string, string>,
  photos?: VendooPhotoPayload[],
  options?: {
    resolvedPrice?: string;
    adjustedPrice?: string;
  }
): VendooExtensionPayload {
  const ebaySection = payloadMap.platforms.ebay.section;
  const itemSpecifics = completeItemSpecifics;
  const category = extractSingleLineValue(ebaySection, ["Category", "eBay Category"]);
  const explicitCanonicalVendooCategoryPath = extractSingleLineValue(ebaySection, [
    "Canonical Vendoo Category Path",
    "Canonical Category Path",
    "Vendoo Category Path",
    "Category Path",
  ]);
  const canonicalVendooCategoryPath =
    explicitCanonicalVendooCategoryPath || deriveCanonicalCategoryPath(category);
  const depopSection = payloadMap.platforms.depop.section;
  const depopBrand =
    extractDepopSingleLineValue(depopSection, ["Brand"]) || itemSpecifics.brand;
  const depopSize =
    extractDepopSingleLineValue(depopSection, ["Size"]) || itemSpecifics.size;
  const depopStyle =
    extractDepopSingleLineValue(depopSection, ["Style"]) ||
    itemSpecifics.styleType ||
    itemSpecifics.style ||
    "";
  const cleanPoshmarkStyleTags = parseVendooBaseTags(
    payloadMap.platforms.poshmark.styleTags
  );

  const payload = buildVendooExtensionPayload({
    title: payloadMap.platforms.ebay.titleA || payloadMap.platforms.ebay.titleB,
    titleA: payloadMap.platforms.ebay.titleA,
    titleB: payloadMap.platforms.ebay.titleB,
    description: payloadMap.platforms.ebay.description,
    category,
    canonicalVendooCategoryPath,
    itemSpecifics,
    photos,
    resolvedPrice: options?.resolvedPrice,
    depop: {
      listing: payloadMap.platforms.depop.listing,
      description: payloadMap.platforms.depop.listing,
      hashtags: payloadMap.platforms.depop.hashtags,
      optionalBrandHashtags: payloadMap.platforms.depop.optionalBrandHashtags,
      ...(depopBrand ? { brand: depopBrand } : {}),
      ...(depopSize ? { size: depopSize } : {}),
      ...(depopStyle ? { style: depopStyle } : {}),
    },
    poshmark: {
      title: payloadMap.platforms.poshmark.title,
      description: payloadMap.platforms.poshmark.description,
      styleTags: cleanPoshmarkStyleTags,
      categoryPath: payloadMap.platforms.poshmark.categoryPath,
      adjustedPrice: options?.adjustedPrice,
    },
    etsy: {
      title: payloadMap.platforms.etsy.title,
      description: payloadMap.platforms.etsy.description,
      tags: parseVendooBaseTags(payloadMap.platforms.etsy.tags),
      categoryPath: payloadMap.platforms.etsy.categoryPath,
      adjustedPrice: options?.adjustedPrice,
      materials: extractSingleLineValue(payloadMap.platforms.etsy.section, [
        "Materials",
      ]),
      style: itemSpecifics.styleType || itemSpecifics.style,
      theme: itemSpecifics.theme,
      occasion: itemSpecifics.occasion,
      gemstone: itemSpecifics.mainStone,
      gemColor: itemSpecifics.mainStoneColor,
      age: itemSpecifics.vintage,
    },
  });

  return mergeCleanPoshmarkStyleTags(
    addAdjustedPriceCompatibilityPaths(
      mergeCompleteEbayItemSpecifics(payload, completeItemSpecifics),
      options?.adjustedPrice
    ),
    cleanPoshmarkStyleTags
  );
}

function addAdjustedPriceCompatibilityPaths(
  payload: VendooExtensionPayload,
  adjustedPrice?: string
): VendooExtensionPayload {
  if (!adjustedPrice) return payload;

  const etsy = payload.etsy
    ? {
        ...payload.etsy,
        adjustedPrice,
      }
    : undefined;
  const poshmark = payload.marketplaces.poshmark
    ? {
        ...payload.marketplaces.poshmark,
        adjustedPrice,
      }
    : undefined;

  return {
    ...payload,
    ...(etsy ? { etsy } : {}),
    ...(poshmark ? { poshmark } : {}),
    marketplaces: {
      ...payload.marketplaces,
      ...(etsy ? { etsy } : {}),
      ...(poshmark ? { poshmark } : {}),
    },
    marketplaceFields: {
      ...payload.marketplaceFields,
      ...(etsy ? { etsy } : {}),
      ...(poshmark ? { poshmark } : {}),
    },
  } as VendooExtensionPayload;
}

export function buildLpuPayloadPreview(input: {
  finalOutput: string;
  hasSellingBrief: boolean;
  generatedAt?: string;
  finalListPriceInput?: string;
  photos?: VendooPhotoPayload[];
  photoWarnings?: PayloadWarning[];
}): LpuPayloadPreview {
  const rawText = normalizeLineBreaks(input.finalOutput);
  const { sections, order } = parsePlatformSections(rawText);
  buildPayloadMap(rawText, sections);
  const payloadMap = buildPreviewPayloadMap(rawText, sections);
  const warnings: PayloadWarning[] = [];
  const completeItemSpecifics = parseCompleteItemSpecifics(
    payloadMap.platforms.ebay.section,
    warnings
  );

  addWarningsForPayloadMap(payloadMap, sections, warnings);
  addItemSpecificFillabilityWarning(completeItemSpecifics, warnings);
  if (Array.isArray(input.photoWarnings)) {
    warnings.push(...input.photoWarnings);
  }
  const resolvedPrice = normalizeFinalListPriceInput(input.finalListPriceInput);
  const adjustedPrice = resolvedPrice
    ? formatAdjustedPriceForPayload(Number(resolvedPrice) * 1.15)
    : "";
  if (
    typeof input.finalListPriceInput === "string" &&
    input.finalListPriceInput.trim().length > 0 &&
    !resolvedPrice
  ) {
    addWarning(
      warnings,
      "invalid_final_list_price",
      "Final List Price is not a valid positive listing price, so no resolvedPrice will be sent.",
      undefined,
      "resolvedPrice"
    );
  }

  const validPhotoCount = Array.isArray(input.photos)
    ? input.photos.filter(
        (photo) =>
          Boolean(photo?.dataUrl?.trim()) ||
          Boolean(photo?.storagePath?.trim()) ||
          Boolean(photo?.imageUrl?.trim()) ||
          Boolean(photo?.signedUrl?.trim())
      ).length
    : 0;
  const invalidPhotoCount = Array.isArray(input.photos)
    ? input.photos.length - validPhotoCount
    : 0;
  if (invalidPhotoCount > 0) {
    addWarning(
      warnings,
      "invalid_photo_payload",
      `${invalidPhotoCount} photo payload entr${
        invalidPhotoCount === 1 ? "y was" : "ies were"
      } omitted because no dataUrl, storagePath, imageUrl, or signedUrl was present.`,
      undefined,
      "photos"
    );
  }

  return {
    payload: buildExtensionPayloadFromPayloadMap(
      payloadMap,
      completeItemSpecifics,
      input.photos,
      { resolvedPrice, adjustedPrice }
    ),
    warnings,
    debug: {
      version: "v2",
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      source: {
        mode: "finalFromBrief",
        hasSellingBrief: input.hasSellingBrief,
        hasFinalOutput: rawText.trim().length > 0,
      },
      platformOrder: order,
      payloadMap,
      rawSections: sections,
      rawText,
    },
  };
}
