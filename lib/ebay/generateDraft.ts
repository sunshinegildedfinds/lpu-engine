const STANDARD_FOOTER =
  "Ships within one day after payment is received. Please see all pictures before purchasing. Stock photo is for reference only and may differ slightly from the actual item.";

export type EbayDraftInput = {
  brand: string;
  itemType: string;
  size: string;
  color: string;
  feature1: string;
  feature2: string;
  length: string;
  pitToPit: string;
  waist: string;
};

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function joinTitleParts(parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

function clampTitle(title: string, max = 80): string {
  const cleaned = clean(title);
  if (cleaned.length <= max) return cleaned;

  const words = cleaned.split(" ");
  let result = "";

  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > max) break;
    result = next;
  }

  return result || cleaned.slice(0, max).trim();
}

export function buildEbayTitleA(input: EbayDraftInput): string {
  const brand = clean(input.brand);
  const itemType = clean(input.itemType);
  const size = clean(input.size);
  const color = clean(input.color);
  const feature1 = clean(input.feature1);
  const feature2 = clean(input.feature2);

  const baseTitle = joinTitleParts([
    brand,
    itemType,
    color,
    size ? `Size ${size}` : "",
    feature1,
    feature2,
  ]);

  return clampTitle(baseTitle, 80);
}

export function buildEbayTitleB(input: EbayDraftInput): string {
  const brand = clean(input.brand);
  const itemType = clean(input.itemType);
  const size = clean(input.size);
  const color = clean(input.color);
  const feature1 = clean(input.feature1);
  const feature2 = clean(input.feature2);

  const baseTitle = joinTitleParts([
    feature1,
    feature2,
    brand,
    color,
    itemType,
    size ? `Size ${size}` : "",
  ]);

  return clampTitle(baseTitle, 80);
}

export function buildMeasurementsBlock(input: EbayDraftInput): string {
  const lines: string[] = [];

  if (clean(input.length)) lines.push(`Length - ${clean(input.length)}`);
  if (clean(input.pitToPit)) lines.push(`Pit to Pit - ${clean(input.pitToPit)}`);
  if (clean(input.waist)) lines.push(`Waist - ${clean(input.waist)}`);

  if (lines.length === 0) {
    return "Approximate Measurements:\nNot provided (see photos)";
  }

  return `Approximate Measurements:\n${lines.join("\n")}`;
}

export function buildEbayDescription(input: EbayDraftInput): string {
  const brand = clean(input.brand);
  const itemType = clean(input.itemType);
  const color = clean(input.color);
  const feature1 = clean(input.feature1);
  const feature2 = clean(input.feature2);

  const firstSentence = clean(
    [brand, itemType, color ? `in ${color}` : "", feature1, feature2]
      .filter(Boolean)
      .join(" ")
  );

  const descriptionLead =
    firstSentence || "Pre-owned item with details shown in photos.";

  return `${descriptionLead}.

${buildMeasurementsBlock(input)}

${STANDARD_FOOTER}`;
}

export function getStandardFooter(): string {
  return STANDARD_FOOTER;
}