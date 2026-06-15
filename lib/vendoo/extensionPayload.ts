export type EbayItemSpecifics = {
  brand: string;
  size: string;
  color: string;
  condition?: string;
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
  dataUrl?: string;
  storagePath?: string;
  imageUrl?: string;
  signedUrl?: string;
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
  imagePayload?: {
    photos: VendooPhotoPayload[];
    count: number;
  };
  vendooBaseTags?: string[];
  etsy?: {
    title: string;
    description: string;
    tags: string[];
    categoryPath?: string;
    adjustedPrice?: string;
    materials?: string;
    style?: string;
    theme?: string;
    occasion?: string;
    recipient?: string;
    jewelryType?: string;
    gemstone?: string;
    gemColor?: string;
    sustainability?: string;
    goldSolidity?: string;
    recycled?: string;
    canBePersonalized?: string;
    age?: string;
  };
  researchMeta?: VendooResearchMeta;
  pricing?: VendooPricingMeta;
  resolvedPrice?: string;
  coreFields?: {
    title: string;
    titleA: string;
    titleB: string;
    description: string;
    category: string;
    canonicalVendooCategoryPath?: string;
    brand: string;
    size: string;
    color: string;
  };
  marketplaceFields?: {
    ebay: VendooExtensionPayload["marketplaces"]["ebay"];
    depop?: NonNullable<VendooExtensionPayload["marketplaces"]["depop"]>;
    poshmark?: NonNullable<VendooExtensionPayload["marketplaces"]["poshmark"]>;
    etsy?: NonNullable<VendooExtensionPayload["etsy"]>;
  };
  fillReadiness?: {
    ebay: {
      titleReady: boolean;
      descriptionReady: boolean;
      categoryReady: boolean;
      canonicalCategoryReady: boolean;
      brandReady: boolean;
      sizeReady: boolean;
      colorReady: boolean;
      photosReady: boolean;
    };
  };
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
    depop?: {
      listing: string;
      description: string;
      hashtags: string;
      optionalBrandHashtags: string;
      brand?: string;
      size?: string;
      style?: string;
    };
    poshmark?: {
      title: string;
      description: string;
      styleTags: string[];
      categoryPath?: string;
      adjustedPrice?: string;
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
  vendooBaseTags?: string[];
  researchMeta?: VendooResearchMeta;
  pricing?: VendooPricingMeta;
  resolvedPrice?: string | null;
  depop?: {
    listing?: string;
    description?: string;
    hashtags?: string;
    optionalBrandHashtags?: string;
    brand?: string;
    size?: string;
    style?: string;
  };
  poshmark?: {
    title?: string;
    description?: string;
    styleTags?: string[];
    categoryPath?: string;
    adjustedPrice?: string;
  };
  etsy?: {
    title?: string;
    description?: string;
    tags?: string[];
    categoryPath?: string;
    adjustedPrice?: string;
    materials?: string;
    style?: string;
    theme?: string;
    occasion?: string;
    recipient?: string;
    jewelryType?: string;
    gemstone?: string;
    gemColor?: string;
    sustainability?: string;
    goldSolidity?: string;
    recycled?: string;
    canBePersonalized?: string;
    age?: string;
  };
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
          storagePath:
            typeof photo?.storagePath === "string" ? photo.storagePath.trim() : "",
          imageUrl: typeof photo?.imageUrl === "string" ? photo.imageUrl.trim() : "",
          signedUrl: typeof photo?.signedUrl === "string" ? photo.signedUrl.trim() : "",
        }))
        .filter(
          (photo) =>
            Boolean(photo.dataUrl) ||
            Boolean(photo.storagePath) ||
            Boolean(photo.imageUrl) ||
            Boolean(photo.signedUrl)
        )
    : [];
  const itemSpecifics: EbayItemSpecifics = {
    brand: input.itemSpecifics.brand.trim(),
    size: input.itemSpecifics.size.trim(),
    color: input.itemSpecifics.color.trim(),
  };

  const optionalItemSpecificKeys = [
    "condition",
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
  const vendooBaseTags = Array.isArray(input.vendooBaseTags)
    ? (() => {
        const seen = new Set<string>();
        const normalized: string[] = [];
        for (const tag of input.vendooBaseTags) {
          if (typeof tag !== "string") continue;
          const cleaned = tag.trim().replace(/^#+/, "").replace(/\s+/g, " ");
          if (!cleaned) continue;
          if (seen.has(cleaned)) continue;
          seen.add(cleaned);
          normalized.push(cleaned);
        }
        return normalized;
      })()
    : [];
  const resolvedPriceInput =
    typeof input.resolvedPrice === "string" ? input.resolvedPrice.trim() : "";
  const resolvedPrice =
    resolvedPriceInput && /^[$]?\d+([.,]\d{1,2})?$/.test(resolvedPriceInput)
      ? resolvedPriceInput
      : "";
  const depop = input.depop && typeof input.depop === "object"
    ? {
        listing: typeof input.depop.listing === "string" ? input.depop.listing.trim() : "",
        description:
          typeof input.depop.description === "string" ? input.depop.description.trim() : "",
        hashtags: typeof input.depop.hashtags === "string" ? input.depop.hashtags.trim() : "",
        optionalBrandHashtags:
          typeof input.depop.optionalBrandHashtags === "string"
            ? input.depop.optionalBrandHashtags.trim()
            : "",
        brand: typeof input.depop.brand === "string" ? input.depop.brand.trim() : "",
        size: typeof input.depop.size === "string" ? input.depop.size.trim() : "",
        style: typeof input.depop.style === "string" ? input.depop.style.trim() : "",
      }
    : null;
  const includeDepop = Boolean(
    depop &&
      (depop.listing ||
        depop.description ||
        depop.hashtags ||
        depop.optionalBrandHashtags ||
        depop.brand ||
        depop.size ||
        depop.style)
  );
  const poshmark = input.poshmark && typeof input.poshmark === "object"
    ? {
        title: typeof input.poshmark.title === "string" ? input.poshmark.title.trim() : "",
        description:
          typeof input.poshmark.description === "string"
            ? input.poshmark.description.trim()
            : "",
        categoryPath:
          typeof input.poshmark.categoryPath === "string"
            ? input.poshmark.categoryPath.trim()
            : "",
        adjustedPrice:
          typeof input.poshmark.adjustedPrice === "string"
            ? input.poshmark.adjustedPrice.trim()
            : "",
        styleTags: Array.isArray(input.poshmark.styleTags)
          ? (() => {
              const seen = new Set<string>();
              const normalized: string[] = [];
              for (const tag of input.poshmark.styleTags) {
                if (typeof tag !== "string") continue;
                const cleaned = tag.trim().replace(/^#+/, "").replace(/\s+/g, " ");
                if (!cleaned || seen.has(cleaned)) continue;
                seen.add(cleaned);
                normalized.push(cleaned);
              }
              return normalized;
            })()
          : [],
      }
    : null;
  const includePoshmark = Boolean(
    poshmark &&
      (poshmark.title ||
        poshmark.description ||
        poshmark.styleTags.length ||
        poshmark.categoryPath ||
        poshmark.adjustedPrice)
  );
  const etsy = input.etsy && typeof input.etsy === "object"
    ? {
        title: typeof input.etsy.title === "string" ? input.etsy.title.trim() : "",
        description:
          typeof input.etsy.description === "string" ? input.etsy.description.trim() : "",
        categoryPath:
          typeof input.etsy.categoryPath === "string"
            ? input.etsy.categoryPath.trim()
            : "",
        adjustedPrice:
          typeof input.etsy.adjustedPrice === "string"
            ? input.etsy.adjustedPrice.trim()
            : "",
        materials:
          typeof input.etsy.materials === "string" ? input.etsy.materials.trim() : "",
        style: typeof input.etsy.style === "string" ? input.etsy.style.trim() : "",
        theme: typeof input.etsy.theme === "string" ? input.etsy.theme.trim() : "",
        occasion: typeof input.etsy.occasion === "string" ? input.etsy.occasion.trim() : "",
        recipient: typeof input.etsy.recipient === "string" ? input.etsy.recipient.trim() : "",
        jewelryType:
          typeof input.etsy.jewelryType === "string" ? input.etsy.jewelryType.trim() : "",
        gemstone: typeof input.etsy.gemstone === "string" ? input.etsy.gemstone.trim() : "",
        gemColor: typeof input.etsy.gemColor === "string" ? input.etsy.gemColor.trim() : "",
        sustainability:
          typeof input.etsy.sustainability === "string"
            ? input.etsy.sustainability.trim()
            : "",
        goldSolidity:
          typeof input.etsy.goldSolidity === "string" ? input.etsy.goldSolidity.trim() : "",
        recycled: typeof input.etsy.recycled === "string" ? input.etsy.recycled.trim() : "",
        canBePersonalized:
          typeof input.etsy.canBePersonalized === "string"
            ? input.etsy.canBePersonalized.trim()
            : "",
        age: typeof input.etsy.age === "string" ? input.etsy.age.trim() : "",
        tags: Array.isArray(input.etsy.tags)
          ? (() => {
              const seen = new Set<string>();
              const normalized: string[] = [];
              for (const tag of input.etsy.tags) {
                if (typeof tag !== "string") continue;
                const cleaned = tag.trim().replace(/^#+/, "").replace(/\s+/g, " ");
                if (!cleaned || seen.has(cleaned)) continue;
                seen.add(cleaned);
                normalized.push(cleaned);
              }
              return normalized;
            })()
          : [],
      }
    : null;
  const includeEtsy = Boolean(
    etsy &&
      (
        etsy.title ||
        etsy.description ||
        etsy.tags.length ||
        etsy.categoryPath ||
        etsy.adjustedPrice ||
        etsy.materials ||
        etsy.style ||
        etsy.theme ||
        etsy.occasion ||
        etsy.recipient ||
        etsy.jewelryType ||
        etsy.gemstone ||
        etsy.gemColor ||
        etsy.sustainability ||
        etsy.goldSolidity ||
        etsy.recycled ||
        etsy.canBePersonalized ||
        etsy.age
      )
  );

  const normalizedEbay = {
    title: input.title.trim(),
    titleA: input.titleA.trim(),
    titleB: input.titleB.trim(),
    description: input.description.trim(),
    category: input.category.trim(),
    ...(canonicalVendooCategoryPath
      ? { canonicalVendooCategoryPath }
      : {}),
    itemSpecifics,
  };

  return {
    ...(sanitizedPhotos.length ? { photos: sanitizedPhotos } : {}),
    ...(sanitizedPhotos.length
      ? {
          imagePayload: {
            photos: sanitizedPhotos,
            count: sanitizedPhotos.length,
          },
        }
      : {}),
    ...(vendooBaseTags.length ? { vendooBaseTags } : {}),
    ...(includeEtsy && etsy
      ? {
          etsy: {
            title: etsy.title,
            description: etsy.description,
            tags: etsy.tags,
            ...(etsy.categoryPath ? { categoryPath: etsy.categoryPath } : {}),
            ...(etsy.adjustedPrice ? { adjustedPrice: etsy.adjustedPrice } : {}),
            ...(etsy.materials ? { materials: etsy.materials } : {}),
            ...(etsy.style ? { style: etsy.style } : {}),
            ...(etsy.theme ? { theme: etsy.theme } : {}),
            ...(etsy.occasion ? { occasion: etsy.occasion } : {}),
            ...(etsy.recipient ? { recipient: etsy.recipient } : {}),
            ...(etsy.jewelryType ? { jewelryType: etsy.jewelryType } : {}),
            ...(etsy.gemstone ? { gemstone: etsy.gemstone } : {}),
            ...(etsy.gemColor ? { gemColor: etsy.gemColor } : {}),
            ...(etsy.sustainability ? { sustainability: etsy.sustainability } : {}),
            ...(etsy.goldSolidity ? { goldSolidity: etsy.goldSolidity } : {}),
            ...(etsy.recycled ? { recycled: etsy.recycled } : {}),
            ...(etsy.canBePersonalized ? { canBePersonalized: etsy.canBePersonalized } : {}),
            ...(etsy.age ? { age: etsy.age } : {}),
          },
        }
      : {}),
    ...(includeResearchMeta && researchMeta ? { researchMeta } : {}),
    ...(includePricing && pricing ? { pricing } : {}),
    ...(resolvedPrice ? { resolvedPrice } : {}),
    coreFields: {
      title: normalizedEbay.title,
      titleA: normalizedEbay.titleA,
      titleB: normalizedEbay.titleB,
      description: normalizedEbay.description,
      category: normalizedEbay.category,
      ...(canonicalVendooCategoryPath
        ? { canonicalVendooCategoryPath }
        : {}),
      brand: itemSpecifics.brand,
      size: itemSpecifics.size,
      color: itemSpecifics.color,
    },
    marketplaces: {
      ebay: normalizedEbay,
      ...(includeDepop && depop
        ? {
            depop: {
              listing: depop.listing,
              description: depop.description,
              hashtags: depop.hashtags,
              optionalBrandHashtags: depop.optionalBrandHashtags,
              ...(depop.brand ? { brand: depop.brand } : {}),
              ...(depop.size ? { size: depop.size } : {}),
              ...(depop.style ? { style: depop.style } : {}),
            },
          }
        : {}),
      ...(includePoshmark && poshmark
        ? {
            poshmark: {
              title: poshmark.title,
              description: poshmark.description,
              styleTags: poshmark.styleTags,
              ...(poshmark.categoryPath ? { categoryPath: poshmark.categoryPath } : {}),
              ...(poshmark.adjustedPrice ? { adjustedPrice: poshmark.adjustedPrice } : {}),
            },
          }
        : {}),
    },
    marketplaceFields: {
      ebay: normalizedEbay,
      ...(includeDepop && depop
        ? {
            depop: {
              listing: depop.listing,
              description: depop.description,
              hashtags: depop.hashtags,
              optionalBrandHashtags: depop.optionalBrandHashtags,
              ...(depop.brand ? { brand: depop.brand } : {}),
              ...(depop.size ? { size: depop.size } : {}),
              ...(depop.style ? { style: depop.style } : {}),
            },
          }
        : {}),
      ...(includePoshmark && poshmark
        ? {
            poshmark: {
              title: poshmark.title,
              description: poshmark.description,
              styleTags: poshmark.styleTags,
              ...(poshmark.categoryPath ? { categoryPath: poshmark.categoryPath } : {}),
              ...(poshmark.adjustedPrice ? { adjustedPrice: poshmark.adjustedPrice } : {}),
            },
          }
        : {}),
      ...(includeEtsy && etsy
        ? {
            etsy: {
              title: etsy.title,
              description: etsy.description,
              tags: etsy.tags,
              ...(etsy.categoryPath ? { categoryPath: etsy.categoryPath } : {}),
              ...(etsy.adjustedPrice ? { adjustedPrice: etsy.adjustedPrice } : {}),
              ...(etsy.materials ? { materials: etsy.materials } : {}),
              ...(etsy.style ? { style: etsy.style } : {}),
              ...(etsy.theme ? { theme: etsy.theme } : {}),
              ...(etsy.occasion ? { occasion: etsy.occasion } : {}),
              ...(etsy.recipient ? { recipient: etsy.recipient } : {}),
              ...(etsy.jewelryType ? { jewelryType: etsy.jewelryType } : {}),
              ...(etsy.gemstone ? { gemstone: etsy.gemstone } : {}),
              ...(etsy.gemColor ? { gemColor: etsy.gemColor } : {}),
              ...(etsy.sustainability ? { sustainability: etsy.sustainability } : {}),
              ...(etsy.goldSolidity ? { goldSolidity: etsy.goldSolidity } : {}),
              ...(etsy.recycled ? { recycled: etsy.recycled } : {}),
              ...(etsy.canBePersonalized ? { canBePersonalized: etsy.canBePersonalized } : {}),
              ...(etsy.age ? { age: etsy.age } : {}),
            },
          }
        : {}),
    },
    fillReadiness: {
      ebay: {
        titleReady: Boolean(normalizedEbay.title),
        descriptionReady: Boolean(normalizedEbay.description),
        categoryReady: Boolean(normalizedEbay.category),
        canonicalCategoryReady: Boolean(canonicalVendooCategoryPath),
        brandReady: Boolean(itemSpecifics.brand),
        sizeReady: Boolean(itemSpecifics.size),
        colorReady: Boolean(itemSpecifics.color),
        photosReady: sanitizedPhotos.length > 0,
      },
    },
  };
}
