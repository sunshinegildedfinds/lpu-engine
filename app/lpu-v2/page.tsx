"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
  const [sellingBrief, setSellingBrief] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeMode, setActiveMode] = useState<GenerationMode | null>(null);
  const [metadata, setMetadata] = useState<GenerationMetadata | null>(null);
  const [imageUploadStatus, setImageUploadStatus] = useState("");

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

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files ?? []));
    setUploadedImageReferences([]);
  }

  async function getGeneratorImageReferences() {
    if (uploadedImageReferences.length) {
      return uploadedImageReferences;
    }

    if (files.length) {
      setImageUploadStatus("Uploading images to Supabase Storage...");
    }

    const generatorImageReferences = await uploadFilesToSupabaseStorage(files);
    setUploadedImageReferences(generatorImageReferences);

    return generatorImageReferences;
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
                readOnly
                placeholder="Generated LP-U output will appear here."
                className="min-h-[360px] w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-xs outline-none"
              />
            </SectionShell>
          </div>

          <aside className="space-y-5">
            <SectionShell title="Research / Comps">
              <p className="text-sm text-gray-600">
                Reserved for universal research notes, comp links, and evidence
                quality checks.
              </p>
            </SectionShell>

            <SectionShell title="Pricing">
              <div className="grid gap-3">
                <input
                  type="text"
                  placeholder="Target price"
                  className="rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                />
                <input
                  type="text"
                  placeholder="Floor price"
                  className="rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                />
                <textarea
                  placeholder="Pricing notes"
                  className="min-h-[90px] rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none focus:border-black"
                />
              </div>
            </SectionShell>

            <SectionShell title="Vendoo Handoff">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                V2 handoff is intentionally disconnected in this pass. The
                existing V1 extension payload flow remains unchanged.
              </div>
            </SectionShell>
          </aside>
        </form>
      </div>
    </main>
  );
}
