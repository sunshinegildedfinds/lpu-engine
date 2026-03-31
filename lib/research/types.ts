export type ResearchRecord = {
  searchSeed: string[];
  primaryQuery: string;
  alternateQueries: string[];
  brand: string;
  category: string;
  itemType: string;
  keyAttributes: string[];
  imageRefs: string[];
  soldCompLink: string;
  completedCompLink: string;
  activeCompLink?: string;
  soldCompSummary: string | null;
  activeCompSummary: string | null;
  matchConfidence: string | null;
  researchNotes: string | null;
};

export type PriceDecisionSource = "manual" | "suggested" | null;

export type OptionalPriceInput = {
  selectedPrice: string;
  floorPrice: string;
  pricingNote: string;
  source: PriceDecisionSource;
};

