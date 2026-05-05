"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { ExtensionPanel } from "@/components/layer3/ExtensionPanel";
import { ResearchPanel } from "@/components/lpu/ResearchPanel";
import {
  buildCopyMap,
  buildPayloadMap,
  buildPayloadSummary,
} from "@/lib/lpu/payloadMap";
import type { PlatformKey } from "@/lib/lpu/payloadMap";
import {
  buildVendooResolvedFieldMap,
  getVendooPlatformRequiredFieldStatus,
} from "@/lib/vendoo/fieldMap";
import { buildVendooActionPreview } from "@/lib/vendoo/actionPreview";
import { buildResearchRecordFromValidatedPayload } from "@/lib/research/buildResearchRecord";
import type { OptionalPriceInput } from "@/lib/research/types";
import type { VendooPricingMeta, VendooResearchMeta } from "@/lib/vendoo/extensionPayload";

const INITIAL_PRICE_DECISION: OptionalPriceInput = {
  selectedPrice: "",
  floorPrice: "",
  pricingNote: "",
  source: null,
};

type ImagePayload = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
};

type ValidationIssue = {
  platform: string;
  code: string;
  message: string;
  severity: "error" | "warning";
};

type PlatformValidationResult = {
  platform: string;
  present: boolean;
  pass: boolean;
  issues: ValidationIssue[];
  metrics: Record<string, unknown>;
  rawSection: string;
};

type ValidationResult = {
  pass: boolean;
  issues: ValidationIssue[];
  parsed: {
    raw: string;
    sections: Partial<Record<PlatformKey, string>>;
    unknownBlocks: string[];
  };
  platformResults: Record<PlatformKey, PlatformValidationResult>;
  metrics: {
    expectedFooterType: string;
    platformsPassed: number;
    platformsFailed: number;
  };
};

type GeneratorInstructionsReport = {
  instructions: string;
  characterLength: number;
  checks: {
    ebayTitleAOrder: boolean;
    ebayThemeRequirement: boolean;
    depopAttributesRequirement: boolean;
    etsyExactly13TagsRequirement: boolean;
    poshmarkStyleTagsMasterListRequirement: boolean;
    compact3TagMasterListRequirement: boolean;
  };
  generatedAt: string;
};

type WorkflowStatus = "ready" | "generating" | "pass" | "needs-review";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Could not read file."));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read file."));
    };

    reader.readAsDataURL(file);
  });
}

function formatMetricValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function previewValue(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) return "—";
  if (normalized.length <= max) return normalized;

  return `${normalized.slice(0, max)}…`;
}

function normalizeVendooBaseTags(raw: string | string[] | undefined): string[] {
  const inputValues = Array.isArray(raw) ? raw : [raw ?? ""];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const input of inputValues) {
    if (typeof input !== "string" || !input.trim()) continue;
    const parts = input
      .split(/\r?\n|,/)
      .map((part) => part.trim().replace(/^#+/, ""))
      .map((part) => part.replace(/\s+/g, " "))
      .filter(Boolean);
    for (const part of parts) {
      if (seen.has(part)) continue;
      seen.add(part);
      normalized.push(part);
    }
  }

  return normalized;
}

function extractPoshmarkStyleTagsSource(section: string): string {
  if (!section.trim()) return "";
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const styleTagLabelPattern = /^style tags\s*:?\s*(.*)$/i;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = line.match(styleTagLabelPattern);
    if (!match) continue;

    const sameLineValue = (match[1] ?? "").trim();
    if (sameLineValue) return sameLineValue;

    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (/^[a-z][a-z0-9\s()\/&-]*:\s*$/i.test(candidate)) return "";
      return candidate;
    }
    return "";
  }

  return "";
}

function StatusBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        pass ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`}
    >
      {pass ? "Pass" : "Fail"}
    </span>
  );
}

function getWorkflowStatus(
  isLoading: boolean,
  error: string,
  validation: ValidationResult | null
): {
  status: WorkflowStatus;
  title: string;
  description: string;
  containerClassName: string;
  badgeClassName: string;
} {
  if (isLoading) {
    return {
      status: "generating",
      title: "Generating",
      description:
        "Layer 1 is generating LP-U output and Layer 2 will validate it automatically.",
      containerClassName: "border-blue-200 bg-blue-50",
      badgeClassName: "bg-blue-100 text-blue-800",
    };
  }

  if (error) {
    return {
      status: "needs-review",
      title: "Needs Review",
      description: "The run did not complete successfully. Review the error message below.",
      containerClassName: "border-red-200 bg-red-50",
      badgeClassName: "bg-red-100 text-red-800",
    };
  }

  if (validation) {
    if (validation.pass) {
      return {
        status: "pass",
        title: "Pass",
        description: "All platform validation checks passed for this LP-U output.",
        containerClassName: "border-green-200 bg-green-50",
        badgeClassName: "bg-green-100 text-green-800",
      };
    }

    return {
      status: "needs-review",
      title: "Needs Review",
      description: `${validation.metrics.platformsFailed} platform(s) still have validation failures.`,
      containerClassName: "border-amber-200 bg-amber-50",
      badgeClassName: "bg-amber-100 text-amber-800",
    };
  }

  return {
    status: "ready",
    title: "Ready",
    description: "Upload photos and notes, then generate LP-U output.",
    containerClassName: "border-gray-200 bg-gray-50",
    badgeClassName: "bg-gray-100 text-gray-800",
  };
}

function CopyButton({
  label,
  onClick,
  disabled,
  copied,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  copied?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
        copied
          ? "border-green-300 bg-green-50 text-green-800"
          : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {copied ? `Copied: ${label}` : label}
    </button>
  );
}

export default function LpuPage() {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [output, setOutput] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<string | null>(null);
  const [layer3Photos, setLayer3Photos] = useState<ImagePayload[]>([]);
  const [enableResearchPanel, setEnableResearchPanel] = useState(false);
  const [showGeneratorInstructionsReport, setShowGeneratorInstructionsReport] =
    useState(false);
  const [generatorInstructionsReport, setGeneratorInstructionsReport] =
    useState<GeneratorInstructionsReport | null>(null);
  const [priceDecision, setPriceDecision] = useState<OptionalPriceInput>(
    INITIAL_PRICE_DECISION
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    setFiles(selectedFiles);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setOutput("");
    setValidation(null);
    setCopiedTarget(null);
    setIsLoading(true);
    setGeneratorInstructionsReport(null);

    try {
      const images: ImagePayload[] = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl: await fileToDataUrl(file),
        }))
      );

      const response = await fetch("/api/lpu/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes,
          images,
          includeGeneratorInstructionsReport: showGeneratorInstructionsReport,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setOutput(data.output || "");
      setValidation(data.validation ?? null);
      setGeneratorInstructionsReport(data.generatorInstructionsReport ?? null);
      setLayer3Photos(images);
      setPriceDecision(INITIAL_PRICE_DECISION);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate output.";
      setError(message);
      setValidation(null);
      setCopiedTarget(null);
      setLayer3Photos([]);
      setGeneratorInstructionsReport(null);
      setPriceDecision(INITIAL_PRICE_DECISION);
    } finally {
      setIsLoading(false);
    }
  }

  const platformOrder: PlatformKey[] = [
    "ebay",
    "depop",
    "poshmark",
    "mercari",
    "etsy",
  ];

  const workflow = getWorkflowStatus(isLoading, error, validation);

  const payloadMap = useMemo(
    () => buildPayloadMap(output, validation?.parsed.sections),
    [output, validation]
  );

  const copyMap = useMemo(() => buildCopyMap(payloadMap), [payloadMap]);

  const payloadSummary = useMemo(
    () => buildPayloadSummary(payloadMap),
    [payloadMap]
  );

  const vendooResolvedMap = useMemo(
    () => buildVendooResolvedFieldMap(payloadMap),
    [payloadMap]
  );

  const vendooStatus = useMemo(
    () => ({
      ebay: getVendooPlatformRequiredFieldStatus(payloadMap, "ebay"),
      depop: getVendooPlatformRequiredFieldStatus(payloadMap, "depop"),
      poshmark: getVendooPlatformRequiredFieldStatus(payloadMap, "poshmark"),
      mercari: getVendooPlatformRequiredFieldStatus(payloadMap, "mercari"),
      etsy: getVendooPlatformRequiredFieldStatus(payloadMap, "etsy"),
    }),
    [payloadMap]
  );

  const vendooTotals = useMemo(() => {
    let requiredFields = 0;
    let readyRequiredFields = 0;
    let platformsReady = 0;

    for (const platform of platformOrder) {
      requiredFields += vendooStatus[platform].requiredFields;
      readyRequiredFields += vendooStatus[platform].readyRequiredFields;

      if (vendooStatus[platform].allRequiredReady) {
        platformsReady += 1;
      }
    }

    return {
      requiredFields,
      readyRequiredFields,
      platformsReady,
      platformsNeedingReview: platformOrder.length - platformsReady,
    };
  }, [platformOrder, vendooStatus]);

  const vendooActionPreview = useMemo(
    () => buildVendooActionPreview(payloadMap),
    [payloadMap]
  );

  const vendooActionTotals = useMemo(() => {
    let totalSteps = 0;
    let readySteps = 0;
    let totalRequiredSteps = 0;
    let readyRequiredSteps = 0;
    let actionReadyPlatforms = 0;

    for (const platform of platformOrder) {
      const preview = vendooActionPreview[platform];
      totalSteps += preview.totalSteps;
      readySteps += preview.readySteps;
      totalRequiredSteps += preview.totalRequiredSteps;
      readyRequiredSteps += preview.readyRequiredSteps;

      if (preview.canRun) {
        actionReadyPlatforms += 1;
      }
    }

    return {
      totalSteps,
      readySteps,
      totalRequiredSteps,
      readyRequiredSteps,
      actionReadyPlatforms,
      actionReviewPlatforms: platformOrder.length - actionReadyPlatforms,
    };
  }, [platformOrder, vendooActionPreview]);

  const researchRecord = useMemo(() => {
    if (!validation) return null;
    return buildResearchRecordFromValidatedPayload(payloadMap);
  }, [payloadMap, validation]);

  const researchMetaForPayload = useMemo<VendooResearchMeta | undefined>(() => {
    if (!enableResearchPanel || !researchRecord) return undefined;
    return {
      searchSeed: researchRecord.searchSeed,
      primaryQuery: researchRecord.primaryQuery,
      alternateQueries: researchRecord.alternateQueries,
      soldCompLink: researchRecord.soldCompLink,
      completedCompLink: researchRecord.completedCompLink,
      activeCompLink: researchRecord.activeCompLink,
      matchConfidence: researchRecord.matchConfidence,
      researchNotes: researchRecord.researchNotes,
    };
  }, [enableResearchPanel, researchRecord]);

  const pricingForPayload = useMemo<VendooPricingMeta | undefined>(() => {
    if (!enableResearchPanel) return undefined;
    return {
      selectedPrice: priceDecision.selectedPrice,
      floorPrice: priceDecision.floorPrice,
      pricingNote: priceDecision.pricingNote,
      source: priceDecision.source,
    };
  }, [enableResearchPanel, priceDecision]);

  const resolvedPriceForPayload = useMemo<string | undefined>(() => {
    if (!enableResearchPanel) return undefined;
    const selected = priceDecision.selectedPrice.trim();
    if (!selected) return undefined;
    return /^[$]?\d+([.,]\d{1,2})?$/.test(selected) ? selected : undefined;
  }, [enableResearchPanel, priceDecision.selectedPrice]);

  const vendooBaseTagsSource = useMemo(() => {
    const styleTagsFromPoshmarkSection = extractPoshmarkStyleTagsSource(
      payloadMap.platforms.poshmark.section
    );
    if (styleTagsFromPoshmarkSection.trim()) {
      return {
        sourceFound: true,
        sourcePath: "payloadMap.platforms.poshmark.section::Style Tags",
        rawValue: styleTagsFromPoshmarkSection,
        normalizedValue: normalizeVendooBaseTags(
          styleTagsFromPoshmarkSection.split(";")
        ),
      };
    }

    const styleTagsFromPayloadMap = payloadMap.platforms.poshmark.styleTags;
    if (styleTagsFromPayloadMap.trim()) {
      return {
        sourceFound: true,
        sourcePath: "payloadMap.platforms.poshmark.styleTags",
        rawValue: styleTagsFromPayloadMap,
        normalizedValue: normalizeVendooBaseTags(styleTagsFromPayloadMap.split(";")),
      };
    }

    const metrics = validation?.platformResults?.poshmark?.metrics;
    const styleTagsFromMetrics = metrics?.styleTags;
    if (Array.isArray(styleTagsFromMetrics) && styleTagsFromMetrics.length > 0) {
      return {
        sourceFound: true,
        sourcePath: "validation.platformResults.poshmark.metrics.styleTags",
        rawValue: styleTagsFromMetrics,
        normalizedValue: normalizeVendooBaseTags(
          styleTagsFromMetrics.filter((value): value is string => typeof value === "string")
        ),
      };
    }

    return {
      sourceFound: false,
      sourcePath: "",
      rawValue: "",
      normalizedValue: [] as string[],
    };
  }, [
    payloadMap.platforms.poshmark.section,
    payloadMap.platforms.poshmark.styleTags,
    validation,
  ]);

  useEffect(() => {
    console.debug("[LPU][VendooBaseTags]", {
      sourceFound: vendooBaseTagsSource.sourceFound,
      sourcePath: vendooBaseTagsSource.sourcePath,
      rawValue: vendooBaseTagsSource.rawValue,
      normalizedValue: vendooBaseTagsSource.normalizedValue,
    });
  }, [vendooBaseTagsSource]);

  async function handleCopy(target: string) {
    const text = copyMap[target];

    if (!text?.trim()) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      window.setTimeout(() => {
        setCopiedTarget((current) => (current === target ? null : current));
      }, 1800);
    } catch {
      setError("Failed to copy to clipboard.");
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-2 text-3xl font-bold">LP-U Generator</h1>
      <p className="mb-6 text-sm text-gray-600">
        Upload item photos, paste your LP-U notes, and generate the full output.
      </p>

      <section
        className={`mb-8 rounded-2xl border p-5 ${workflow.containerClassName}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600">
              Workflow Status
            </div>
            <div className="mt-2 text-2xl font-bold">{workflow.title}</div>
            <p className="mt-2 text-sm text-gray-700">{workflow.description}</p>
          </div>

          <span
            className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${workflow.badgeClassName}`}
          >
            {workflow.title}
          </span>
        </div>

        {validation ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/60 bg-white/70 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Platforms Passed
              </div>
              <div className="mt-1 text-lg font-semibold">
                {validation.metrics.platformsPassed}
              </div>
            </div>

            <div className="rounded-xl border border-white/60 bg-white/70 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Platforms Failed
              </div>
              <div className="mt-1 text-lg font-semibold">
                {validation.metrics.platformsFailed}
              </div>
            </div>

            <div className="rounded-xl border border-white/60 bg-white/70 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                Expected Footer
              </div>
              <div className="mt-1 text-lg font-semibold">
                {validation.metrics.expectedFooterType}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border p-6"
      >
        <div>
          <label className="mb-2 block font-medium">LP-U notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder='Example: LP-U :: Brand: Selro Selini, Vintage, missing 1 charm, size 6'
            className="min-h-[180px] w-full rounded-xl border p-3"
          />
        </div>

        <div>
          <label className="mb-2 block font-medium">Item photos</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="block w-full"
          />
          <p className="mt-2 text-sm text-gray-500">
            Selected: {files.length} file(s)
          </p>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-xl bg-black px-5 py-3 text-white disabled:opacity-50"
        >
          {isLoading ? "Generating..." : "Generate LP-U"}
        </button>

        {error ? (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        ) : null}
      </form>

      <section className="mt-8 rounded-2xl border p-4">
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              checked={enableResearchPanel}
              onChange={(event) => setEnableResearchPanel(event.target.checked)}
              className="h-4 w-4"
            />
            Enable Research Panel
          </label>
          <label className="flex items-center gap-3 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              checked={showGeneratorInstructionsReport}
              onChange={(event) =>
                setShowGeneratorInstructionsReport(event.target.checked)
              }
              className="h-4 w-4"
            />
            Show Generator Instructions Report
          </label>
        </div>
      </section>

      {showGeneratorInstructionsReport && generatorInstructionsReport ? (
        <section className="mt-6 rounded-2xl border p-6">
          <details open>
            <summary className="cursor-pointer text-lg font-semibold">
              Generator Instructions Report
            </summary>
            <div className="mt-4 space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Character Length
                  </div>
                  <div className="mt-1 font-semibold">
                    {generatorInstructionsReport.characterLength}
                  </div>
                </div>
                <div className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Report Generated
                  </div>
                  <div className="mt-1 font-semibold">
                    {new Date(
                      generatorInstructionsReport.generatedAt
                    ).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-2 font-semibold">Framework Checks</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>
                    eBay Title A order present:{" "}
                    {String(
                      generatorInstructionsReport.checks.ebayTitleAOrder
                    )}
                  </li>
                  <li>
                    eBay Theme requirement present:{" "}
                    {String(
                      generatorInstructionsReport.checks.ebayThemeRequirement
                    )}
                  </li>
                  <li>
                    Depop Attributes requirement present:{" "}
                    {String(
                      generatorInstructionsReport.checks.depopAttributesRequirement
                    )}
                  </li>
                  <li>
                    Etsy exactly 13 tags requirement present:{" "}
                    {String(
                      generatorInstructionsReport.checks
                        .etsyExactly13TagsRequirement
                    )}
                  </li>
                  <li>
                    Poshmark Style Tags master-list requirement present:{" "}
                    {String(
                      generatorInstructionsReport.checks
                        .poshmarkStyleTagsMasterListRequirement
                    )}
                  </li>
                  <li>
                    Compact 3-Tag Strategy master-list requirement present:{" "}
                    {String(
                      generatorInstructionsReport.checks
                        .compact3TagMasterListRequirement
                    )}
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-2 font-semibold">
                  Runtime MASTER_LPU_INSTRUCTIONS
                </div>
                <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-800">
                  {generatorInstructionsReport.instructions}
                </pre>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {enableResearchPanel && validation && researchRecord ? (
        <ResearchPanel
          researchRecord={researchRecord}
          priceDecision={priceDecision}
          onPriceDecisionChange={setPriceDecision}
        />
      ) : null}

      <ExtensionPanel
        key={[
          payloadMap.platforms.ebay.titleA,
          payloadMap.platforms.ebay.titleB,
          payloadMap.platforms.ebay.description,
          payloadMap.platforms.ebay.section,
        ].join("|")}
        seed={{
          titleA: payloadMap.platforms.ebay.titleA,
          titleB: payloadMap.platforms.ebay.titleB,
          description: payloadMap.platforms.ebay.description,
          ebaySection: payloadMap.platforms.ebay.section,
          poshmarkStyleTags: vendooBaseTagsSource.normalizedValue.join(", "),
          photos: layer3Photos,
          researchMeta: researchMetaForPayload,
          pricing: pricingForPayload,
          resolvedPrice: resolvedPriceForPayload,
          depop: {
            listing: payloadMap.platforms.depop.listing,
            hashtags: payloadMap.platforms.depop.hashtags,
            optionalBrandHashtags: payloadMap.platforms.depop.optionalBrandHashtags,
          },
          poshmark: {
            title: payloadMap.platforms.poshmark.title,
            description: payloadMap.platforms.poshmark.description,
            styleTags: payloadMap.platforms.poshmark.styleTags,
            categoryPath: payloadMap.platforms.poshmark.categoryPath,
          },
          etsy: {
            title: payloadMap.platforms.etsy.title,
            description: payloadMap.platforms.etsy.description,
            tags: payloadMap.platforms.etsy.tags,
            categoryPath: payloadMap.platforms.etsy.categoryPath,
          },
        }}
      />

      <section className="mt-8 rounded-2xl border p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">Output</h2>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-3 text-sm font-semibold text-gray-700">
              Section Copy Actions
            </div>
            <div className="flex flex-wrap gap-3">
              <CopyButton
                label="Copy Full Output"
                onClick={() => handleCopy("full")}
                disabled={!copyMap.full?.trim()}
                copied={copiedTarget === "full"}
              />
              <CopyButton
                label="Copy eBay"
                onClick={() => handleCopy("ebay")}
                disabled={!copyMap.ebay?.trim()}
                copied={copiedTarget === "ebay"}
              />
              <CopyButton
                label="Copy Depop"
                onClick={() => handleCopy("depop")}
                disabled={!copyMap.depop?.trim()}
                copied={copiedTarget === "depop"}
              />
              <CopyButton
                label="Copy Poshmark"
                onClick={() => handleCopy("poshmark")}
                disabled={!copyMap.poshmark?.trim()}
                copied={copiedTarget === "poshmark"}
              />
              <CopyButton
                label="Copy Mercari"
                onClick={() => handleCopy("mercari")}
                disabled={!copyMap.mercari?.trim()}
                copied={copiedTarget === "mercari"}
              />
              <CopyButton
                label="Copy Etsy"
                onClick={() => handleCopy("etsy")}
                disabled={!copyMap.etsy?.trim()}
                copied={copiedTarget === "etsy"}
              />
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-gray-700">
              Field Copy Actions
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-semibold uppercase">eBay</div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    label="Copy Title A"
                    onClick={() => handleCopy("ebay-title-a")}
                    disabled={!copyMap["ebay-title-a"]?.trim()}
                    copied={copiedTarget === "ebay-title-a"}
                  />
                  <CopyButton
                    label="Copy Title B"
                    onClick={() => handleCopy("ebay-title-b")}
                    disabled={!copyMap["ebay-title-b"]?.trim()}
                    copied={copiedTarget === "ebay-title-b"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("ebay-description")}
                    disabled={!copyMap["ebay-description"]?.trim()}
                    copied={copiedTarget === "ebay-description"}
                  />
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-semibold uppercase">Depop</div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    label="Copy Listing"
                    onClick={() => handleCopy("depop-listing")}
                    disabled={!copyMap["depop-listing"]?.trim()}
                    copied={copiedTarget === "depop-listing"}
                  />
                  <CopyButton
                    label="Copy Hashtags"
                    onClick={() => handleCopy("depop-hashtags")}
                    disabled={!copyMap["depop-hashtags"]?.trim()}
                    copied={copiedTarget === "depop-hashtags"}
                  />
                  <CopyButton
                    label="Copy Brand Hashtags"
                    onClick={() => handleCopy("depop-brand-hashtags")}
                    disabled={!copyMap["depop-brand-hashtags"]?.trim()}
                    copied={copiedTarget === "depop-brand-hashtags"}
                  />
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-semibold uppercase">Poshmark</div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    label="Copy Title"
                    onClick={() => handleCopy("poshmark-title")}
                    disabled={!copyMap["poshmark-title"]?.trim()}
                    copied={copiedTarget === "poshmark-title"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("poshmark-description")}
                    disabled={!copyMap["poshmark-description"]?.trim()}
                    copied={copiedTarget === "poshmark-description"}
                  />
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-semibold uppercase">Mercari</div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    label="Copy Title"
                    onClick={() => handleCopy("mercari-title")}
                    disabled={!copyMap["mercari-title"]?.trim()}
                    copied={copiedTarget === "mercari-title"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("mercari-description")}
                    disabled={!copyMap["mercari-description"]?.trim()}
                    copied={copiedTarget === "mercari-description"}
                  />
                  <CopyButton
                    label="Copy Hashtags"
                    onClick={() => handleCopy("mercari-hashtags")}
                    disabled={!copyMap["mercari-hashtags"]?.trim()}
                    copied={copiedTarget === "mercari-hashtags"}
                  />
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-semibold uppercase">Etsy</div>
                <div className="flex flex-wrap gap-2">
                  <CopyButton
                    label="Copy Title"
                    onClick={() => handleCopy("etsy-title")}
                    disabled={!copyMap["etsy-title"]?.trim()}
                    copied={copiedTarget === "etsy-title"}
                  />
                  <CopyButton
                    label="Copy Tags"
                    onClick={() => handleCopy("etsy-tags")}
                    disabled={!copyMap["etsy-tags"]?.trim()}
                    copied={copiedTarget === "etsy-tags"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("etsy-description")}
                    disabled={!copyMap["etsy-description"]?.trim()}
                    copied={copiedTarget === "etsy-description"}
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-gray-700">
              Payload Map
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold uppercase">eBay</div>
                <div className="mt-2 text-sm text-gray-700">
                  Ready fields: {payloadSummary.ebay} / 4
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold uppercase">Depop</div>
                <div className="mt-2 text-sm text-gray-700">
                  Ready fields: {payloadSummary.depop} / 4
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold uppercase">Poshmark</div>
                <div className="mt-2 text-sm text-gray-700">
                  Ready fields: {payloadSummary.poshmark} / 3
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold uppercase">Mercari</div>
                <div className="mt-2 text-sm text-gray-700">
                  Ready fields: {payloadSummary.mercari} / 4
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-sm font-semibold uppercase">Etsy</div>
                <div className="mt-2 text-sm text-gray-700">
                  Ready fields: {payloadSummary.etsy} / 4
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          {output ? (
            <div className="whitespace-pre-wrap text-sm leading-7">{output}</div>
          ) : (
            <p className="text-sm text-gray-500">
              Your generated LP-U output will appear here.
            </p>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-2xl border p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">Vendoo Field Map</h2>
          <StatusBadge pass={vendooTotals.platformsNeedingReview === 0} />
        </div>

        {!validation ? (
          <p className="text-sm text-gray-500">
            Vendoo field readiness will appear here after generation.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Platforms Ready
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooTotals.platformsReady}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Platforms Needing Review
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooTotals.platformsNeedingReview}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Required Fields Ready
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooTotals.readyRequiredFields} / {vendooTotals.requiredFields}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Validation Status
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {validation.pass ? "Passing" : "Needs Review"}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {platformOrder.map((platformKey) => {
                const resolved = vendooResolvedMap[platformKey];
                const status = vendooStatus[platformKey];

                return (
                  <div key={platformKey} className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-base font-semibold uppercase">
                        {platformKey}
                      </div>
                      <StatusBadge pass={status.allRequiredReady} />
                    </div>

                    <div className="mb-4 text-sm text-gray-600">
                      Required ready: {status.readyRequiredFields} / {status.requiredFields}
                    </div>

                    <div className="space-y-3">
                      {resolved.fields.map((field) => (
                        <div key={field.key} className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="font-medium text-sm">{field.label}</div>

                            <div className="flex gap-2">
                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                  field.required
                                    ? "bg-gray-100 text-gray-700"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {field.required ? "Required" : "Optional"}
                              </span>

                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                  field.ready
                                    ? "bg-green-100 text-green-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {field.ready ? "Ready" : "Missing"}
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 text-xs text-gray-700">
                            {previewValue(field.value)}
                          </div>

                          {field.notes ? (
                            <div className="mt-2 text-[11px] text-gray-500">
                              {field.notes}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-2xl border p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">Vendoo Action Preview</h2>
          <StatusBadge pass={vendooActionTotals.actionReviewPlatforms === 0} />
        </div>

        {!validation ? (
          <p className="text-sm text-gray-500">
            Vendoo action preview will appear here after generation.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Platforms Action-Ready
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooActionTotals.actionReadyPlatforms}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Platforms Needing Review
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooActionTotals.actionReviewPlatforms}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Required Steps Ready
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooActionTotals.readyRequiredSteps} / {vendooActionTotals.totalRequiredSteps}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  All Steps Ready
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {vendooActionTotals.readySteps} / {vendooActionTotals.totalSteps}
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {platformOrder.map((platformKey) => {
                const preview = vendooActionPreview[platformKey];

                return (
                  <div key={platformKey} className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-base font-semibold uppercase">
                        {platformKey}
                      </div>
                      <StatusBadge pass={preview.canRun} />
                    </div>

                    <div className="mb-4 text-sm text-gray-600">
                      Ready steps: {preview.readySteps} / {preview.totalSteps}
                    </div>

                    <div className="space-y-3">
                      {preview.steps.map((step) => (
                        <div key={`${platformKey}-${step.fieldKey}`} className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs uppercase tracking-wide text-gray-500">
                                Step {step.order}
                              </div>
                              <div className="mt-1 font-medium text-sm">
                                {step.actionLabel}
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                  step.required
                                    ? "bg-gray-100 text-gray-700"
                                    : "bg-slate-100 text-slate-700"
                                }`}
                              >
                                {step.required ? "Required" : "Optional"}
                              </span>

                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                  step.ready
                                    ? "bg-green-100 text-green-800"
                                    : "bg-amber-100 text-amber-800"
                                }`}
                              >
                                {step.ready ? "Ready" : "Missing"}
                              </span>
                            </div>
                          </div>

                          <div className="mt-2 text-xs text-gray-700">
                            {previewValue(step.value)}
                          </div>

                          {step.notes ? (
                            <div className="mt-2 text-[11px] text-gray-500">
                              {step.notes}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="mt-8 rounded-2xl border p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-semibold">Validation</h2>
          {validation ? <StatusBadge pass={validation.pass} /> : null}
        </div>

        {!validation ? (
          <p className="text-sm text-gray-500">
            Validation results will appear here after generation.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Overall
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {validation.pass ? "Passing" : "Failing"}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Platforms Passed
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {validation.metrics.platformsPassed}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Platforms Failed
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {validation.metrics.platformsFailed}
                </div>
              </div>

              <div className="rounded-xl border p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Expected Footer
                </div>
                <div className="mt-2 text-lg font-semibold">
                  {validation.metrics.expectedFooterType}
                </div>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-semibold">Platform Status</h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {platformOrder.map((platformKey) => {
                  const result = validation.platformResults[platformKey];
                  const metricEntries = Object.entries(result.metrics).slice(0, 6);

                  return (
                    <div key={platformKey} className="rounded-xl border p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-base font-semibold uppercase">
                          {platformKey}
                        </div>
                        <StatusBadge pass={result.pass} />
                      </div>

                      <div className="mb-3 text-sm text-gray-600">
                        Section present: {result.present ? "Yes" : "No"}
                      </div>

                      {metricEntries.length > 0 ? (
                        <div className="space-y-2 text-sm">
                          {metricEntries.map(([key, value]) => (
                            <div key={key}>
                              <span className="font-medium">{key}:</span>{" "}
                              <span className="text-gray-700">
                                {formatMetricValue(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500">No metrics</div>
                      )}

                      {result.issues.length > 0 ? (
                        <div className="mt-4">
                          <div className="mb-2 text-sm font-medium">Issues</div>
                          <ul className="space-y-2 text-sm text-red-700">
                            {result.issues.map((issue, index) => (
                              <li
                                key={`${issue.code}-${index}`}
                                className="rounded-lg bg-red-50 p-2"
                              >
                                <div className="font-medium">{issue.code}</div>
                                <div>{issue.message}</div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-4 text-sm text-green-700">No issues</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-lg font-semibold">All Issues</h3>
              {validation.issues.length === 0 ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-green-800">
                  No validation issues found.
                </div>
              ) : (
                <div className="space-y-3">
                  {validation.issues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${index}`}
                      className="rounded-xl border border-red-200 bg-red-50 p-4"
                    >
                      <div className="font-semibold text-red-800">
                        {issue.platform.toUpperCase()} — {issue.code}
                      </div>
                      <div className="mt-1 text-sm text-red-700">
                        {issue.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

    </main>
  );
}
