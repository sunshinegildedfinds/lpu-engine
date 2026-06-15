export type EbayCategoryConfidence =
  | "AI suggested"
  | "Final LP-U derived"
  | "Low confidence"
  | "User-provided"
  | "API suggested";

export type AiStartingRangeConfidence = "Low" | "Low-medium" | "Medium" | "High";

export type LookbackWindow = "90d" | "6mo" | "1y" | "2y" | "3y" | "custom";

export type ShippingIncluded = "yes" | "no" | "unknown";

export type ConditionMatch = "lower" | "similar" | "better" | "unknown";

export type PricingConfidence = "Low" | "Low-medium" | "Medium" | "Medium-high" | "High";
export type PublicWebCompPricingConfidence = "High" | "Medium" | "Low" | "Very Low";
export type PricingSource = "manual" | "public_web_comps" | "ai_fallback";

export type SelectedWebCompPricingSource = {
  visiblePrice: number | null;
  status: "sold" | "completed" | "best_offer_uncertain" | "active_or_unclear" | "excluded";
  eligibleForPricing: boolean;
  selectableForUserPricing: boolean;
  hardDisabled: boolean;
  userOverrideRisk: "none" | "low" | "medium" | "high";
  usedInPricing: boolean;
  similarity: "strong" | "medium" | "weak" | "not_comparable";
  matchType:
    | "full_item"
    | "same_item_type"
    | "component_only"
    | "style_only"
    | "brand_only"
    | "material_only"
    | "unclear";
};

export type PublicWebCompPricingSummary = {
  suggestedPrice?: number | null;
  confidence?: PublicWebCompPricingConfidence;
  selectedSoldResultsUsed?: number;
  bestOfferCaveatUsed?: boolean;
};

export type DerivedPricingResult = {
  suggestedListPrice: number | null;
  fastSalePrice: number | null;
  bestOfferFloor: number | null;
  pricingConfidence: PublicWebCompPricingConfidence;
  pricingSource: PricingSource;
  pricingExplanation: string;
};

export type PricingResearchGenerated = {
  researchKeywords: string;
  ebaySoldCompsUrl: string;
  ebaySoldCompsExplanation: string;
  terapeakResearchQuery: string;
  broaderResearchQuery: string;
  narrowerResearchQuery: string;
  suggestedEbayCategoryName: string;
  suggestedEbayCategoryPath: string;
  suggestedEbayCategoryConfidence: EbayCategoryConfidence;
  categoryNotes: string;
  aiStartingRangeLow: number;
  aiStartingRangeHigh: number;
  aiStartingRangeConfidence: AiStartingRangeConfidence;
  aiStartingRangeBasis: string;
  pricingWarnings: string[];
};

export type PricingResearchInput = {
  sellingBrief: string;
  finalOutput?: string;
  notes?: string;
  knownDetails?: string;
  conditionFlaws?: string;
  measurements?: string;
  markingsLabels?: string;
};

export type ManualCompInputs = {
  averageSoldPrice?: number;
  medianSoldPrice?: number;
  lowRelevantSold?: number;
  highRelevantSold?: number;
  soldCount?: number;
  activeCount?: number;
  sellThroughPercent?: number;
  lookbackWindow?: LookbackWindow;
  shippingIncluded?: ShippingIncluded;
  conditionMatch?: ConditionMatch;
  compNotes?: string;
};

export type PricingRecommendation = {
  suggestedListPrice: number;
  fastSalePrice: number;
  bestOfferFloor: number;
  pricingConfidence: PricingConfidence | PublicWebCompPricingConfidence;
  pricingExplanation: string;
  basePriceSource: string;
  usedAiFallback: boolean;
  pricingSource: PricingSource;
};

const EBAY_SOLD_SEARCH_BASE_URL = "https://www.ebay.com/sch/i.html";

const SUBJECTIVE_TERMS = [
  "rare",
  "beautiful",
  "stunning",
  "statement",
  "unique",
  "high quality",
  "perfect",
  "must-have",
  "collectible",
  "luxury",
  "gorgeous",
  "timeless",
  "elegant",
  "stylish",
  "eye-catching",
  "classic",
  "versatile",
  "great",
  "amazing",
  "lovely",
  "nice",
] as const;

const INTERNAL_SELLING_BRIEF_LABELS = [
  "item identity",
  "evidence anchors",
  "claim limits",
  "condition basis",
  "measurement basis",
  "buyer search keywords",
  "style / theme / aesthetic candidate bank",
  "candidate term",
  "evidence source",
  "visual evidence",
  "confidence level",
  "safe wording",
  "use in",
  "claim limit",
  "primary style",
  "primary style / theme / aesthetic candidate",
  "confirmed candidate terms",
  "ebay title b style/theme/aesthetic requirement",
  "generic phrases to avoid",
  "platform angle map",
  "buyer intent",
  "search / discovery mechanic",
  "buyer decision problem",
  "supported evidence to use",
  "candidate bank terms to use",
  "backend / attribute strategy",
  "title / opening strategy",
  "description strategy",
  "tag / keyword strategy",
  "required final copy moves",
  "phrases to avoid",
  "do not say",
  "say instead",
  "one example direction",
  "quality risks before final listing",
  "seller-confirmed",
  "seller provided",
  "photo-derived",
  "measurement-photo-derived",
  "label/marking-derived",
  "packaging-derived",
] as const;

const SECTION_HEADINGS = [
  ...INTERNAL_SELLING_BRIEF_LABELS,
  "universal selling brief",
  "brand / maker / model",
  "brand / maker evidence",
  "brand / maker",
  "brand",
  "maker",
  "manufacturer",
  "publisher",
  "item type",
  "item name",
  "object type",
  "product type",
  "category",
  "blocked overclaims",
  "candidate 1",
  "candidate 2",
  "candidate 3",
  "candidate 4",
  "candidate 5",
  "candidate 6",
  "candidate 7",
  "candidate 8",
  "candidate 9",
  "candidate 10",
  "rejection reason",
] as const;

const QUERY_STOP_WORDS = new Set([
  "or",
  "a",
  "an",
  "for",
  "by",
  "from",
  "see",
  "photos",
  "photo",
  "shown",
  "provided",
  "supported",
  "confirmed",
  "attribution",
  "attributed",
  "evidence",
  "derived",
  "basis",
  "claim",
  "confidence",
  "measurement",
  "condition",
  "seller",
  "visible",
  "appears",
  "appearance",
  "safe",
  "wording",
  "candidate",
  "term",
  "not",
  "specified",
  "source",
  "confidence",
  "level",
  "visual",
  "basis",
  "anchors",
  "identity",
  "limits",
  "seller-confirmed",
  "photo-derived",
  "measurement-photo-derived",
  "label/marking-derived",
  "packaging-derived",
]);

const SOURCE_FRAGMENT_TERMS = [
  "attribution",
  "derived",
  "photo",
  "seller",
  "evidence",
  "anchor",
  "source",
  "basis",
  "visual",
  "confidence",
  "safe wording",
  "use in",
  "claim",
  "measurement",
  "condition",
  "provided",
  "shown",
  "inferred",
  "based on",
  "visible",
  "appears",
  "confirmed",
] as const;

const QUERY_FORBIDDEN_WORDS = new Set([
  "attribution",
  "evidence",
  "source",
  "seller",
  "confirmed",
  "photo",
  "derived",
  "visual",
  "basis",
  "appears",
  "shown",
  "provided",
  "claim",
  "confidence",
  "measurement",
  "condition",
  "strategy",
]);

const QUERY_FORBIDDEN_PHRASES = [
  "must remain",
  "ad context",
  "safe wording",
  "use in",
  "item identity",
  "evidence anchors",
  "claim limits",
  "condition basis",
  "measurement basis",
  "supported evidence",
  "claim limit",
  "final copy moves",
  "item type",
  "but item",
  "this item",
  "is but item",
  "arrangement of",
] as const;

const QUERY_LEADING_FILLER_WORDS = new Set([
  "is",
  "are",
  "was",
  "were",
  "but",
  "and",
  "with",
  "item",
  "this",
  "type",
  "identity",
]);

const QUERY_TRAILING_FILLER_WORDS = new Set([
  "is",
  "are",
  "was",
  "were",
  "but",
  "and",
  "with",
  "this",
  "type",
  "identity",
]);

const BROKEN_SOURCE_FRAGMENTS = [
  "- derived",
  "derived arrangement of",
  "arrangement of",
  "based on",
  "visible",
  "appears",
  "confirmed",
] as const;

const LOW_VALUE_QUERY_TERMS = [
  "round",
  "small",
  "large",
  "clear",
  "smoky",
  "dimensional",
  "layered",
  "faceted",
  "prong set",
] as const;

const RECOMMENDED_QUERY_TARGET_WORDS = 12;
const RECOMMENDED_QUERY_MAX_WORDS = 14;

const GENERIC_QUERY_WORDS = new Set([
  "item",
  "accessory",
  "piece",
  "design",
  "detail",
  "detailing",
  "look",
  "style",
  "metal",
  "jewelry",
  "pendant",
  "charm",
  "accent",
]);

const ITEM_TYPE_HINTS = [
  "shirt",
  "top",
  "blouse",
  "dress",
  "skirt",
  "pants",
  "jeans",
  "jacket",
  "coat",
  "sweater",
  "shoes",
  "boots",
  "sandals",
  "sneakers",
  "bag",
  "purse",
  "wallet",
  "belt",
  "hat",
  "scarf",
  "necklace",
  "bracelet",
  "ring",
  "earrings",
  "brooch",
  "pin",
  "watch",
  "vase",
  "lamp",
  "bowl",
  "plate",
  "figurine",
  "frame",
  "decor",
  "console",
  "camera",
  "phone",
  "speaker",
  "headphones",
  "book",
  "dvd",
  "cd",
  "vinyl",
  "record",
  "game",
  "toy",
  "doll",
  "plush",
  "tool",
  "drill",
  "saw",
  "mixer",
  "blender",
  "appliance",
  "supply",
] as const;

