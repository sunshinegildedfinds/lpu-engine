"use client";

import { useMemo, useState } from "react";
import { PayloadPreviewCard } from "@/components/vendoo/PayloadPreviewCard";
import { ReadyToSendCard } from "@/components/vendoo/ReadyToSendCard";
import type { FinalTitleSelection } from "@/lib/ebay/selectFinalTitle";
import { validateEbayDraft } from "@/lib/ebay/validateDraft";
import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";
import { buildVendooCategoryPath } from "@/lib/vendoo/buildVendooCategoryPath";
import type {
  EbayItemSpecifics,
  VendooPhotoPayload,
  VendooPricingMeta,
  VendooResearchMeta,
} from "@/lib/vendoo/extensionPayload";
import { getReadyToSendState } from "@/lib/vendoo/getReadyToSendState";
import { buildVendooExtensionPayload } from "@/lib/vendoo/extensionPayload";

type Layer3Seed = {
  titleA: string;
  titleB: string;
  description: string;
  ebaySection: string;
  poshmarkStyleTags?: string;
  photos?: VendooPhotoPayload[];
  researchMeta?: VendooResearchMeta;
  pricing?: VendooPricingMeta;
  resolvedPrice?: string;
  depop?: {
    listing?: string;
    hashtags?: string;
    optionalBrandHashtags?: string;
  };
  poshmark?: {
    title?: string;
    description?: string;
    styleTags?: string;
    categoryPath?: string;
    adjustedPrice?: string;
  };
  etsy?: {
    title?: string;
    description?: string;
    tags?: string;
    categoryPath?: string;
    adjustedPrice?: string;
    materials?: string;
    style?: string;
    theme?: string;
    occasion?: string;
    gemstone?: string;
    gemColor?: string;
    age?: string;
  };
};

type SendFeedbackState = {
  status: "idle" | "sent" | "failed";
  message: string;
};

const INITIAL_SEND_FEEDBACK: SendFeedbackState = {
  status: "idle",
  message: "",
};

function normalizeToken(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isJewelryLike(value: string): boolean {
  const normalized = normalizeToken(value);
  const tokens = new Set(normalized.match(/[a-z0-9]+/g) ?? []);
  const keywords = [
    "brooch",
    "bracelet",
    "earrings",
    "necklace",
    "ring",
    "pin",
    "pendant",
    "jewelry",
    "parure",
  ];

  return keywords.some((keyword) => tokens.has(keyword));
}

function normalizeValue(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s\-–—:;,.]+/, "")
    .replace(/[\s\-–—:;,.]+$/, "");
}

