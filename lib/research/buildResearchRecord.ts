import type { StructuredPayloadMap } from "@/lib/lpu/payloadMap";
import type { ResearchRecord } from "@/lib/research/types";

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "from",
  "this",
  "that",
  "size",
  "new",
  "vintage",
]);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractSingleLineValue(section: string, labels: readonly string[]): string {
  if (!section.trim()) return "";
  const lines = section.replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      const normalizedLine = line.toLowerCase();
      if (
        normalizedLine === normalizedLabel ||
        normalizedLine.startsWith(`${normalizedLabel}:`)
      ) {
        const colonIndex = line.indexOf(":");
        const sameLine =
          colonIndex >= 0 ? normalizeText(line.slice(colonIndex + 1)) : "";
        if (sameLine) return sameLine;

        for (let next = index + 1; next < lines.length; next += 1) {
          const valueLine = normalizeText(lines[next]);
          if (!valueLine) continue;
          if (/^[A-Za-z][A-Za-z /&'-]+:/.test(valueLine)) break;
          return valueLine;
        }
      }
    }
  }

  return "";
}

function tokenizeTitleKeywords(value: string): string[] {
  const tokens = value
    .split(/[^A-Za-z0-9]+/g)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 8);
}

function categoryLeaf(category: string): string {
  const parts = category
    .split(">")
    .map((part) => normalizeText(part))
    .filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function toSearchSeed(values: string[]): string[] {
  const seen = new Set<string>();
  const seed: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    seed.push(normalized);
  }
  return seed;
}

function buildQuery(terms: string[]): string {
  return normalizeText(terms.join(" "));
}

export function buildPublicEbayCompLinks(researchRecord: Pick<ResearchRecord, "primaryQuery">): {
  soldCompLink: string;
  completedCompLink: string;
  activeCompLink?: string;
} {
  const query = encodeURIComponent(normalizeText(researchRecord.primaryQuery));
  const base = `https://www.ebay.com/sch/i.html?_nkw=${query}`;
  return {
    soldCompLink: `${base}&LH_Sold=1&LH_Complete=1`,
    completedCompLink: `${base}&LH_Complete=1`,
    activeCompLink: `${base}`,
  };
}

export function buildResearchRecordFromValidatedPayload(
  validatedPayload: StructuredPayloadMap
): ResearchRecord {
  const ebay = validatedPayload.platforms.ebay;
  const section = ebay.section ?? "";
  const brand = extractSingleLineValue(section, ["Brand", "Maker", "Signed/Maker"]);
  const category =
    extractSingleLineValue(section, ["Category", "eBay Category"]) || "";
  const styleType = extractSingleLineValue(section, ["Type", "Style/Type", "Style Type"]);
  const model = extractSingleLineValue(section, ["Model"]);
  const color = extractSingleLineValue(section, ["Color", "Colour"]);
  const material = extractSingleLineValue(section, ["Material"]);
  const pattern = extractSingleLineValue(section, ["Pattern"]);

  const titleSource = normalizeText(`${ebay.titleA} ${ebay.titleB}`);
  const titleKeywords = tokenizeTitleKeywords(titleSource);
  const itemType = styleType || categoryLeaf(category);
  const standoutAttributes = [color, material, pattern].filter(Boolean);

  const searchSeed = toSearchSeed([
    brand,
    itemType,
    ...titleKeywords,
    model,
    ...standoutAttributes,
  ]);

  const primaryQuery = buildQuery(
    toSearchSeed([brand, itemType, model, ...standoutAttributes]).slice(0, 8)
  );

  const alternateQueries = [
    buildQuery(toSearchSeed([brand, itemType, ...titleKeywords]).slice(0, 10)),
    buildQuery(toSearchSeed([itemType, ...standoutAttributes, model]).slice(0, 10)),
  ]
    .map((query) => normalizeText(query))
    .filter(Boolean)
    .filter((query, index, arr) => arr.indexOf(query) === index)
    .filter((query) => query !== primaryQuery);

  const links = buildPublicEbayCompLinks({ primaryQuery });

  const imageRefs =
    Array.isArray((validatedPayload as unknown as { imageRefs?: string[] }).imageRefs)
      ? ((validatedPayload as unknown as { imageRefs?: string[] }).imageRefs ?? []).filter(
          (ref): ref is string => typeof ref === "string" && !!normalizeText(ref)
        )
      : [];

  return {
    searchSeed,
    primaryQuery,
    alternateQueries,
    brand: normalizeText(brand),
    category: normalizeText(category),
    itemType: normalizeText(itemType),
    keyAttributes: toSearchSeed([model, ...standoutAttributes]),
    imageRefs,
    soldCompLink: links.soldCompLink,
    completedCompLink: links.completedCompLink,
    activeCompLink: links.activeCompLink,
    soldCompSummary: null,
    activeCompSummary: null,
    matchConfidence: null,
    researchNotes: null,
  };
}