const MATERIAL_APPEARANCE_HINTS = [
  "rhinestone",
  "faux pearl",
  "pearl",
  "leather",
  "suede",
  "wool",
  "silk",
  "cotton",
  "denim",
  "ceramic",
  "glass",
  "wood",
  "brass tone",
  "gold tone",
  "silver tone",
  "metal",
  "plastic",
  "resin",
  "paper",
  "vinyl",
  "canvas",
] as const;

const COMPONENT_PHRASE_HINTS = [
  "clip earrings",
  "stud earrings",
  "drop earrings",
  "necklace",
  "earrings",
  "bracelet",
  "ring",
  "brooch",
  "pin",
  "pendant",
  "cup",
  "saucer",
  "plate",
  "bowl",
  "top",
  "skirt",
  "pants",
  "jacket",
  "tool",
  "book",
  "game",
  "piece",
] as const;

const BRAND_LABELS = [
  "Brand / Maker / Model",
  "Brand / Maker evidence",
  "Brand / Maker",
  "Brand",
  "Maker",
  "Designer",
  "Manufacturer",
  "Publisher",
  "Artist",
  "Studio",
  "Label",
  "Attribution",
  "Seller-confirmed attribution",
  "Seller-provided attribution",
  "Attributed to",
] as const;

const COMPOSITE_PATTERNS = [
  { term: "jewelry set", exactTerm: "demi parure", pattern: /\bdemi\s+parure\b/i },
  { term: "jewelry set", exactTerm: "parure", pattern: /\bparure\b/i },
  { term: "jewelry set", exactTerm: "necklace earrings set", pattern: /\bnecklace\s*(?:\+|and|&|with)\s*(?:clip\s+)?earrings?(?:\s+set)?\b/i },
  { term: "jewelry set", exactTerm: "jewelry set", pattern: /\bjewelry\s+set\b/i },
  { term: "outfit set", pattern: /\b(?:outfit|ensemble|top\s*(?:\+|and|&|with)\s*skirt(?:\s+set)?)\b/i },
  { term: "cup saucer set", pattern: /\bcup\s*(?:\+|and|&|with)\s*saucer(?:\s+set)?\b/i },
  { term: "book set", pattern: /\bbook\s+set\b/i },
  { term: "dish set", pattern: /\bdish\s+set\b/i },
  { term: "tool set", pattern: /\btool\s+set\b/i },
  { term: "game set", pattern: /\bgame\s+set\b/i },
  { term: "kit", pattern: /\bkit\b/i },
  { term: "lot", pattern: /\blot\b/i },
  { term: "bundle", pattern: /\bbundle\b/i },
  { term: "pair", pattern: /\bpair\b/i },
  { term: "collection", pattern: /\bcollection\b/i },
  { term: "set", exactTerm: "matching set", pattern: /\bmatching\s+set\b/i },
  { term: "set", pattern: /\bset\s+includes?\b/i },
] as const;

const CATEGORY_HINTS = [
  {
    name: "Clothing",
    path: "Clothing, Shoes & Accessories > Specialty Apparel or category-specific clothing",
    terms: ["shirt", "top", "blouse", "dress", "skirt", "pants", "jeans", "jacket", "coat", "sweater", "apparel", "clothing"],
    range: [18, 45],
  },
  {
    name: "Shoes",
    path: "Clothing, Shoes & Accessories > Shoes > category-specific shoes",
    terms: ["shoes", "boots", "sandals", "sneakers", "heels", "loafers"],
    range: [24, 65],
  },
  {
    name: "Jewelry",
    path: "Jewelry & Watches > Fashion Jewelry or Vintage & Antique Jewelry",
    terms: ["necklace", "bracelet", "ring", "earrings", "brooch", "pin", "jewelry", "watch"],
    range: [14, 45],
  },
  {
    name: "Bags & Accessories",
    path: "Clothing, Shoes & Accessories > Women > Women's Bags & Handbags or category-specific accessories",
    terms: ["bag", "purse", "wallet", "belt", "hat", "scarf", "accessory"],
    range: [18, 55],
  },
  {
    name: "Home Decor",
    path: "Home & Garden > Home Decor > category-specific decor",
    terms: ["vase", "lamp", "bowl", "plate", "figurine", "frame", "decor", "candle", "wall art"],
    range: [16, 50],
  },
  {
    name: "Electronics",
    path: "Consumer Electronics > category-specific electronics",
    terms: ["console", "camera", "phone", "speaker", "headphones", "electronic", "charger"],
    range: [25, 90],
  },
  {
    name: "Collectibles",
    path: "Collectibles > category-specific collectibles",
    terms: ["collectible", "figurine", "trading card", "memorabilia", "coin", "stamp"],
    range: [12, 55],
  },
  {
    name: "Toys",
    path: "Toys & Hobbies > category-specific toys",
    terms: ["toy", "doll", "plush", "game", "puzzle", "figure"],
    range: [12, 40],
  },
  {
    name: "Books & Media",
    path: "Books & Magazines or Movies & TV or Music > category-specific media",
    terms: ["book", "dvd", "cd", "vinyl", "record", "magazine", "media"],
    range: [8, 30],
  },
  {
    name: "Beauty",
    path: "Health & Beauty > category-specific beauty",
    terms: ["beauty", "makeup", "skincare", "fragrance", "perfume", "cosmetic"],
    range: [10, 35],
  },
  {
    name: "Tools",
    path: "Home & Garden > Tools & Workshop Equipment > category-specific tools",
    terms: ["tool", "drill", "saw", "wrench", "socket", "hardware"],
    range: [15, 60],
  },
  {
    name: "Small Appliances",
    path: "Home & Garden > Kitchen, Dining & Bar > Small Kitchen Appliances",
    terms: ["mixer", "blender", "appliance", "toaster", "coffee maker"],
    range: [20, 75],
  },
] as const;

const CATEGORY_RULES = [
  {
    name: "Jewelry Sets",
    path: "Jewelry & Watches > Fashion Jewelry > Jewelry Sets",
    terms: ["jewelry set", "demi parure", "parure", "necklace earrings set"],
    range: [18, 70],
  },
  {
    name: "Outfits & Sets",
    path: "Clothing, Shoes & Accessories > Women > Women's Clothing > Outfits & Sets",
    terms: ["outfit set", "matching set", "ensemble", "top skirt set"],
    range: [24, 70],
  },
  {
    name: "Book Sets",
    path: "Books & Magazines > Books > Book Sets & Collections",
    terms: ["book set"],
    range: [10, 45],
  },
  {
    name: "Dinnerware Sets",
    path: "Pottery & Glass > Decorative Cookware, Dinnerware & Serveware > Dinner Sets",
    terms: ["dish set", "cup saucer set"],
    range: [18, 70],
  },
  {
    name: "Tool Sets",
    path: "Home & Garden > Tools & Workshop Equipment > Tool Sets",
    terms: ["tool set"],
    range: [20, 80],
  },
  {
    name: "Game Sets",
    path: "Toys & Hobbies > Games > Game Sets",
    terms: ["game set"],
    range: [12, 45],
  },
  {
    name: "Brooches & Pins",
    path: "Jewelry & Watches > Fashion Jewelry > Brooches & Pins",
    terms: ["brooch", "pin"],
    range: [14, 45],
  },
  {
    name: "Necklaces",
    path: "Jewelry & Watches > Fashion Jewelry > Necklaces & Pendants",
    terms: ["necklace", "pendant"],
    range: [14, 50],
  },
  {
    name: "Bracelets",
    path: "Jewelry & Watches > Fashion Jewelry > Bracelets & Charms",
    terms: ["bracelet", "bangle", "charm"],
    range: [12, 45],
  },
  {
    name: "Rings",
    path: "Jewelry & Watches > Fashion Jewelry > Rings",
    terms: ["ring"],
    range: [12, 45],
  },
  {
    name: "Earrings",
    path: "Jewelry & Watches > Fashion Jewelry > Earrings",
    terms: ["earrings", "earring"],
    range: [10, 40],
  },
  {
    name: "Shoes",
    path: "Clothing, Shoes & Accessories > Shoes > category-specific shoes",
    terms: ["shoes", "boots", "sandals", "sneakers", "heels", "loafers"],
    range: [24, 65],
  },
  {
    name: "Women's Bags & Handbags",
    path: "Clothing, Shoes & Accessories > Women > Women's Bags & Handbags",
    terms: ["bag", "purse", "handbag", "tote", "satchel", "clutch"],
    range: [18, 65],
  },
  {
    name: "Wallets",
    path: "Clothing, Shoes & Accessories > Women > Women's Accessories > Wallets",
    terms: ["wallet"],
    range: [12, 45],
  },
  {
    name: "Hats",
    path: "Clothing, Shoes & Accessories > Specialty > Hats",
    terms: ["hat", "cap"],
    range: [12, 40],
  },
  {
    name: "Scarves & Wraps",
    path: "Clothing, Shoes & Accessories > Women > Women's Accessories > Scarves & Wraps",
    terms: ["scarf", "wrap"],
    range: [12, 40],
  },
  {
    name: "Shirts & Tops",
    path: "Clothing, Shoes & Accessories > Women > Women's Clothing > Tops",
    terms: ["shirt", "top", "blouse", "tee", "t-shirt"],
    range: [18, 45],
  },
  {
    name: "Dresses",
    path: "Clothing, Shoes & Accessories > Women > Women's Clothing > Dresses",
    terms: ["dress"],
    range: [20, 60],
  },
  {
    name: "Jeans",
    path: "Clothing, Shoes & Accessories > Women > Women's Clothing > Jeans",
    terms: ["jeans"],
    range: [18, 55],
  },
  {
    name: "Jackets & Coats",
    path: "Clothing, Shoes & Accessories > Women > Women's Clothing > Coats, Jackets & Vests",
    terms: ["jacket", "coat", "vest"],
    range: [24, 75],
  },
  {
    name: "Books",
    path: "Books & Magazines > Books",
    terms: ["book", "novel", "textbook"],
    range: [8, 30],
  },
  {
    name: "Movies",
    path: "Movies & TV > DVDs & Blu-ray Discs",
    terms: ["dvd", "blu-ray", "bluray", "movie"],
    range: [7, 25],
  },
  {
    name: "Music",
    path: "Music > Vinyl Records, CDs, or Cassettes",
    terms: ["vinyl", "record", "cd", "cassette"],
    range: [8, 35],
  },
  {
    name: "Video Games",
    path: "Video Games & Consoles > Video Games",
    terms: ["video game", "game cartridge", "game disc"],
    range: [10, 45],
  },
  {
    name: "Toys",
    path: "Toys & Hobbies > category-specific toys",
    terms: ["toy", "doll", "plush", "puzzle", "figure"],
    range: [12, 40],
  },
  {
    name: "Lamps",
    path: "Home & Garden > Lamps, Lighting & Ceiling Fans > Lamps",
    terms: ["lamp", "light"],
    range: [20, 70],
  },
  {
    name: "Vases",
    path: "Home & Garden > Home Decor > Vases",
    terms: ["vase"],
    range: [16, 50],
  },
  {
    name: "Plates",
    path: "Pottery & Glass > Decorative Cookware, Dinnerware & Serveware > Plates",
    terms: ["plate", "platter"],
    range: [12, 45],
  },
  {
    name: "Cameras",
    path: "Cameras & Photo > Digital Cameras or Film Photography",
    terms: ["camera"],
    range: [25, 90],
  },
  {
    name: "Headphones",
    path: "Consumer Electronics > Portable Audio & Headphones > Headphones",
    terms: ["headphones", "earbuds"],
    range: [18, 80],
  },
  {
    name: "Tools",
    path: "Home & Garden > Tools & Workshop Equipment > category-specific tools",
    terms: ["tool", "drill", "saw", "wrench", "socket", "hardware"],
    range: [15, 60],
  },
  {
    name: "Small Kitchen Appliances",
    path: "Home & Garden > Kitchen, Dining & Bar > Small Kitchen Appliances",
    terms: ["mixer", "blender", "toaster", "coffee maker", "small appliance"],
    range: [20, 75],
  },
] as const;