function parsePriceNumber(value: string): number | null {
  const cleaned = String(value ?? "").replace(/[$,\s]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatPriceForPayload(value: number): string {
  return value.toFixed(2);
}

function normalizeLabel(value: string): string {
  return normalizeToken(value.replace(/:$/, ""));
}

function parseVendooBaseTags(raw: string | undefined): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  const tokens = raw
    .split(/\r?\n|,/)
    .map((token) => token.trim().replace(/^#+/, ""))
    .map((token) => token.replace(/\s+/g, " "))
    .filter(Boolean);

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function extractDepopSingleLineValue(section: string, labels: readonly string[]): string {
  if (!section.trim()) return "";
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLabelLine(line, labels)) continue;
    const colonIndex = line.indexOf(":");
    const sameLineValue = colonIndex >= 0 ? normalizeValue(line.slice(colonIndex + 1)) : "";
    if (sameLineValue) return sameLineValue;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (/^[a-z][a-z0-9\s/&()-]*:\s*$/i.test(candidate)) break;
      return normalizeValue(candidate);
    }
  }
  return "";
}

function toPoshmarkBaseCategoryPath(value: string): string {
  const normalized = normalizeToken(value);
  if (!normalized) return "";
  if (normalized.includes("women") && normalized.includes("dresses")) {
    return "Women > Dresses";
  }
  if (normalized.includes("women") && normalized.includes("tops")) {
    return "Women > Tops";
  }
  if (normalized.includes("women") && normalized.includes("skirts")) {
    return "Women > Skirts";
  }
  return "";
}

function derivePoshmarkCategoryLeafFromSpecifics(itemSpecifics: EbayItemSpecifics): string {
  const dressLength = normalizeToken(String(itemSpecifics.dressLength ?? ""));
  if (dressLength.includes("maxi")) return "Maxi";
  if (dressLength.includes("midi")) return "Midi";
  if (dressLength.includes("mini")) return "Mini";
  if (dressLength.includes("knee")) return "Knee-Length";

  const styleType = normalizeValue(
    String(itemSpecifics.styleType || itemSpecifics.style || "")
  );
  return styleType || "";
}

function buildPoshmarkCategoryGuidance(input: {
  directCategoryPath: string;
  canonicalCategoryPath: string;
  fallbackCategory: string;
  itemSpecifics: EbayItemSpecifics;
}): { sourceFound: boolean; sourcePath: string; rawValue: string } {
  const direct = normalizeValue(input.directCategoryPath);
  if (direct) {
    return {
      sourceFound: true,
      sourcePath: "seed.poshmark.categoryPath",
      rawValue: direct,
    };
  }

  const canonical = normalizeValue(input.canonicalCategoryPath);
  const category = normalizeValue(input.fallbackCategory);
  const base =
    toPoshmarkBaseCategoryPath(canonical) || toPoshmarkBaseCategoryPath(category);
  if (!base) {
    return {
      sourceFound: false,
      sourcePath: "",
      rawValue: "",
    };
  }

  const leaf = normalizeValue(derivePoshmarkCategoryLeafFromSpecifics(input.itemSpecifics));
  const refined = leaf ? `${base} > ${leaf}` : base;
  return {
    sourceFound: true,
    sourcePath: leaf
      ? "mappedSeed.canonicalCategoryPath+mappedSeed.itemSpecifics"
      : canonical
        ? "mappedSeed.canonicalCategoryPath"
        : "mappedSeed.category",
    rawValue: refined,
  };
}

function isLabelLine(line: string, labels: readonly string[]): boolean {
  const normalizedLine = normalizeLabel(line);
  const raw = line.trim();
  return labels.some((label) => {
    const normalizedLabel = normalizeLabel(label);
    return normalizedLine === normalizedLabel || raw.startsWith(`${label}:`);
  });
}

function extractSingleLineValue(section: string, labels: readonly string[]): string {
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const ebayTopLabels = [
    "Title A",
    "Title B",
    "Category",
    "Item Specifics",
    "Description",
    "Approximate Measurements",
  ];
  const knownLabels = [...ebayTopLabels, ...labels];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLabelLine(line, labels)) continue;

    const colonIndex = line.indexOf(":");
    const sameLineValue = colonIndex >= 0 ? normalizeValue(line.slice(colonIndex + 1)) : "";
    if (sameLineValue) return sameLineValue;

    for (let next = index + 1; next < lines.length; next += 1) {
      const nextLine = lines[next].trim();
      if (!nextLine) continue;
      if (isLabelLine(nextLine, knownLabels)) break;
      return normalizeValue(nextLine);
    }
  }

  return "";
}

