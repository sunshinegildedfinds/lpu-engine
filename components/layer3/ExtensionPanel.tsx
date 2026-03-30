"use client";

import { useMemo, useState } from "react";
import { PayloadPreviewCard } from "@/components/vendoo/PayloadPreviewCard";
import { ReadyToSendCard } from "@/components/vendoo/ReadyToSendCard";
import type { FinalTitleSelection } from "@/lib/ebay/selectFinalTitle";
import { validateEbayDraft } from "@/lib/ebay/validateDraft";
import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";
import { buildVendooCategoryPath } from "@/lib/vendoo/buildVendooCategoryPath";
import type { EbayItemSpecifics } from "@/lib/vendoo/extensionPayload";
import { getReadyToSendState } from "@/lib/vendoo/getReadyToSendState";
import { buildVendooExtensionPayload } from "@/lib/vendoo/extensionPayload";

type Layer3Seed = {
  titleA: string;
  titleB: string;
  description: string;
  ebaySection: string;
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

function normalizeLabel(value: string): string {
  return normalizeToken(value.replace(/:$/, ""));
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
    () =>
      mappedSeed.canonicalCategoryPath ||
      buildVendooCategoryPath({ simpleCategory: category }) ||
      undefined,
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
