function clean(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const CANONICAL_CATEGORY_PATHS: Record<string, string> = {
  "women > dresses":
    "Clothing, Shoes & Accessories > Women > Women's Clothing > Dresses",
  "women > skirts":
    "Clothing, Shoes & Accessories > Women > Women's Clothing > Skirts",
  "women > tops":
    "Clothing, Shoes & Accessories > Women > Women's Clothing > Tops",
};

export function buildVendooCategoryPath(input: {
  simpleCategory: string;
}): string | null {
  const key = clean(input.simpleCategory).toLowerCase();
  return CANONICAL_CATEGORY_PATHS[key] ?? null;
}
