(() => {
  if (window.LPU_VENDOO_SELECTORS) return;

  window.LPU_VENDOO_SELECTORS = {
    ebay: {
      title: {
        labelStrategies: [{ labelTerms: ["ebay title", "title"], fieldSelector: "input" }],
        fallbackStrategies: [{ fieldSelector: "input", keywords: ["title", "ebay"] }],
      },
      description: {
        labelStrategies: [
          { labelTerms: ["ebay description", "description"], fieldSelector: "textarea" },
          {
            labelTerms: ["ebay description", "description"],
            fieldSelector: '[contenteditable="true"]',
          },
        ],
        fallbackStrategies: [
          { fieldSelector: "textarea", keywords: ["description", "details"] },
          { fieldSelector: '[contenteditable="true"]', keywords: ["description", "details"] },
        ],
      },
      category: {
        labelStrategies: [{ labelTerms: ["ebay category", "category"], fieldSelector: "input" }],
        fallbackStrategies: [
          { fieldSelector: "input", keywords: ["category", "ebay"] },
          { fieldSelector: "input", keywords: ["category"] },
        ],
      },
      brand: {
        labelStrategies: [{ labelTerms: ["brand"], fieldSelector: "input" }],
        fallbackStrategies: [{ fieldSelector: "input", keywords: ["brand"] }],
      },
      size: {
        labelStrategies: [{ labelTerms: ["size"], fieldSelector: "input" }],
        fallbackStrategies: [{ fieldSelector: "input", keywords: ["size"] }],
      },
      color: {
        labelStrategies: [
          { labelTerms: ["color", "colour"], fieldSelector: "input" },
        ],
        fallbackStrategies: [
          { fieldSelector: "input", keywords: ["color"] },
          { fieldSelector: "input", keywords: ["colour"] },
        ],
      },
    },

    // Placeholder maps for easy future expansion.
    depop: {},
    poshmark: {},
    mercari: {},
    etsy: {},
  };
})();