export const PRICING_RESEARCH_CONSTANTS = {
  conditionAdjustment: {
    better: 1.05,
    similar: 1,
    lower: 0.9,
    unknown: 1,
  },
  sellThroughAdjustment: {
    high: 1.08,
    mediumHigh: 1.03,
    mediumLow: 0.95,
    low: 0.85,
  },
  fastSaleMultiplier: 0.88,
  bestOfferFloorMultiplier: 0.75,
} as const;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseToBoundaryPattern(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("[\\s/-]+");
}

function containsWholePhrase(value: string, phrase: string): boolean {
  if (!value || !phrase) return false;
  const pattern = phraseToBoundaryPattern(phrase);
  return new RegExp(`(^|[^a-z0-9])${pattern}(?:s|es)?(?=$|[^a-z0-9])`, "i").test(value);
}

function labelToPattern(label: string): string {
  return escapeRegExp(label).replace(/\\ \/\\ |\\\/|\\s+/g, "\\s*(?:\\/|&|and)?\\s*");
}

function normalizeHeading(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/^[\s#>*-]+/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/[:：]+$/, "")
      .replace(/[()[\]{}]/g, " ")
      .replace(/\s*\/\s*/g, " / ")
  );
}

function stripLeadingLabel(value: string, labels: readonly string[]): string {
  let next = value;
  for (const label of labels) {
    const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${labelToPattern(label)}\\s*(?:[:：\\-–—>]+|\\b)\\s*`, "i");
    next = next.replace(pattern, "");
  }
  return next;
}

function stripInternalLabels(value: string): string {
  let next = value;
  for (const label of INTERNAL_SELLING_BRIEF_LABELS) {
    const pattern = new RegExp(`\\b${labelToPattern(label)}\\b\\s*(?:[:：\\-–—>]+)?`, "gi");
    next = next.replace(pattern, " ");
  }
  return normalizeWhitespace(next);
}

function stripSubjectiveTerms(value: string): string {
  let next = ` ${value.toLowerCase()} `;
  for (const term of SUBJECTIVE_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    next = next.replace(pattern, " ");
  }
  return normalizeWhitespace(next);
}

function containsSourceFragment(value: string): boolean {
  const normalized = normalizeWhitespace(value.toLowerCase().replace(/[–—]/g, "-"));
  if (!normalized) return true;
  if (/^\s*-|-\s*$/.test(value)) return true;
  if (BROKEN_SOURCE_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;
  return SOURCE_FRAGMENT_TERMS.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(normalized));
}

function stripForbiddenQueryWords(value: string): string {
  let next = value;
  for (const phrase of QUERY_FORBIDDEN_PHRASES) {
    next = next.replace(new RegExp(`\\b${phraseToBoundaryPattern(phrase)}\\b`, "gi"), " ");
  }

  return normalizeWhitespace(
    next
      .split(/\s+/)
      .filter((word) => !QUERY_FORBIDDEN_WORDS.has(word.toLowerCase()))
      .join(" ")
  );
}

function stripNonCompositeSetConstruction(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\bprong\s+set\b/gi, "prong")
      .replace(/\b(?:stone|stones|gem|gems|rhinestone|rhinestones|crystal|crystals)\s+set\s+(?:in|into|on|with)?\b/gi, (match) =>
        match.replace(/\bset\b/gi, " ")
      )
      .replace(/\bset\s+(?:stone|stones|gem|gems|rhinestone|rhinestones|crystal|crystals)\b/gi, (match) =>
        match.replace(/\bset\b/gi, " ")
      )
      .replace(/\bset\s+(?:in|with)\b/gi, " ")
  );
}

function trimQueryFillerTokens(value: string): string {
  const words = normalizeWhitespace(value).split(/\s+/).filter(Boolean);
  while (words.length && QUERY_LEADING_FILLER_WORDS.has(words[0].toLowerCase())) {
    words.shift();
  }
  while (words.length && QUERY_TRAILING_FILLER_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
}

function scrubQueryArtifacts(value: string, brief: string): string {
  let next = stripUnsupportedExactEra(value, brief)
    .replace(/[–—]/g, "-")
    .replace(/\b(?:is\s+but\s+item|but\s+item|this\s+item|item\s+identity|item\s+type)\b/gi, " ")
    .replace(/(?:^|\s)-+\s*|\s*-+(?=\s|$)/g, " ");

  next = stripInternalLabels(next);
  next = stripForbiddenQueryWords(next);
  next = trimQueryFillerTokens(next);

  if (!next || containsSourceFragment(next)) return "";
  if (/^\s*(?:-|[+/&])|(?:-|[+/&])\s*$/.test(next)) return "";
  if (/^(?:is|are|was|were|but|and|with|item)\b/i.test(next)) return "";
  if (/\bis\s+but\s+item\b/i.test(next)) return "";

  return normalizeWhitespace(next);
}

function hasSupportedExactEra(brief: string, exactEra: string): boolean {
  const lines = brief.split(/\r?\n/).filter((line) => line.includes(exactEra));
  return lines.some((line) =>
    /\b(?:seller-(?:provided|confirmed|entered)|known details)\b[^\n.]{0,120}\b(?:documented\s+)?(?:production\s+)?(?:date|year|decade|period)\b/i.test(line) ||
    /\b(?:dated\s+tag|date\s+stamp|copyright\s+date|label\s+date|marking\s+date|dated|date\s+shows|label\s+shows|marking\s+shows|documented\s+production\s+date)\b/i.test(line)
  );
}

function stripUnsupportedExactEra(value: string, brief: string): string {
  return normalizeWhitespace(
    value.replace(/\b(?:18|19|20)\d{2}s?\b/gi, (match) =>
      hasSupportedExactEra(brief, match) ? match : " "
    )
  );
}

function isLowValueOnlyPhrase(value: string): boolean {
  const cleaned = cleanQueryPhrase(value);
  if (!cleaned) return true;

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return true;

  return words.every((word) =>
    LOW_VALUE_QUERY_TERMS.some((term) => term.split(/\s+/).includes(word.toLowerCase()))
  );
}

function cleanQueryPhrase(value: string): string {
  if (containsSourceFragment(value)) return "";

  const withoutLabels = stripNonCompositeSetConstruction(stripInternalLabels(value))
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/(?:->|=>|→|←|>|<|::)/g, " ");
  const noSubjective = stripSubjectiveTerms(withoutLabels);
  const withoutPunctuation = noSubjective.replace(/[^a-z0-9\s/-]/gi, " ");
  const words = normalizeWhitespace(withoutPunctuation)
    .split(" ")
    .filter((word) => word && !QUERY_STOP_WORDS.has(word.toLowerCase()));

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(word);
  }

  return trimQueryFillerTokens(stripForbiddenQueryWords(deduped.join(" ")));
}

function cleanQueryPhraseForBrief(value: string, brief: string): string {
  return scrubQueryArtifacts(cleanQueryPhrase(stripUnsupportedExactEra(cleanQueryPhrase(value), brief)), brief);
}

function uniquePhrases(phrases: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const phrase of phrases) {
    const cleaned = cleanQueryPhrase(phrase);
    if (!cleaned || cleaned.toLowerCase() === "unbranded") continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result;
}

function countQueryWords(phrases: string[]): number {
  return phrases.join(" ").split(/\s+/).filter(Boolean).length;
}

function appendQueryPhrase(
  phrases: string[],
  phrase: string,
  maxWords: number,
  options: { allowLowValueOnly?: boolean; brief?: string; required?: boolean } = {}
): void {
  const cleaned = options.brief ? cleanQueryPhraseForBrief(phrase, options.brief) : cleanQueryPhrase(phrase);
  if (!cleaned || cleaned.toLowerCase() === "unbranded") return;
  if (!options.allowLowValueOnly && isLowValueOnlyPhrase(cleaned)) return;

  const key = cleaned.toLowerCase();
  const existingWords = new Set(phrases.join(" ").toLowerCase().split(/\s+/).filter(Boolean));
  const phraseWords = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  if (phrases.some((existing) => existing.toLowerCase() === key)) return;
  if (phraseWords.every((word) => existingWords.has(word))) return;

  const nextWords = countQueryWords(phrases) + cleaned.split(/\s+/).filter(Boolean).length;
  if (!options.required && nextWords > maxWords) return;
  phrases.push(cleaned);
}

function removeGenericQueryWords(phrase: string): string {
  return normalizeWhitespace(
    phrase
      .split(/\s+/)
      .filter((word) => !GENERIC_QUERY_WORDS.has(word.toLowerCase()))
      .join(" ")
  );
}

function appendRecommendedSlot(
  phrases: string[],
  phrase: string,
  brief: string,
  options: { protected?: boolean; allowGeneric?: boolean } = {}
): void {
  const cleaned = cleanQueryPhraseForBrief(
    options.allowGeneric ? phrase : removeGenericQueryWords(phrase),
    brief
  );
  if (!cleaned) return;

  const currentWordCount = countQueryWords(phrases);
  const nextWordCount = currentWordCount + cleaned.split(/\s+/).filter(Boolean).length;
  const maxWords = options.protected ? RECOMMENDED_QUERY_MAX_WORDS : RECOMMENDED_QUERY_TARGET_WORDS;

  appendQueryPhrase(phrases, cleaned, maxWords, {
    brief,
    required: options.protected && currentWordCount === 0 && nextWordCount > maxWords,
  });
}

function isSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /^[-*]\s+/.test(trimmed)) return false;
  const normalized = normalizeHeading(trimmed.split(":")[0] ?? trimmed);
  return SECTION_HEADINGS.some((heading) => normalizeHeading(heading) === normalized);
}

function extractSection(text: string, sectionName: string): string {
  const requested = normalizeHeading(sectionName);
  const lines = text.split(/\r?\n/);
  const collected: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const beforeColon = normalizeHeading(trimmed.split(":")[0] ?? trimmed);
    const wholeLine = normalizeHeading(trimmed);

    if (!inSection && (beforeColon === requested || wholeLine === requested)) {
      inSection = true;
      const inlineValue = trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1).trim() : "";
      if (inlineValue) collected.push(inlineValue);
      continue;
    }

    if (inSection && isSectionHeading(line)) break;
    if (inSection) collected.push(line);
  }

  return collected.join("\n").trim();
}

function extractLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${labelToPattern(label)}\\s*:?\\s*(.+)`, "i");
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(stripLeadingLabel(match[1].replace(/^[-:]\s*/, ""), labels));
    }
  }

  return "";
}

