(() => {
  if (window.LPU_VENDOO_FIELD_DEFINITIONS) return;

  function buildEbayFieldDefinitions(payload, selectors, valuePickers) {
    return [
      {
        marketplace: "ebay",
        key: "title",
        label: "eBay title",
        payloadValue: valuePickers.pickEbayTitle(payload),
        selectorConfig: selectors.title,
      },
      {
        marketplace: "ebay",
        key: "description",
        label: "eBay description",
        payloadValue: payload?.marketplaces?.ebay?.description ?? "",
        selectorConfig: selectors.description,
      },
      {
        marketplace: "ebay",
        key: "category",
        label: "eBay category",
        payloadValue: valuePickers.pickEbayCategoryPath(payload),
        selectorConfig: selectors.category,
      },
      {
        marketplace: "ebay",
        key: "brand",
        label: "eBay brand",
        payloadValue: valuePickers.pickEbayBrand(payload),
        selectorConfig: selectors.brand,
      },
      {
        marketplace: "ebay",
        key: "size",
        label: "eBay size",
        payloadValue: valuePickers.pickEbaySize(payload),
        selectorConfig: selectors.size,
      },
      {
        marketplace: "ebay",
        key: "color",
        label: "eBay color",
        payloadValue: valuePickers.pickEbayColor(payload),
        selectorConfig: selectors.color,
      },
    ];
  }

  window.LPU_VENDOO_FIELD_DEFINITIONS = {
    buildEbayFieldDefinitions,
  };
})();
