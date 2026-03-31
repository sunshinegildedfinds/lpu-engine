export type EbayItemSpecifics = {
  brand: string;
  size: string;
  color: string;
  signedMaker?: string;
  material?: string;
  styleType?: string;
  fabricType?: string;
  department?: string;
  jewelryDepartment?: string;
  occasion?: string;
  style?: string;
  features?: string;
  closure?: string;
  accents?: string;
  theme?: string;
  pattern?: string;
  dressLength?: string;
  neckline?: string;
  sleeveLength?: string;
  sleeveType?: string;
  fit?: string;
  sizeType?: string;
  vintage?: string;
  handmade?: string;
  signed?: string;
  setIncludes?: string;
  baseMetal?: string;
  countryRegionOfManufacture?: string;
  mainStone?: string;
  mainStoneColor?: string;
  mainStoneCreation?: string;
  shape?: string;
};

export type VendooPhotoPayload = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

export type VendooResearchMeta = {
  searchSeed: string[];
  primaryQuery: string;
  alternateQueries: string[];
  soldCompLink: string;
  completedCompLink: string;
  activeCompLink?: string;
  matchConfidence: string | null;
  researchNotes: string | null;
};

export type VendooPricingMeta = {
  selectedPrice: string;
  floorPrice: string;
  pricingNote: string;
  source: "manual" | "suggested" | null;
};

export type VendooExtensionPayload = {
  photos?: VendooPhotoPayload[];
  researchMeta?: VendooResearchMeta;
  pricing?: VendooPricingMeta;
  resolvedPrice?: string;
  marketplaces: {
    ebay: {
      title: string;
      titleA: string;
      titleB: string;
      description: string;
      category: string;
      canonicalVendooCategoryPath?: string;
      itemSpecifics: EbayItemSpecifics;
    };
  };
};

