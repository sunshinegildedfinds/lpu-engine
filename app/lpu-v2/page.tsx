"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  buildPricingResearchFromBrief,
  calculatePricingRecommendation,
  type ConditionMatch,
  type LookbackWindow,
  type ManualCompInputs,
  type ShippingIncluded,
} from "@/lib/lpu/pricingResearch";
import {
  formatWebCompsSourceCountLabel,
  recalculateWebCompsSummary,
} from "@/lib/lpu/webComps";
import {
  buildLpuPayloadPreview,
  type LpuPayloadPreview,
  type PayloadWarning,
  type PayloadPlatformKey,
} from "@/lib/lpu/payloadPreview";
import { sendVendooPayloadToExtension } from "@/lib/sendVendooPayloadToExtension";
import type {
  JsonObject,
  ListingQueueRecord,
  ListingQueueStatus,
} from "@/lib/lpu/listingQueue";
import { stripUnsafePhotoDataForQueue } from "@/lib/lpu/listingQueue";
import type { VendooPhotoPayload } from "@/lib/vendoo/extensionPayload";

const INTERFACE_VERSION = "v2";
const PROMPT_VERSION = "v2";

const WORKFLOW_SECTIONS = [
  "Item Intake",
  "Evidence Review",
  "Generate LP-U",
  "Platform Review",
  "Research / Comps",
  "Pricing",
  "Vendoo Handoff",
];

type GenerationMetadata = {
  promptVersion?: string;
  interfaceVersion?: string;
  requestImageCount?: number;
};

type GeneratorImageReference = {
  name: string;
  type: string;
  size: number;
  storagePath: string;
  imageUrl: string;
};

type GenerationMode = "sellingBrief" | "finalFromBrief";

type QueueStatusResponse = {
  authenticated?: boolean;
  error?: string;
};

type QueueListResponse = {
  ok?: boolean;
  items?: ListingQueueRecord[];
  error?: string;
};

type QueueItemResponse = {
  ok?: boolean;
  item?: ListingQueueRecord;
  error?: string;
};

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

type ManualPricingFormState = {
  averageSoldPrice: string;
  medianSoldPrice: string;
  lowRelevantSold: string;
  highRelevantSold: string;
  soldCount: string;
  activeCount: string;
  sellThroughPercent: string;
  lookbackWindow: LookbackWindow;
  shippingIncluded: ShippingIncluded;
  conditionMatch: ConditionMatch;
  compNotes: string;
};

type WebCompsSourceStatus =
  | "sold"
  | "completed"
  | "best_offer_uncertain"
  | "active_or_unclear"
  | "excluded";

type WebCompsSimilarity =
  | "strong"
  | "medium"
  | "weak"
  | "not_comparable";

type WebCompsMatchType =
  | "full_item"
  | "same_item_type"
  | "component_only"
  | "style_only"
  | "brand_only"
  | "material_only"
  | "unclear";

type WebCompsUserOverrideRisk = "none" | "low" | "medium" | "high";

type WebCompsResultState = {
  suggestedPrice: number | null;
  suggestedPriceLabel: string;
  confidence: "High" | "Medium" | "Low" | "Very Low";
  usableSoldResultsUsed: number;
  targetSoldResultsRequested: 10;
  minimumTargetSoldResults: 10;
  candidateSourcesReturned: number;
  eligibleSoldResultsFound: number;
  selectedSoldResultsUsed: number;
  basis: string;
  bestOfferCaveatUsed: boolean;
  sourceUrls: Array<{
    id: string;
    url: string;
    title: string;
    visiblePrice: number | null;
    status: WebCompsSourceStatus;
    eligibleForPricing: boolean;
    defaultIncludedInPricing: boolean;
    selectableForUserPricing: boolean;
    hardDisabled: boolean;
    userOverrideRisk: WebCompsUserOverrideRisk;
    usedInPricing: boolean;
    ineligibilityReason: string | null;
    similarity: WebCompsSimilarity;
    matchType: WebCompsMatchType;
    matchReasons: string[];
    mismatchReasons: string[];
  }>;
};

function isWebCompsResultState(value: unknown): value is WebCompsResultState {
  if (!value || typeof value !== "object") return false;

  const source = value as Record<string, unknown>;
  const suggestedPrice = source.suggestedPrice;
  const confidence = source.confidence;

  return (
    (suggestedPrice === null ||
      (typeof suggestedPrice === "number" &&
        Number.isFinite(suggestedPrice) &&
        suggestedPrice > 0)) &&
    typeof source.suggestedPriceLabel === "string" &&
    (confidence === "High" ||
      confidence === "Medium" ||
      confidence === "Low" ||
      confidence === "Very Low") &&
    typeof source.usableSoldResultsUsed === "number" &&
    Number.isInteger(source.usableSoldResultsUsed) &&
    source.usableSoldResultsUsed >= 0 &&
    source.targetSoldResultsRequested === 10 &&
    source.minimumTargetSoldResults === 10 &&
    typeof source.candidateSourcesReturned === "number" &&
    Number.isInteger(source.candidateSourcesReturned) &&
    source.candidateSourcesReturned >= 0 &&
    typeof source.eligibleSoldResultsFound === "number" &&
    Number.isInteger(source.eligibleSoldResultsFound) &&
    source.eligibleSoldResultsFound >= 0 &&
    typeof source.selectedSoldResultsUsed === "number" &&
    Number.isInteger(source.selectedSoldResultsUsed) &&
    source.selectedSoldResultsUsed >= 0 &&
    typeof source.bestOfferCaveatUsed === "boolean" &&
    Array.isArray(source.sourceUrls)
  );
}

function getWebCompSourceSelectionLabel(
  source: WebCompsResultState["sourceUrls"][number]
): string {
  if (source.hardDisabled) {
    return source.ineligibilityReason || "source cannot be priced";
  }

  if (!source.eligibleForPricing) {
    return `${source.ineligibilityReason || "uncertain source"} - user override allowed`;
  }

  if (source.defaultIncludedInPricing) return "auto-selected";
  return "eligible override";
}

const DEFAULT_MANUAL_PRICING_FORM: ManualPricingFormState = {
  averageSoldPrice: "",
  medianSoldPrice: "",
  lowRelevantSold: "",
  highRelevantSold: "",
  soldCount: "",
  activeCount: "",
  sellThroughPercent: "",
  lookbackWindow: "90d",
  shippingIncluded: "unknown",
  conditionMatch: "unknown",
  compNotes: "",
};

function sanitizeFileName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildStoragePath(file: File): string {
  const safeName = sanitizeFileName(file.name) || "upload.jpg";
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `lpu/${stamp}-${random}-${safeName}`;
}

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function uploadFilesToSupabaseStorage(
  files: File[]
): Promise<GeneratorImageReference[]> {
  if (!files.length) return [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const bucketName =
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() ||
    "lpu-generator-images";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase configuration. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  const references: GeneratorImageReference[] = [];

  for (const file of files) {
    const storagePath = buildStoragePath(file);
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucketName}/${encodeStoragePath(
      storagePath
    )}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "x-upsert": "false",
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      const bodyText = await uploadResponse.text();
      throw new Error(
        `Supabase image upload failed for ${file.name}: ${uploadResponse.status} ${bodyText}`
      );
    }

    const imageUrl = `${supabaseUrl}/storage/v1/object/public/${bucketName}/${encodeStoragePath(
      storagePath
    )}`;

    references.push({
      name: file.name,
      type: file.type,
      size: file.size,
      storagePath,
      imageUrl,
    });
  }

  return references;
}

