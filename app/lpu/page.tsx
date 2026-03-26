"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

type ImagePayload = {
  name: string;
  type: string;
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
    sections: Partial<
      Record<"ebay" | "depop" | "poshmark" | "mercari" | "etsy", string>
    >;
    unknownBlocks: string[];
  };
  platformResults: Record<
    "ebay" | "depop" | "poshmark" | "mercari" | "etsy",
    PlatformValidationResult
  >;
  metrics: {
    expectedFooterType: string;
    platformsPassed: number;
    platformsFailed: number;
  };
};

type WorkflowStatus = "ready" | "generating" | "pass" | "needs-review";
type PlatformKey = "ebay" | "depop" | "poshmark" | "mercari" | "etsy";

const FIELD_LABELS = {
  ebay: {
    titleA: ["Title A"],
    titleB: ["Title B"],
    description: ["Description"],
  },
  depop: {
    listing: ["Listing"],
    hashtags: ["Hashtags"],
    optionalBrandHashtags: ["Optional Brand Hashtags"],
  },
  poshmark: {
    title: ["Title"],
    description: ["Description"],
  },
  mercari: {
    title: ["Title"],
    description: ["Description"],
    hashtags: ["Hashtags"],
  },
  etsy: {
    title: ["Title"],
    tags: ["Tags"],
    description: ["Description"],
  },
} as const;

const KNOWN_LABELS = Array.from(
  new Set(
    Object.values(FIELD_LABELS).flatMap((platformLabels) =>
      Object.values(platformLabels).flatMap((labels) => labels)
    )
  )
);

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

function normalizeLabelLine(line: string): string {
  return line.trim().replace(/:$/, "");
}

function lineMatchesAnyLabel(line: string, labels: readonly string[]): boolean {
  const trimmed = line.trim();
  const normalized = normalizeLabelLine(trimmed);

  return labels.some((label) => normalized === label || trimmed.startsWith(`${label}:`));
}

function isKnownLabelLine(line: string): boolean {
  return lineMatchesAnyLabel(line, KNOWN_LABELS);
}