export function buildVendooExtensionPayload(input: {
  title: string;
  titleA: string;
  titleB: string;
  description: string;
  category: string;
  canonicalVendooCategoryPath?: string | null;
  itemSpecifics: EbayItemSpecifics;
  photos?: VendooPhotoPayload[];
  researchMeta?: VendooResearchMeta;
  pricing?: VendooPricingMeta;
  resolvedPrice?: string | null;
}): VendooExtensionPayload {
  const canonicalVendooCategoryPath = input.canonicalVendooCategoryPath?.trim();
  const sanitizedPhotos = Array.isArray(input.photos)
    ? input.photos
        .map((photo) => ({
          name: typeof photo?.name === "string" ? photo.name.trim() : "",
          type: typeof photo?.type === "string" ? photo.type.trim() : "",
          size:
            typeof photo?.size === "number" && Number.isFinite(photo.size) && photo.size >= 0
              ? photo.size
              : 0,
          dataUrl: typeof photo?.dataUrl === "string" ? photo.dataUrl.trim() : "",
        }))
        .filter((photo) => photo.dataUrl)
    : [];
  const itemSpecifics: EbayItemSpecifics = {
    brand: input.itemSpecifics.brand.trim(),
    size: input.itemSpecifics.size.trim(),
    color: input.itemSpecifics.color.trim(),
  };

  const optionalItemSpecificKeys = [
    "signedMaker",
    "material",
    "styleType",
    "fabricType",
    "department",
    "jewelryDepartment",
    "occasion",
    "style",
    "features",
    "closure",
    "accents",
    "theme",
    "pattern",
    "dressLength",
    "neckline",
    "sleeveLength",
    "sleeveType",
    "fit",
    "sizeType",
    "vintage",
    "handmade",
    "signed",
    "setIncludes",
    "baseMetal",
    "countryRegionOfManufacture",
    "mainStone",
    "mainStoneColor",
    "mainStoneCreation",
    "shape",
  ] as const;

  for (const key of optionalItemSpecificKeys) {
    const value = input.itemSpecifics[key];
    if (typeof value === "string" && value.trim()) {
      itemSpecifics[key] = value.trim();
    }
  }

  const researchMeta =
    input.researchMeta && typeof input.researchMeta === "object"
      ? {
          searchSeed: Array.isArray(input.researchMeta.searchSeed)
            ? input.researchMeta.searchSeed
                .map((value) => (typeof value === "string" ? value.trim() : ""))
                .filter(Boolean)
            : [],
          primaryQuery:
            typeof input.researchMeta.primaryQuery === "string"
              ? input.researchMeta.primaryQuery.trim()
              : "",
          alternateQueries: Array.isArray(input.researchMeta.alternateQueries)
            ? input.researchMeta.alternateQueries
                .map((value) => (typeof value === "string" ? value.trim() : ""))
                .filter(Boolean)
            : [],
          soldCompLink:
            typeof input.researchMeta.soldCompLink === "string"
              ? input.researchMeta.soldCompLink.trim()
              : "",
          completedCompLink:
            typeof input.researchMeta.completedCompLink === "string"
              ? input.researchMeta.completedCompLink.trim()
              : "",
          ...(typeof input.researchMeta.activeCompLink === "string" &&
          input.researchMeta.activeCompLink.trim()
            ? { activeCompLink: input.researchMeta.activeCompLink.trim() }
            : {}),
          matchConfidence:
            typeof input.researchMeta.matchConfidence === "string" &&
            input.researchMeta.matchConfidence.trim()
              ? input.researchMeta.matchConfidence.trim()
              : null,
          researchNotes:
            typeof input.researchMeta.researchNotes === "string" &&
            input.researchMeta.researchNotes.trim()
              ? input.researchMeta.researchNotes.trim()
              : null,
        }
      : null;

  const pricing =
    input.pricing && typeof input.pricing === "object"
      ? {
          selectedPrice:
            typeof input.pricing.selectedPrice === "string"
              ? input.pricing.selectedPrice.trim()
              : "",
          floorPrice:
            typeof input.pricing.floorPrice === "string"
              ? input.pricing.floorPrice.trim()
              : "",
          pricingNote:
            typeof input.pricing.pricingNote === "string"
              ? input.pricing.pricingNote.trim()
              : "",
          source:
            input.pricing.source === "manual" || input.pricing.source === "suggested"
              ? input.pricing.source
              : null,
        }
      : null;

  const includeResearchMeta = Boolean(
    researchMeta &&
      (researchMeta.searchSeed.length ||
        researchMeta.primaryQuery ||
        researchMeta.alternateQueries.length ||
        researchMeta.soldCompLink ||
        researchMeta.completedCompLink ||
        researchMeta.activeCompLink ||
        researchMeta.matchConfidence ||
        researchMeta.researchNotes)
  );

  const includePricing = Boolean(
    pricing &&
      (pricing.selectedPrice || pricing.floorPrice || pricing.pricingNote || pricing.source)
  );
  const resolvedPriceInput =
    typeof input.resolvedPrice === "string" ? input.resolvedPrice.trim() : "";
  const resolvedPrice =
    resolvedPriceInput && /^[$]?\d+([.,]\d{1,2})?$/.test(resolvedPriceInput)
      ? resolvedPriceInput
      : "";

  return {
    ...(sanitizedPhotos.length ? { photos: sanitizedPhotos } : {}),
    ...(includeResearchMeta && researchMeta ? { researchMeta } : {}),
    ...(includePricing && pricing ? { pricing } : {}),
    ...(resolvedPrice ? { resolvedPrice } : {}),
    marketplaces: {
      ebay: {
        title: input.title.trim(),
        titleA: input.titleA.trim(),
        titleB: input.titleB.trim(),
        description: input.description.trim(),
        category: input.category.trim(),
        ...(canonicalVendooCategoryPath
          ? { canonicalVendooCategoryPath }
          : {}),
        itemSpecifics,
      },
    },
  };
}