function removeLabeledLines(text: string, labels: readonly string[]): string {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = normalizeHeading(line.replace(/^\s*[-*]\s*/, "").split(":")[0] ?? "");
      return !labels.some((label) => normalizeHeading(label) === normalized);
    })
    .join("\n");
}

function stripBrandSourceQualifiers(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/[()]/g, " ")
      .replace(/^\s*(?:brand|maker|designer|manufacturer|publisher|artist|studio|label|attribution)\b\s*[:：-]?\s*/i, " ")
      .replace(/\b(?:seller-(?:confirmed|provided|entered)|seller confirmed|seller provided)\b/gi, " ")
      .replace(/\b(?:attributed to|attribution to|attribution|attributed|confirmed|provided|made by|unsigned|via|ad reference|reference)\b/gi, " ")
      .replace(/\b(?:evidence|source|basis|claim)\b.*$/i, " ")
  );
}

function isUnsupportedBrandValue(value: string): boolean {
  return !value || /^(?:vintage|documented|date|year|decade|production|period|age)$/i.test(value) ||
    /\b(?:unbranded|unknown|not specified|not provided|see photos|n\/a|none)\b/i.test(value);
}

function cleanBrandValue(value: string): string {
  const cleaned = stripBrandSourceQualifiers(value.split(/[.;|]/)[0] ?? "");
  return isUnsupportedBrandValue(cleaned) ? "" : cleaned;
}

function extractStructuredBrand(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

  const patterns = [
    /\b(?:brand|maker|designer|manufacturer|publisher|artist|studio|label|by|set\s+by)\s*[:：-]\s*([^.;,\n]+)/i,
    /\b(?:unsigned\s+but\s+confirmed\s+it\s+was\s+made\s+by|confirmed\s+set\s+by|confirmed\s+[\w\s/-]{0,40}?\s+by|confirmed\s+by|made\s+by|attributed\s+to|seller-confirmed\s+unsigned|seller-confirmed)\s+([^.;,\n]+)/i,
    /\b([^.;,\n]+?)\s*,\s*unsigned\b/i,
    /\bunsigned\s+([^.;,\n]+)/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match?.[1]) continue;
      const brand = cleanBrandValue(match[1]);
      if (brand) return brand;
    }
  }

  return "";
}

function extractBrandFromSupportedSegments(brief: string): string {
  const supportedLines = brief
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => /\b(?:seller-(?:confirmed|provided)|known details)\b/i.test(line));

  for (const line of supportedLines) {
    const segments = line.split(/[;\n]/).map(normalizeWhitespace).filter(Boolean);
    for (const segment of segments) {
      const match = segment.match(
        /\b(?:brand(?:\s*\/\s*maker)?|maker|designer|manufacturer|publisher|artist|studio|label|attribution)\b\s*[:：-]?\s+(.+)$/i
      );
      if (!match?.[1]) continue;
      const brand = cleanBrandValue(match[1]);
      if (brand) return brand;
    }

    const attributed = line.match(/\b(?:attributed to|unsigned)\s+(.+?)\s+attribution\b/i);
    if (attributed?.[1]) {
      const brand = cleanBrandValue(attributed[1]);
      if (brand) return brand;
    }
  }

  return "";
}

function extractInlineIdentityBrand(brief: string): string {
  const identitySection = extractSection(brief, "Item Identity");
  if (!identitySection) return "";

  const corroborated = extractBrandFromSupportedSegments(brief);
  if (corroborated && containsWholePhrase(identitySection, corroborated)) {
    return corroborated;
  }

  return "";
}

function extractBrand(brief: string): string {
  const structuredBrand = extractStructuredBrand(brief);
  if (structuredBrand) return structuredBrand;

  const value = extractLabeledValue(brief, [...BRAND_LABELS]);

  const labeled = cleanBrandValue(value);
  if (labeled) return labeled;

  return extractBrandFromSupportedSegments(brief) || extractInlineIdentityBrand(brief);
}

function normalizeMaterialPhrase(value: string): string {
  const normalized = normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/\bsilver[-\s]+tone\s+metal\b/g, "silver tone")
      .replace(/\bgold[-\s]+tone\s+metal\b/g, "gold tone")
      .replace(/\bbrass[-\s]+tone\s+metal\b/g, "brass tone")
      .replace(/\bsilver[-\s]+tone\b/g, "silver tone")
      .replace(/\bgold[-\s]+tone\b/g, "gold tone")
      .replace(/\bbrass[-\s]+tone\b/g, "brass tone")
      .replace(/\brhinestones\b/g, "rhinestone")
      .replace(/\bfaux pearls\b/g, "faux pearl")
  );
  const hasTone = /\b(?:silver|gold|brass)\s+tone\b/i.test(normalized);
  return hasTone ? normalizeWhitespace(normalized.replace(/\bmetal\b/gi, " ")) : normalized;
}

function extractPrimaryCandidate(brief: string): string {
  const primarySection = extractSection(brief, "Primary Style / Theme / Aesthetic Candidate");
  const labeled = extractLabeledValue(primarySection, ["Candidate Term", "Safe Wording"]);
  if (labeled) return labeled;
  if (!primarySection || /\bweak\b|\bdo not use\b|\breject(?:ed|ion)\b|\bunsupported\b/i.test(primarySection)) {
    return "";
  }

  const fallbackLine = primarySection
    .split(/\r?\n/)
    .map((line) => stripLeadingLabel(line.replace(/^\s*[-*]\s*/, ""), SECTION_HEADINGS))
    .find((line) => line.trim() && !containsSourceFragment(line) && !/^claim limit\b/i.test(line.trim()));

  return fallbackLine ? normalizeWhitespace(fallbackLine) : "";
}