function getMappedEbayFields(section: string): {
  category: string;
  canonicalCategoryPath: string;
  itemSpecifics: EbayItemSpecifics;
} {
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const itemSpecificsStartIndex = lines.findIndex((line) =>
    isLabelLine(line, ["Item Specifics"])
  );
  const ebayBoundaryLabels = ["Title A", "Title B", "Category", "Description", "Approximate Measurements"];
  const itemSpecificsLines: string[] = [];

  if (itemSpecificsStartIndex >= 0) {
    for (let index = itemSpecificsStartIndex + 1; index < lines.length; index += 1) {
      const current = lines[index];
      if (isLabelLine(current, ebayBoundaryLabels)) break;
      if (current.trim()) {
        itemSpecificsLines.push(current.trim());
      }
    }
  }

  const itemSpecificsMap = new Map<string, string>();
  for (const line of itemSpecificsLines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) continue;
    const key = normalizeLabel(line.slice(0, separatorIndex));
    const value = normalizeValue(line.slice(separatorIndex + 1));
    if (!value || itemSpecificsMap.has(key)) continue;
    itemSpecificsMap.set(key, value);
  }

  function getSpecificValue(aliases: readonly string[]): string {
    for (const alias of aliases) {
      const value = itemSpecificsMap.get(normalizeLabel(alias));
      if (value) return normalizeValue(value);
    }
    return "";
  }

  function getSpecificValueWithFallback(
    itemSpecificAliases: readonly string[],
    fallbackLabels: readonly string[] = []
  ): string {
    const fromSpecifics = getSpecificValue(itemSpecificAliases);
    if (fromSpecifics) return fromSpecifics;
    if (!fallbackLabels.length) return "";
    return normalizeValue(extractSingleLineValue(section, fallbackLabels));
  }

  const category = extractSingleLineValue(section, ["Category", "eBay Category"]);
  const canonicalCategoryPath =
    getSpecificValue([
      "Canonical Vendoo Category Path",
      "Canonical Category Path",
      "Vendoo Category Path",
      "Category Path",
    ]) ||
    extractSingleLineValue(section, [
      "Canonical Vendoo Category Path",
      "Canonical Category Path",
      "Vendoo Category Path",
      "Category Path",
    ]);
  const itemSpecifics: EbayItemSpecifics = {
    brand: getSpecificValueWithFallback(["Brand", "Maker", "Signed/Maker", "Signed Maker"], [
      "Brand",
      "Maker",
      "Signed/Maker",
      "Signed Maker",
    ]),
    size: getSpecificValueWithFallback(["Size"], ["Size"]),
    color: getSpecificValueWithFallback(["Color", "Colour"], ["Color", "Colour"]),
  };

  const optionalSpecificFields: Array<[keyof EbayItemSpecifics, readonly string[], readonly string[]]> = [
    ["condition", ["Condition", "Item Condition"], ["Condition", "Item Condition"]],
    ["signedMaker", ["Signed/Maker", "Signed Maker", "Maker", "Designer"], ["Signed/Maker", "Signed Maker", "Maker", "Designer"]],
    ["material", ["Material"], ["Material"]],
    ["styleType", ["Style/Type", "Style Type"], ["Style/Type", "Style Type"]],
    ["fabricType", ["Fabric Type", "Fabric"], ["Fabric Type", "Fabric"]],
    ["department", ["Department", "Jewelry Department"], ["Department", "Jewelry Department"]],
    ["jewelryDepartment", ["Jewelry Department"], ["Jewelry Department"]],
    ["occasion", ["Occasion"], ["Occasion"]],
    ["style", ["Style"], ["Style"]],
    ["features", ["Features", "Feature"], ["Features", "Feature"]],
    ["closure", ["Closure"], ["Closure"]],
    ["accents", ["Accents", "Accent"], ["Accents", "Accent"]],
    ["theme", ["Theme", "Style Theme"], ["Theme", "Style Theme"]],
    ["pattern", ["Pattern"], ["Pattern"]],
    ["dressLength", ["Dress Length"], ["Dress Length"]],
    ["neckline", ["Neckline"], ["Neckline"]],
    ["sleeveLength", ["Sleeve Length"], ["Sleeve Length"]],
    ["sleeveType", ["Sleeve Type"], ["Sleeve Type"]],
    ["fit", ["Fit"], ["Fit"]],
    ["sizeType", ["Size Type"], ["Size Type"]],
    ["vintage", ["Vintage"], ["Vintage"]],
    ["handmade", ["Handmade", "Hand Made"], ["Handmade", "Hand Made"]],
    ["signed", ["Signed"], ["Signed"]],
    ["setIncludes", ["Set Includes", "Includes"], ["Set Includes", "Includes"]],
    ["baseMetal", ["Base Metal"], ["Base Metal"]],
    [
      "countryRegionOfManufacture",
      ["Country/Region of Manufacture", "Country of Manufacture", "Region of Manufacture"],
      ["Country/Region of Manufacture", "Country of Manufacture", "Region of Manufacture"],
    ],
    ["mainStone", ["Main Stone"], ["Main Stone"]],
    ["mainStoneColor", ["Main Stone Color"], ["Main Stone Color"]],
    ["mainStoneCreation", ["Main Stone Creation"], ["Main Stone Creation"]],
    ["shape", ["Shape"], ["Shape"]],
  ];

  for (const [key, itemAliases, fallbackLabels] of optionalSpecificFields) {
    const value = getSpecificValueWithFallback(itemAliases, fallbackLabels);
    if (!value) continue;
    itemSpecifics[key] = value;
  }

  return {
    category: normalizeValue(category),
    canonicalCategoryPath: normalizeValue(canonicalCategoryPath),
    itemSpecifics,
  };
}