function extractLabeledBlock(section: string, labels: readonly string[]): string {
  if (!section?.trim()) return "";

  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const startIndex = lines.findIndex((line) => lineMatchesAnyLabel(line, labels));

  if (startIndex === -1) return "";

  const startLine = lines[startIndex].trim();
  const colonIndex = startLine.indexOf(":");
  const firstValue = colonIndex >= 0 ? startLine.slice(colonIndex + 1).trim() : "";

  const collected: string[] = [];
  if (firstValue) {
    collected.push(firstValue);
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const currentLine = lines[i];

    if (isKnownLabelLine(currentLine)) {
      break;
    }

    collected.push(currentLine);
  }

  return collected.join("\n").trim();
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

    try {
      const images: ImagePayload[] = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      setOutput(data.output || "");
      setValidation(data.validation ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate output.";
      setError(message);
      setValidation(null);
      setCopiedTarget(null);
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

  const sectionCopies = useMemo(
    () => ({
      full: output,
      ebay: validation?.parsed.sections.ebay ?? "",
      depop: validation?.parsed.sections.depop ?? "",
      poshmark: validation?.parsed.sections.poshmark ?? "",
      mercari: validation?.parsed.sections.mercari ?? "",
      etsy: validation?.parsed.sections.etsy ?? "",
    }),
    [output, validation]
  );

  const fieldCopies = useMemo(
    () => ({
      "ebay-title-a": extractLabeledBlock(sectionCopies.ebay, FIELD_LABELS.ebay.titleA),
      "ebay-title-b": extractLabeledBlock(sectionCopies.ebay, FIELD_LABELS.ebay.titleB),
      "ebay-description": extractLabeledBlock(
        sectionCopies.ebay,
        FIELD_LABELS.ebay.description
      ),

      "depop-listing": extractLabeledBlock(sectionCopies.depop, FIELD_LABELS.depop.listing),
      "depop-hashtags": extractLabeledBlock(
        sectionCopies.depop,
        FIELD_LABELS.depop.hashtags
      ),
      "depop-brand-hashtags": extractLabeledBlock(
        sectionCopies.depop,
        FIELD_LABELS.depop.optionalBrandHashtags
      ),

      "poshmark-title": extractLabeledBlock(
        sectionCopies.poshmark,
        FIELD_LABELS.poshmark.title
      ),
      "poshmark-description": extractLabeledBlock(
        sectionCopies.poshmark,
        FIELD_LABELS.poshmark.description
      ),

      "mercari-title": extractLabeledBlock(sectionCopies.mercari, FIELD_LABELS.mercari.title),
      "mercari-description": extractLabeledBlock(
        sectionCopies.mercari,
        FIELD_LABELS.mercari.description
      ),
      "mercari-hashtags": extractLabeledBlock(
        sectionCopies.mercari,
        FIELD_LABELS.mercari.hashtags
      ),

      "etsy-title": extractLabeledBlock(sectionCopies.etsy, FIELD_LABELS.etsy.title),
      "etsy-tags": extractLabeledBlock(sectionCopies.etsy, FIELD_LABELS.etsy.tags),
      "etsy-description": extractLabeledBlock(
        sectionCopies.etsy,
        FIELD_LABELS.etsy.description
      ),
    }),
    [sectionCopies]
  );

  const copyMap = useMemo(
    () => ({
      ...sectionCopies,
      ...fieldCopies,
    }),
    [sectionCopies, fieldCopies]
  );

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
                disabled={!sectionCopies.full?.trim()}
                copied={copiedTarget === "full"}
              />
              <CopyButton
                label="Copy eBay"
                onClick={() => handleCopy("ebay")}
                disabled={!sectionCopies.ebay?.trim()}
                copied={copiedTarget === "ebay"}
              />
              <CopyButton
                label="Copy Depop"
                onClick={() => handleCopy("depop")}
                disabled={!sectionCopies.depop?.trim()}
                copied={copiedTarget === "depop"}
              />
              <CopyButton
                label="Copy Poshmark"
                onClick={() => handleCopy("poshmark")}
                disabled={!sectionCopies.poshmark?.trim()}
                copied={copiedTarget === "poshmark"}
              />
              <CopyButton
                label="Copy Mercari"
                onClick={() => handleCopy("mercari")}
                disabled={!sectionCopies.mercari?.trim()}
                copied={copiedTarget === "mercari"}
              />
              <CopyButton
                label="Copy Etsy"
                onClick={() => handleCopy("etsy")}
                disabled={!sectionCopies.etsy?.trim()}
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
                    disabled={!fieldCopies["ebay-title-a"]?.trim()}
                    copied={copiedTarget === "ebay-title-a"}
                  />
                  <CopyButton
                    label="Copy Title B"
                    onClick={() => handleCopy("ebay-title-b")}
                    disabled={!fieldCopies["ebay-title-b"]?.trim()}
                    copied={copiedTarget === "ebay-title-b"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("ebay-description")}
                    disabled={!fieldCopies["ebay-description"]?.trim()}
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
                    disabled={!fieldCopies["depop-listing"]?.trim()}
                    copied={copiedTarget === "depop-listing"}
                  />
                  <CopyButton
                    label="Copy Hashtags"
                    onClick={() => handleCopy("depop-hashtags")}
                    disabled={!fieldCopies["depop-hashtags"]?.trim()}
                    copied={copiedTarget === "depop-hashtags"}
                  />
                  <CopyButton
                    label="Copy Brand Hashtags"
                    onClick={() => handleCopy("depop-brand-hashtags")}
                    disabled={!fieldCopies["depop-brand-hashtags"]?.trim()}
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
                    disabled={!fieldCopies["poshmark-title"]?.trim()}
                    copied={copiedTarget === "poshmark-title"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("poshmark-description")}
                    disabled={!fieldCopies["poshmark-description"]?.trim()}
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
                    disabled={!fieldCopies["mercari-title"]?.trim()}
                    copied={copiedTarget === "mercari-title"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("mercari-description")}
                    disabled={!fieldCopies["mercari-description"]?.trim()}
                    copied={copiedTarget === "mercari-description"}
                  />
                  <CopyButton
                    label="Copy Hashtags"
                    onClick={() => handleCopy("mercari-hashtags")}
                    disabled={!fieldCopies["mercari-hashtags"]?.trim()}
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
                    disabled={!fieldCopies["etsy-title"]?.trim()}
                    copied={copiedTarget === "etsy-title"}
                  />
                  <CopyButton
                    label="Copy Tags"
                    onClick={() => handleCopy("etsy-tags")}
                    disabled={!fieldCopies["etsy-tags"]?.trim()}
                    copied={copiedTarget === "etsy-tags"}
                  />
                  <CopyButton
                    label="Copy Description"
                    onClick={() => handleCopy("etsy-description")}
                    disabled={!fieldCopies["etsy-description"]?.trim()}
                    copied={copiedTarget === "etsy-description"}
                  />
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