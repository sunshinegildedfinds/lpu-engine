export type PlatformKey = "ebay" | "depop" | "poshmark" | "mercari" | "etsy";

export type PayloadSections = Partial<Record<PlatformKey, string>>;

export type EbayPayload = {
  section: string;
  titleA: string;
  titleB: string;
  description: string;
};

export type DepopPayload = {
  section: string;
  listing: string;
  hashtags: string;
  optionalBrandHashtags: string;
};

export type PoshmarkPayload = {
  section: string;
  title: string;
  description: string;
  styleTags: string;
  categoryPath: string;
};

export type MercariPayload = {
  section: string;
  title: string;
  description: string;
  hashtags: string;
};

export type EtsyPayload = {
  section: string;
  title: string;
  tags: string;
  description: string;
};

export type StructuredPayloadMap = {
  fullOutput: string;
  platforms: {
    ebay: EbayPayload;
    depop: DepopPayload;
    poshmark: PoshmarkPayload;
    mercari: MercariPayload;
    etsy: EtsyPayload;
  };
};

const FIELD_LABELS = {
  ebay: {
    titleA: ["Title A"],
    titleB: ["Title B"],
    description: ["Description"],
  },
  depop: {
    listing: ["Listing"],
    hashtags: ["Hashtags"],
    optionalBrandHashtags: ["Optional Brand Hashtags"],
  },
  poshmark: {
    title: ["Title"],
    description: ["Description"],
    styleTags: ["Style Tags", "Style tags"],
    categoryPath: ["Category Path", "Category"],
  },
  mercari: {
    title: ["Title"],
    description: ["Description"],
    hashtags: ["Hashtags"],
  },
  etsy: {
    title: ["Title"],
    tags: ["Tags"],
    description: ["Description"],
  },
} as const;

const KNOWN_LABELS = Array.from(
  new Set(
    Object.values(FIELD_LABELS).flatMap((platformLabels) =>
      Object.values(platformLabels).flatMap((labels) => labels)
    )
  )
);

function normalizeLabelLine(line: string): string {
  return line.trim().replace(/:$/, "");
}

function lineMatchesAnyLabel(line: string, labels: readonly string[]): boolean {
  const trimmed = line.trim();
  const normalized = normalizeLabelLine(trimmed);

  return labels.some((label) => normalized === label || trimmed.startsWith(`${label}:`));
}

function isKnownLabelLine(line: string): boolean {
  return lineMatchesAnyLabel(line, KNOWN_LABELS);
}

export function extractLabeledBlock(section: string, labels: readonly string[]): string {
  if (!section?.trim()) return "";

  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => lineMatchesAnyLabel(line, labels));

  if (startIndex === -1) return "";

  const startLine = lines[startIndex].trim();
  const colonIndex = startLine.indexOf(":");
  const firstValue = colonIndex >= 0 ? startLine.slice(colonIndex + 1).trim() : "";

  const collected: string[] = [];
  if (firstValue) {
    collected.push(firstValue);
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const currentLine = lines[i];

    if (isKnownLabelLine(currentLine)) {
      break;
    }

    collected.push(currentLine);
  }

  return collected.join("\n").trim();
}

function countReadyFields(values: string[]): number {
  return values.filter((value) => value.trim().length > 0).length;
}