export function ExtensionPanel({ seed }: { seed: Layer3Seed }) {
  const mappedSeed = useMemo(() => getMappedEbayFields(seed.ebaySection), [seed.ebaySection]);
  const vendooBaseTags = useMemo(
    () => parseVendooBaseTags(seed.poshmarkStyleTags),
    [seed.poshmarkStyleTags]
  );
  const poshmarkCategoryPayloadInfo = useMemo(
    () =>
      buildPoshmarkCategoryGuidance({
        directCategoryPath: String(seed.poshmark?.categoryPath ?? ""),
        canonicalCategoryPath: String(mappedSeed.canonicalCategoryPath ?? ""),
        fallbackCategory: String(mappedSeed.category ?? ""),
        itemSpecifics: mappedSeed.itemSpecifics,
      }),
    [
      mappedSeed.canonicalCategoryPath,
      mappedSeed.category,
      mappedSeed.itemSpecifics,
      seed.poshmark?.categoryPath,
    ]
  );
  const poshmarkPayload = useMemo(() => {
    const title = String(seed.poshmark?.title ?? "").trim();
    const description = String(seed.poshmark?.description ?? "").trim();
    const styleTags = parseVendooBaseTags(seed.poshmark?.styleTags);
    const categoryPath = normalizeValue(poshmarkCategoryPayloadInfo.rawValue);
    const selectedPriceRaw = String(seed.pricing?.selectedPrice ?? "").trim();
    const selectedPriceValue = parsePriceNumber(selectedPriceRaw);
    const adjustedPrice =
      selectedPriceValue !== null
        ? formatPriceForPayload(selectedPriceValue * 1.15)
        : "";
    return {
      title,
      description,
      styleTags,
      ...(categoryPath ? { categoryPath } : {}),
      ...(adjustedPrice ? { adjustedPrice } : {}),
    };
  }, [poshmarkCategoryPayloadInfo.rawValue, seed.poshmark, seed.pricing?.selectedPrice]);
  const depopPayload = useMemo(() => {
    const section = String(seed.depop?.listing ?? "");
    const listing = section.trim();
    const hashtags = String(seed.depop?.hashtags ?? "").trim();
    const optionalBrandHashtags = String(seed.depop?.optionalBrandHashtags ?? "").trim();
    const brandFromDepop = extractDepopSingleLineValue(section, ["Brand"]);
    const sizeFromDepop = extractDepopSingleLineValue(section, ["Size"]);
    const styleFromDepop = extractDepopSingleLineValue(section, ["Style"]);
    const styleFromCanonical =
      mappedSeed.itemSpecifics.styleType || mappedSeed.itemSpecifics.style || "";
    const depopBrand = brandFromDepop || mappedSeed.itemSpecifics.brand || "";
    const depopSize = sizeFromDepop || mappedSeed.itemSpecifics.size || "";
    const depopStyle = styleFromDepop || styleFromCanonical;
    return {
      listing,
      description: listing,
      hashtags,
      optionalBrandHashtags,
      ...(depopBrand ? { brand: depopBrand } : {}),
      ...(depopSize ? { size: depopSize } : {}),
      ...(depopStyle ? { style: depopStyle } : {}),
    };
  }, [mappedSeed.itemSpecifics, seed.depop]);
  const etsySpecificsPayloadInfo = useMemo(() => {
    const specifics = mappedSeed.itemSpecifics;
    const generated: Record<string, string> = {};
    const sourcePaths: Record<string, string> = {};
    const skippedKeys: string[] = [];

    const rules: Array<{
      key:
        | "materials"
        | "style"
        | "theme"
        | "occasion"
        | "gemstone"
        | "gemColor"
        | "age";
      sources: Array<{ path: string; value: string }>;
    }> = [
      {
        key: "materials",
        sources: [{ path: "mappedSeed.itemSpecifics.material", value: String(specifics.material || "") }],
      },
      {
        key: "style",
        sources: [
          { path: "mappedSeed.itemSpecifics.styleType", value: String(specifics.styleType || "") },
          { path: "mappedSeed.itemSpecifics.style", value: String(specifics.style || "") },
        ],
      },
      {
        key: "theme",
        sources: [{ path: "mappedSeed.itemSpecifics.theme", value: String(specifics.theme || "") }],
      },
      {
        key: "occasion",
        sources: [
          { path: "mappedSeed.itemSpecifics.occasion", value: String(specifics.occasion || "") },
        ],
      },
      {
        key: "gemstone",
        sources: [
          { path: "mappedSeed.itemSpecifics.mainStone", value: String(specifics.mainStone || "") },
        ],
      },
      {
        key: "gemColor",
        sources: [
          {
            path: "mappedSeed.itemSpecifics.mainStoneColor",
            value: String(specifics.mainStoneColor || ""),
          },
        ],
      },
      {
        key: "age",
        sources: [{ path: "mappedSeed.itemSpecifics.vintage", value: String(specifics.vintage || "") }],
      },
    ];

    for (const rule of rules) {
      const source = rule.sources.find((candidate) => normalizeValue(candidate.value));
      if (!source) {
        skippedKeys.push(rule.key);
        continue;
      }
      generated[rule.key] = normalizeValue(source.value);
      sourcePaths[rule.key] = source.path;
    }

    return {
      generated,
      generatedKeys: Object.keys(generated),
      skippedKeys,
      sourcePaths,
    };
  }, [mappedSeed.itemSpecifics]);

  const etsyPayload = useMemo(() => {
    const title = String(seed.etsy?.title ?? "").trim();
    const description = String(seed.etsy?.description ?? "").trim();
    const tags = parseVendooBaseTags(seed.etsy?.tags);
    const directCategoryPath = normalizeValue(String(seed.etsy?.categoryPath ?? ""));
    const fallbackCategoryPath = normalizeValue(
      String(mappedSeed.canonicalCategoryPath || mappedSeed.category || "")
    );
    const categoryPath = directCategoryPath || fallbackCategoryPath;
    const selectedPriceRaw = String(seed.pricing?.selectedPrice ?? "").trim();
    const selectedPriceValue = parsePriceNumber(selectedPriceRaw);
    const adjustedPrice =
      selectedPriceValue !== null
        ? formatPriceForPayload(selectedPriceValue * 1.15)
        : "";
    return {
      title,
      description,
      tags,
      ...(categoryPath ? { categoryPath } : {}),
      ...(adjustedPrice ? { adjustedPrice } : {}),
      ...etsySpecificsPayloadInfo.generated,
    };
  }, [
    etsySpecificsPayloadInfo.generated,
    mappedSeed.canonicalCategoryPath,
    mappedSeed.category,
    seed.etsy,
    seed.pricing?.selectedPrice,
  ]);
  const vintageValue = String(mappedSeed.itemSpecifics.vintage ?? "").trim();
  const etsyIncludedForVintage = useMemo(() => {
    const normalized = normalizeToken(vintageValue);
    return (
      normalized === "yes" ||
      normalized === "y" ||
      normalized === "true" ||
      normalized === "vintage"
    );
  }, [vintageValue]);

  const [selectedSource, setSelectedSource] = useState<"A" | "B">(
    seed.titleA.trim() ? "A" : "B"
  );
  const [category, setCategory] = useState(mappedSeed.category);
  const [brand, setBrand] = useState(mappedSeed.itemSpecifics.brand);
  const [size, setSize] = useState(mappedSeed.itemSpecifics.size);
  const [color, setColor] = useState(mappedSeed.itemSpecifics.color);
  const [sendFeedback, setSendFeedback] = useState<SendFeedbackState>(
    INITIAL_SEND_FEEDBACK
  );

  const selectedTitle = useMemo(
    () => (selectedSource === "A" ? seed.titleA : seed.titleB).trim(),
    [seed.titleA, seed.titleB, selectedSource]
  );

  const finalTitleSelection: FinalTitleSelection = useMemo(
    () => ({
      selectedTitle,
      selectedSource,
      titleA: {
        title: seed.titleA,
        score: 0,
        length: seed.titleA.trim().length,
        reasons: [],
      },
      titleB: {
        title: seed.titleB,
        score: 0,
        length: seed.titleB.trim().length,
        reasons: [],
      },
    }),
    [seed.titleA, seed.titleB, selectedSource, selectedTitle]
  );

  const validation = useMemo(
    () =>
      validateEbayDraft({
        titleA: seed.titleA,
        titleB: seed.titleB,
        description: seed.description,
      }),
    [seed.description, seed.titleA, seed.titleB]
  );

  const readyToSend = useMemo(
    () =>
      getReadyToSendState({
        finalTitleSelection,
        validation,
        description: seed.description,
      }),
    [finalTitleSelection, seed.description, validation]
  );

  const canonicalVendooCategoryPath = useMemo(
    () => {
      const explicitCanonical = mappedSeed.canonicalCategoryPath?.trim() ?? "";
      if (explicitCanonical) return explicitCanonical;

      const derivedFromSimple = buildVendooCategoryPath({ simpleCategory: category });
      if (derivedFromSimple?.trim()) return derivedFromSimple.trim();

      const normalizedCategory = category
        .split(">")
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" > ");
      const segmentCount = normalizedCategory ? normalizedCategory.split(">").length : 0;
      if (segmentCount >= 3) {
        return normalizedCategory;
      }

      return undefined;
    },
    [category, mappedSeed.canonicalCategoryPath]
  );

  const sizeNotApplicableHint = useMemo(() => {
    const source = `${seed.titleA} ${seed.titleB} ${seed.description} ${category}`;
    return isJewelryLike(source) && size.trim().length === 0;
  }, [category, seed.description, seed.titleA, seed.titleB, size]);

  const payload = useMemo(
    () =>
      buildVendooExtensionPayload({
        title: selectedTitle,
        titleA: seed.titleA,
        titleB: seed.titleB,
        description: seed.description,
        category,
        canonicalVendooCategoryPath,
        photos: seed.photos ?? [],
        vendooBaseTags,
        researchMeta: seed.researchMeta,
        pricing: seed.pricing,
        resolvedPrice: seed.resolvedPrice,
        depop: depopPayload,
        poshmark: poshmarkPayload,
        ...(etsyIncludedForVintage ? { etsy: etsyPayload } : {}),
        itemSpecifics: {
          ...mappedSeed.itemSpecifics,
          brand,
          size,
          color,
        },
      }),
    [
      brand,
      canonicalVendooCategoryPath,
      category,
      color,
      mappedSeed.itemSpecifics,
      seed.description,
      seed.titleA,
      seed.titleB,
      seed.photos,
      vendooBaseTags,
      seed.researchMeta,
      seed.pricing,
      seed.resolvedPrice,
      depopPayload,
      poshmarkPayload,
      etsyIncludedForVintage,
      etsyPayload,
      selectedTitle,
      size,
    ]
  );

  function handleSendPayload() {
    if (!readyToSend.isReadyToSend) {
      setSendFeedback({
        status: "failed",
        message: "Draft is not ready to send. Resolve blocking issues first.",
      });
      return;
    }

    const preBuildConditionRaw =
      typeof mappedSeed.itemSpecifics.condition === "string"
        ? mappedSeed.itemSpecifics.condition.trim()
        : "";
    console.debug("[LPU][ConditionPayload]", {
      stage: "pre_build",
      hasConditionLikeValue: Boolean(preBuildConditionRaw),
      conditionPath: preBuildConditionRaw ? "mappedSeed.itemSpecifics.condition" : "",
      rawValue: preBuildConditionRaw,
      normalizedValue: preBuildConditionRaw ? normalizeToken(preBuildConditionRaw) : "",
    });

    const finalConditionRaw =
      typeof payload?.marketplaces?.ebay?.itemSpecifics?.condition === "string"
        ? payload.marketplaces.ebay.itemSpecifics.condition.trim()
        : "";
    console.debug("[LPU][ConditionPayload]", {
      stage: "final_payload",
      hasConditionLikeValue: Boolean(finalConditionRaw),
      conditionPath: finalConditionRaw ? "payload.marketplaces.ebay.itemSpecifics.condition" : "",
      rawValue: finalConditionRaw,
      normalizedValue: finalConditionRaw ? normalizeToken(finalConditionRaw) : "",
    });

    console.debug("[LPU][VendooBaseTags]", {
      sourceFound: Boolean(seed.poshmarkStyleTags?.trim()),
      sourcePath: "seed.poshmarkStyleTags",
      rawValue: seed.poshmarkStyleTags ?? "",
      normalizedValue: vendooBaseTags,
    });
    console.debug("[LPU][VendooBaseTagsSend]", {
      hasVendooBaseTags: Array.isArray(payload?.vendooBaseTags) && payload.vendooBaseTags.length > 0,
      vendooBaseTags: Array.isArray(payload?.vendooBaseTags) ? payload.vendooBaseTags : [],
      topLevelPayloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
    });
    const depopBlock = payload?.marketplaces?.depop;
    const depopSize = typeof depopBlock?.size === "string" ? depopBlock.size : "";
    const depopBrand = typeof depopBlock?.brand === "string" ? depopBlock.brand : "";
    const depopStyle = typeof depopBlock?.style === "string" ? depopBlock.style : "";
    const depopDescription = typeof depopBlock?.description === "string" ? depopBlock.description : "";
    console.debug("[LPU][DepopPayload]", {
      sourceFound: Boolean(
        depopBlock &&
          (depopBlock.listing ||
            depopBlock.description ||
            depopBlock.hashtags ||
            depopBlock.optionalBrandHashtags)
      ),
      depopTopLevelKeys: depopBlock && typeof depopBlock === "object" ? Object.keys(depopBlock) : [],
      sizeLike: { path: depopSize ? "payload.marketplaces.depop.size" : "", value: depopSize },
      brandLike: { path: depopBrand ? "payload.marketplaces.depop.brand" : "", value: depopBrand },
      styleLike: { path: depopStyle ? "payload.marketplaces.depop.style" : "", value: depopStyle },
      description: {
        path: depopDescription ? "payload.marketplaces.depop.description" : "",
        present: Boolean(depopDescription),
      },
    });
    const poshmarkBlock = payload?.marketplaces?.poshmark;
    const poshmarkTitle = typeof poshmarkBlock?.title === "string" ? poshmarkBlock.title : "";
    const poshmarkDescription =
      typeof poshmarkBlock?.description === "string" ? poshmarkBlock.description : "";
    const poshmarkStyleTags = Array.isArray(poshmarkBlock?.styleTags)
      ? poshmarkBlock.styleTags
      : [];
    const poshmarkCategoryPath =
      typeof poshmarkBlock?.categoryPath === "string" ? poshmarkBlock.categoryPath : "";
    console.debug("[LPU][PoshmarkCategoryPayload]", {
      sourceFound: poshmarkCategoryPayloadInfo.sourceFound,
      sourcePath: poshmarkCategoryPayloadInfo.sourcePath,
      rawValue: poshmarkCategoryPayloadInfo.rawValue,
      normalizedValue: poshmarkCategoryPayloadInfo.rawValue
        ? normalizeToken(poshmarkCategoryPayloadInfo.rawValue)
        : "",
    });
    console.debug("[LPU][PoshmarkPayload]", {
      sourceFound: Boolean(poshmarkBlock && typeof poshmarkBlock === "object"),
      poshmarkTopLevelKeys:
        poshmarkBlock && typeof poshmarkBlock === "object" ? Object.keys(poshmarkBlock) : [],
      titleLike: {
        path: poshmarkTitle ? "payload.marketplaces.poshmark.title" : "",
        present: Boolean(poshmarkTitle),
      },
      descriptionLike: {
        path: poshmarkDescription ? "payload.marketplaces.poshmark.description" : "",
        present: Boolean(poshmarkDescription),
      },
      styleTagsLike: {
        path: poshmarkStyleTags.length ? "payload.marketplaces.poshmark.styleTags" : "",
        present: poshmarkStyleTags.length > 0,
      },
      categoryLike: {
        path: poshmarkCategoryPath ? "payload.marketplaces.poshmark.categoryPath" : "",
        present: Boolean(poshmarkCategoryPath),
      },
    });
    const etsyBlock = payload?.etsy;
    const selectedPrice = String(seed.pricing?.selectedPrice ?? "").trim();
    const poshmarkAdjustedPrice =
      typeof payload?.marketplaces?.poshmark?.adjustedPrice === "string"
        ? payload.marketplaces.poshmark.adjustedPrice
        : "";
    const etsyAdjustedPrice =
      typeof payload?.etsy?.adjustedPrice === "string" ? payload.etsy.adjustedPrice : "";
    console.debug("[LPU][MarketplacePriceAdjustments]", {
      selectedPrice,
      poshmarkAdjustedPrice,
      etsyAdjustedPrice,
    });
    console.debug("[LPU][EtsySpecificsPayload]", {
      generatedKeys: etsySpecificsPayloadInfo.generatedKeys,
      skippedKeys: etsySpecificsPayloadInfo.skippedKeys,
      sourcePaths: etsySpecificsPayloadInfo.sourcePaths,
    });
    const etsyCategoryPath =
      typeof etsyBlock?.categoryPath === "string" ? etsyBlock.categoryPath : "";
    const etsyCategorySourcePath = normalizeValue(String(seed.etsy?.categoryPath ?? ""))
      ? "seed.etsy.categoryPath"
      : normalizeValue(String(mappedSeed.canonicalCategoryPath ?? ""))
        ? "mappedSeed.canonicalCategoryPath"
        : normalizeValue(String(mappedSeed.category ?? ""))
          ? "mappedSeed.category"
          : "";
    console.debug("[LPU][EtsyCategoryPayload]", {
      sourceFound: Boolean(etsyCategoryPath),
      sourcePath: etsyCategorySourcePath,
      rawValue: etsyCategoryPath,
      normalizedValue: etsyCategoryPath ? normalizeToken(etsyCategoryPath) : "",
    });
    console.debug("[LPU][EtsyPayload]", {
      vintageSourcePath: "mappedSeed.itemSpecifics.vintage",
      vintageValue,
      etsyIncluded: Boolean(etsyIncludedForVintage && etsyBlock && typeof etsyBlock === "object"),
      etsyTopLevelKeys:
        etsyBlock && typeof etsyBlock === "object" ? Object.keys(etsyBlock) : [],
    });

    const sent = sendVendooPayloadToExtension(payload);
    if (sent) {
      setSendFeedback({
        status: "sent",
        message: "Payload sent to Vendoo extension.",
      });
      return;
    }

    setSendFeedback({
      status: "failed",
      message: "Payload could not be sent from this page.",
    });
  }

  return (
    <section className="mt-8 rounded-2xl border p-6">
      <h2 className="text-2xl font-semibold">Layer 3 Extension Flow</h2>
      <p className="mt-2 text-sm text-gray-600">
        Uses the current Layer 1 / Layer 2 eBay output, previews the Vendoo
        extension payload, then sends it to the private extension.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <ReadyToSendCard state={readyToSend} />

          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Final eBay Title Source
            </h3>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedSource("A");
                  setSendFeedback(INITIAL_SEND_FEEDBACK);
                }}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  selectedSource === "A"
                    ? "border-black bg-black text-white"
                    : "border-gray-300 bg-white text-gray-800"
                }`}
              >
                Use Title A
              </button>

              <button
                type="button"
                onClick={() => {
                  setSelectedSource("B");
                  setSendFeedback(INITIAL_SEND_FEEDBACK);
                }}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  selectedSource === "B"
                    ? "border-black bg-black text-white"
                    : "border-gray-300 bg-white text-gray-800"
                }`}
              >
                Use Title B
              </button>
            </div>

            <div className="mt-4 text-sm text-gray-700">
              <div>
                <span className="font-medium">Selected title:</span>{" "}
                {selectedTitle || "—"}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                Length: {selectedTitle.length}
              </div>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Vendoo Mapped Fields
            </h3>

            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-medium">Category</span>
                <input
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Category path"
                  className="rounded-lg border p-2"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Brand</span>
                <input
                  value={brand}
                  onChange={(event) => {
                    setBrand(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Brand"
                  className="rounded-lg border p-2"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Size</span>
                <input
                  value={size}
                  onChange={(event) => {
                    setSize(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder={
                    sizeNotApplicableHint
                      ? "Optional for jewelry (leave blank if not applicable)"
                      : "Size"
                  }
                  className="rounded-lg border p-2"
                />
                {sizeNotApplicableHint ? (
                  <span className="text-xs text-gray-500">
                    Size is optional for jewelry and can be left blank when not applicable.
                  </span>
                ) : null}
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-medium">Color</span>
                <input
                  value={color}
                  onChange={(event) => {
                    setColor(event.target.value);
                    setSendFeedback(INITIAL_SEND_FEEDBACK);
                  }}
                  placeholder="Color"
                  className="rounded-lg border p-2"
                />
              </label>
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <button
              type="button"
              onClick={handleSendPayload}
              disabled={!readyToSend.isReadyToSend}
              className="w-full rounded-xl bg-black px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send payload to Vendoo extension
            </button>

            {sendFeedback.status !== "idle" ? (
              <p
                className={`mt-3 text-sm ${
                  sendFeedback.status === "sent"
                    ? "text-green-700"
                    : "text-red-700"
                }`}
              >
                {sendFeedback.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              Layer 1 / Layer 2 eBay Source
            </h3>
            <div className="mt-3 space-y-3 text-sm text-gray-700">
              <div>
                <div className="font-medium">Title A</div>
                <div className="mt-1 rounded-lg bg-gray-50 p-2 text-xs">
                  {seed.titleA || "—"}
                </div>
              </div>
              <div>
                <div className="font-medium">Title B</div>
                <div className="mt-1 rounded-lg bg-gray-50 p-2 text-xs">
                  {seed.titleB || "—"}
                </div>
              </div>
              <div>
                <div className="font-medium">Description</div>
                <div className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2 text-xs">
                  {seed.description || "—"}
                </div>
              </div>
            </div>
          </div>

          <PayloadPreviewCard payload={payload} />
        </div>
      </div>
    </section>
  );
}
