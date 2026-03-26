"use client";

import { ChangeEvent, FormEvent, useState } from "react";

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
    sections: Partial<Record<"ebay" | "depop" | "poshmark" | "mercari" | "etsy", string>>;
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

function StatusBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        pass
          ? "bg-green-100 text-green-800"
          : "bg-red-100 text-red-800"
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
      description: "Layer 1 is generating LP-U output and Layer 2 will validate it automatically.",
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

export default function LpuPage() {
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [output, setOutput] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    setFiles(selectedFiles);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setOutput("");
    setValidation(null);
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
    } finally {
      setIsLoading(false);
    }
  }

  const platformOrder: Array<"ebay" | "depop" | "poshmark" | "mercari" | "etsy"> = [
    "ebay",
    "depop",
    "poshmark",
    "mercari",
    "etsy",
  ];

  const workflow = getWorkflowStatus(isLoading, error, validation);

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
        <h2 className="mb-4 text-2xl font-semibold">Output</h2>

        {output ? (
          <div className="whitespace-pre-wrap text-sm leading-7">{output}</div>
        ) : (
          <p className="text-sm text-gray-500">
            Your generated LP-U output will appear here.
          </p>
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
                        <div className="mt-4 text-sm text-green-700">
                          No issues
                        </div>
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