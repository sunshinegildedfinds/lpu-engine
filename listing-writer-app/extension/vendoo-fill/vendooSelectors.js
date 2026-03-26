(() => {
  if (window.LPU_VENDOO_SELECTORS) return;

  window.LPU_VENDOO_SELECTORS = {
    ebay: {
      title: {
        labelStrategies: [
          { labelTerms: ["ebay title", "title"], fieldSelector: "input" },
        ],
        fallbackStrategies: [
          { fieldSelector: "input", keywords: ["title", "ebay"] },
        ],
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
          {
            fieldSelector: '[contenteditable="true"]',
            keywords: ["description", "details"],
          },
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
