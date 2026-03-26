export type VendooExtensionPayload = {
  marketplaces: {
    ebay: {
      title: string;
      titleA: string;
      titleB: string;
      description: string;
      category: string;
      canonicalVendooCategoryPath?: string;
      itemSpecifics: {
        brand: string;
        size: string;
        color: string;
      };
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
  itemSpecifics: {
    brand: string;
    size: string;
    color: string;
  };
}): VendooExtensionPayload {
  const canonicalVendooCategoryPath = input.canonicalVendooCategoryPath?.trim();

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
        itemSpecifics: {
          brand: input.itemSpecifics.brand.trim(),
          size: input.itemSpecifics.size.trim(),
          color: input.itemSpecifics.color.trim(),
        },
      },
    },
  };
}