function cleanCandidatePhrase(value: string): string {
  return cleanQueryPhrase(normalizeMaterialPhrase(value))
    .replace(/\b(?:design|metal)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMaterialAppearance(brief: string): string {
  const identitySection = extractSection(brief, "Item Identity");
  const value = extractLabeledValue(identitySection || brief, [
    "Material Appearance",
    "Material / Fabric",
    "Materials",
    "Material",
    "Fabric",
    "Metal",
    "Stone",
  ]);

  const materialTerms = new Set<string>();
  const labeled = cleanQueryPhrase(normalizeMaterialPhrase(value));
  for (const word of labeled.split(/\s+/).filter(Boolean)) {
    materialTerms.add(word);
  }

  const supportedText = [
    identitySection,
    extractSection(brief, "Buyer Search Keywords"),
    extractSection(brief, "Known Details"),
    extractSection(brief, "Markings / Labels"),
    extractSection(brief, "Notes"),
  ].join("\n");

  for (const term of MATERIAL_APPEARANCE_HINTS) {
    const normalizedTerm = normalizeMaterialPhrase(term);
    if (!containsWholePhrase(normalizeMaterialPhrase(supportedText), normalizedTerm)) continue;
    for (const word of cleanQueryPhrase(normalizedTerm).split(/\s+/).filter(Boolean)) {
      materialTerms.add(word);
    }
  }

  const words = Array.from(materialTerms);
  const hasTone = words.includes("tone") && (words.includes("silver") || words.includes("gold") || words.includes("brass"));
  return words
    .filter((word) => !(hasTone && word.toLowerCase() === "metal"))
    .slice(0, 6)
    .join(" ");
}

function extractBuyerSearchKeywords(brief: string): string[] {
  const section = extractSection(brief, "Buyer Search Keywords");
  if (!section) return [];

  return section
    .split(/\n|;|,/)
    .map((line) =>
      normalizeWhitespace(
        normalizeMaterialPhrase(
          stripLeadingLabel(
            line
              .replace(/^\s*[-*]\s*/, "")
              .replace(/^\s*\d+[.)]\s*/, ""),
            SECTION_HEADINGS
          )
        ).replace(/\bdesign\b/gi, " ")
      )
    )
    .filter((line) => line.length <= 80 && !containsSourceFragment(line))
    .slice(0, 18);
}

function extractCandidateBlocks(brief: string): string[] {
  const bank = extractSection(brief, "Style / Theme / Aesthetic Candidate Bank");
  if (!bank) return [];
  return bank
    .split(/(?:^|\n)\s*Candidate\s+\d+\s*:\s*/i)
    .map((block) => block.trim())
    .filter(Boolean);
}

function extractConfirmedCandidateTerms(brief: string): string[] {
  const explicitConfirmed = extractSection(brief, "Confirmed Candidate Terms")
    .split(/\n|;|,/)
    .map((line) =>
      stripLeadingLabel(
        line
          .replace(/^\s*[-*]\s*/, "")
          .replace(/^\s*\d+[.)]\s*/, ""),
        ["Candidate Term", "Safe Wording"]
      )
    )
    .filter((line) => line && !/\bweak\b|\bdo not use\b|\breject(?:ed|ion)\b|\bunsupported\b/i.test(line));

  return [
    ...explicitConfirmed,
    ...extractCandidateBlocks(brief)
      .filter((block) =>
        /\bconfirmed\b/i.test(block) &&
        !/\bweak\b|\bdo not use\b|\breject(?:ed|ion)\b|\bunsupported\b/i.test(block)
      )
      .flatMap((block) => [
        extractLabeledValue(block, ["Safe Wording"]),
        extractLabeledValue(block, ["Candidate Term"]),
      ]),
  ];
}

function extractCompositeItemType(brief: string, phrases: string[] = []): string {
  const identitySection = extractSection(brief, "Item Identity");
  const labeled = extractLabeledValue(identitySection || brief, [
    "Item Type",
    "Item Name",
    "Object Type",
    "Product Type",
    "Category",
  ]);
  const identityWithoutBrand = removeLabeledLines(identitySection, BRAND_LABELS);
  const searchable = [
    labeled,
    identityWithoutBrand,
    extractSection(brief, "Buyer Search Keywords"),
    phrases.join(" "),
  ].join(" ");

  for (const composite of COMPOSITE_PATTERNS) {
    if (composite.pattern.test(searchable)) return composite.term;
  }

  if (/\bincludes?\b[^\n.]{0,80}\b(?:and|&|\+|,)\b/i.test(searchable)) {
    return "set";
  }

  return "";
}

function extractExactCompositePhrase(brief: string, phrases: string[] = []): string {
  const identitySection = extractSection(brief, "Item Identity");
  const searchable = [
    extractLabeledValue(identitySection || brief, [
      "Item Type",
      "Item Name",
      "Object Type",
      "Product Type",
      "Category",
    ]),
    removeLabeledLines(identitySection, BRAND_LABELS),
    extractSection(brief, "Buyer Search Keywords"),
    phrases.join(" "),
  ].join(" ");

  for (const composite of COMPOSITE_PATTERNS) {
    if (!("exactTerm" in composite) || !composite.exactTerm) continue;
    if (composite.pattern.test(searchable)) return composite.exactTerm;
  }

  if (/\bset\s+includes?\b/i.test(searchable)) return "set";
  return "";
}

function extractCompositeComponentTerms(brief: string): string[] {
  const text = [
    extractSection(brief, "Item Identity"),
    extractSection(brief, "Buyer Search Keywords"),
  ].join(" ");
  const components: string[] = [];

  for (const phrase of COMPONENT_PHRASE_HINTS) {
    if (components.length >= 4) break;
    if (containsWholePhrase(text, phrase)) components.push(phrase);
  }

  for (const term of ITEM_TYPE_HINTS) {
    if (components.length >= 4) break;
    if (containsWholePhrase(text, term)) components.push(term);
  }

  return uniquePhrases(components);
}

function extractItemType(brief: string, phrases: string[]): string {
  const identitySection = extractSection(brief, "Item Identity");
  const composite = extractCompositeItemType(brief, phrases);
  if (composite) return composite;

  const labeled = extractLabeledValue(identitySection || brief, [
    "Item Type",
    "Item Name",
    "Object Type",
    "Product Type",
    "Category",
  ]);
  if (labeled) return cleanQueryPhrase(labeled);

  const searchableIdentity = removeLabeledLines(identitySection, BRAND_LABELS);
  const combined = `${phrases.join(" ")} ${searchableIdentity}`.toLowerCase();
  return ITEM_TYPE_HINTS.find((term) => containsWholePhrase(combined, term)) ?? "resale item";
}

function hasSellerConfirmedVintage(brief: string): boolean {
  return /seller-(?:confirmed|provided)[^\n.]{0,80}\bvintage\b/i.test(brief) ||
    /known details[^\n.]{0,120}\bvintage\b/i.test(brief);
}

function hasUnsignedAttribution(brief: string): boolean {
  return /\bunsigned\b/i.test(brief) &&
    /(seller-provided|seller-confirmed|attribution|attributed)/i.test(brief);
}

function vintageCategoryPath(path: string, isVintage: boolean): string {
  if (!isVintage || !path.startsWith("Jewelry & Watches > Fashion Jewelry >")) return path;
  return path.replace(
    "Jewelry & Watches > Fashion Jewelry >",
    "Jewelry & Watches > Vintage & Antique Jewelry >"
  );
}

function encodeEbayQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("+");
}

function buildQueryTerms(brief: string): {
  terms: string[];
  explanationTerms: string[];
  narrowerTerms: string[];
  broaderTerms: string[];
} {
  const buyerKeywords = uniquePhrases(extractBuyerSearchKeywords(brief));
  const brand = cleanQueryPhrase(extractBrand(brief));
  const materialAppearance = extractMaterialAppearance(brief);
  const primaryCandidate = cleanCandidatePhrase(extractPrimaryCandidate(brief));
  const confirmedCandidates = uniquePhrases(
    extractConfirmedCandidateTerms(brief).map(cleanCandidatePhrase)
  );
  const compositeItemType = cleanQueryPhrase(extractCompositeItemType(brief, buyerKeywords));
  const exactCompositePhrase = cleanQueryPhrase(extractExactCompositePhrase(brief, buyerKeywords));
  const itemType = compositeItemType || cleanQueryPhrase(extractItemType(brief, buyerKeywords));
  const componentTerms = compositeItemType ? extractCompositeComponentTerms(brief) : [];
  const isVintage = hasSellerConfirmedVintage(brief);
  const isUnsigned = hasUnsignedAttribution(brief);
  const strongestCandidate = primaryCandidate || confirmedCandidates[0] || "";
  const phraseCandidates = uniquePhrases([
    ...buyerKeywords,
    primaryCandidate,
    ...confirmedCandidates,
  ]);

  const finalTerms: string[] = [];
  appendRecommendedSlot(finalTerms, brand, brief, { protected: true, allowGeneric: true });
  appendRecommendedSlot(finalTerms, isUnsigned ? "unsigned" : "", brief, { protected: true });
  appendRecommendedSlot(finalTerms, isVintage ? "vintage" : "", brief, { protected: true });
  appendRecommendedSlot(finalTerms, exactCompositePhrase, brief, { protected: true, allowGeneric: true });
  if (!exactCompositePhrase) {
    appendRecommendedSlot(finalTerms, itemType, brief, { protected: true, allowGeneric: true });
  }
  appendRecommendedSlot(finalTerms, materialAppearance, brief, { protected: true });
  appendRecommendedSlot(finalTerms, strongestCandidate, brief, { protected: true });
  for (const component of componentTerms) {
    appendRecommendedSlot(finalTerms, component, brief);
  }

  for (const phrase of phraseCandidates) {
    appendRecommendedSlot(finalTerms, phrase, brief);
  }

  if (!finalTerms.length) appendRecommendedSlot(finalTerms, itemType, brief, { protected: true, allowGeneric: true });

  const narrowerTerms = [...finalTerms];
  let distinguishingAdded = 0;
  for (const phrase of uniquePhrases([...componentTerms, ...phraseCandidates])) {
    const before = narrowerTerms.length;
    appendQueryPhrase(narrowerTerms, phrase, countQueryWords(finalTerms) + 6, {
      allowLowValueOnly: distinguishingAdded < 3,
      brief,
    });
    if (narrowerTerms.length > before) distinguishingAdded += 1;
    if (distinguishingAdded >= 3) break;
  }

  const broaderTerms: string[] = [];
  appendQueryPhrase(broaderTerms, brand, 10, { brief, required: true });
  appendQueryPhrase(broaderTerms, isVintage ? "vintage" : "", 10, { brief, required: true });
  appendQueryPhrase(broaderTerms, exactCompositePhrase, 10, { brief, required: true });
  appendQueryPhrase(broaderTerms, itemType, 10, { brief, required: true });
  appendQueryPhrase(broaderTerms, materialAppearance, 10, { brief, required: true });
  appendQueryPhrase(broaderTerms, strongestCandidate, 12, { brief });
  for (const component of componentTerms.slice(0, 2)) {
    appendQueryPhrase(broaderTerms, component, 14, { brief });
  }

  return {
    terms: finalTerms,
    explanationTerms: uniquePhrases([
      brand,
      isUnsigned ? "unsigned" : "",
      isVintage ? "vintage" : "",
      exactCompositePhrase,
      itemType,
      materialAppearance,
      ...componentTerms,
      ...buyerKeywords.slice(0, 3),
      primaryCandidate,
      ...confirmedCandidates.slice(0, 2),
    ].map((phrase) => cleanQueryPhraseForBrief(phrase, brief))),
    narrowerTerms: uniquePhrases(narrowerTerms),
    broaderTerms: broaderTerms.length ? uniquePhrases(broaderTerms) : finalTerms.slice(0, Math.min(4, finalTerms.length)),
  };
}

