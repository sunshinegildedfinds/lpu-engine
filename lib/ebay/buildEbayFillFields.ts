import type { EbayDraftInput } from "@/lib/ebay/generateDraft";

export type EbayMappedFillFields = {
  category: string;
  itemSpecifics: {
    brand: string;
    size: string;
    color: string;
  };
};

function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function mapCategoryFromItemType(itemType: string): string {
  const normalized = clean(itemType).toLowerCase();

  if (normalized.includes("dress")) {
    return "Women > Dresses";
  }

  if (normalized.includes("skirt")) {
    return "Women > Skirts";
  }

  if (normalized.includes("blouse") || normalized.includes("top")) {
    return "Women > Tops";
  }

  return "Women > Unspecified";
}

export function buildEbayFillFields(input: EbayDraftInput): EbayMappedFillFields {
  return {
    category: mapCategoryFromItemType(input.itemType),
    itemSpecifics: {
      brand: clean(input.brand),
      size: clean(input.size),
      color: clean(input.color),
    },
  };
}