export function buildPayloadMap(
  output: string,
  sections: PayloadSections = {}
): StructuredPayloadMap {
  const ebaySection = sections.ebay ?? "";
  const depopSection = sections.depop ?? "";
  const poshmarkSection = sections.poshmark ?? "";
  const mercariSection = sections.mercari ?? "";
  const etsySection = sections.etsy ?? "";

  return {
    fullOutput: output,
    platforms: {
      ebay: {
        section: ebaySection,
        titleA: extractLabeledBlock(ebaySection, FIELD_LABELS.ebay.titleA),
        titleB: extractLabeledBlock(ebaySection, FIELD_LABELS.ebay.titleB),
        description: extractLabeledBlock(ebaySection, FIELD_LABELS.ebay.description),
      },
      depop: {
        section: depopSection,
        listing: extractLabeledBlock(depopSection, FIELD_LABELS.depop.listing),
        hashtags: extractLabeledBlock(depopSection, FIELD_LABELS.depop.hashtags),
        optionalBrandHashtags: extractLabeledBlock(
          depopSection,
          FIELD_LABELS.depop.optionalBrandHashtags
        ),
      },
      poshmark: {
        section: poshmarkSection,
        title: extractLabeledBlock(poshmarkSection, FIELD_LABELS.poshmark.title),
        description: extractLabeledBlock(
          poshmarkSection,
          FIELD_LABELS.poshmark.description
        ),
        styleTags: extractLabeledBlock(
          poshmarkSection,
          FIELD_LABELS.poshmark.styleTags
        ),
        categoryPath: extractLabeledBlock(
          poshmarkSection,
          FIELD_LABELS.poshmark.categoryPath
        ),
      },
      mercari: {
        section: mercariSection,
        title: extractLabeledBlock(mercariSection, FIELD_LABELS.mercari.title),
        description: extractLabeledBlock(
          mercariSection,
          FIELD_LABELS.mercari.description
        ),
        hashtags: extractLabeledBlock(mercariSection, FIELD_LABELS.mercari.hashtags),
      },
      etsy: {
        section: etsySection,
        title: extractLabeledBlock(etsySection, FIELD_LABELS.etsy.title),
        tags: extractLabeledBlock(etsySection, FIELD_LABELS.etsy.tags),
        description: extractLabeledBlock(etsySection, FIELD_LABELS.etsy.description),
      },
    },
  };
}

export function buildCopyMap(payloadMap: StructuredPayloadMap): Record<string, string> {
  return {
    full: payloadMap.fullOutput,

    ebay: payloadMap.platforms.ebay.section,
    "ebay-title-a": payloadMap.platforms.ebay.titleA,
    "ebay-title-b": payloadMap.platforms.ebay.titleB,
    "ebay-description": payloadMap.platforms.ebay.description,

    depop: payloadMap.platforms.depop.section,
    "depop-listing": payloadMap.platforms.depop.listing,
    "depop-hashtags": payloadMap.platforms.depop.hashtags,
    "depop-brand-hashtags": payloadMap.platforms.depop.optionalBrandHashtags,

    poshmark: payloadMap.platforms.poshmark.section,
    "poshmark-title": payloadMap.platforms.poshmark.title,
    "poshmark-description": payloadMap.platforms.poshmark.description,
    "poshmark-style-tags": payloadMap.platforms.poshmark.styleTags,
    "poshmark-category-path": payloadMap.platforms.poshmark.categoryPath,

    mercari: payloadMap.platforms.mercari.section,
    "mercari-title": payloadMap.platforms.mercari.title,
    "mercari-description": payloadMap.platforms.mercari.description,
    "mercari-hashtags": payloadMap.platforms.mercari.hashtags,

    etsy: payloadMap.platforms.etsy.section,
    "etsy-title": payloadMap.platforms.etsy.title,
    "etsy-tags": payloadMap.platforms.etsy.tags,
    "etsy-description": payloadMap.platforms.etsy.description,
  };
}

export function buildPayloadSummary(
  payloadMap: StructuredPayloadMap
): Record<PlatformKey, number> {
  return {
    ebay: countReadyFields([
      payloadMap.platforms.ebay.section,
      payloadMap.platforms.ebay.titleA,
      payloadMap.platforms.ebay.titleB,
      payloadMap.platforms.ebay.description,
    ]),
    depop: countReadyFields([
      payloadMap.platforms.depop.section,
      payloadMap.platforms.depop.listing,
      payloadMap.platforms.depop.hashtags,
      payloadMap.platforms.depop.optionalBrandHashtags,
    ]),
    poshmark: countReadyFields([
      payloadMap.platforms.poshmark.section,
      payloadMap.platforms.poshmark.title,
      payloadMap.platforms.poshmark.description,
      payloadMap.platforms.poshmark.styleTags,
      payloadMap.platforms.poshmark.categoryPath,
    ]),
    mercari: countReadyFields([
      payloadMap.platforms.mercari.section,
      payloadMap.platforms.mercari.title,
      payloadMap.platforms.mercari.description,
      payloadMap.platforms.mercari.hashtags,
    ]),
    etsy: countReadyFields([
      payloadMap.platforms.etsy.section,
      payloadMap.platforms.etsy.title,
      payloadMap.platforms.etsy.tags,
      payloadMap.platforms.etsy.description,
    ]),
  };
}