function SectionShell({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-950">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-800">
      {children}
    </label>
  );
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parseOptionalNumber(value: string): number | undefined {
  const cleaned = value.replace(/[$,%]/g, "").trim();
  if (!cleaned) return undefined;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatFinalListPriceInput(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function buildManualCompInputs(
  form: ManualPricingFormState
): ManualCompInputs {
  return {
    averageSoldPrice: parseOptionalNumber(form.averageSoldPrice),
    medianSoldPrice: parseOptionalNumber(form.medianSoldPrice),
    lowRelevantSold: parseOptionalNumber(form.lowRelevantSold),
    highRelevantSold: parseOptionalNumber(form.highRelevantSold),
    soldCount: parseOptionalNumber(form.soldCount),
    activeCount: parseOptionalNumber(form.activeCount),
    sellThroughPercent: parseOptionalNumber(form.sellThroughPercent),
    lookbackWindow: form.lookbackWindow,
    shippingIncluded: form.shippingIncluded,
    conditionMatch: form.conditionMatch,
    compNotes: form.compNotes,
  };
}

function PricingMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-gray-950">{value}</div>
    </div>
  );
}

function ManualPricingInput({
  label,
  name,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  name: keyof ManualPricingFormState;
  onChange: (name: keyof ManualPricingFormState, value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <div>
      <FieldLabel htmlFor={`manual-${name}`}>{label}</FieldLabel>
      <input
        id={`manual-${name}`}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
      />
    </div>
  );
}

const PAYLOAD_PLATFORM_LABELS: Record<PayloadPlatformKey, string> = {
  ebay: "eBay",
  depop: "Depop",
  poshmark: "Poshmark",
  mercari: "Mercari",
  etsy: "Etsy",
};

const PAYLOAD_PLATFORM_ORDER: PayloadPlatformKey[] = [
  "ebay",
  "depop",
  "poshmark",
  "mercari",
  "etsy",
];

function PayloadCopyButton({
  children,
  onCopy,
}: {
  children: ReactNode;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500"
    >
      {children}
    </button>
  );
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function buildQueuePhotos(
  references: GeneratorImageReference[]
): ListingQueueRecord["photos"] {
  return references.map((reference, index) => ({
    storagePath: reference.storagePath,
    imageUrl: reference.imageUrl,
    name: reference.name,
    type: reference.type,
    size: reference.size,
    sortOrder: index,
  }));
}

function readQueuePayloadString(
  payload: LpuPayloadPreview["payload"] | null,
  paths: string[][]
): string {
  for (const path of paths) {
    let current: unknown = payload;
    for (const segment of path) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (typeof current === "string" && current.trim()) return current.trim();
  }

  return "";
}

function formatQueueDate(value?: string): string {
  if (!value) return "No date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatQueueStatus(status: ListingQueueStatus): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function PayloadPreviewPanel({
  copyStatus,
  onCopy,
  preview,
}: {
  copyStatus: string;
  onCopy: (label: string, value: unknown) => void;
  preview: LpuPayloadPreview;
}) {
  const parsedPlatforms = PAYLOAD_PLATFORM_ORDER.filter(
    (platform) => preview.debug.rawSections[platform]
  );
  const missingPlatforms = PAYLOAD_PLATFORM_ORDER.filter(
    (platform) => !preview.debug.rawSections[platform]
  );
  const extensionPlatformPayloads: Partial<Record<PayloadPlatformKey, unknown>> = {
    ebay: preview.payload.marketplaces.ebay,
    depop: preview.payload.marketplaces.depop,
    poshmark: preview.payload.marketplaces.poshmark,
    etsy: preview.payload.etsy,
  };

  return (
    <SectionShell title="Payload Preview">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-gray-950">
          Extension readiness payload preview
        </summary>

        <div className="mt-4 space-y-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <PricingMetric
              label="Platforms Parsed"
              value={`${parsedPlatforms.length} / ${PAYLOAD_PLATFORM_ORDER.length}`}
            />
            <PricingMetric
              label="Photos Ready"
              value={String(preview.payload.photos?.length ?? 0)}
            />
            <PricingMetric
              label="Warnings"
              value={String(preview.warnings.length)}
            />
            <PricingMetric
              label="Payload Shape"
              value="VendooExtensionPayload"
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Preview only. This shows the V1-compatible extension payload shape but
            does not send data to the extension or trigger generation.
          </div>

          <div className="flex flex-wrap gap-2">
            <PayloadCopyButton
              onCopy={() => onCopy("Full payload JSON", preview.payload)}
            >
              Copy Full Payload JSON
            </PayloadCopyButton>
            {PAYLOAD_PLATFORM_ORDER.map((platform) => {
              const platformPayload = extensionPlatformPayloads[platform];
              if (!platformPayload) return null;

              return (
                <PayloadCopyButton
                  key={platform}
                  onCopy={() =>
                    onCopy(
                      `${PAYLOAD_PLATFORM_LABELS[platform]} payload JSON`,
                      platformPayload
                    )
                  }
                >
                  Copy {PAYLOAD_PLATFORM_LABELS[platform]} Payload
                </PayloadCopyButton>
              );
            })}
          </div>

          {copyStatus ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
              {copyStatus}
            </div>
          ) : null}

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-950">
              Platform parse status
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-5">
              {PAYLOAD_PLATFORM_ORDER.map((platform) => (
                <div
                  key={platform}
                  className="rounded-md border border-gray-200 bg-white p-3"
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {PAYLOAD_PLATFORM_LABELS[platform]}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-950">
                    {preview.debug.rawSections[platform] ? "Parsed" : "Missing"}
                  </div>
                  {platform === "mercari" && preview.debug.rawSections.mercari ? (
                    <div className="mt-1 text-xs text-gray-500">
                      Parsed for review; not in current V1 extension payload.
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {missingPlatforms.length ? (
              <p className="mt-3 text-xs text-gray-600">
                Missing:{" "}
                {missingPlatforms
                  .map((platform) => PAYLOAD_PLATFORM_LABELS[platform])
                  .join(", ")}
              </p>
            ) : null}
          </div>

          {preview.warnings.length ? (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
              <div className="text-sm font-semibold text-yellow-950">
                Validation warnings
              </div>
              <ul className="mt-3 space-y-2 text-sm text-yellow-900">
                {preview.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${warning.platform ?? "global"}-${index}`}>
                    {warning.platform
                      ? `${PAYLOAD_PLATFORM_LABELS[warning.platform]}: `
                      : ""}
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
              No payload preview warnings.
            </div>
          )}

          <details className="rounded-lg border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-950">
              Extension-compatible JSON preview
            </summary>
            <pre className="mt-3 max-h-[520px] overflow-auto rounded-md bg-gray-950 p-4 text-xs text-gray-50">
              {JSON.stringify(preview.payload, null, 2)}
            </pre>
          </details>

          <div className="space-y-3">
            {PAYLOAD_PLATFORM_ORDER.map((platform) => {
              const platformPayload = extensionPlatformPayloads[platform];
              if (!platformPayload) return null;

              return (
                <details
                  key={platform}
                  className="rounded-lg border border-gray-200 bg-white p-4"
                >
                  <summary className="cursor-pointer text-sm font-semibold text-gray-950">
                    {PAYLOAD_PLATFORM_LABELS[platform]} parsed payload
                  </summary>
                  <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-gray-50 p-4 text-xs text-gray-800">
                    {JSON.stringify(platformPayload, null, 2)}
                  </pre>
                </details>
              );
            })}
          </div>

          <details className="rounded-lg border border-gray-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-gray-950">
              Parsed raw-section debug
            </summary>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded-md bg-gray-50 p-4 text-xs text-gray-800">
              {JSON.stringify(preview.debug, null, 2)}
            </pre>
          </details>
        </div>
      </details>
    </SectionShell>
  );
}

function buildV2Notes({
  conditionNotes,
  knownDetails,
  markings,
  measurements,
  notes,
}: {
  conditionNotes: string;
  knownDetails: string;
  markings: string;
  measurements: string;
  notes: string;
}) {
  return [
    "LP-U V2 interface test intake",
    "",
    "Notes:",
    notes.trim() || "Not provided",
    "",
    "Known details:",
    knownDetails.trim() || "Not provided",
    "",
    "Condition / flaws:",
    conditionNotes.trim() || "Not provided",
    "",
    "Measurements:",
    measurements.trim() || "Not provided",
    "",
    "Markings / labels:",
    markings.trim() || "Not provided",
  ].join("\n");
}

export default function LpuV2Page() {
  const [notes, setNotes] = useState("");
  const [knownDetails, setKnownDetails] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [measurements, setMeasurements] = useState("");
  const [markings, setMarkings] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [uploadedImageReferences, setUploadedImageReferences] = useState<
    GeneratorImageReference[]
  >([]);
  const [vendooPhotos, setVendooPhotos] = useState<VendooPhotoPayload[]>([]);
  const [vendooPhotoWarnings, setVendooPhotoWarnings] = useState<PayloadWarning[]>(
    []
  );
  const [sellingBrief, setSellingBrief] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeMode, setActiveMode] = useState<GenerationMode | null>(null);
  const [metadata, setMetadata] = useState<GenerationMetadata | null>(null);
  const [imageUploadStatus, setImageUploadStatus] = useState("");
  const [manualPricingForm, setManualPricingForm] =
    useState<ManualPricingFormState>(DEFAULT_MANUAL_PRICING_FORM);
  const [webCompsResult, setWebCompsResult] =
    useState<WebCompsResultState | null>(null);
  const [webCompsError, setWebCompsError] = useState("");
  const [isWebCompsLoading, setIsWebCompsLoading] = useState(false);
  const [payloadCopyStatus, setPayloadCopyStatus] = useState("");
  const [vendooSendStatus, setVendooSendStatus] = useState<
    "idle" | "sent" | "failed"
  >("idle");
  const [vendooSendMessage, setVendooSendMessage] = useState("");
  const [finalListPriceInput, setFinalListPriceInput] = useState("");
  const [finalListPriceManuallyEdited, setFinalListPriceManuallyEdited] =
    useState(false);
  const [queueAuthenticated, setQueueAuthenticated] = useState(false);
  const [queueAuthLoading, setQueueAuthLoading] = useState(false);
  const [queueAuthError, setQueueAuthError] = useState("");
  const [queueOwnerSecretInput, setQueueOwnerSecretInput] = useState("");
  const [queueItems, setQueueItems] = useState<ListingQueueRecord[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [queueSaveStatus, setQueueSaveStatus] = useState("");
  const [queueSaveError, setQueueSaveError] = useState("");

  const compiledNotes = useMemo(
    () =>
      buildV2Notes({
        conditionNotes,
        knownDetails,
        markings,
        measurements,
        notes,
      }),
    [conditionNotes, knownDetails, markings, measurements, notes]
  );

  const pricingResearch = useMemo(
    () =>
      buildPricingResearchFromBrief({
        sellingBrief,
        finalOutput: output,
        notes,
        knownDetails,
        conditionFlaws: conditionNotes,
        measurements,
        markingsLabels: markings,
      }),
    [conditionNotes, knownDetails, markings, measurements, notes, output, sellingBrief]
  );

  const manualCompInputs = useMemo(
    () => buildManualCompInputs(manualPricingForm),
    [manualPricingForm]
  );

  const pricingRecommendation = useMemo(
    () =>
      calculatePricingRecommendation(manualCompInputs, pricingResearch, {
        summary: webCompsResult,
        sources: webCompsResult?.sourceUrls ?? [],
      }),
    [manualCompInputs, pricingResearch, webCompsResult]
  );

  const suggestedListPriceInputValue = useMemo(
    () => formatFinalListPriceInput(pricingRecommendation.suggestedListPrice),
    [pricingRecommendation.suggestedListPrice]
  );

  useEffect(() => {
    if (finalListPriceManuallyEdited) return;
    setFinalListPriceInput(suggestedListPriceInputValue);
  }, [finalListPriceManuallyEdited, suggestedListPriceInputValue]);

  useEffect(() => {
    async function checkInitialQueueAuthStatus() {
      setQueueAuthLoading(true);
      setQueueAuthError("");

      try {
        const statusResponse = await fetch("/api/lpu/queue-auth/status", {
          method: "GET",
          cache: "no-store",
        });
        const statusData = (await statusResponse.json()) as QueueStatusResponse;

        if (!statusResponse.ok) {
          throw new Error("Unable to verify queue status.");
        }

        const authenticated = Boolean(statusData.authenticated);
        setQueueAuthenticated(authenticated);
        if (!authenticated) {
          setQueueItems([]);
          return;
        }

        setQueueLoading(true);
        setQueueError("");
        const listResponse = await fetch("/api/lpu/listing-queue", {
          method: "GET",
          cache: "no-store",
        });
        const listData = (await listResponse.json()) as QueueListResponse;

        if (!listResponse.ok || !listData.ok || !Array.isArray(listData.items)) {
          throw new Error("Unable to load listing queue.");
        }

        setQueueItems(listData.items);
      } catch {
        setQueueAuthenticated(false);
        setQueueItems([]);
        setQueueAuthError("Unable to verify queue status.");
      } finally {
        setQueueAuthLoading(false);
        setQueueLoading(false);
      }
    }

    void checkInitialQueueAuthStatus();
  }, []);

  const payloadPreview = useMemo(
    () => {
      if (!output.trim()) return null;

      const photoWarnings = [...vendooPhotoWarnings];
      if (files.length > 0 && vendooPhotos.length === 0) {
        photoWarnings.push({
          code: "missing_photo_payload",
          message:
            "Selected images exist, but no valid Vendoo photo payload entries were prepared.",
          field: "photos",
        });
      }

      return buildLpuPayloadPreview({
        finalOutput: output,
        hasSellingBrief: sellingBrief.trim().length > 0,
        finalListPriceInput,
        photos: vendooPhotos,
        photoWarnings,
      });
    },
    [
      files.length,
      finalListPriceInput,
      output,
      sellingBrief,
      vendooPhotoWarnings,
      vendooPhotos,
    ]
  );

  const queuePhotoMetadata = useMemo(
    () => buildQueuePhotos(uploadedImageReferences),
    [uploadedImageReferences]
  );

  const selectedPhotosNeedUpload =
    files.length > 0 && queuePhotoMetadata.length < files.length;
  const canSaveCurrentListingToQueue = Boolean(
    queueAuthenticated &&
      output.trim() &&
      payloadPreview?.payload &&
      !selectedPhotosNeedUpload &&
      !queueLoading
  );

  async function unlockQueue() {
    const ownerSecret = queueOwnerSecretInput;
    if (!ownerSecret.trim()) {
      setQueueAuthError("Enter the queue owner secret.");
      return;
    }

    setQueueAuthLoading(true);
    setQueueAuthError("");
    setQueueSaveStatus("");
    setQueueSaveError("");

    try {
      const response = await fetch("/api/lpu/queue-auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ownerSecret }),
      });
      const data = (await response.json()) as QueueStatusResponse;

      if (!response.ok || !data.authenticated) {
        throw new Error("Queue unlock failed.");
      }

      setQueueAuthenticated(true);
      setQueueOwnerSecretInput("");
      await loadQueueItems();
    } catch {
      setQueueAuthenticated(false);
      setQueueItems([]);
      setQueueAuthError("Queue unlock failed.");
    } finally {
      setQueueAuthLoading(false);
    }
  }

  async function lockQueue() {
    setQueueAuthLoading(true);
    setQueueAuthError("");
    setQueueError("");
    setQueueSaveStatus("");
    setQueueSaveError("");

    try {
      await fetch("/api/lpu/queue-auth/logout", {
        method: "POST",
      });
    } finally {
      setQueueAuthenticated(false);
      setQueueOwnerSecretInput("");
      setQueueItems([]);
      setQueueAuthLoading(false);
    }
  }

  async function loadQueueItems() {
    setQueueLoading(true);
    setQueueError("");

    try {
      const response = await fetch("/api/lpu/listing-queue", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json()) as QueueListResponse;

      if (response.status === 401 || response.status === 403) {
        setQueueAuthenticated(false);
        setQueueItems([]);
        throw new Error("Unlock the queue to view saved listings.");
      }

      if (!response.ok || !data.ok || !Array.isArray(data.items)) {
        throw new Error("Unable to load listing queue.");
      }

      setQueueItems(data.items);
    } catch (err) {
      setQueueError(
        err instanceof Error ? err.message : "Unable to load listing queue."
      );
    } finally {
      setQueueLoading(false);
    }
  }

  async function archiveQueueItem(id: string) {
    if (!id) return;

    setQueueLoading(true);
    setQueueError("");
    setQueueSaveStatus("");
    setQueueSaveError("");

    try {
      const response = await fetch(
        `/api/lpu/listing-queue/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        }
      );
      const data = (await response.json()) as QueueItemResponse;

      if (response.status === 401 || response.status === 403) {
        setQueueAuthenticated(false);
        setQueueItems([]);
        throw new Error("Unlock the queue to archive listings.");
      }

      if (!response.ok || !data.ok) {
        throw new Error("Unable to archive queue item.");
      }

      setQueueSaveStatus("Queue item archived.");
      await loadQueueItems();
    } catch (err) {
      setQueueError(
        err instanceof Error ? err.message : "Unable to archive queue item."
      );
    } finally {
      setQueueLoading(false);
    }
  }

  async function saveCurrentListingToQueue() {
    setQueueSaveStatus("");
    setQueueSaveError("");

    if (!queueAuthenticated) {
      setQueueSaveError("Unlock the queue before saving.");
      return;
    }

    if (!output.trim()) {
      setQueueSaveError("Generate or paste Final LP-U output before saving.");
      return;
    }

    if (!payloadPreview?.payload) {
      setQueueSaveError("Generate Final LP-U to create a payload before saving.");
      return;
    }

    if (selectedPhotosNeedUpload) {
      setQueueSaveError("Photos must be uploaded before saving to queue.");
      return;
    }

    const payloadSnapshot = toJsonObject(
      stripUnsafePhotoDataForQueue(payloadPreview.payload)
    );
    const title =
      readQueuePayloadString(payloadPreview.payload, [
        ["coreFields", "title"],
        ["marketplaces", "ebay", "title"],
        ["marketplaces", "ebay", "titleA"],
      ]) || "Untitled queued listing";
    const categorySummary =
      readQueuePayloadString(payloadPreview.payload, [
        ["coreFields", "canonicalVendooCategoryPath"],
        ["coreFields", "category"],
        ["marketplaces", "ebay", "canonicalVendooCategoryPath"],
        ["marketplaces", "ebay", "category"],
      ]) || pricingResearch.suggestedEbayCategoryPath;

    setQueueLoading(true);

    try {
      const response = await fetch("/api/lpu/listing-queue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: payloadSnapshot ? "payload_ready" : "lpu_generated",
          title,
          subtitle: categorySummary,
          categorySummary,
          thumbnailPath: queuePhotoMetadata[0]?.storagePath,
          finalListPrice: finalListPriceInput.trim(),
          itemIntake: {
            notes,
            knownDetails,
            conditionFlaws: conditionNotes,
            conditionNotes,
            measurements,
            markingsLabels: markings,
            markings,
          },
          sellingBrief,
          finalLpuOutput: output,
          payloadSnapshot,
          pricingSnapshot: toJsonObject({
            finalListPriceInput,
            pricingRecommendation,
            pricingResearch,
          }),
          publicWebCompsSnapshot: toJsonObject(webCompsResult),
          manualCompInputs: toJsonObject(manualCompInputs),
          vendooSendStatus: toJsonObject({
            status: vendooSendStatus,
            message: vendooSendMessage,
          }),
          appVersion: `${INTERFACE_VERSION}/${PROMPT_VERSION}`,
          photos: queuePhotoMetadata,
        }),
      });
      const data = (await response.json()) as QueueItemResponse;

      if (response.status === 401 || response.status === 403) {
        setQueueAuthenticated(false);
        setQueueItems([]);
        throw new Error("Unlock the queue before saving.");
      }

      if (!response.ok || !data.ok) {
        throw new Error("Unable to save listing to queue.");
      }

      setQueueSaveStatus("Current listing saved to queue.");
      await loadQueueItems();
    } catch (err) {
      setQueueSaveError(
        err instanceof Error ? err.message : "Unable to save listing to queue."
      );
    } finally {
      setQueueLoading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    setUploadedImageReferences([]);
    setVendooPhotos([]);
    setVendooPhotoWarnings([]);
  }

  function updateManualPricingField(
    name: keyof ManualPricingFormState,
    value: string
  ) {
    setManualPricingForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updateFinalListPriceInput(value: string) {
    setFinalListPriceInput(value);
    setFinalListPriceManuallyEdited(value.trim().length > 0);
  }

  function resetFinalListPriceInput() {
    setFinalListPriceInput(suggestedListPriceInputValue);
    setFinalListPriceManuallyEdited(false);
  }

  async function findPublicWebComps() {
    setWebCompsError("");
    setWebCompsResult(null);
    setIsWebCompsLoading(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 65000);

    try {
      const response = await fetch("/api/lpu/web-comps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          pricingQuery: pricingResearch.terapeakResearchQuery,
          narrowerQuery: pricingResearch.narrowerResearchQuery,
          broaderQuery: pricingResearch.broaderResearchQuery,
          ebaySoldCompsUrl: pricingResearch.ebaySoldCompsUrl,
          sellingBriefSummary: sellingBrief,
          itemIntake: {
            notes,
            knownDetails,
            conditionFlaws: conditionNotes,
            measurements,
            markingsLabels: markings,
          },
        }),
      });
      const responseContentType = response.headers.get("content-type") || "";
      const rawBody = await response.text();
      const data = responseContentType.includes("application/json")
        ? JSON.parse(rawBody)
        : null;

      if (!response.ok) {
        throw new Error(
          data?.error ||
            rawBody?.trim() ||
            `Public web comps request failed with status ${response.status}.`
        );
      }

      if (!data) {
        throw new Error("Server returned a non-JSON public web comps response.");
      }

      if (!isWebCompsResultState(data)) {
        throw new Error("Server returned an invalid public web comps response.");
      }

      setWebCompsResult(data);
    } catch (err) {
      setWebCompsError(
        err instanceof Error && err.name === "AbortError"
          ? "Public web comps search timed out."
          : err instanceof Error
            ? err.message
            : "Failed to find public web comps."
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsWebCompsLoading(false);
    }
  }

  function toggleWebCompSource(sourceId: string, checked: boolean) {
    setWebCompsResult((current) => {
      if (!current) return current;

      const sourceUrls = current.sourceUrls.map((source) =>
        source.id === sourceId && source.selectableForUserPricing
          ? { ...source, usedInPricing: checked }
          : source
      );
      const selectedSourceIds = sourceUrls
        .filter((source) => source.usedInPricing && source.selectableForUserPricing)
        .map((source) => source.id);
      const summary = recalculateWebCompsSummary(
        { ...current, sourceUrls },
        selectedSourceIds
      );

      return {
        ...current,
        ...summary,
        usableSoldResultsUsed: summary.usableSoldResultsUsed,
        sourceUrls,
      };
    });
  }

  async function getGeneratorImageReferences() {
    if (uploadedImageReferences.length) {
      if (!vendooPhotos.length) {
        await prepareVendooPhotos(uploadedImageReferences);
      }
      return uploadedImageReferences;
    }

    if (files.length) {
      setImageUploadStatus("Uploading images to Supabase Storage...");
    }

    const generatorImageReferences = await uploadFilesToSupabaseStorage(files);
    setUploadedImageReferences(generatorImageReferences);
    await prepareVendooPhotos(generatorImageReferences);

    return generatorImageReferences;
  }

  async function prepareVendooPhotos(imageReferences: GeneratorImageReference[]) {
    const warnings: PayloadWarning[] = [];
    const photos = await Promise.all(
      files.map(async (file, index): Promise<VendooPhotoPayload | null> => {
        const reference = imageReferences[index];
        let dataUrl = "";

        try {
          dataUrl = await fileToDataUrl(file);
        } catch {
          warnings.push({
            code: "photo_data_url_conversion_failed",
            message: `Could not prepare image data for ${file.name}; uploaded image references will be used if available.`,
            field: "photos",
          });
        }

        const photo: VendooPhotoPayload = {
          name: file.name,
          type: file.type,
          size: file.size,
          ...(dataUrl ? { dataUrl } : {}),
          ...(reference?.storagePath ? { storagePath: reference.storagePath } : {}),
          ...(reference?.imageUrl ? { imageUrl: reference.imageUrl } : {}),
        };

        if (
          !photo.dataUrl &&
          !photo.storagePath &&
          !photo.imageUrl &&
          !photo.signedUrl
        ) {
          warnings.push({
            code: "invalid_photo_payload",
            message: `${file.name} was omitted because no dataUrl, storagePath, imageUrl, or signedUrl was available.`,
            field: "photos",
          });
          return null;
        }

        return photo;
      })
    );

    const validPhotos = photos.filter(
      (photo): photo is VendooPhotoPayload => photo !== null
    );
    if (files.length > 0 && validPhotos.length < files.length) {
      warnings.push({
        code: "partial_photo_payload",
        message: `${files.length - validPhotos.length} selected image${
          files.length - validPhotos.length === 1 ? "" : "s"
        } could not be prepared for Vendoo photo upload.`,
        field: "photos",
      });
    }

    setVendooPhotos(validPhotos);
    setVendooPhotoWarnings(warnings);
  }

  async function runV2Generation(mode: GenerationMode) {
    setError("");
    setMetadata(null);
    setImageUploadStatus("");
    setIsLoading(true);
    setActiveMode(mode);

    try {
      if (mode === "finalFromBrief" && !sellingBrief.trim()) {
        throw new Error("Generate or enter a Selling Brief before final LP-U generation.");
      }

      if (mode === "sellingBrief") {
        setSellingBrief("");
        setOutput("");
      }

      const generatorImageReferences = await getGeneratorImageReferences();
      if (files.length) {
        setImageUploadStatus(
          `Using ${generatorImageReferences.length} uploaded image reference(s). ${
            mode === "sellingBrief"
              ? "Generating Selling Brief..."
              : "Generating final LP-U from brief..."
          }`
        );
      }

      const response = await fetch("/api/lpu/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notes: compiledNotes,
          images: generatorImageReferences,
          mode,
          ...(mode === "finalFromBrief"
            ? { sellingBrief: sellingBrief.trim() }
            : {}),
          interfaceVersion: INTERFACE_VERSION,
          promptVersion: PROMPT_VERSION,
        }),
      });
      const responseContentType = response.headers.get("content-type") || "";
      const rawBody = await response.text();
      const data = responseContentType.includes("application/json")
        ? JSON.parse(rawBody)
        : null;

      if (!response.ok) {
        throw new Error(
          data?.error ||
            rawBody?.trim() ||
            `Request failed with status ${response.status}.`
        );
      }

      if (!data) {
        throw new Error("Server returned a non-JSON success response.");
      }

      if (mode === "sellingBrief") {
        setSellingBrief(data.sellingBrief || data.output || "");
        setOutput("");
      } else {
        setOutput(data.output || "");
      }

      setMetadata({
        interfaceVersion: data.interfaceVersion,
        promptVersion: data.promptVersion,
        requestImageCount: generatorImageReferences.length,
      });
      setImageUploadStatus(
        files.length
          ? "Generation used Supabase image references successfully."
          : ""
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate output.");
      setImageUploadStatus("");
    } finally {
      setIsLoading(false);
      setActiveMode(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runV2Generation("finalFromBrief");
  }

  async function copyPayloadPreview(label: string, value: unknown) {
    setPayloadCopyStatus("");

    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setPayloadCopyStatus(`${label} copied.`);
    } catch {
      setPayloadCopyStatus(`Could not copy ${label}.`);
    }
  }

  function handleSendPayloadToVendooExtension() {
    setVendooSendStatus("idle");
    setVendooSendMessage("");

    try {
      if (!payloadPreview?.payload) {
        setVendooSendStatus("failed");
        setVendooSendMessage("Generate Final LP-U to create payload.");
        return;
      }

      const sent = sendVendooPayloadToExtension(payloadPreview.payload);
      if (!sent) {
        setVendooSendStatus("failed");
        setVendooSendMessage("Payload could not be posted from this browser page.");
        return;
      }

      setVendooSendStatus("sent");
      setVendooSendMessage(
        "Payload send message posted. If the extension is installed, it should receive it."
      );
    } catch (err) {
      setVendooSendStatus("failed");
      setVendooSendMessage(
        err instanceof Error
          ? err.message
          : "Payload could not be posted to the extension bridge."
      );
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 text-gray-950 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 border-b border-gray-200 pb-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
              V2 / Test Mode
            </span>
            <span className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700">
              Interface {INTERFACE_VERSION}
            </span>
            <span className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700">
              Prompt {PROMPT_VERSION}
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">LP-U Workspace V2</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600">
            Isolated interface shell for V2 prompt and workflow testing. The V1
            app route and extension handoff remain separate.
          </p>
        </div>

        <div className="mb-6 grid gap-2 md:grid-cols-7">
          {WORKFLOW_SECTIONS.map((section, index) => (
            <div
              key={section}
              className="rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Step {index + 1}
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-950">
                {section}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <SectionShell title="Item Intake">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <FieldLabel htmlFor="notes">Notes</FieldLabel>
                  <textarea
                    id="notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="General item notes, source details, seller observations, or task context."
                    className="mt-2 min-h-[130px] w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="known-details">Known Details</FieldLabel>
                  <textarea
                    id="known-details"
                    value={knownDetails}
                    onChange={(event) => setKnownDetails(event.target.value)}
                    placeholder="Brand, item type, materials, size, color, age, style, or provenance when known."
                    className="mt-2 min-h-[110px] w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="condition-flaws">Condition / Flaws</FieldLabel>
                  <textarea
                    id="condition-flaws"
                    value={conditionNotes}
                    onChange={(event) => setConditionNotes(event.target.value)}
                    placeholder="Wear, marks, missing parts, repairs, odors, or condition uncertainty."
                    className="mt-2 min-h-[110px] w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="measurements">Measurements</FieldLabel>
                  <textarea
                    id="measurements"
                    value={measurements}
                    onChange={(event) => setMeasurements(event.target.value)}
                    placeholder='Example: Length - 24", Width - 18", Drop - 2"'
                    className="mt-2 min-h-[110px] w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                  />
                </div>

                <div>
                  <FieldLabel htmlFor="markings-labels">Markings / Labels</FieldLabel>
                  <textarea
                    id="markings-labels"
                    value={markings}
                    onChange={(event) => setMarkings(event.target.value)}
                    placeholder="Tags, stamps, signatures, RN numbers, labels, hallmarks, or maker marks."
                    className="mt-2 min-h-[110px] w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                  />
                </div>
              </div>
            </SectionShell>

            <SectionShell title="Evidence Review">
              <FieldLabel htmlFor="uploaded-images">Uploaded Images</FieldLabel>
              <input
                id="uploaded-images"
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="mt-2 block w-full text-sm"
              />
              <p className="mt-2 text-sm text-gray-500">
                Selected: {files.length} image(s).
              </p>
            </SectionShell>

            <SectionShell title="Universal Selling Brief">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void runV2Generation("sellingBrief")}
                  className="rounded-lg bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading && activeMode === "sellingBrief"
                    ? "Generating Selling Brief..."
                    : "Generate Selling Brief"}
                </button>
                <div className="text-sm text-gray-600">
                  Creates the visible strategy brief before final LP-U generation.
                </div>
              </div>

              <div className="mt-4">
                <FieldLabel htmlFor="selling-brief">
                  Editable Universal Selling Brief
                </FieldLabel>
                <textarea
                  id="selling-brief"
                  value={sellingBrief}
                  onChange={(event) => setSellingBrief(event.target.value)}
                  placeholder="Generated Selling Brief will appear here. You can edit it before final LP-U generation."
                  className="mt-2 min-h-[420px] w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-xs outline-none focus:border-black"
                />
              </div>
            </SectionShell>

            <SectionShell title="Pricing Research">
              {!sellingBrief.trim() ? (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  Generate or paste a Universal Selling Brief to populate pricing
                  research shortcuts. This panel does not scrape eBay, open
                  marketplace pages automatically, or create comp data automatically.
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Manual comp data overrides AI starting range. Suggested pricing
                    depends on the data you enter. Research links are shortcuts for
                    manual review, not manually confirmed comp data.
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="text-sm font-semibold text-gray-950">
                        eBay Sold Search
                      </div>
                      <p className="mt-2 text-xs text-gray-600">
                        Open eBay Sold Search is a research shortcut, not manually
                        confirmed comp data.
                      </p>
                      <a
                        href={pricingResearch.ebaySoldCompsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white"
                      >
                        Open eBay Sold Search
                      </a>
                      <div className="mt-3 break-words rounded-md bg-white p-3 font-mono text-xs text-gray-700">
                        {pricingResearch.researchKeywords || "No supported query yet"}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">
                        {pricingResearch.ebaySoldCompsExplanation}
                      </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="text-sm font-semibold text-gray-950">
                        Product Research Query
                      </div>
                      <p className="mt-2 text-xs text-gray-600">
                        Product Research query is for manual use in eBay Seller Hub
                        / Research tab.
                      </p>
                      <div className="mt-3 grid gap-3">
                        <PricingMetric
                          label="Recommended"
                          value={
                            <span className="font-mono">
                              {pricingResearch.terapeakResearchQuery}
                            </span>
                          }
                        />
                        <PricingMetric
                          label="Narrower"
                          value={
                            <span className="font-mono">
                              {pricingResearch.narrowerResearchQuery}
                            </span>
                          }
                        />
                        <PricingMetric
                          label="Broader"
                          value={
                            <span className="font-mono">
                              {pricingResearch.broaderResearchQuery}
                            </span>
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-sm font-semibold text-gray-950">
                        Suggested eBay Category
                      </div>
                      <div className="mt-3 grid gap-3">
                        <PricingMetric
                          label="Name"
                          value={pricingResearch.suggestedEbayCategoryName}
                        />
                        <PricingMetric
                          label="Path"
                          value={pricingResearch.suggestedEbayCategoryPath}
                        />
                        <PricingMetric
                          label="Confidence"
                          value={pricingResearch.suggestedEbayCategoryConfidence}
                        />
                      </div>
                      <p className="mt-3 text-xs text-gray-500">
                        {pricingResearch.categoryNotes}
                      </p>
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="text-sm font-semibold text-gray-950">
                        AI Starting Range — not sold-comp derived.
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <PricingMetric
                          label="Low"
                          value={formatUsd(pricingResearch.aiStartingRangeLow)}
                        />
                        <PricingMetric
                          label="High"
                          value={formatUsd(pricingResearch.aiStartingRangeHigh)}
                        />
                        <PricingMetric
                          label="Confidence"
                          value={pricingResearch.aiStartingRangeConfidence}
                        />
                      </div>
                      <p className="mt-3 text-sm text-gray-700">
                        {pricingResearch.aiStartingRangeBasis}
                      </p>
                      <ul className="mt-3 space-y-1 text-xs text-gray-500">
                        {pricingResearch.pricingWarnings.map((warning) => (
                          <li key={warning}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-950">
                          Public Web Comps
                        </div>
                        <p className="mt-1 text-xs text-gray-600">
                          Uses public eBay pages surfaced by web search. Best Offer
                          results are treated conservatively.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={
                          isWebCompsLoading ||
                          !pricingResearch.terapeakResearchQuery.trim()
                        }
                        onClick={() => void findPublicWebComps()}
                        className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isWebCompsLoading
                          ? "Searching public eBay sold results..."
                          : "Find Public Web Comps"}
                      </button>
                    </div>

                    {webCompsError ? (
                      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {webCompsError}
                      </div>
                    ) : null}

                    {webCompsResult ? (
                      <div className="mt-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <PricingMetric
                            label="Suggested Public-Web Comp Price"
                            value={
                              webCompsResult.suggestedPrice === null
                                ? "Not enough public sold evidence"
                                : formatUsd(webCompsResult.suggestedPrice)
                            }
                          />
                          <PricingMetric
                            label="Confidence"
                            value={webCompsResult.confidence}
                          />
                          <PricingMetric
                            label="Sources Used"
                            value={formatWebCompsSourceCountLabel(
                              webCompsResult.selectedSoldResultsUsed,
                              webCompsResult.minimumTargetSoldResults
                            )}
                          />
                        </div>

                        {webCompsResult.sourceUrls.length ? (
                          <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
                            <summary className="cursor-pointer font-semibold text-gray-800">
                              Sources used/details
                            </summary>
                            <div className="mt-3 grid gap-2 sm:grid-cols-4">
                              <PricingMetric
                                label="Candidate Sources"
                                value={String(webCompsResult.candidateSourcesReturned)}
                              />
                              <PricingMetric
                                label="Auto-selected comps"
                                value={String(
                                  webCompsResult.sourceUrls.filter(
                                    (source) => source.defaultIncludedInPricing
                                  ).length
                                )}
                              />
                              <PricingMetric
                                label="Selected sources"
                                value={String(webCompsResult.selectedSoldResultsUsed)}
                              />
                              <PricingMetric
                                label="Target"
                                value={`${webCompsResult.minimumTargetSoldResults}+ usable comps`}
                              />
                            </div>
                            <ul className="mt-3 space-y-2">
                              {webCompsResult.sourceUrls.map((source) => (
                                <li
                                  key={source.id}
                                  className="rounded-md border border-gray-200 bg-white p-3"
                                >
                                  <label className="flex items-start gap-3">
                                    <input
                                      type="checkbox"
                                      checked={source.usedInPricing}
                                      disabled={!source.selectableForUserPricing}
                                      onChange={(event) =>
                                        toggleWebCompSource(
                                          source.id,
                                          event.target.checked
                                        )
                                      }
                                      className="mt-1 h-4 w-4 rounded border-gray-300 text-black disabled:cursor-not-allowed disabled:opacity-50"
                                    />
                                    <span className="min-w-0 flex-1">
                                      <a
                                        href={source.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="break-words font-medium text-gray-950 underline"
                                      >
                                        {source.title || source.url}
                                      </a>
                                      <span className="mt-1 block text-gray-500">
                                        {source.status}
                                        {source.visiblePrice !== null
                                          ? ` · ${formatUsd(source.visiblePrice)}`
                                          : " · no visible price"}
                                        {source.usedInPricing
                                          ? " · selected"
                                          : " · not selected"}
                                      </span>
                                      <span className="mt-1 block text-gray-500">
                                        {source.similarity} · {source.matchType}
                                        {` · ${getWebCompSourceSelectionLabel(source)}`}
                                      </span>
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-gray-950">
                          Optional Manual Comp Inputs
                        </div>
                        <p className="mt-1 text-xs text-gray-600">
                          Enter only what you have. Do not enter sold data unless
                          you manually reviewed it.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setManualPricingForm(DEFAULT_MANUAL_PRICING_FORM)
                        }
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700"
                      >
                        Clear manual comps
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-3">
                      <ManualPricingInput
                        label="Average sold price"
                        name="averageSoldPrice"
                        value={manualPricingForm.averageSoldPrice}
                        onChange={updateManualPricingField}
                        placeholder="$"
                      />
                      <ManualPricingInput
                        label="Median sold price"
                        name="medianSoldPrice"
                        value={manualPricingForm.medianSoldPrice}
                        onChange={updateManualPricingField}
                        placeholder="$"
                      />
                      <ManualPricingInput
                        label="Low relevant sold"
                        name="lowRelevantSold"
                        value={manualPricingForm.lowRelevantSold}
                        onChange={updateManualPricingField}
                        placeholder="$"
                      />
                      <ManualPricingInput
                        label="High relevant sold"
                        name="highRelevantSold"
                        value={manualPricingForm.highRelevantSold}
                        onChange={updateManualPricingField}
                        placeholder="$"
                      />
                      <ManualPricingInput
                        label="Sold count"
                        name="soldCount"
                        value={manualPricingForm.soldCount}
                        onChange={updateManualPricingField}
                      />
                      <ManualPricingInput
                        label="Active listing count"
                        name="activeCount"
                        value={manualPricingForm.activeCount}
                        onChange={updateManualPricingField}
                      />
                      <ManualPricingInput
                        label="Sell-through %"
                        name="sellThroughPercent"
                        value={manualPricingForm.sellThroughPercent}
                        onChange={updateManualPricingField}
                        placeholder="%"
                      />

                      <div>
                        <FieldLabel htmlFor="manual-lookbackWindow">
                          Lookback window
                        </FieldLabel>
                        <select
                          id="manual-lookbackWindow"
                          value={manualPricingForm.lookbackWindow}
                          onChange={(event) =>
                            updateManualPricingField(
                              "lookbackWindow",
                              event.target.value as LookbackWindow
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                        >
                          <option value="90d">90d</option>
                          <option value="6mo">6mo</option>
                          <option value="1y">1y</option>
                          <option value="2y">2y</option>
                          <option value="3y">3y</option>
                          <option value="custom">custom</option>
                        </select>
                      </div>

                      <div>
                        <FieldLabel htmlFor="manual-shippingIncluded">
                          Shipping included
                        </FieldLabel>
                        <select
                          id="manual-shippingIncluded"
                          value={manualPricingForm.shippingIncluded}
                          onChange={(event) =>
                            updateManualPricingField(
                              "shippingIncluded",
                              event.target.value as ShippingIncluded
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                        >
                          <option value="unknown">unknown</option>
                          <option value="yes">yes</option>
                          <option value="no">no</option>
                        </select>
                      </div>

                      <div>
                        <FieldLabel htmlFor="manual-conditionMatch">
                          Condition match
                        </FieldLabel>
                        <select
                          id="manual-conditionMatch"
                          value={manualPricingForm.conditionMatch}
                          onChange={(event) =>
                            updateManualPricingField(
                              "conditionMatch",
                              event.target.value as ConditionMatch
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                        >
                          <option value="unknown">unknown</option>
                          <option value="lower">lower</option>
                          <option value="similar">similar</option>
                          <option value="better">better</option>
                        </select>
                      </div>

                      <div className="md:col-span-3">
                        <FieldLabel htmlFor="manual-compNotes">Notes</FieldLabel>
                        <textarea
                          id="manual-compNotes"
                          value={manualPricingForm.compNotes}
                          onChange={(event) =>
                            updateManualPricingField(
                              "compNotes",
                              event.target.value
                            )
                          }
                          placeholder="Manual comp source notes, outliers excluded, shipping context, or custom lookback details."
                          className="mt-2 min-h-[90px] w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-sm font-semibold text-gray-950">
                      {pricingRecommendation.pricingSource === "manual"
                        ? "Calculated Pricing Recommendation"
                        : pricingRecommendation.pricingSource === "public_web_comps"
                          ? "Public-Web Comp Pricing"
                          : "AI Fallback Pricing"}
                    </div>
                    <p className="mt-1 text-xs text-gray-600">
                      {pricingRecommendation.pricingSource === "manual"
                        ? "Manual comp data is being used where available."
                        : pricingRecommendation.pricingSource === "public_web_comps"
                          ? "No manual comp price data entered; selected Public Web Comp sources are being analyzed."
                          : "No manual comp price data or selected Public Web Comp source prices are available; this uses AI Starting Range midpoint fallback."}
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <PricingMetric
                        label="Suggested List Price"
                        value={formatUsd(pricingRecommendation.suggestedListPrice)}
                      />
                      <PricingMetric
                        label="Fast-Sale Price"
                        value={formatUsd(pricingRecommendation.fastSalePrice)}
                      />
                      <PricingMetric
                        label="Best Offer Floor"
                        value={formatUsd(pricingRecommendation.bestOfferFloor)}
                      />
                      <PricingMetric
                        label="Pricing Confidence"
                        value={pricingRecommendation.pricingConfidence}
                      />
                    </div>
                    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <FieldLabel htmlFor="final-list-price">
                            Final List Price
                          </FieldLabel>
                          <p className="mt-1 text-xs text-gray-600">
                            Auto-filled from Suggested List Price. You can edit this before sending to Vendoo.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={resetFinalListPriceInput}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-500"
                        >
                          Reset to Suggested List Price
                        </button>
                      </div>
                      <input
                        id="final-list-price"
                        type="text"
                        inputMode="decimal"
                        value={finalListPriceInput}
                        onChange={(event) =>
                          updateFinalListPriceInput(event.target.value)
                        }
                        placeholder={suggestedListPriceInputValue || "129.99"}
                        className="mt-3 w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                      />
                      {finalListPriceManuallyEdited ? (
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-800">
                            Manual override
                          </span>
                          {finalListPriceInput.trim() !== suggestedListPriceInputValue ? (
                            <span className="text-gray-600">
                              Using manually edited Final List Price.
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm text-gray-700">
                      {pricingRecommendation.pricingExplanation}
                    </p>
                  </div>
                </div>
              )}
            </SectionShell>

            <SectionShell title="Generate Final LP-U">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={isLoading || !sellingBrief.trim()}
                  className="rounded-lg bg-black px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading && activeMode === "finalFromBrief"
                    ? "Generating Final LP-U..."
                    : "Generate Final LP-U From Brief"}
                </button>
                <div className="text-sm text-gray-600">
                  Sends <span className="font-semibold">promptVersion: v2</span>,{" "}
                  <span className="font-semibold">interfaceVersion: v2</span>,
                  original notes, uploaded image references, and the edited Selling
                  Brief.
                </div>
              </div>

              {error ? (
                <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {imageUploadStatus ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  {imageUploadStatus}
                </div>
              ) : null}

              {metadata ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                  Response metadata: promptVersion{" "}
                  <span className="font-semibold">{metadata.promptVersion}</span>,
                  interfaceVersion{" "}
                  <span className="font-semibold">
                    {metadata.interfaceVersion ?? "not provided"}
                  </span>
                  , requestImageCount{" "}
                  <span className="font-semibold">
                    {metadata.requestImageCount ?? 0}
                  </span>
                </div>
              ) : null}
            </SectionShell>

            <SectionShell title="Platform Review">
              <textarea
                value={output}
                onChange={(event) => {
                  setOutput(event.target.value);
                  setVendooSendStatus("idle");
                  setVendooSendMessage("");
                }}
                placeholder="Generated LP-U output will appear here."
                className="min-h-[360px] w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-xs outline-none focus:border-black"
              />
            </SectionShell>

            {payloadPreview ? (
              <PayloadPreviewPanel
                copyStatus={payloadCopyStatus}
                onCopy={(label, value) => void copyPayloadPreview(label, value)}
                preview={payloadPreview}
              />
            ) : null}
          </div>

          <aside className="space-y-5">
            <SectionShell title="Listing Queue">
              <div className="space-y-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-gray-950">
                        Queue Status
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        {queueAuthLoading
                          ? "Checking queue access..."
                          : queueAuthenticated
                            ? "Unlocked for this browser session."
                            : "Locked."}
                      </div>
                    </div>
                    {queueAuthenticated ? (
                      <button
                        type="button"
                        onClick={() => void lockQueue()}
                        disabled={queueAuthLoading}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Lock Queue
                      </button>
                    ) : null}
                  </div>

                  {!queueAuthenticated ? (
                    <div className="mt-3 space-y-3">
                      <FieldLabel htmlFor="queue-owner-secret">
                        Owner Secret
                      </FieldLabel>
                      <input
                        id="queue-owner-secret"
                        type="password"
                        value={queueOwnerSecretInput}
                        onChange={(event) =>
                          setQueueOwnerSecretInput(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void unlockQueue();
                          }
                        }}
                        className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                      />
                      <button
                        type="button"
                        onClick={() => void unlockQueue()}
                        disabled={queueAuthLoading}
                        className="w-full rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {queueAuthLoading ? "Unlocking..." : "Unlock Queue"}
                      </button>
                    </div>
                  ) : null}

                  {queueAuthError ? (
                    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      {queueAuthError}
                    </div>
                  ) : null}
                </div>

                {queueAuthenticated ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <button
                        type="button"
                        onClick={() => void saveCurrentListingToQueue()}
                        disabled={!canSaveCurrentListingToQueue}
                        className="w-full rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {queueLoading ? "Working..." : "Save Current Listing to Queue"}
                      </button>
                      {selectedPhotosNeedUpload ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          Photos must be uploaded before saving to queue.
                        </div>
                      ) : null}
                      {!output.trim() || !payloadPreview ? (
                        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                          Generate Final LP-U and payload preview before saving.
                        </div>
                      ) : null}
                      {queueSaveStatus ? (
                        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                          {queueSaveStatus}
                        </div>
                      ) : null}
                      {queueSaveError ? (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                          {queueSaveError}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-gray-950">
                        Saved Listings
                      </div>
                      <button
                        type="button"
                        onClick={() => void loadQueueItems()}
                        disabled={queueLoading}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Refresh
                      </button>
                    </div>

                    {queueError ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {queueError}
                      </div>
                    ) : null}

                    {queueLoading && !queueItems.length ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                        Loading queue...
                      </div>
                    ) : null}

                    {!queueLoading && !queueItems.length ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                        No saved listings yet.
                      </div>
                    ) : null}

                    <div className="space-y-3">
                      {queueItems.map((item) => {
                        const thumbnailUrl =
                          item.photos.find((photo) => photo.imageUrl)?.imageUrl ?? "";
                        const timestamp = item.updatedAt || item.createdAt;

                        return (
                          <article
                            key={item.id}
                            className="rounded-lg border border-gray-200 bg-white p-3"
                          >
                            <div className="flex gap-3">
                              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                                {thumbnailUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={thumbnailUrl}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase text-gray-400">
                                    No image
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="break-words text-sm font-semibold text-gray-950">
                                  {item.title || "Untitled queued listing"}
                                </div>
                                <div className="mt-1 text-xs text-gray-600">
                                  {item.finalListPrice
                                    ? `$${item.finalListPrice}`
                                    : "No final price"}{" "}
                                  · {formatQueueStatus(item.status)}
                                </div>
                                {item.categorySummary ? (
                                  <div className="mt-1 break-words text-xs text-gray-500">
                                    {item.categorySummary}
                                  </div>
                                ) : null}
                                <div className="mt-1 text-xs text-gray-500">
                                  {formatQueueDate(timestamp)}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold">
                                  {item.sentToVendooAt ? (
                                    <span className="rounded-full bg-green-100 px-2 py-1 text-green-800">
                                      Sent
                                    </span>
                                  ) : null}
                                  {item.archivedAt || item.status === "archived" ? (
                                    <span className="rounded-full bg-gray-200 px-2 py-1 text-gray-700">
                                      Archived
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            {item.id && item.status !== "archived" ? (
                              <button
                                type="button"
                                onClick={() => void archiveQueueItem(item.id || "")}
                                disabled={queueLoading}
                                className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Archive
                              </button>
                            ) : null}
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </SectionShell>

            <SectionShell title="Vendoo Handoff">
              <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
                <div className="space-y-2 text-sm text-gray-700">
                  <p>
                    Sends the extension-compatible payload preview to the
                    installed Vendoo extension.
                  </p>
                  <p>Preview remains editable; sending does not regenerate the listing.</p>
                  <p>Make sure the extension is installed and active on this app origin.</p>
                </div>

                <button
                  type="button"
                  disabled={!payloadPreview}
                  onClick={handleSendPayloadToVendooExtension}
                  className="w-full rounded-lg bg-black px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send Payload to Vendoo Extension
                </button>

                {!payloadPreview ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                    Generate Final LP-U to create payload.
                  </div>
                ) : null}

                {vendooSendMessage ? (
                  <div
                    className={`rounded-lg border p-3 text-sm ${
                      vendooSendStatus === "sent"
                        ? "border-green-200 bg-green-50 text-green-900"
                        : "border-red-200 bg-red-50 text-red-900"
                    }`}
                  >
                    {vendooSendMessage}
                  </div>
                ) : null}
              </div>
            </SectionShell>
          </aside>
        </form>
      </div>
    </main>
  );
}
