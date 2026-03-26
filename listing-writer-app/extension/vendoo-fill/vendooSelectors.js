(() => {
  if (window.LPU_VENDOO_SELECTORS) return;

  window.LPU_VENDOO_SELECTORS = {
    ebay: {
      title: {
        controlType: "text",
        labelStrategies: [
          {
            labelTerms: ["ebay title", "title"],
            elementSelector: 'input[type="text"], input:not([type])',
            metadataIncludes: ["title"],
            metadataExcludes: ["category", "brand", "size", "color", "colour"],
          },
        ],
        fallbackStrategies: [
          {
            elementSelector: 'input[type="text"], input:not([type])',
            metadataIncludes: ["title"],
            metadataExcludes: ["category", "brand", "size", "color", "colour"],
          },
        ],
      },

      description: {
        controlType: "textarea",
        labelStrategies: [
          {
            labelTerms: ["ebay description", "description"],
            elementSelector: "textarea",
            metadataIncludes: ["description"],
            metadataExcludes: ["title", "category"],
          },
          {
            labelTerms: ["ebay description", "description", "details"],
            elementSelector: '[contenteditable="true"]',
            metadataIncludes: ["description", "details"],
            metadataExcludes: ["title", "category"],
          },
        ],
        fallbackStrategies: [
          {
            elementSelector: "textarea",
            metadataIncludes: ["description", "details"],
            metadataExcludes: ["title", "category"],
          },
          {
            elementSelector: '[contenteditable="true"]',
            metadataIncludes: ["description", "details"],
            metadataExcludes: ["title", "category"],
          },
        ],
      },

      category: {
        controlType: "custom_select",
        labelStrategies: [
          {
            labelTerms: ["ebay category", "category"],
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["category"],
            metadataExcludes: ["title", "brand", "size", "color", "colour"],
          },
        ],
        fallbackStrategies: [
          {
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["category"],
            metadataExcludes: ["title", "brand", "size", "color", "colour"],
          },
        ],
      },

      brand: {
        controlType: "custom_select",
        labelStrategies: [
          {
            labelTerms: ["brand"],
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["brand"],
            metadataExcludes: ["title", "category", "size", "color", "colour"],
          },
        ],
        fallbackStrategies: [
          {
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["brand"],
            metadataExcludes: ["title", "category", "size", "color", "colour"],
          },
        ],
      },

      size: {
        controlType: "custom_select",
        labelStrategies: [
          {
            labelTerms: ["size"],
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["size"],
            metadataExcludes: ["title", "category", "brand", "color", "colour"],
          },
        ],
        fallbackStrategies: [
          {
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["size"],
            metadataExcludes: ["title", "category", "brand", "color", "colour"],
          },
        ],
      },

      color: {
        controlType: "custom_select",
        labelStrategies: [
          {
            labelTerms: ["color", "colour"],
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["color", "colour"],
            metadataExcludes: ["title", "category", "brand", "size"],
          },
        ],
        fallbackStrategies: [
          {
            elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
            metadataIncludes: ["color", "colour"],
            metadataExcludes: ["title", "category", "brand", "size"],
          },
        ],
      },
    },

    depop: {},
    poshmark: {},
    mercari: {},
    etsy: {},
  };
})();