function extractFinalLpuEbayCategory(finalLpuOutput?: string): string {
  if (!finalLpuOutput?.trim()) return "";

  const ebayStart = finalLpuOutput.search(/\bEBAY\b/i);
  const ebayText = ebayStart >= 0 ? finalLpuOutput.slice(ebayStart) : finalLpuOutput;
  const nextPlatform = ebayText.search(/\n(?:DEPOP|POSHMARK|MERCARI|ETSY|WHATNOT)\b/i);
  const ebaySection = nextPlatform > 0 ? ebayText.slice(0, nextPlatform) : ebayText;

  return extractLabeledValue(ebaySection, ["Category", "Primary Store Category"]);
}

function matchCategoryByTerms(haystack: string, categories: readonly {
  name: string;
  path: string;
  terms: readonly string[];
  range: readonly [number, number];
}[]) {
  return categories.find((category) =>
    category.terms.some((term) => containsWholePhrase(haystack, term))
  );
}

function inferCategory(brief: string, finalLpuOutput?: string) {
  const finalCategory = extractFinalLpuEbayCategory(finalLpuOutput);
  if (finalCategory) {
    return {
      name: finalCategory,
      path: finalCategory,
      confidence: "Final LP-U derived" as EbayCategoryConfidence,
      notes: "Derived from the generated final LP-U eBay category text. No eBay category ID is claimed.",
    };
  }

  const buyerKeywords = extractBuyerSearchKeywords(brief);
  const compositeItemType = extractCompositeItemType(brief, buyerKeywords);
  const itemType = extractItemType(brief, buyerKeywords);
  const isVintage = hasSellerConfirmedVintage(brief);
  const identityWithoutBrand = removeLabeledLines(extractSection(brief, "Item Identity"), BRAND_LABELS);
  const haystack = compositeItemType
    ? `${compositeItemType} ${buyerKeywords.join(" ")} ${identityWithoutBrand}`.toLowerCase()
    : itemType !== "resale item"
    ? itemType.toLowerCase()
    : `${buyerKeywords.join(" ")} ${identityWithoutBrand}`.toLowerCase();
  const specificMatch = matchCategoryByTerms(haystack, CATEGORY_RULES);

  if (specificMatch) {
    return {
      name: specificMatch.name,
      path: vintageCategoryPath(specificMatch.path, isVintage),
      confidence: "AI suggested" as EbayCategoryConfidence,
      notes: "Conservative brief-derived category path based on item type. No exact eBay category ID is claimed.",
    };
  }

  const match = matchCategoryByTerms(haystack, CATEGORY_HINTS);

  if (!match) {
    return {
      name: "Best-fit eBay resale category",
      path: "Use eBay category search or Seller Hub category suggestions",
      confidence: "Low confidence" as EbayCategoryConfidence,
      notes: "Conservative brief-derived category hint only. Future eBay Taxonomy API support can add categoryId.",
    };
  }

  return {
    name: match.name,
    path: match.path,
    confidence: "Low confidence" as EbayCategoryConfidence,
    notes: "Conservative brief-derived category hint only. No exact eBay category ID is claimed.",
  };
}

function inferPricingCategory(brief: string) {
  const buyerKeywords = extractBuyerSearchKeywords(brief);
  const compositeItemType = extractCompositeItemType(brief, buyerKeywords);
  const itemType = extractItemType(brief, buyerKeywords);
  const identityWithoutBrand = removeLabeledLines(extractSection(brief, "Item Identity"), BRAND_LABELS);
  const haystack = compositeItemType
    ? `${compositeItemType} ${buyerKeywords.join(" ")} ${identityWithoutBrand}`.toLowerCase()
    : itemType !== "resale item"
    ? itemType.toLowerCase()
    : `${buyerKeywords.join(" ")} ${identityWithoutBrand}`.toLowerCase();

  return (
    matchCategoryByTerms(haystack, CATEGORY_RULES) ??
    matchCategoryByTerms(haystack, CATEGORY_HINTS)
  );
}

function inferAiRange(brief: string): {
  low: number;
  high: number;
  confidence: AiStartingRangeConfidence;
  basis: string;
  warnings: string[];
} {
  const category = inferPricingCategory(brief);
  const [baseLow, baseHigh] = category?.range ?? [12, 45];
  const hasBrand = Boolean(extractBrand(brief));
  const hasMeasurements = /measurement|dimensions|size|length|width|height|inseam/i.test(brief);
  const complete = /complete|sealed|new with tags|new in box|appears intact|no obvious missing/i.test(brief);
  const testingConcern = /untested|not tested|not working|does not power|for parts|function issue/i.test(brief);
  const wearConcern = /flaw|wear|damage|missing|crack|chip|stain|repair/i.test(brief);
  const conditionConcern = testingConcern || wearConcern;
  const itemType = extractItemType(brief, extractBuyerSearchKeywords(brief));

  let low = baseLow;
  let high = baseHigh;
  const basisParts = [
    itemType && itemType !== "resale item" ? `${itemType} item type` : category ? `${category.name} item type` : "broad resale item type",
  ];

  if (hasBrand) {
    high *= 1.18;
    basisParts.push("supported brand/maker identifier");
  }

  if (complete) {
    low *= 1.05;
    high *= 1.1;
    basisParts.push("brief suggests completeness or intact presentation");
  }

  if (conditionConcern) {
    low *= 0.85;
    high *= 0.9;
    basisParts.push(testingConcern ? "seller-entered testing/function issue" : "condition notes or visible wear");
  }

  const confidence: AiStartingRangeConfidence =
    category && hasBrand && hasMeasurements && !conditionConcern
      ? "Medium"
      : category && (hasBrand || hasMeasurements)
        ? "Low-medium"
        : "Low";

  return {
    low: Math.max(5, roundCurrency(low)),
    high: Math.max(9, roundCurrency(high)),
    confidence,
    basis: `Broad non-comp estimate based on ${basisParts.join(", ")}. This does not use sold comps, marketplace averages, or sell-through data.`,
    warnings: [
      "Manual sold comp data is needed before treating pricing as market-supported.",
      "AI Starting Range is only a starting estimate and must not override relevant manual comps.",
    ],
  };
}

function normalizePricingInput(
  input: PricingResearchInput | string,
  finalLpuOutput?: string
): PricingResearchInput {
  if (typeof input === "string") {
    return {
      sellingBrief: input,
      finalOutput: finalLpuOutput,
    };
  }

  return input;
}

