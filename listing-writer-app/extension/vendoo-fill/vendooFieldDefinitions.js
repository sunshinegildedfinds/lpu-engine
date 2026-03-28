(() => {
  if (window.LPU_VENDOO_FIELD_DEFINITIONS) return;

  function normalizeCategoryPath(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function isJewelryProofSlice(input) {
    const categoryPath = normalizeCategoryPath(input.categoryPath);
    if (categoryPath.includes("jewelry")) return true;

    return [input.material, input.styleType, input.signedMaker].some((value) =>
      String(value ?? "").trim().length > 0
    );
  }

  function addFieldIfPresent(fields, input) {
    const value = String(input.payloadValue ?? "").trim();
    if (!value) return;
    fields.push({ ...input, payloadValue: value });
  }

  function buildEbayApparelFieldDefinitions(payload, selectors, valuePickers) {
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
        valuePolicy: {
          allowValueAdaptation: true,
          valueAdaptationType: "alpha_apparel_size",
        },
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

  function buildEbayJewelryFieldDefinitions(payload, selectors, valuePickers) {
    const fields = [
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
    ];

    addFieldIfPresent(fields, {
      marketplace: "ebay",
      key: "signedMaker",
      label: "eBay signed/maker",
      payloadValue: valuePickers.pickEbaySignedMaker(payload),
      selectorConfig: selectors.signedMaker ?? selectors.brand,
    });

    addFieldIfPresent(fields, {
      marketplace: "ebay",
      key: "color",
      label: "eBay color",
      payloadValue: valuePickers.pickEbayColor(payload),
      selectorConfig: selectors.color,
    });

    addFieldIfPresent(fields, {
      marketplace: "ebay",
      key: "material",
      label: "eBay material",
      payloadValue: valuePickers.pickEbayMaterial(payload),
      selectorConfig: selectors.material ?? selectors.color,
    });

    addFieldIfPresent(fields, {
      marketplace: "ebay",
      key: "styleType",
      label: "eBay style/type",
      payloadValue: valuePickers.pickEbayStyleType(payload),
      selectorConfig: selectors.styleType ?? selectors.color,
    });

    return fields;
  }

  function buildEbayFieldDefinitions(payload, selectors, valuePickers) {
    const categoryPath = valuePickers.pickEbayCategoryPath(payload);
    const signedMaker = valuePickers.pickEbaySignedMaker(payload);
    const material = valuePickers.pickEbayMaterial(payload);
    const styleType = valuePickers.pickEbayStyleType(payload);

    if (
      isJewelryProofSlice({
        categoryPath,
        signedMaker,
        material,
        styleType,
      })
    ) {
      return buildEbayJewelryFieldDefinitions(payload, selectors, valuePickers);
    }

    return buildEbayApparelFieldDefinitions(payload, selectors, valuePickers);
  }

  window.LPU_VENDOO_FIELD_DEFINITIONS = {
    buildEbayFieldDefinitions,
  };
})();
