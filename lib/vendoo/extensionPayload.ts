export type VendooExtensionPayload = {
  marketplaces: {
    ebay: {
      title: string;
      titleA: string;
      titleB: string;
      description: string;
      category: string;
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
  itemSpecifics: {
    brand: string;
    size: string;
    color: string;
  };
}): VendooExtensionPayload {
  return {
    marketplaces: {
      ebay: {
        title: input.title.trim(),
        titleA: input.titleA.trim(),
        titleB: input.titleB.trim(),
        description: input.description.trim(),
        category: input.category.trim(),
        itemSpecifics: {
          brand: input.itemSpecifics.brand.trim(),
          size: input.itemSpecifics.size.trim(),
          color: input.itemSpecifics.color.trim(),
        },
      },
    },
  };
}
