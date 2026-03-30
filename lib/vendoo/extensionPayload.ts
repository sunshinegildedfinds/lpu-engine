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

export type VendooExtensionPayload = {
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
}): VendooExtensionPayload {
  const canonicalVendooCategoryPath = input.canonicalVendooCategoryPath?.trim();
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

  return {
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