function formatAllowedSection(name: string, value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${name}:\n${trimmed}` : "";
}

function buildAllowedPricingSource(input: PricingResearchInput): string {
  const sellingBrief = input.sellingBrief || "";
  const confirmedCandidates = uniquePhrases(
    extractConfirmedCandidateTerms(sellingBrief).map(cleanCandidatePhrase)
  );

  return [
    formatAllowedSection("Known Details", input.knownDetails || ""),
    formatAllowedSection("Markings / Labels", input.markingsLabels || ""),
    formatAllowedSection("Notes", input.notes || ""),
    formatAllowedSection("Measurements", input.measurements || ""),
    formatAllowedSection("Condition / Flaws", input.conditionFlaws || ""),
    formatAllowedSection("Buyer Search Keywords", extractSection(sellingBrief, "Buyer Search Keywords")),
    formatAllowedSection("Item Identity", extractSection(sellingBrief, "Item Identity")),
    formatAllowedSection(
      "Primary Style / Theme / Aesthetic Candidate",
      extractSection(sellingBrief, "Primary Style / Theme / Aesthetic Candidate")
    ),
    formatAllowedSection(
      "Confirmed Candidate Terms",
      confirmedCandidates.map((term) => `- Candidate Term: ${term}`).join("\n")
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPricingResearchFromBrief(
  input: PricingResearchInput | string,
  finalLpuOutput?: string
): PricingResearchGenerated {
  const pricingInput = normalizePricingInput(input, finalLpuOutput);
  const allowedSource = buildAllowedPricingSource(pricingInput);
  const { terms, explanationTerms, narrowerTerms, broaderTerms } = buildQueryTerms(allowedSource);
  const query = cleanQueryPhraseForBrief(terms.join(" "), allowedSource);
  const broaderQuery = cleanQueryPhraseForBrief(broaderTerms.join(" "), allowedSource) || query;
  const narrowerQuery = cleanQueryPhraseForBrief(narrowerTerms.join(" "), allowedSource) || query;
  const category = inferCategory(allowedSource, pricingInput.finalOutput);
  const aiRange = inferAiRange(allowedSource);

  return {
    researchKeywords: query,
    ebaySoldCompsUrl: `${EBAY_SOLD_SEARCH_BASE_URL}?_nkw=${encodeEbayQuery(query)}&LH_Sold=1&LH_Complete=1`,
    ebaySoldCompsExplanation: explanationTerms.length
      ? `Built from structured Item Intake and whitelisted Selling Brief identifiers: ${explanationTerms.join(", ")}. Subjective filler and unsupported terms are removed.`
      : "Built from structured Item Intake and whitelisted Selling Brief sections using available item identifiers only.",
    terapeakResearchQuery: query,
    broaderResearchQuery: broaderQuery,
    narrowerResearchQuery: narrowerQuery,
    suggestedEbayCategoryName: category.name,
    suggestedEbayCategoryPath: category.path,
    suggestedEbayCategoryConfidence: category.confidence,
    categoryNotes: category.notes,
    aiStartingRangeLow: aiRange.low,
    aiStartingRangeHigh: aiRange.high,
    aiStartingRangeConfidence: aiRange.confidence,
    aiStartingRangeBasis: aiRange.basis,
    pricingWarnings: aiRange.warnings,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToPricingConvention(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (value < 25) {
    return Math.max(0.99, Math.floor(value) + 0.99);
  }

  if (value <= 100) {
    const lower = Math.floor(value / 10) * 10 + 4.99;
    const upper = Math.floor(value / 10) * 10 + 9.99;
    return Math.abs(value - lower) <= Math.abs(value - upper) ? lower : upper;
  }

  const increment = value < 200 ? 5 : 10;
  return Math.round(value / increment) * increment;
}

function median(values: number[]): number | null {
  if (!values.length) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) return sorted[middle];

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedMedian(
  values: Array<{ value: number; weight: number }>
): number | null {
  const usableValues = values
    .filter(
      (item) =>
        Number.isFinite(item.value) &&
        item.value > 0 &&
        Number.isFinite(item.weight) &&
        item.weight > 0
    )
    .sort((a, b) => a.value - b.value);

  if (!usableValues.length) return null;

  const totalWeight = usableValues.reduce((sum, item) => sum + item.weight, 0);
  let runningWeight = 0;

  for (const item of usableValues) {
    runningWeight += item.weight;
    if (runningWeight >= totalWeight / 2) return item.value;
  }

  return usableValues[usableValues.length - 1].value;
}

function confidenceRankForPublicWebComps(
  confidence: PublicWebCompPricingConfidence
): number {
  switch (confidence) {
    case "Very Low":
      return 0;
    case "Low":
      return 1;
    case "Medium":
      return 2;
    case "High":
      return 3;
  }
}

function confidenceFromPublicWebCompRank(
  rank: number
): PublicWebCompPricingConfidence {
  if (rank >= 3) return "High";
  if (rank === 2) return "Medium";
  if (rank === 1) return "Low";
  return "Very Low";
}

function capPublicWebCompConfidence(
  confidence: PublicWebCompPricingConfidence,
  maxConfidence: PublicWebCompPricingConfidence
): PublicWebCompPricingConfidence {
  return confidenceFromPublicWebCompRank(
    Math.min(
      confidenceRankForPublicWebComps(confidence),
      confidenceRankForPublicWebComps(maxConfidence)
    )
  );
}

function publicWebCompSourceWeight(source: SelectedWebCompPricingSource): number {
  let weight = 0;

  switch (source.similarity) {
    case "strong":
      weight = 1;
      break;
    case "medium":
      weight = 0.85;
      break;
    case "weak":
      weight = 0.55;
      break;
    case "not_comparable":
      weight = 0.25;
      break;
  }

  if (source.matchType === "component_only") weight = Math.min(weight, 0.45);
  if (source.status === "active_or_unclear") weight = Math.min(weight, 0.35);
  if (!source.eligibleForPricing) weight = Math.min(weight, 0.35);
  if (source.userOverrideRisk === "high") weight = Math.min(weight, 0.25);
  if (source.status === "best_offer_uncertain") weight *= 0.85;

  return Math.max(0.1, weight);
}

function adjustedPublicWebCompPrice(
  source: SelectedWebCompPricingSource
): number {
  const visiblePrice = source.visiblePrice ?? 0;
  return source.status === "best_offer_uncertain"
    ? visiblePrice * 0.9
    : visiblePrice;
}

function removeExtremePublicWebCompOutliers(
  comps: Array<{
    source: SelectedWebCompPricingSource;
    value: number;
    weight: number;
  }>
): Array<{
  source: SelectedWebCompPricingSource;
  value: number;
  weight: number;
}> {
  if (comps.length < 5) return comps;

  const sortedValues = comps.map((comp) => comp.value).sort((a, b) => a - b);
  const lowerHalf = sortedValues.slice(0, Math.floor(sortedValues.length / 2));
  const upperHalf = sortedValues.slice(Math.ceil(sortedValues.length / 2));
  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);

  if (q1 === null || q3 === null) return comps;

  const iqr = q3 - q1;
  if (iqr <= 0) return comps;

  const lowerFence = q1 - iqr * 1.5;
  const upperFence = q3 + iqr * 1.5;
  const filtered = comps.filter(
    (comp) => comp.value >= lowerFence && comp.value <= upperFence
  );

  return filtered.length ? filtered : comps;
}

function getPublicWebCompCountConfidence(
  count: number
): PublicWebCompPricingConfidence {
  if (count >= 10) return "High";
  if (count >= 4) return "Medium";
  if (count >= 1) return "Low";
  return "Very Low";
}

function getPublicWebCompQualityConfidence(
  sources: SelectedWebCompPricingSource[]
): PublicWebCompPricingConfidence {
  if (!sources.length) return "Very Low";

  const strongOrMediumCount = sources.filter(
    (source) => source.similarity === "strong" || source.similarity === "medium"
  ).length;
  const weakOrComponentCount = sources.filter(
    (source) =>
      source.similarity === "weak" || source.matchType === "component_only"
  ).length;
  const activeOrUnclearCount = sources.filter(
    (source) => source.status === "active_or_unclear"
  ).length;
  const highRiskOverrideCount = sources.filter(
    (source) => !source.eligibleForPricing && source.userOverrideRisk === "high"
  ).length;

  if (sources.length <= 2 && weakOrComponentCount === sources.length) {
    return "Very Low";
  }
  if (activeOrUnclearCount >= sources.length / 2) return "Very Low";
  if (highRiskOverrideCount > 0 && strongOrMediumCount < 3) return "Very Low";
  if (weakOrComponentCount === sources.length) return "Low";
  if (strongOrMediumCount >= 10) return "High";
  if (strongOrMediumCount >= 4) return "Medium";
  return "Low";
}

export function hasManualCompPriceData(manual: ManualCompInputs): boolean {
  return Boolean(
    (manual.medianSoldPrice && manual.medianSoldPrice > 0) ||
      (manual.averageSoldPrice && manual.averageSoldPrice > 0) ||
      (manual.lowRelevantSold &&
        manual.lowRelevantSold > 0 &&
        manual.highRelevantSold &&
        manual.highRelevantSold > 0)
  );
}

export function derivePricingFromSelectedWebComps(
  selectedSources: SelectedWebCompPricingSource[],
  summary?: PublicWebCompPricingSummary | null,
  _generated?: Partial<PricingResearchGenerated> | null,
  conditionMatch: ConditionMatch = "unknown"
): DerivedPricingResult {
  const usableSources = selectedSources.filter(
    (source) =>
      source.usedInPricing &&
      !source.hardDisabled &&
      source.visiblePrice !== null &&
      source.visiblePrice > 0
  );

  if (!usableSources.length) {
    if (
      summary?.selectedSoldResultsUsed &&
      summary.selectedSoldResultsUsed > 0 &&
      summary.suggestedPrice &&
      summary.suggestedPrice > 0
    ) {
      const fallbackConfidence = capPublicWebCompConfidence(
        summary.confidence ?? "Very Low",
        "Low"
      );
      const conditionAdjustment =
        PRICING_RESEARCH_CONSTANTS.conditionAdjustment[conditionMatch];
      const suggestedListPrice = roundToPricingConvention(
        summary.suggestedPrice * conditionAdjustment
      );
      const fastSalePrice = roundToPricingConvention(
        suggestedListPrice * (fallbackConfidence === "Low" ? 0.84 : 0.78)
      );
      const bestOfferFloor = roundToPricingConvention(
        suggestedListPrice * (fallbackConfidence === "Low" ? 0.7 : 0.65)
      );

      return {
        suggestedListPrice,
        fastSalePrice,
        bestOfferFloor,
        pricingConfidence: fallbackConfidence,
        pricingSource: "public_web_comps",
        pricingExplanation:
          "Public Web Comp source-level visible prices were unavailable, so the Public Web Comp summary price was used as limited fallback context. Manual comp price data will override this recommendation if entered.",
      };
    }

    return {
      suggestedListPrice: null,
      fastSalePrice: null,
      bestOfferFloor: null,
      pricingConfidence: "Very Low",
      pricingSource: "ai_fallback",
      pricingExplanation:
        "No selected Public Web Comp sources with visible prices are available.",
    };
  }

  const weightedComps = removeExtremePublicWebCompOutliers(
    usableSources.map((source) => ({
      source,
      value: adjustedPublicWebCompPrice(source),
      weight: publicWebCompSourceWeight(source),
    }))
  );
  const basePrice = weightedMedian(weightedComps);

  if (basePrice === null) {
    return {
      suggestedListPrice: null,
      fastSalePrice: null,
      bestOfferFloor: null,
      pricingConfidence: "Very Low",
      pricingSource: "ai_fallback",
      pricingExplanation:
        "Selected Public Web Comp sources did not expose usable visible prices.",
    };
  }

  const sourceCount = usableSources.length;
  const selectedCount = summary?.selectedSoldResultsUsed ?? sourceCount;
  const bestOfferUncertainCount = usableSources.filter(
    (source) => source.status === "best_offer_uncertain"
  ).length;
  const overriddenCount = usableSources.filter(
    (source) => !source.eligibleForPricing
  ).length;
  const activeOrUnclearCount = usableSources.filter(
    (source) => source.status === "active_or_unclear"
  ).length;
  const notComparableCount = usableSources.filter(
    (source) => source.similarity === "not_comparable"
  ).length;
  const weakOrComponentCount = usableSources.filter(
    (source) =>
      source.similarity === "weak" || source.matchType === "component_only"
  ).length;

  let pricingConfidence = capPublicWebCompConfidence(
    getPublicWebCompCountConfidence(sourceCount),
    getPublicWebCompQualityConfidence(usableSources)
  );

  if (summary?.confidence) {
    pricingConfidence = capPublicWebCompConfidence(
      pricingConfidence,
      summary.confidence
    );
  }

  if (bestOfferUncertainCount > 0 || summary?.bestOfferCaveatUsed) {
    pricingConfidence = capPublicWebCompConfidence(pricingConfidence, "Medium");
  }
  if (bestOfferUncertainCount > sourceCount / 2 && sourceCount < 5) {
    pricingConfidence = capPublicWebCompConfidence(pricingConfidence, "Low");
  }
  if (overriddenCount > 0) {
    pricingConfidence = capPublicWebCompConfidence(pricingConfidence, "Low");
  }
  if (activeOrUnclearCount > 0) {
    pricingConfidence = capPublicWebCompConfidence(
      pricingConfidence,
      activeOrUnclearCount >= sourceCount / 2 ? "Very Low" : "Low"
    );
  }
  if (notComparableCount > 0 && sourceCount < 4) {
    pricingConfidence = capPublicWebCompConfidence(pricingConfidence, "Very Low");
  }
  if (sourceCount === 1) {
    pricingConfidence = capPublicWebCompConfidence(
      pricingConfidence,
      weakOrComponentCount === 1 || overriddenCount > 0 ? "Very Low" : "Low"
    );
  }

  const conditionAdjustment =
    PRICING_RESEARCH_CONSTANTS.conditionAdjustment[conditionMatch];
  const confidenceListMultiplier =
    pricingConfidence === "High"
      ? 1.04
      : pricingConfidence === "Medium"
        ? 1.02
        : pricingConfidence === "Low"
          ? 0.98
          : 0.95;
  const suggestedListPrice = roundToPricingConvention(
    basePrice * conditionAdjustment * confidenceListMultiplier
  );
  const fastSaleMultiplier =
    pricingConfidence === "High" || pricingConfidence === "Medium"
      ? 0.88
      : pricingConfidence === "Low"
        ? 0.84
        : 0.78;
  const bestOfferFloorMultiplier =
    pricingConfidence === "High" || pricingConfidence === "Medium"
      ? 0.75
      : pricingConfidence === "Low"
        ? 0.7
        : 0.65;
  const uncertaintyFloorMultiplier =
    bestOfferUncertainCount > 0 ? bestOfferFloorMultiplier - 0.03 : bestOfferFloorMultiplier;
  const fastSalePrice = roundToPricingConvention(
    suggestedListPrice * fastSaleMultiplier
  );
  const bestOfferFloor = roundToPricingConvention(
    suggestedListPrice * Math.max(0.55, uncertaintyFloorMultiplier)
  );

  const caveats = [];
  if (bestOfferUncertainCount > 0) {
    caveats.push(
      "Best Offer uncertain prices were treated as visible upper-bound evidence."
    );
  }
  if (overriddenCount > 0) {
    caveats.push("User-selected override sources capped confidence.");
  }
  if (weightedComps.length < usableSources.length) {
    caveats.push("Statistically extreme selected prices were excluded.");
  }

  return {
    suggestedListPrice,
    fastSalePrice,
    bestOfferFloor,
    pricingConfidence,
    pricingSource: "public_web_comps",
    pricingExplanation: [
      `Selected Public Web Comp sources were analyzed directly (${sourceCount} usable visible-price source${sourceCount === 1 ? "" : "s"} selected; ${selectedCount} total selected).`,
      "Confidence is based on selected source count, similarity, match type, user overrides, and Best Offer uncertainty.",
      "Manual comp price data will override this recommendation if entered.",
      ...caveats,
    ].join(" "),
  };
}

function getBasePrice(
  manual: ManualCompInputs,
  generated: PricingResearchGenerated
): { value: number; source: string; usedAiFallback: boolean } {
  if (manual.medianSoldPrice && manual.medianSoldPrice > 0) {
    return { value: manual.medianSoldPrice, source: "manual median sold price", usedAiFallback: false };
  }

  if (manual.averageSoldPrice && manual.averageSoldPrice > 0) {
    return { value: manual.averageSoldPrice, source: "manual average sold price", usedAiFallback: false };
  }

  if (
    manual.lowRelevantSold &&
    manual.lowRelevantSold > 0 &&
    manual.highRelevantSold &&
    manual.highRelevantSold > 0
  ) {
    return {
      value: (manual.lowRelevantSold + manual.highRelevantSold) / 2,
      source: "manual low/high relevant sold midpoint",
      usedAiFallback: false,
    };
  }

  return {
    value: (generated.aiStartingRangeLow + generated.aiStartingRangeHigh) / 2,
    source: "AI Starting Range midpoint fallback",
    usedAiFallback: true,
  };
}

function getSellThroughAdjustment(sellThroughPercent?: number): number {
  if (sellThroughPercent === undefined || !Number.isFinite(sellThroughPercent)) {
    return 1;
  }

  if (sellThroughPercent >= 80) {
    return PRICING_RESEARCH_CONSTANTS.sellThroughAdjustment.high;
  }
  if (sellThroughPercent >= 50) {
    return PRICING_RESEARCH_CONSTANTS.sellThroughAdjustment.mediumHigh;
  }
  if (sellThroughPercent >= 20) {
    return PRICING_RESEARCH_CONSTANTS.sellThroughAdjustment.mediumLow;
  }
  return PRICING_RESEARCH_CONSTANTS.sellThroughAdjustment.low;
}

function scorePricingConfidence(
  manual: ManualCompInputs,
  usedAiFallback: boolean
): PricingConfidence {
  if (usedAiFallback) return "Low";

  let score = 1;
  if (manual.medianSoldPrice || manual.averageSoldPrice) score += 2;
  if (manual.soldCount !== undefined) score += manual.soldCount >= 8 ? 2 : manual.soldCount >= 3 ? 1 : -1;
  if (manual.sellThroughPercent !== undefined) score += 1;
  if (manual.activeCount !== undefined) score += 1;
  if (manual.lookbackWindow === "90d") score += 2;
  if (manual.lookbackWindow === "6mo") score += 1;
  if (manual.lookbackWindow === "2y") score -= 1;
  if (manual.lookbackWindow === "3y") score -= 2;
  if (manual.lookbackWindow === "custom" && !manual.compNotes?.trim()) score -= 1;

  if (score >= 7) return "High";
  if (score >= 5) return "Medium-high";
  if (score >= 3) return "Medium";
  if (score >= 2) return "Low-medium";
  return "Low";
}

export function calculatePricingRecommendation(
  manual: ManualCompInputs,
  generated: PricingResearchGenerated,
  publicWebComps?: {
    summary?: PublicWebCompPricingSummary | null;
    sources?: SelectedWebCompPricingSource[];
  } | null
): PricingRecommendation {
  if (!hasManualCompPriceData(manual)) {
    const publicWebCompPricing = derivePricingFromSelectedWebComps(
      publicWebComps?.sources ?? [],
      publicWebComps?.summary,
      generated,
      manual.conditionMatch ?? "unknown"
    );

    if (
      publicWebCompPricing.pricingSource === "public_web_comps" &&
      publicWebCompPricing.suggestedListPrice !== null &&
      publicWebCompPricing.fastSalePrice !== null &&
      publicWebCompPricing.bestOfferFloor !== null
    ) {
      return {
        suggestedListPrice: publicWebCompPricing.suggestedListPrice,
        fastSalePrice: publicWebCompPricing.fastSalePrice,
        bestOfferFloor: publicWebCompPricing.bestOfferFloor,
        pricingConfidence: publicWebCompPricing.pricingConfidence,
        pricingExplanation: publicWebCompPricing.pricingExplanation,
        basePriceSource: "selected Public Web Comp source prices",
        usedAiFallback: false,
        pricingSource: "public_web_comps",
      };
    }
  }

  const basePrice = getBasePrice(manual, generated);
  const conditionMatch = manual.conditionMatch ?? "unknown";
  const conditionAdjustment =
    PRICING_RESEARCH_CONSTANTS.conditionAdjustment[conditionMatch];
  const sellThroughAdjustment = getSellThroughAdjustment(manual.sellThroughPercent);
  const adjusted = basePrice.value * conditionAdjustment * sellThroughAdjustment;
  const suggestedListPrice = roundToPricingConvention(adjusted);
  const fastSalePrice = roundToPricingConvention(
    suggestedListPrice * PRICING_RESEARCH_CONSTANTS.fastSaleMultiplier
  );
  const bestOfferFloor = roundToPricingConvention(
    suggestedListPrice * PRICING_RESEARCH_CONSTANTS.bestOfferFloorMultiplier
  );

  const explanationParts = [
    `Base uses ${basePrice.source}.`,
    `Condition adjustment: ${conditionMatch} (${conditionAdjustment.toFixed(2)}x).`,
  ];

  if (manual.sellThroughPercent !== undefined) {
    explanationParts.push(
      `Manual sell-through adjustment applied from ${manual.sellThroughPercent}% (${sellThroughAdjustment.toFixed(2)}x).`
    );
  } else {
    explanationParts.push("No sell-through adjustment applied because sell-through was not entered.");
  }

  if (basePrice.usedAiFallback) {
    explanationParts.push("This recommendation is an AI-range fallback, not sold-comp derived.");
  } else {
    explanationParts.push("Manual comp data overrides the AI starting range.");
  }

  return {
    suggestedListPrice,
    fastSalePrice,
    bestOfferFloor,
    pricingConfidence: scorePricingConfidence(manual, basePrice.usedAiFallback),
    pricingExplanation: explanationParts.join(" "),
    basePriceSource: basePrice.source,
    usedAiFallback: basePrice.usedAiFallback,
    pricingSource: basePrice.usedAiFallback ? "ai_fallback" : "manual",
  };
}
