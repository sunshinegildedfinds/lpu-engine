import { NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import { openai } from "@/lib/openai";
import { getLpuOpenAIGenerationModel } from "@/lib/lpu/openaiModels";
import { isStagingDeployment } from "@/lib/lpu/deploymentEnv";
import { QueueAuthError, requireQueueOwnerSession } from "@/lib/lpu/queueAuth";
import {
  getMasterPrompt,
  UNIVERSAL_SELLING_BRIEF_INSTRUCTIONS_V2,
} from "@/lib/lpu/masterPrompt";
import {
  DEPOP_AESTHETIC_MODE_LIST,
  DEPOP_AESTHETIC_MODE_NOT_APPLICABLE,
  POSHMARK_STYLE_TAG_MASTER_LIST,
  validateLpuOutput,
} from "@/lib/validator";
import {
  getProductionStorageBucket,
  getRequiredStagingStorageBucket,
  isStagingStoragePath,
} from "@/lib/lpu/stagingStoragePolicy";
import {
  StagingLegacyMacImageError,
  stagingLegacyMacImageUrls,
} from "@/lib/lpu/stagingLegacyMacImagePolicy";

// The production project currently has Vercel's 300-second function ceiling.
// Provider repairs below must therefore remain evidence-triggered rather than
// adding an unconditional second full-output generation call.
export const maxDuration = 300;

type IncomingImage = {
  name: string;
  type: string;
  imageUrl: string;
  storagePath?: string;
};

type GenerateBody = {
  notes: string;
  images: IncomingImage[];
  mode?: "sellingBrief" | "finalFromBrief";
  sellingBrief?: string;
  includeGeneratorInstructionsReport?: boolean;
  interfaceVersion?: string;
  promptVersion?: string;
  generationContinuation?: GenerationContinuation;
};

type GenerationContinuation = {
  schemaVersion: 1;
  requestFingerprint: string;
  responseIds: Record<string, string>;
  signature: string;
};

type BackgroundGenerationContext = {
  requestFingerprint: string;
  responseIds: Record<string, string>;
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
  promptVersion: "v1" | "v2";
  interfaceVersion?: string;
};

type TitleValidationIssue = {
  code?: unknown;
  message?: unknown;
  severity?: unknown;
};

type TitleValidationShape = {
  issues?: TitleValidationIssue[];
  platformResults?: Record<string, { metrics?: Record<string, unknown> }>;
};

const LPU_V2_SANITIZER_DEBUG_PATTERNS = [
  "Approx. 1.75–2 in size",
  "Approx. 1.75–2 inches wide and tall",
  "Approx. size is about",
  "Size:",
  "Approximate Measurements:",
  "provided images",
  "not tested",
  "functionality not tested",
] as const;

type LpuV2SanitizerDebugStage =
  | "before_deterministic_sanitizer"
  | "after_deterministic_sanitizer"
  | "json_response_lpuOutput";

type LpuV2SanitizerDebugCapture = {
  routePath: "v2_finalFromBrief";
  generatedAt: string;
  stages: Record<
    LpuV2SanitizerDebugStage,
    {
      length: number;
      patternPresence: Record<(typeof LPU_V2_SANITIZER_DEBUG_PATTERNS)[number], boolean>;
      output: string;
    }
  >;
};

function isLpuV2SanitizerDebugEnabled(): boolean {
  return process.env.LPU_V2_SANITIZER_DEBUG === "1";
}

function captureLpuV2SanitizerDebugStage(output: string) {
  const patternPresence = Object.fromEntries(
    LPU_V2_SANITIZER_DEBUG_PATTERNS.map((pattern) => [
      pattern,
      output.includes(pattern),
    ])
  ) as Record<(typeof LPU_V2_SANITIZER_DEBUG_PATTERNS)[number], boolean>;

  return {
    length: output.length,
    patternPresence,
    output,
  };
}

async function writeLpuV2SanitizerDebugCapture(
  capture: LpuV2SanitizerDebugCapture
): Promise<void> {
  if (!isLpuV2SanitizerDebugEnabled()) {
    return;
  }

  try {
    const { writeFile } = await import("node:fs/promises");
    const fileTimestamp = capture.generatedAt.replace(/[:.]/g, "-");
    const filePath = `/tmp/lpu-v2-sanitizer-debug-${fileTimestamp}.json`;

    await writeFile(filePath, `${JSON.stringify(capture, null, 2)}\n`, "utf8");

    console.info("[LPU_V2_SANITIZER_DEBUG]", {
      filePath,
      routePath: capture.routePath,
      patterns: {
        before:
          capture.stages.before_deterministic_sanitizer.patternPresence,
        after: capture.stages.after_deterministic_sanitizer.patternPresence,
        response: capture.stages.json_response_lpuOutput.patternPresence,
      },
    });
  } catch (error) {
    console.error("[LPU_V2_SANITIZER_DEBUG] Failed to write capture:", error);
  }
}

function normalizePromptVersion(promptVersion: unknown): "v1" | "v2" {
  return promptVersion === "v2" ? "v2" : "v1";
}

function normalizeInterfaceVersion(interfaceVersion: unknown): string | undefined {
  if (typeof interfaceVersion !== "string") return undefined;

  const normalized = interfaceVersion.trim();
  return normalized || undefined;
}

function normalizeMode(mode: unknown): "sellingBrief" | "finalFromBrief" | undefined {
  return mode === "sellingBrief" || mode === "finalFromBrief" ? mode : undefined;
}

const BACKGROUND_GENERATION_SCHEMA_VERSION = 1 as const;
const BACKGROUND_GENERATION_PHASE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const BACKGROUND_RESPONSE_ID_PATTERN = /^resp_[A-Za-z0-9_-]{8,200}$/;
const BACKGROUND_TERMINAL_FAILURES = new Set([
  "failed",
  "cancelled",
  "incomplete",
]);

class BackgroundGenerationPending extends Error {
  constructor(readonly continuation: GenerationContinuation) {
    super("Background generation is still in progress.");
  }
}

class BackgroundGenerationContinuationError extends Error {}

function generationContinuationSecret(): string {
  const secret = process.env.QUEUE_OWNER_SECRET?.trim();
  if (!secret) {
    throw new Error("Background generation requires Queue owner custody configuration.");
  }
  return secret;
}

function backgroundGenerationRequestFingerprint({
  notes,
  images,
  sellingBrief,
  promptVersion,
  interfaceVersion,
}: {
  notes: string;
  images: IncomingImage[];
  sellingBrief: string;
  promptVersion: "v1" | "v2";
  interfaceVersion?: string;
}): string {
  const source = JSON.stringify({
    mode: "finalFromBrief",
    notes,
    images: images.map((image) => ({
      name: typeof image?.name === "string" ? image.name : "",
      type: typeof image?.type === "string" ? image.type : "",
      imageUrl: typeof image?.imageUrl === "string" ? image.imageUrl : "",
      storagePath:
        typeof image?.storagePath === "string" ? image.storagePath : "",
    })),
    sellingBrief,
    promptVersion,
    interfaceVersion: interfaceVersion ?? "",
    model: getLpuOpenAIGenerationModel(),
  });
  return createHash("sha256").update(source, "utf8").digest("hex");
}

function generationContinuationSignature({
  requestFingerprint,
  responseIds,
}: BackgroundGenerationContext): string {
  const entries = Object.entries(responseIds).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return createHmac("sha256", generationContinuationSecret())
    .update(JSON.stringify({ requestFingerprint, responseIds: entries }), "utf8")
    .digest("hex");
}

function signedGenerationContinuation(
  context: BackgroundGenerationContext
): GenerationContinuation {
  return {
    schemaVersion: BACKGROUND_GENERATION_SCHEMA_VERSION,
    requestFingerprint: context.requestFingerprint,
    responseIds: { ...context.responseIds },
    signature: generationContinuationSignature(context),
  };
}

function backgroundGenerationContext({
  continuation,
  requestFingerprint,
}: {
  continuation: GenerateBody["generationContinuation"];
  requestFingerprint: string;
}): BackgroundGenerationContext {
  if (continuation === undefined) {
    return { requestFingerprint, responseIds: {} };
  }
  if (
    !continuation ||
    continuation.schemaVersion !== BACKGROUND_GENERATION_SCHEMA_VERSION ||
    continuation.requestFingerprint !== requestFingerprint ||
    !continuation.responseIds ||
    typeof continuation.responseIds !== "object" ||
    Array.isArray(continuation.responseIds) ||
    typeof continuation.signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(continuation.signature)
  ) {
    throw new BackgroundGenerationContinuationError(
      "Background generation continuation is invalid."
    );
  }
  const responseIds = Object.fromEntries(
    Object.entries(continuation.responseIds)
      .filter(
        ([phase, responseId]) =>
          BACKGROUND_GENERATION_PHASE_PATTERN.test(phase) &&
          typeof responseId === "string" &&
          BACKGROUND_RESPONSE_ID_PATTERN.test(responseId)
      )
      .sort(([left], [right]) => left.localeCompare(right))
  );
  if (
    Object.keys(responseIds).length !== Object.keys(continuation.responseIds).length ||
    Object.keys(responseIds).length > 12
  ) {
    throw new BackgroundGenerationContinuationError(
      "Background generation continuation contains invalid response identities."
    );
  }
  const context = { requestFingerprint, responseIds };
  const expected = Buffer.from(generationContinuationSignature(context), "hex");
  const supplied = Buffer.from(continuation.signature, "hex");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new BackgroundGenerationContinuationError(
      "Background generation continuation signature is invalid."
    );
  }
  return context;
}

async function createGenerationResponse(
  phase: string,
  params: ResponseCreateParamsNonStreaming,
  context?: BackgroundGenerationContext
): Promise<OpenAIResponse> {
  if (!context) {
    return openai.responses.create(params);
  }
  if (!BACKGROUND_GENERATION_PHASE_PATTERN.test(phase)) {
    throw new Error("Background generation phase identity is invalid.");
  }
  const existingResponseId = context.responseIds[phase];
  const response = existingResponseId
    ? await openai.responses.retrieve(existingResponseId)
    : await openai.responses.create({ ...params, background: true, store: true });
  if (!existingResponseId) {
    if (!BACKGROUND_RESPONSE_ID_PATTERN.test(response.id)) {
      throw new Error("OpenAI did not return a durable response identity.");
    }
    context.responseIds[phase] = response.id;
  }
  if (response.status === "completed") {
    return response;
  }
  if (response.status && BACKGROUND_TERMINAL_FAILURES.has(response.status)) {
    throw new Error(`OpenAI background generation ${phase} ended as ${response.status}.`);
  }
  throw new BackgroundGenerationPending(signedGenerationContinuation(context));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolveGeneratorImageUrl(
  image: IncomingImage,
  legacyMacImageUrl?: string
): Promise<string> {
  if (legacyMacImageUrl) return legacyMacImageUrl;
  const directUrl =
    typeof image?.imageUrl === "string" ? image.imageUrl.trim() : "";
  const storagePath =
    typeof image?.storagePath === "string" ? image.storagePath.trim() : "";

  const staging = isStagingDeployment();
  if (staging && !isStagingStoragePath(storagePath)) return "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName = staging
    ? getRequiredStagingStorageBucket(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim())
    : getProductionStorageBucket(process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim());

  if (!storagePath || !supabaseUrl || !serviceRoleKey) {
    return staging ? "" : directUrl;
  }

  const encodedPath = storagePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const signEndpoint = `${supabaseUrl}/storage/v1/object/sign/${bucketName}/${encodedPath}`;
  const signResponse = await fetch(signEndpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 * 60 }),
    cache: "no-store",
  });

  if (!signResponse.ok) {
    return staging ? "" : directUrl;
  }

  const signData = (await signResponse.json()) as { signedURL?: string };
  const signedPath = typeof signData?.signedURL === "string" ? signData.signedURL : "";
  if (!signedPath) return staging ? "" : directUrl;

  return `${supabaseUrl}/storage/v1${signedPath}`;
}

function buildGeneratorInstructionsReport({
  interfaceVersion,
  promptVersion,
}: {
  interfaceVersion?: string;
  promptVersion: "v1" | "v2";
}): GeneratorInstructionsReport {
  const instructions = getMasterPrompt(promptVersion);
  return {
    instructions,
    characterLength: instructions.length,
    checks: {
      ebayTitleAOrder: instructions.includes(
        "[Brand/Maker] + [Item Name] + [Key Descriptor/Material] + [Color] + [Size] + [Gender/Dept]"
      ),
      ebayThemeRequirement:
        instructions.includes('Theme requirement:') &&
        instructions.includes('eBay Item Specifics must always include a "Theme:" line.'),
      depopAttributesRequirement: instructions.includes("Include official Depop Attributes section."),
      etsyExactly13TagsRequirement: instructions.includes("Output exactly 13 Etsy tags"),
      poshmarkStyleTagsMasterListRequirement:
        instructions.includes("BOTH Poshmark tag groups must use the saved Poshmark Style Tag master list verbatim:") &&
        instructions.includes("1. Style Tags"),
      compact3TagMasterListRequirement:
        instructions.includes("2. Compact 3-Tag Strategy (Alt Option)") &&
        instructions.includes("use only tags from the saved master list"),
    },
    generatedAt: new Date().toISOString(),
    promptVersion,
    ...(interfaceVersion ? { interfaceVersion } : {}),
  };
}

function hasOnlyTitleLengthIssues(validation: TitleValidationShape): boolean {
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return false;
  }

  const allowedCodes = new Set([
    "EBAY_TITLE_A_LENGTH",
    "EBAY_TITLE_B_LENGTH",
    "POSHMARK_TITLE_LENGTH",
    "MERCARI_TITLE_LENGTH",
  ]);

  return validation.issues.every(
    (issue) =>
      issue?.severity === "error" &&
      typeof issue?.code === "string" &&
      allowedCodes.has(issue.code)
  );
}

function hasRemainingValidationIssues(validation: TitleValidationShape): boolean {
  return Array.isArray(validation?.issues) && validation.issues.length > 0;
}

function hasPoshmarkOutputOrderIssues(validation: TitleValidationShape): boolean {
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return false;
  }

  const formatOrderCodes = new Set([
    "POSHMARK_FIELD_ORDER",
    "POSHMARK_FOOTER_ORDER",
  ]);

  return validation.issues.some(
    (issue) =>
      issue?.severity === "error" &&
      typeof issue?.code === "string" &&
      formatOrderCodes.has(issue.code)
  );
}

function hasMercariOutputFormatIssues(validation: TitleValidationShape): boolean {
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return false;
  }

  const formatCodes = new Set([
    "MERCARI_FIELD_ORDER",
    "MERCARI_DUPLICATE_LABEL",
    "MERCARI_FOOTER_ORDER",
    "MERCARI_DUPLICATE_FOOTER",
  ]);

  return validation.issues.some(
    (issue) =>
      issue?.severity === "error" &&
      typeof issue?.code === "string" &&
      formatCodes.has(issue.code)
  );
}

function hasPoshmarkInvalidStyleTagIssues(validation: TitleValidationShape): boolean {
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return false;
  }

  return validation.issues.some(
    (issue) =>
      issue?.severity === "error" &&
      issue?.code === "POSHMARK_INVALID_STYLE_TAG"
  );
}

function hasDepopInvalidAestheticModeIssues(validation: TitleValidationShape): boolean {
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return false;
  }

  return validation.issues.some(
    (issue) =>
      issue?.severity === "error" &&
      issue?.code === "DEPOP_INVALID_AESTHETIC_MODE"
  );
}

function hasEstimatedMeasurementUnsupportedIssues(validation: TitleValidationShape): boolean {
  if (!validation || !Array.isArray(validation.issues) || validation.issues.length === 0) {
    return false;
  }

  return validation.issues.some(
    (issue) =>
      issue?.severity === "error" &&
      (issue?.code === "ESTIMATED_MEASUREMENT_UNSUPPORTED" ||
        issue?.code === "MEASUREMENT_SHOULD_BE_IN_BLOCK")
  );
}

function buildTitleRevisionInstruction(
  output: string,
  validation: TitleValidationShape
): string {
  const issueLines = (validation?.issues ?? []).map(
    (issue) => `- ${String(issue.code)}: ${String(issue.message)}`
  );

  const platformResults = validation?.platformResults ?? {};

  const ebayTitleA = platformResults?.ebay?.metrics?.titleA ?? "";
  const ebayTitleALength = platformResults?.ebay?.metrics?.titleALength ?? null;

  const ebayTitleB = platformResults?.ebay?.metrics?.titleB ?? "";
  const ebayTitleBLength = platformResults?.ebay?.metrics?.titleBLength ?? null;

  const poshmarkTitle = platformResults?.poshmark?.metrics?.title ?? "";
  const poshmarkTitleLength = platformResults?.poshmark?.metrics?.titleLength ?? null;

  const mercariTitle = platformResults?.mercari?.metrics?.title ?? "";
  const mercariTitleLength = platformResults?.mercari?.metrics?.titleLength ?? null;

  return `Revise the LP-U output below.

IMPORTANT:
- Preserve the existing LP-U framework, structure, platform order, labels, and overall wording style.
- Revise ONLY the title lines that currently fail validation.
- Keep all non-title content unchanged.
- Do not remove accurate existing keywords.
- Add only accurate searchable wording supported by the current item details.
- Do not add filler or unsupported claims.
- Every required title in EBAY, POSHMARK, and MERCARI must be between 70 and 80 characters inclusive.
- Before returning output, recount each revised title including spaces.
- Return the full corrected LP-U output only.
- Do not add commentary.

Current failing titles and lengths:
- EBAY Title A (${ebayTitleALength} chars): ${ebayTitleA}
- EBAY Title B (${ebayTitleBLength} chars): ${ebayTitleB}
- POSHMARK Title (${poshmarkTitleLength} chars): ${poshmarkTitle}
- MERCARI Title (${mercariTitleLength} chars): ${mercariTitle}

Validation failures:
${issueLines.join("\n")}

Current LP-U output:
${output}`;
}

function buildEstimatedMeasurementUnsupportedRevisionInstruction(
  output: string,
  validation: TitleValidationShape
): string {
  const issueLines = (validation?.issues ?? [])
    .filter((issue) =>
      issue?.code === "ESTIMATED_MEASUREMENT_UNSUPPORTED" ||
      issue?.code === "MEASUREMENT_SHOULD_BE_IN_BLOCK"
    )
    .map((issue) => `- ${String(issue.code)}: ${String(issue.message)}`);

  return `Revise the LP-U output below.

IMPORTANT:
- Fix ONLY estimated physical measurement language listed in the validation failures.
- Preserve every platform section unchanged except the offending estimated measurement wording.
- If the offending numeric measurement says it is based on a ruler photo, measurement-board photo, measurement-reference photo, typed measurement graphic, or visual comparison to a visible measurement reference, move that existing measurement into that platform's Approximate Measurements block.
- When moving a supported approximate measurement into the block, replace "Not provided (see photos)" with the existing measurement line and preserve source wording such as "based on ruler photo" or "from ruler photo".
- For jewelry and small components, mm and cm measurements are allowed when supported by ruler/photo/measurement-reference evidence.
- If the offending numeric measurement does not include ruler/photo/measurement-reference source language, remove the unsupported numeric estimate.
- Replace removed unsupported estimates with non-numeric descriptive wording supported by the existing item details, such as "graduated bead sizes" or "varied bead sizes".
- Do not invent a new measurement.
- Do not change product volume or packaging volume claims such as fl oz, oz, ml, or mL.
- Do not reclassify the item.
- Do not add new item attributes.
- Return the full corrected LP-U output only.
- Do not add commentary.

Validation failures:
${issueLines.join("\n")}

Current LP-U output:
${output}`;
}

function buildDepopInvalidAestheticModeRevisionInstruction(
  output: string,
  validation: TitleValidationShape
): string {
  const issueLines = (validation?.issues ?? [])
    .filter((issue) => issue?.code === "DEPOP_INVALID_AESTHETIC_MODE")
    .map((issue) => `- ${String(issue.code)}: ${String(issue.message)}`);

  return `Revise the LP-U output below.

IMPORTANT:
- Fix ONLY invalid Depop Aesthetic Mode Primary and Secondary values.
- Preserve every other platform section unchanged.
- Preserve all Depop listing text, attributes, hashtags, measurements, and footer unchanged except the invalid Aesthetic Mode replacements.
- Do not reclassify the item.
- Do not add new item attributes.
- Do not change image-derived facts.
- Use only exact values from this saved Depop Aesthetic Mode list, preserving spelling and capitalization.
- If the item is not aesthetic-led or not fashion/style related, use exactly "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}".
- Return the full corrected LP-U output only.
- Do not add commentary.

Allowed Depop Aesthetic Mode values:
${DEPOP_AESTHETIC_MODE_LIST.join("; ")}
${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}

Validation failures:
${issueLines.join("\n")}

Current LP-U output:
${output}`;
}

function buildPoshmarkInvalidStyleTagRevisionInstruction(
  output: string,
  validation: TitleValidationShape
): string {
  const issueLines = (validation?.issues ?? [])
    .filter((issue) => issue?.code === "POSHMARK_INVALID_STYLE_TAG")
    .map((issue) => `- ${String(issue.code)}: ${String(issue.message)}`);

  return `Revise the LP-U output below.

IMPORTANT:
- Fix ONLY invalid Poshmark tags in Style Tags and Compact 3-Tag Strategy (Alt Option).
- Preserve every other platform section unchanged.
- Preserve all Poshmark fields, order, titles, descriptions, measurements, and footer unchanged except the invalid tag replacements.
- Do not reclassify the item.
- Do not add new item attributes.
- Do not change image-derived facts.
- Use only exact tags from this Poshmark Style Tag master list.
- Return the full corrected LP-U output only.
- Do not add commentary.

Allowed Poshmark Style Tag master list:
${POSHMARK_STYLE_TAG_MASTER_LIST.join("; ")}

Validation failures:
${issueLines.join("\n")}

Current LP-U output:
${output}`;
}

function buildPoshmarkOrderRevisionInstruction(
  output: string,
  validation: TitleValidationShape
): string {
  const issueLines = (validation?.issues ?? [])
    .filter((issue) =>
      issue?.code === "POSHMARK_FIELD_ORDER" ||
      issue?.code === "POSHMARK_FOOTER_ORDER"
    )
    .map((issue) => `- ${String(issue.code)}: ${String(issue.message)}`);

  return `Revise the LP-U output below.

IMPORTANT:
- Fix ONLY the Poshmark output order.
- Preserve every other platform section unchanged.
- Preserve the existing Poshmark wording and values; only move existing blocks as needed.
- Do not reclassify the item.
- Do not add new item attributes.
- Do not change image-derived facts.
- Return the full corrected LP-U output only.
- Do not add commentary.

Required Poshmark order:
Title:
Description:
Style Tags:
Compact 3-Tag Strategy (Alt Option):
Approximate Measurements:
footer

The Poshmark footer must appear after the Approximate Measurements block.

Validation failures:
${issueLines.join("\n")}

Current LP-U output:
${output}`;
}

function buildMercariOutputFormatRevisionInstruction(
  output: string,
  validation: TitleValidationShape
): string {
  const issueLines = (validation?.issues ?? [])
    .filter((issue) =>
      issue?.code === "MERCARI_FIELD_ORDER" ||
      issue?.code === "MERCARI_DUPLICATE_LABEL" ||
      issue?.code === "MERCARI_FOOTER_ORDER" ||
      issue?.code === "MERCARI_DUPLICATE_FOOTER"
    )
    .map((issue) => `- ${String(issue.code)}: ${String(issue.message)}`);

  return `Revise the LP-U output below.

IMPORTANT:
- Fix ONLY the Mercari output format issues listed in the validation failures.
- Preserve every other platform section unchanged.
- Preserve the existing Mercari wording and values; only move existing blocks as needed.
- Remove duplicate Mercari Approximate Measurements blocks and duplicate Mercari footer lines.
- Do not reclassify the item.
- Do not add new item attributes.
- Do not change image-derived facts.
- Return the full corrected LP-U output only.
- Do not add commentary.

Required Mercari order:
Title:
Description:
Hashtags:
Approximate Measurements:
footer

The Mercari footer must appear once, after the Approximate Measurements block.

Validation failures:
${issueLines.join("\n")}

Current LP-U output:
${output}`;
}

function buildSellingBriefCandidateBankRepairInstruction(
  sellingBrief: string
): string {
  return `Repair the Universal Selling Brief below.

This is a V2-only Selling Brief repair pass.
Operate only on the generated Universal Selling Brief.
Do not create final LP-U output.
Do not use external research, brand history, category-specific assumptions, test-item examples, or any source outside this brief.

Primary repair target:
- Review each STYLE / THEME / AESTHETIC CANDIDATE BANK row using only:
  Candidate Term, Evidence Source, Visual Evidence, Confidence Level, Safe Wording, Use In, Claim Limit, and the rest of this brief's evidence anchors, claim limits, and platform angles.
- If a candidate row has Evidence Source Photo-derived, Seller-provided, Label/marking-derived, Packaging-derived, or Measurement-photo-derived; concrete visible or seller-provided support in Visual Evidence or the brief's evidence anchors; and was marked Weak/Do not use, Safe Wording N/A, or Use In Do Not Use only because it lacked official proof, exact historical proof, documented origin, official style name, designer intent, provenance, rarity, material proof, or production-period proof, repair it as usable.
- Also repair directly related universal evidence issues in Item Identity, Evidence Anchors, Claim Limits, Condition Basis, Measurement Basis, Buyer Search Keywords, Generic Phrases to Avoid, Platform Angle Map, and Quality Risks Before Final Listing when they affect source attribution, readable measurement-reference photos, Unbranded fallback, or buyer-facing cleanup direction.

Universal rule:
- If the uploaded item photos or generated brief evidence clearly support a style/theme/aesthetic candidate as a buyer-search visual descriptor, mark Confidence Level: Confirmed.
- Claim Limit prevents overclaiming. Claim Limit is not a usage blocker.
- A candidate can be Confirmed and still have strong Claim Limit restrictions.
- Content entered in Known Details / user notes is seller-provided evidence.
- If Known Details contains a direct factual descriptor such as Vintage, Handmade, Deadstock, New, NOS, Signed, Tested, Untested, Complete, Sealed, or a similar seller-known item fact, treat it as seller-confirmed unless it conflicts with photos or the brief's evidence.
- If Known Details says Vintage, then Vintage = Yes. Do not weaken it into vintage style, vintage-inspired, appears vintage, or possibly vintage. Do not claim exact decade, antique status, production period, historical era, provenance, or rarity unless separately supported.
- If Known Details contains a style/theme/aesthetic term and the brief evidence does not contradict it, treat it as a seller-preferred candidate.
- Seller-confirmed means the fact came from Known Details, Condition / Flaw notes, item notes, seller-entered fields, user-provided text, or another seller-written input.
- Photo-derived means the fact was inferred from item photos.
- Label/marking-derived, packaging-derived, and measurement-photo-derived facts must not be relabeled as seller-confirmed unless the seller also wrote the same fact.
- If photos appear to show complete or intact condition, write internally: Photo-derived: appears present / appears intact / no obvious missing components in provided images. Do not write Seller-confirmed: all parts present unless the seller actually wrote that.
- If no brand, maker, designer, publisher, manufacturer, label, studio, model family, or official mark is visible or seller-provided, use Unbranded as the brand fallback. Do not use Not specified, Unknown, See photos, or Not specified (see photos) as brand fallback.
- If Measurement Basis says no measurements were provided but the brief references a readable ruler, measuring tape, measurement board, grid, scale reference, typed measurement graphic, measurement-reference photo, or photo-derived dimensions, repair Measurement Basis to state that a measurement-reference photo was provided and approximate measurements were derived from the photo.
- Do not leave Measurement Basis as No measurements provided when readable measurement-reference evidence exists in the brief.
- Do not only write "see ruler photo for scale reference."
- Seller-preferred Confirmed or Seller-provided style/theme/aesthetic candidates outrank purely model-selected candidates for high-visibility placement.
- Seller preference can come from Known Details, seller notes, an edited Selling Brief, a manually edited Primary Style / Theme / Aesthetic Candidate field, or a candidate emphasized by the user in the Selling Brief before final LP-U generation.
- If seller preference exists and that candidate is Confirmed or Seller-provided, not misleading, and useful for buyer search, it must become the Primary Style / Theme / Aesthetic Candidate.
- Do not demote a seller-preferred Confirmed or Seller-provided candidate because another candidate is shorter, broader, safer-sounding, easier to fit, or because Claim Limit blocks harder claims.
- If the seller edited the Selling Brief to mark a candidate as primary, preserve that primary choice unless the term is misleading, unsupported, not useful for the platform, or violates platform length limits.

Repaired candidate row requirements:
- Evidence Source: preserve the correct original source, such as Photo-derived.
- Confidence Level: Confirmed.
- Safe Wording: default to the exact Candidate Term for Confirmed style/theme/aesthetic candidates.
- Do not automatically append generic caution suffixes such as style, look, inspired, aesthetic, visual style, design, detailing, motif, or influence to Safe Wording.
- Add a suffix only when the seller used it, readable label/marking/packaging/product text used it, the Candidate Term itself already includes it as part of the supported phrase, or the exact Candidate Term would be materially misleading.
- If Candidate Term or Safe Wording gained a generic caution suffix only to avoid overclaiming, clean it back to the strongest supported buyer-search phrase for Confirmed style/theme/aesthetic candidates.
- Do not apply suffix cleanup to material, finish, construction, condition, or physical-description terms.
- Preserve material-safe and appearance-safe wording when material identity is not confirmed.
- Use In: include appropriate high-visibility platform locations from the existing Selling Brief location vocabulary when useful and not misleading, including eBay Title B, Poshmark Title, Etsy Title, Depop Listing opening, eBay Theme, eBay Item Specifics, eBay Description, Etsy Tags, or Etsy Description.
- Claim Limit must use exactly this two-part boundary:
  Allowed Safe Use: May use as a visual style/theme/aesthetic search descriptor.
  Blocked Overclaims: Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.
- Claim Limit is not a reason to add style, look, inspired, aesthetic, visual style, design, detailing, motif, influence, or similar caution suffixes.

Generic subjective candidate repair:
- Do not confirm generic subjective marketing adjectives or broad praise words as Candidate Terms when they do not name a concrete buyer-search descriptor.
- If a candidate relies mainly on subjective appeal instead of visible evidence, reject it or rewrite the Candidate Term into concrete visual language supported by the brief, such as scale, construction, form, dimensions, color contrast, visible structural presence, motif, pattern, texture, finish, or functional design.
- Candidate Terms should be specific buyer-search descriptors, motifs, forms, style/theme/aesthetic terms, construction descriptors, or visual search terms.
- Do not allow a generic subjective candidate into Use In fields unless it has been rewritten into concrete evidence-based language.

Candidate priority for high-visibility fields:
Use this universal ranking when choosing which candidate should guide eBay Title B, Poshmark Title, Etsy Title, and Depop Listing opening:
1. Seller-preferred Confirmed or Seller-provided style/theme/aesthetic candidate from Known Details or an edited Selling Brief
2. Confirmed named style/theme/aesthetic candidate that is most specific and useful for buyer search
3. Confirmed label/marking/packaging-derived style/theme/aesthetic term
4. Confirmed photo-derived named style/theme/aesthetic term
5. Confirmed motif/design-family term
6. Confirmed construction/form descriptor
7. Confirmed color/material/finish descriptor
8. Generic visual adjective

- If a stronger Confirmed named style/theme/aesthetic candidate exists and is useful for buyer search, it must outrank generic descriptors such as ornate, decorative, scrollwork, textured, colorful, bold, structured, or similar broad visual adjectives.
- Do not let generic descriptors outrank a stronger Confirmed named style/theme/aesthetic candidate for eBay Title B, Poshmark Title, Etsy Title, or Depop Listing opening.
- Generic descriptors may support high-visibility copy only after the strongest Confirmed named candidate has been considered and placed where useful, not misleading, and within platform limits.
- Tie-breakers: prefer the candidate that is more specific, better matches buyer search language, creates a more distinct Title B / Etsy title / Poshmark title / Depop opening, and is supported by multiple evidence anchors.
- Do not prefer a shorter candidate solely because it is shorter when a more specific candidate also fits.
- Do not prefer generic descriptors over a Confirmed named style/theme/aesthetic candidate.
- Do not demote a candidate only because Claim Limit blocks harder claims.
- Do not demote a candidate because it is photo-derived if it is Confirmed.

Primary Style / Theme / Aesthetic Candidate repair:
- Add or update this required field group after the candidate rows when any Confirmed or Seller-provided style/theme/aesthetic candidate exists:
  Primary Style / Theme / Aesthetic Candidate:
  - Candidate Term:
  - Reason Selected:
  - Evidence Anchors:
  - Seller Preference:
  - Use In:
  - Claim Limit:
- Select the strongest candidate for high-visibility buyer-search placement using the universal priority rule.
- If seller preference exists and the seller-preferred candidate is Confirmed or Seller-provided, not misleading, and useful for buyer search, seller preference overrides model preference and must control the Primary Style / Theme / Aesthetic Candidate.
- If seller preference controls the choice, Reason Selected must state that seller preference controlled the choice.
- Seller Preference must state the source of preference when available, such as Known Details, seller notes, edited Selling Brief, manually edited primary candidate field, or emphasized brief wording.
- If a broader candidate is chosen over a more specific one, explain why.
- The primary candidate must not be chosen only because it is shorter.
- Use In should route the primary candidate to eBay Title B, Poshmark Title, Etsy Title, Depop Listing opening, eBay Theme / Item Specifics, Etsy Tags, and Etsy Description when each use is useful, fits, and is not misleading.
- If the primary candidate cannot be used in one of those high-visibility places, state the reason: too long, misleading, less useful for that platform, non-style-led item, or platform format conflict.
- Do not silently substitute a broader candidate for the primary candidate.

Do not reject a candidate only because:
- it is inferred from photos
- it is not printed on a label
- it is not stated in seller notes
- it lacks dated documentation
- it lacks official proof
- it lacks exact historical authentication
- it lacks exact production year
- it lacks documented production period
- it lacks an official style name
- it lacks designer-intent proof
- it lacks provenance
- it lacks material confirmation
- it lacks production-period proof

Reject only when one of these is true:
- no visible item details support it
- no seller note supports it
- no readable label, mark, packaging, tag, or product text supports it
- the term conflicts with visible evidence
- the term would mislead buyers even with safe wording
- the term is too broad to help buyer search or merchandising
- the candidate is based only on brand assumptions, marketplace assumptions, external research, or unsupported history

If rejecting a candidate:
- keep Evidence Source as Rejected.
- keep Confidence Level as Weak/Do not use.
- keep Use In as Do Not Use.
- explain the exact missing or conflicting evidence.
- do not cite lack of official proof as the only reason if visual evidence supports safe wording.
- do not cite lack of exact production year or documented production period as the rejection reason when visual, seller, label/marking, packaging, or measurement-photo evidence supports the candidate as a safe buyer-search descriptor.
- do not use lack of exact dating, exact era, specific decade, documented period, or seller-confirmed vintage as the rejection reason for a broad buyer-search descriptor.

Directly related guidance repairs:
- Revise only directly related eBay Title B guidance and Platform Angle Map references if a repaired candidate should be considered there.
- If a primary candidate is selected and Safe Wording is short enough, eBay Title B guidance must use the Primary Style / Theme / Aesthetic Candidate when it fits under 80 characters, improves buyer search, and does not mislead.
- Do not choose a broader or shorter candidate for Title B only because it is shorter.
- If Title B cannot fit the primary candidate, use the next strongest Confirmed candidate and route the primary candidate to Theme/Item Specifics or Description.
- Title B must not fall back to only motif, construction, color, material appearance, or form-factor wording when a stronger Confirmed style/theme/aesthetic candidate exists and fits.
- Title B must not be only Title A reordered.
- If Safe Wording is too long for Title B, direct it to eBay Theme/Item Specifics, eBay Description, Etsy Tags, or Etsy Description instead.
- Do not use the candidate in Title B if safe wording would be misleading.
- eBay may use Confirmed candidates in Title B, Theme/Item Specifics, or Description when useful.
- Depop may use Confirmed candidates as short visual/vibe language in the listing opening when supported, style-led, useful for search, and not forced.
- Poshmark may use Confirmed candidates in title or description, but Style Tags must still come only from the saved master list.
- Mercari should use Confirmed candidates only if they help fast identification.
- Etsy may use Confirmed candidates in title, long-tail tags, and curated description language when useful.
- Update Platform Angle Map references so the strongest Confirmed style/theme/aesthetic candidate is available for eBay Title B, Poshmark Title, Etsy Title, and Depop Listing opening when useful and not misleading.
- Update Platform Angle Map references so the Primary Style / Theme / Aesthetic Candidate is available for eBay Title B, Poshmark Title, Etsy Title, and Depop Listing opening when useful and not misleading.
- Ensure Platform Angle Map does not route only generic visual descriptors to those four fields when the strongest Confirmed named style/theme/aesthetic candidate fits, improves search, and is not misleading.
- For functional, technical, replacement, utility, media, appliance, tool, book, supply, or parts-type items, do not force style/theme/aesthetic terms into titles or openings. Use the candidate only when it genuinely improves buyer search; otherwise prioritize supported identifier, model, function, compatibility, form factor, or use-case language.

Preservation rules:
- Revise only STYLE / THEME / AESTHETIC CANDIDATE BANK rows that need repair.
- Revise only directly related eBay Title B guidance and Platform Angle Map references.
- Preserve all unrelated Selling Brief sections, structure, section order, and item-specific detail.
- Do not make the Selling Brief more generic.
- Do not add unsupported hard claims.
- Return the full repaired Universal Selling Brief only.
- Do not add commentary before or after the brief.

Universal Selling Brief to repair:
${sellingBrief}`;
}

async function generateSellingBrief({
  imageUrls,
  notes,
}: {
  imageUrls: string[];
  notes: string;
}) {
  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
  > = [
    {
      type: "input_text",
      text: `Generate a Universal Selling Brief for this item.

User notes:
${notes}`,
    },
    ...imageUrls.map((imageUrl) => ({
      type: "input_image" as const,
      image_url: imageUrl,
      detail: "auto" as const,
    })),
  ];

  const response = await openai.responses.create({
    model: getLpuOpenAIGenerationModel(),
    instructions: UNIVERSAL_SELLING_BRIEF_INSTRUCTIONS_V2,
    input: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  return response.output_text ?? "";
}

async function repairSellingBriefCandidateBank(
  sellingBrief: string,
  sellerInput: string
): Promise<string> {
  if (!sellingBrief.trim()) {
    return sellingBrief;
  }

  const response = await openai.responses.create({
    model: getLpuOpenAIGenerationModel(),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildSellingBriefCandidateBankRepairInstruction(sellingBrief),
          },
        ],
      },
    ],
  });

  const repairedBrief = response.output_text ?? "";

  return sanitizeSellingBriefAfterRepair({
    sellingBrief: repairedBrief.trim() ? repairedBrief : sellingBrief,
    sellerInput,
  });
}

const SELLING_BRIEF_BLOCKED_OVERCLAIM_BOUNDARY =
  "Blocked Overclaims: Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.";

const SELLING_BRIEF_CLAIM_LIMIT_BOUNDARY =
  "Do not claim exact production year, documented production period, rarity, material composition, authenticity, or official design line unless supported.";

const OLD_SELLING_BRIEF_ERA_LANGUAGE_PATTERN =
  /\b(?:No confirmed era|do not assign (?:an? )?(?:exact )?decade|do not assign (?:an? )?named historical period|do not assign (?:an? )?(?:exact )?decade or named historical period|none directly confirming era beyond seller Vintage|insufficient evidence to support specific era classification(?: beyond Vintage)?|insufficient evidence to assign era-specific style|insufficient evidence to assign specific era|beyond seller-confirmed vintage|beyond seller vintage|beyond vintage|exact production decade|exact production year|exact decade|exact era|no exact production decade|no specific decade|no exact historical period|no exact era)\b/i;

const SELLING_BRIEF_CLAIM_LIMIT_NORMALIZATION_SCOPE_PATTERN =
  /\b(?:Claim Limits?|Candidate Bank|Primary Style \/ Theme \/ Aesthetic Candidate|Primary Candidate|Platform Angle Map|Quality Risks Before Final Listing|Quality Risks)\b/i;

const SELLER_PROVIDED_FUNCTIONALITY_CAVEAT_PATTERN =
  /\b(?:broken|untested|not tested|non-working|not working|incomplete|missing|loose|damaged|does not power on|parts only|for repair|function issue|functional issue|functionality issue|not functional|working status unknown|function unknown|operation unknown)\b/i;

const SELLING_BRIEF_FUNCTIONALITY_CAVEAT_PATTERN =
  /\b(?:functional status not tested|functionality not tested|function not tested|not tested|untested|clasp not tested|closure not tested|pin mechanism not tested|zipper not tested|button function not tested|power not tested|not formally tested|working status unknown|function unknown|operation unknown)\b/gi;

const GENERIC_SUBJECTIVE_CANDIDATE_EXACT_PATTERN =
  /^\s*(?:statement|beautiful|eye-catching|unique|timeless|classic|stylish|versatile|must-have|high quality|rare|perfect|great)\s*$/i;

const FAKE_CANDIDATE_TERM_PATTERN =
  /^\s*(?:rejected unsupported marketing wording|generic subjective wording|unsupported marketing phrase|do not use|n\/a|not applicable|unsupported term|rejected phrase)\s*$/i;

const GENERIC_SUBJECTIVE_KEYWORD_PATTERN =
  /^(?:statement|beautiful|eye-catching|unique|timeless|classic|stylish|versatile|must-have|high quality|rare|perfect|great|rare find)$/i;

const GENERIC_SUBJECTIVE_KEYWORD_WITH_TARGET_PATTERN =
  /^(?:statement|beautiful|eye-catching|unique|timeless|classic|stylish|versatile|must-have|high quality)\s+.+$/i;

const GENERIC_SUBJECTIVE_PERFECT_GREAT_PATTERN =
  /^(?:perfect|great)\s+.+$/i;

const GENERIC_SUBJECTIVE_KEYWORD_PHRASE_PATTERN =
  /\b(?:rare\s+find|high\s+quality|eye-catching|must-have)\b/gi;

const GENERIC_SUBJECTIVE_KEYWORD_WORD_PATTERN =
  /\b(?:statement|beautiful|unique|timeless|classic|stylish|versatile|rare|perfect|great)\b/gi;

const SELLING_BRIEF_SECTION_HEADING_PATTERN =
  /^[A-Z][A-Za-z0-9 /&()'-]{2,80}\s*:?\s*$/;

const SELLING_BRIEF_CANDIDATE_HEADING_PATTERN =
  /^\s*(?:[-*]\s*)?Candidate\s+\d+\s*:?\s*$/i;

function sellerProvidedFunctionalityCaveat(sellerInput: string): boolean {
  return SELLER_PROVIDED_FUNCTIONALITY_CAVEAT_PATTERN.test(sellerInput);
}

function normalizeCandidatePhrase(candidateTerm: string): string {
  const placeholders: string[] = [];
  const protectedCandidateTerm = candidateTerm.replace(/\[[^\]]+\]/g, (placeholder) => {
    placeholders.push(placeholder);
    return `LPUPLACEHOLDER${placeholders.length - 1}`;
  });

  return protectedCandidateTerm
    .replace(/_/g, " ")
    .replace(/\b(?:candidate|taxonomy|internal|classification)\b/gi, "")
    .replace(/\bstyle\s*\/\s*theme\s*\/\s*aesthetic\b/gi, "")
    .replace(/\btheme\s*\/\s*aesthetic\b/gi, "")
    .replace(/\bsearch\s+descriptor\b/gi, "descriptor")
    .replace(/^(?:descriptor|term|phrase)\s*:\s*(.+)$/i, "$1")
    .replace(/^([^:,;]+)\s*:\s*(.+)$/i, "$2 $1")
    .replace(/^([^,;]+),\s*(.+)$/i, "$2 $1")
    .replace(/(?<!\[)\s*\/\s*(?![^\[]*\])/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/LPUPLACEHOLDER(\d+)/g, (_match, index: string) => {
      return placeholders[Number(index)] ?? "";
    });
}

function normalizeCandidateReferences(text: string, from: string, to: string): string {
  if (!from || !to || from === to) {
    return text;
  }

  return text.replace(new RegExp(escapeRegExp(from), "gi"), to);
}

function isGenericSubjectiveKeyword(term: string): boolean {
  const normalized = term.toLowerCase().replace(/\s{2,}/g, " ").trim();

  return (
    GENERIC_SUBJECTIVE_KEYWORD_PATTERN.test(normalized) ||
    GENERIC_SUBJECTIVE_KEYWORD_WITH_TARGET_PATTERN.test(normalized) ||
    GENERIC_SUBJECTIVE_PERFECT_GREAT_PATTERN.test(normalized)
  );
}

function cleanGenericSubjectiveBuyerSearchKeyword(term: string): string {
  const normalized = normalizeCandidatePhrase(term);

  if (!normalized || isGenericSubjectiveKeyword(normalized)) {
    return "";
  }

  const cleaned = normalized
    .replace(GENERIC_SUBJECTIVE_KEYWORD_PHRASE_PATTERN, "")
    .replace(GENERIC_SUBJECTIVE_KEYWORD_WORD_PATTERN, "")
    .replace(/\s+([,;/])/g, "$1")
    .replace(/([,;/])\s+/g, "$1 ")
    .replace(/(?:^|\s)[,;/]+(?:\s|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^(?:for|as|and|with|of|to)\s+/i, "")
    .replace(/\s+(?:for|as|and|with|of|to)$/i, "")
    .trim();

  if (!cleaned || isGenericSubjectiveKeyword(cleaned)) {
    return "";
  }

  if (/^\[(?:item\/use|use|purpose|occasion)\]$/i.test(cleaned)) {
    return "";
  }

  return cleaned;
}

function parseBuyerSearchKeywordTerms(value: string): string[] {
  return value
    .split(/\s*(?:,|;|\n)\s*/)
    .map((term) =>
      normalizeCandidatePhrase(
        term
          .replace(/^\s*[-*]\s*/, "")
          .replace(/^\s*(?:Buyer Search Keywords|Candidate Terms?)\s*:\s*/i, "")
      )
    )
    .filter(Boolean);
}

function cleanBuyerSearchKeywordTerms(terms: string[]): string[] {
  const cleanedTerms: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const normalized = cleanGenericSubjectiveBuyerSearchKeyword(term);
    if (!normalized) {
      continue;
    }

    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    cleanedTerms.push(normalized);
  }

  return cleanedTerms;
}

function sanitizeCandidateTermValue(candidateTerm: string): {
  term: string;
  rejected: boolean;
} {
  if (FAKE_CANDIDATE_TERM_PATTERN.test(candidateTerm.trim())) {
    return { term: "", rejected: true };
  }

  const normalized = normalizeCandidatePhrase(candidateTerm);

  if (!normalized) {
    return { term: "", rejected: true };
  }

  if (
    GENERIC_SUBJECTIVE_CANDIDATE_EXACT_PATTERN.test(normalized) ||
    isGenericSubjectiveKeyword(normalized)
  ) {
    return { term: normalized, rejected: true };
  }

  return { term: normalized, rejected: false };
}

function isSellingBriefSectionHeading(line: string): boolean {
  return SELLING_BRIEF_SECTION_HEADING_PATTERN.test(line.trim());
}

function isClaimLimitNormalizationScope(line: string): boolean {
  return SELLING_BRIEF_CLAIM_LIMIT_NORMALIZATION_SCOPE_PATTERN.test(line);
}

function isClaimLimitScopedLine(line: string, currentSection: string): boolean {
  return (
    /^\s*-?\s*(?:Claim Limit|Blocked Overclaims|Allowed Safe Use|Reason|Reason Selected|Rejection Reason|Risk|Quality Risk)\s*:/i.test(
      line
    ) ||
    isClaimLimitNormalizationScope(currentSection) ||
    isClaimLimitNormalizationScope(line)
  );
}

function normalizeSellingBriefClaimLimitLine({
  line,
  currentSection,
}: {
  line: string;
  currentSection: string;
}): string {
  if (!OLD_SELLING_BRIEF_ERA_LANGUAGE_PATTERN.test(line)) {
    return line;
  }

  if (!isClaimLimitScopedLine(line, currentSection)) {
    return line;
  }

  const indentation = line.match(/^\s*/)?.[0] ?? "";
  const bullet = line.match(/^\s*([-*]\s*)/)?.[1] ?? "";
  return `${indentation}${bullet}${SELLING_BRIEF_CLAIM_LIMIT_BOUNDARY}`;
}

function removeDuplicateClaimLimitBoundaryLines(sellingBrief: string): string {
  const rebuiltLines: string[] = [];
  let previousWasClaimLimitBoundary = false;

  for (const line of sellingBrief.split("\n")) {
    const isClaimLimitBoundary =
      line.trim().replace(/^[-*]\s*/, "") === SELLING_BRIEF_CLAIM_LIMIT_BOUNDARY;

    if (isClaimLimitBoundary && previousWasClaimLimitBoundary) {
      continue;
    }

    rebuiltLines.push(line);
    previousWasClaimLimitBoundary = isClaimLimitBoundary;
  }

  return rebuiltLines.join("\n");
}

function sanitizeBuyerSearchKeywordsSection(sellingBrief: string): string {
  const lines = sellingBrief.split("\n");
  const rebuiltLines: string[] = [];
  let isInsideBuyerSearchKeywords = false;
  let buyerSearchPrefix = "";
  let buyerSearchIndentation = "";
  let buyerSearchTerms: string[] = [];

  function flushBuyerSearchKeywords() {
    if (!isInsideBuyerSearchKeywords) {
      return;
    }

    const cleanedTerms = cleanBuyerSearchKeywordTerms(buyerSearchTerms);
    if (cleanedTerms.length > 0) {
      const normalizedPrefix = buyerSearchPrefix
        ? buyerSearchPrefix.replace(/\s*$/, " ")
        : `${buyerSearchIndentation}Buyer Search Keywords: `;
      rebuiltLines.push(`${normalizedPrefix}${cleanedTerms.join(", ")}`);
    }

    isInsideBuyerSearchKeywords = false;
    buyerSearchPrefix = "";
    buyerSearchIndentation = "";
    buyerSearchTerms = [];
  }

  for (const line of lines) {
    const labelMatch = line.match(/^(\s*(?:[-*]\s*)?Buyer Search Keywords\s*:?\s*)(.*)$/i);

    if (labelMatch) {
      flushBuyerSearchKeywords();
      isInsideBuyerSearchKeywords = true;
      buyerSearchPrefix = (labelMatch[1] ?? "").includes(":")
        ? labelMatch[1] ?? ""
        : `${line.match(/^\s*/)?.[0] ?? ""}Buyer Search Keywords: `;
      buyerSearchIndentation = line.match(/^\s*/)?.[0] ?? "";
      buyerSearchTerms.push(...parseBuyerSearchKeywordTerms(labelMatch[2] ?? ""));
      continue;
    }

    if (isInsideBuyerSearchKeywords) {
      const startsNextSection =
        line.trim() &&
        isSellingBriefSectionHeading(line) &&
        !/^\s*[-*]/.test(line);

      if (startsNextSection) {
        flushBuyerSearchKeywords();
        rebuiltLines.push(line);
        continue;
      }

      if (line.trim()) {
        buyerSearchTerms.push(...parseBuyerSearchKeywordTerms(line));
      }
      continue;
    }

    rebuiltLines.push(line);
  }

  flushBuyerSearchKeywords();

  return rebuiltLines.join("\n");
}

function removeFakeSellingBriefCandidateRows(sellingBrief: string): string {
  const candidateStartPattern = /^\s*-?\s*Candidate Term\s*:\s*(.+?)\s*$/im;
  const lines = sellingBrief.split("\n");
  const rebuiltLines: string[] = [];
  let currentBlock: string[] = [];
  let isInsideCandidateBlock = false;

  function flushCandidateBlock() {
    if (!isInsideCandidateBlock) {
      return;
    }

    const blockText = currentBlock.join("\n");
    const candidateMatch = blockText.match(candidateStartPattern);
    const rawCandidateTerm = candidateMatch?.[1]?.trim() ?? "";
    const candidateTerm = normalizeCandidatePhrase(rawCandidateTerm);

    if (
      rawCandidateTerm &&
      !FAKE_CANDIDATE_TERM_PATTERN.test(rawCandidateTerm) &&
      !FAKE_CANDIDATE_TERM_PATTERN.test(candidateTerm)
    ) {
      rebuiltLines.push(...currentBlock);
    }

    currentBlock = [];
    isInsideCandidateBlock = false;
  }

  for (const line of lines) {
    if (
      SELLING_BRIEF_CANDIDATE_HEADING_PATTERN.test(line) ||
      /^\s*-?\s*Candidate Term\s*:/i.test(line)
    ) {
      flushCandidateBlock();
      isInsideCandidateBlock = true;
      currentBlock.push(line);
      continue;
    }

    if (isInsideCandidateBlock) {
      const startsNewNonCandidateSection =
        line.trim() &&
        isSellingBriefSectionHeading(line) &&
        !/^\s*[-*]/.test(line);

      if (startsNewNonCandidateSection) {
        flushCandidateBlock();
        rebuiltLines.push(line);
        continue;
      }

      currentBlock.push(line);
      continue;
    }

    rebuiltLines.push(line);
  }

  flushCandidateBlock();

  return rebuiltLines
    .filter((line, index, allLines) => {
      if (!SELLING_BRIEF_CANDIDATE_HEADING_PATTERN.test(line)) {
        return true;
      }

      const nextContentLine = allLines
        .slice(index + 1)
        .find((candidateLine) => candidateLine.trim());

      return Boolean(nextContentLine && /^\s*-?\s*Candidate Term\s*:/i.test(nextContentLine));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function getRejectedStyleCandidateTerms(sellingBrief: string): string[] {
  const candidateBank = extractStyleCandidateBank(sellingBrief);

  if (!candidateBank.trim()) {
    return [];
  }

  const candidateBlocks = candidateBank
    .split(/\n(?=\s*-?\s*Candidate Term\s*:)/i)
    .filter((block) => /\bCandidate Term\s*:/i.test(block));
  const rejectedTerms = new Set<string>();

  for (const block of candidateBlocks) {
    const rawCandidateTerm = extractFieldValue(block, "Candidate Term");
    const candidateTerm = normalizeCandidatePhrase(rawCandidateTerm);
    const evidenceSource = extractFieldValue(block, "Evidence Source");
    const confidenceLevel = extractFieldValue(block, "Confidence Level");
    const useIn = extractFieldValue(block, "Use In");

    if (
      candidateTerm &&
      !FAKE_CANDIDATE_TERM_PATTERN.test(rawCandidateTerm) &&
      !FAKE_CANDIDATE_TERM_PATTERN.test(candidateTerm) &&
      (/^Rejected$/i.test(evidenceSource) ||
        /^Weak\/Do not use$/i.test(confidenceLevel) ||
        /^Do Not Use$/i.test(useIn))
    ) {
      rejectedTerms.add(candidateTerm);
    }
  }

  return Array.from(rejectedTerms).sort((a, b) => b.length - a.length);
}

function cleanRejectedCandidateTermsFromReferenceLine(
  line: string,
  rejectedTerms: string[]
): string {
  let cleanedLine = line;

  for (const term of rejectedTerms) {
    cleanedLine = cleanedLine.replace(new RegExp(escapeRegExp(term), "gi"), "");
  }

  return cleanedLine
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/:\s*,\s*/g, ": ")
    .replace(/,\s*(?=$)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1");
}

function removeRejectedCandidateTermsFromSellingBriefReferences(
  sellingBrief: string,
  rejectedTerms: string[]
): string {
  if (rejectedTerms.length === 0) {
    return sellingBrief;
  }

  const cleanedLines: string[] = [];
  let currentSection = "";
  let isInsideCandidateBlock = false;

  for (const line of sellingBrief.split("\n")) {
    if (line.trim() && isSellingBriefSectionHeading(line)) {
      currentSection = line.trim().replace(/:$/, "");
      isInsideCandidateBlock = false;
    }

    if (
      SELLING_BRIEF_CANDIDATE_HEADING_PATTERN.test(line) ||
      /^\s*-?\s*Candidate Term\s*:/i.test(line)
    ) {
      isInsideCandidateBlock = true;
    }

    const canCleanLine =
      !isInsideCandidateBlock &&
      !/^Generic Phrases to Avoid\b/i.test(currentSection) &&
      /^(?:Buyer Search Keywords|Platform Angle Map|EBAY TITLE B STYLE\/THEME\/AESTHETIC REQUIREMENT|Quality Risks Before Final Listing)\b/i.test(
        currentSection
      );

    cleanedLines.push(
      canCleanLine
        ? cleanRejectedCandidateTermsFromReferenceLine(line, rejectedTerms)
        : line
    );
  }

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function applyCandidateTermReferenceRepairs(
  sellingBrief: string,
  repairs: Array<{ from: string; to: string }>
): string {
  let repairedBrief = sellingBrief;

  for (const repair of repairs) {
    if (!repair.from || !repair.to || repair.from === repair.to) {
      continue;
    }

    repairedBrief = normalizeCandidateReferences(repairedBrief, repair.from, repair.to);
  }

  return repairedBrief;
}

function sanitizeSellingBriefAfterRepair({
  sellingBrief,
  sellerInput,
}: {
  sellingBrief: string;
  sellerInput: string;
}): string {
  if (!sellingBrief.trim()) {
    return sellingBrief;
  }

  const hasFunctionalityCaveat = sellerProvidedFunctionalityCaveat(sellerInput);
  let currentCandidateRepair: { term: string; rejected: boolean } | null = null;
  let currentSection = "";
  const candidateTermRepairs: Array<{ from: string; to: string }> = [];

  const sanitized = removeFakeSellingBriefCandidateRows(sellingBrief)
    .replace(
      /Blocked Overclaims:\s*Do not claim [^\n.]*\b(?:designer intent|provenance|documented design line|exact production date)[^\n.]*unless supported\./gi,
      SELLING_BRIEF_BLOCKED_OVERCLAIM_BOUNDARY
    )
    .replace(
      /Blocked Overclaims:\s*Do not claim [^\n.]*\b(?:exact production date|documented design line)[^\n.]*unless supported\./gi,
      SELLING_BRIEF_BLOCKED_OVERCLAIM_BOUNDARY
    )
    .replace(/\n{3,}/g, "\n\n");

  const lineSanitized = sanitized
    .split("\n")
    .map((line) => {
      if (line.trim() && isSellingBriefSectionHeading(line)) {
        currentSection = line.trim();
      }

      const candidateMatch = line.match(/^(\s*-?\s*Candidate Term\s*:\s*)(.+?)\s*$/i);
      if (candidateMatch) {
        const originalCandidateTerm = candidateMatch[2] ?? "";
        currentCandidateRepair = sanitizeCandidateTermValue(originalCandidateTerm);
        if (!currentCandidateRepair.rejected) {
          candidateTermRepairs.push({
            from: originalCandidateTerm.trim(),
            to: currentCandidateRepair.term,
          });
        }
        return `${candidateMatch[1]}${currentCandidateRepair.term}`;
      }

      if (
        currentCandidateRepair &&
        /^\s*-?\s*Evidence Source\s*:/i.test(line) &&
        currentCandidateRepair.rejected
      ) {
        return line.replace(/:\s*.*$/i, ": Rejected");
      }

      if (
        currentCandidateRepair &&
        /^\s*-?\s*Confidence Level\s*:/i.test(line) &&
        currentCandidateRepair.rejected
      ) {
        return line.replace(/:\s*.*$/i, ": Weak/Do not use");
      }

      if (currentCandidateRepair && /^\s*-?\s*Safe Wording\s*:/i.test(line)) {
        return line.replace(
          /:\s*.*$/i,
          `: ${currentCandidateRepair.rejected ? "N/A" : currentCandidateRepair.term}`
        );
      }

      if (
        currentCandidateRepair &&
        /^\s*-?\s*Use In\s*:/i.test(line) &&
        currentCandidateRepair.rejected
      ) {
        return line.replace(/:\s*.*$/i, ": Do Not Use");
      }

      if (
        currentCandidateRepair &&
        /^\s*-?\s*(?:Claim Limit|Reason|Rejection Reason)\s*:/i.test(line) &&
        currentCandidateRepair.rejected
      ) {
        return line.replace(/:\s*.*$/i, ": visual evidence does not support this descriptor");
      }

      const claimLimitLine = normalizeSellingBriefClaimLimitLine({
        line,
        currentSection,
      });
      if (claimLimitLine !== line) {
        return claimLimitLine;
      }

      if (line.trim() === "" || isSellingBriefSectionHeading(line)) {
        currentCandidateRepair = null;
      }

      if (!hasFunctionalityCaveat) {
        return line
          .replace(/\bpin mechanism not tested\b/gi, "pin clasp present")
          .replace(/\bclasp not tested\b/gi, "clasp present")
          .replace(/\bclosure not tested\b/gi, "closure shown")
          .replace(/\bzipper not tested\b/gi, "zipper present")
          .replace(/\bbutton function not tested\b/gi, "buttons present")
          .replace(/\bpower not tested\b/gi, "cord shown")
          .replace(/\b(?:functional status not tested|functionality not tested|function not tested|not formally tested|working status unknown|function unknown|operation unknown)\b/gi, "component shown");
      }

      return line;
    })
    .join("\n")
    .replace(/[ \t]{2,}/g, " ");

  const withCandidateReferences = applyCandidateTermReferenceRepairs(
    lineSanitized,
    candidateTermRepairs
  );
  const rejectedTerms = getRejectedStyleCandidateTerms(withCandidateReferences);
  const withRejectedReferencesCleaned =
    removeRejectedCandidateTermsFromSellingBriefReferences(
      withCandidateReferences,
      rejectedTerms
    );
  const withCleanKeywords = sanitizeBuyerSearchKeywordsSection(
    withRejectedReferencesCleaned
  );
  const withDedupedClaimLimits =
    removeDuplicateClaimLimitBoundaryLines(withCleanKeywords);

  return hasFunctionalityCaveat
    ? withDedupedClaimLimits
    : withDedupedClaimLimits.replace(SELLING_BRIEF_FUNCTIONALITY_CAVEAT_PATTERN, "component shown");
}

function extractStyleCandidateBank(sellingBrief: string): string {
  const bankHeading = "STYLE / THEME / AESTHETIC CANDIDATE BANK";
  const startIndex = sellingBrief.indexOf(bankHeading);

  if (startIndex === -1) {
    return "";
  }

  const afterBankHeadingIndex = startIndex + bankHeading.length;
  const remainingBrief = sellingBrief.slice(afterBankHeadingIndex);
  const endMatch = remainingBrief.match(
    /\n(?:EBAY TITLE B STYLE\/THEME\/AESTHETIC REQUIREMENT|Generic Phrases to Avoid|Platform Angle Map|Quality Risks Before Final Listing)\b/
  );

  if (!endMatch || typeof endMatch.index !== "number") {
    return remainingBrief;
  }

  return remainingBrief.slice(0, endMatch.index);
}

function extractFieldValue(block: string, fieldName: string): string {
  const match = block.match(
    new RegExp(`^\\s*-?\\s*${escapeRegExp(fieldName)}\\s*:\\s*(.+?)\\s*$`, "im")
  );

  return match?.[1]?.trim() ?? "";
}

function getExactConfirmedStyleCandidateSafeWordings(
  sellingBrief: string
): string[] {
  const candidateBank = extractStyleCandidateBank(sellingBrief);

  if (!candidateBank.trim()) {
    return [];
  }

  const candidateBlocks = candidateBank
    .split(/\n(?=\s*-?\s*Candidate Term\s*:)/i)
    .filter((block) => /\bCandidate Term\s*:/i.test(block));
  const exactSafeWordings = new Set<string>();

  for (const block of candidateBlocks) {
    const candidateTerm = extractFieldValue(block, "Candidate Term");
    const confidenceLevel = extractFieldValue(block, "Confidence Level");
    const safeWording = extractFieldValue(block, "Safe Wording");

    if (
      candidateTerm &&
      safeWording &&
      confidenceLevel === "Confirmed" &&
      safeWording === candidateTerm
    ) {
      exactSafeWordings.add(safeWording);
    }
  }

  return Array.from(exactSafeWordings).sort((a, b) => b.length - a.length);
}

function shouldSkipExactCandidateSuffixRepairLine(line: string): boolean {
  return /^\s*(?:Style Tags|Compact 3-Tag Strategy \(Alt Option\)|Depop Aesthetic Mode|Aesthetic Mode)\s*:/i.test(
    line
  );
}

function shouldSkipSentenceLevelBodyCopyRepairLine(line: string): boolean {
  return /^\s*(?:eBay Title A|eBay Title B|Title|Poshmark Title|Etsy Title|Etsy Tags|Depop Hashtags|Search keywords|Style Tags|Compact 3-Tag Strategy \(Alt Option\)|Depop Aesthetic Mode|Aesthetic Mode)\s*:/i.test(
    line
  );
}

const PLATFORM_HEADING_PATTERN = /^\s*(EBAY|DEPOP|POSHMARK|MERCARI|ETSY|WHATNOT)\s*$/i;
const FINAL_OUTPUT_FIELD_LABEL_PATTERN =
  /^\s*(?:Title A|Title B|Title|Category|Item Specifics|Aesthetic Mode|Primary|Secondary|Attributes|Listing|Description|Style Tags|Compact 3-Tag Strategy \(Alt Option\)|Hashtags|Optional Brand Hashtags|Approximate Measurements|Materials|Attributes \/ Key Details|Tags|Search keywords)\s*:/i;

const WEAK_GENERIC_BODY_COPY_PATTERN =
  /\b(?:great for collectors|anyone drawn to|works well|statement piece|statement accessory|standout piece|beautiful piece|unique find|perfect for any outfit|great addition|timeless|high quality|stylish accessory|versatile piece|eye-catching|must-have|rare find|collector's item|collector’s item|decorative piece|classic design|pairs well|worn alone or layered|vintage-inspired outfits|classic styling|formal looks|ornate looks|great for styling|perfect gift|gift for her|(?:statement|beautiful|unique|perfect|great|stylish|versatile|eye-catching|must-have|rare|classic)\s+(?:\[[^\]]+\]|[a-z][a-z /-]{1,40}))/i;

const VAGUE_BODY_FALLBACK_PATTERN =
  /\b(?:with\s+(?:visible\s+)?(?:detailing|detail|design|look|style)(?:\s+(?:detail|details|(?:\[[^\]]+\]|[a-z][a-z /-]{1,40})))?|(?:detailing|detail|design|visual|style|look)\s+detail|(?:\[[^\]]+\]|[a-z][a-z /-]{1,40})\s+with\s+detailing\s+(?:\[[^\]]+\]|[a-z][a-z /-]{1,40}))\b/i;

const WEAK_UNBRANDED_BODY_OPENING_PATTERN =
  /^\s*(?:[-*•]\s*)?(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?)\s+(?:is\s+unbranded|with\s+Unbranded|by\s+Unbranded|from\s+Unbranded)\b/i;

const UNSUPPORTED_FUNCTIONALITY_CAVEAT_PATTERN =
  /\b(?:untested|not tested|functional status not tested|functionality not tested|function not tested|clasp not tested|closure not tested|pin mechanism not tested|zipper not tested|button function not tested|power not tested|not formally tested|working status unknown|function unknown|functionality unknown|operation unknown|working condition unknown)\b/i;

const INTERNAL_SOURCE_LANGUAGE_PATTERN =
  /\b(?:seller-confirmed|seller confirmed|seller-provided|seller provided|seller states|seller stated|per seller|seller note|seller notes|photo evidence|visible in photos|photo-derived|evidence source|Known Details|provided by seller)\b/i;

const BUYER_FACING_NEGATIVE_UNCERTAINTY_PATTERN =
  /\b(?:not individually verified|completeness not verified|no confirmed missing parts|no confirmed missing stones|no confirmed missing components|no explicit missing parts confirmed|no explicit missing stones confirmed|stone completeness not verified|component completeness not verified)\b/i;

const DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN =
  /^\s*(?:(?:Size|Scale|Measurements?|Approx(?:imate)? size|Dimensions?)\s*:\s*)?(?:(?:measur(?:e|es|ing)\s+)?approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+(?:in(?:ches)?|inch|["”]|cm|mm|ft|feet)\b).*|(?:(?:the|this)\s+item|it)?\s*measur(?:e|es|ing)\s+approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+).*|approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+(?:in(?:ches)?|inch|["”]|cm|mm|ft|feet))\s+across\b.*|approximate\s+size\s+(?:\[measurement\]|[\d./\s-]+).*|(?:approx(?:imate)?\s+)?size\s+listed\s+below|measurements?\s+listed\s+below|dimensions?\s+listed\s+below|see\s+measurements?\s+below|see\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?\s+for\s+(?:scale reference|approx(?:imate)?\s+size|size|measurements?)|size\s+is\s+shown\s+(?:using|in|with)\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?|measurements?\s+(?:shown|visible)\s+in\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?|based\s+on\s+(?:the\s+)?measurement\s+photo|from\s+measurement\s+photo|size\s+noted\s+below|approximate\s+size\s+noted\s+below)/i;

const MEASUREMENT_REFERENCE_PHRASE_PATTERN =
  /\b(?:(?:measur(?:e|es|ing)\s+)?approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+(?:in(?:ches)?|inch|["”]|cm|mm|ft|feet)\b)(?:\s+across)?|(?:(?:the|this)\s+item|it)?\s*measur(?:e|es|ing)\s+approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+)|approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+(?:in(?:ches)?|inch|["”]|cm|mm|ft|feet))\s+across|approximate\s+size\s+(?:\[measurement\]|[\d./\s-]+)|(?:approx(?:imate)?\s+)?size\s+listed\s+below|measurements?\s+listed\s+below|dimensions?\s+listed\s+below|see\s+measurements?\s+below|see\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?\s+for\s+(?:scale reference|approx(?:imate)?\s+size|size|measurements?)|size\s+is\s+shown\s+(?:using|in|with)\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?|measurements?\s+(?:shown|visible)\s+in\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?|based\s+on\s+(?:the\s+)?measurement\s+photo|from\s+measurement\s+photo|approximate\s+measurement\s+from\s+photo|measurement\s+from\s+photo|size\s+noted\s+below|approximate\s+size\s+noted\s+below)/i;

const BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN =
  /\b(?:measur(?:e|es|ing)\s+approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+)(?:\s+across)?|approx(?:imately)?\.?\s*(?:\[measurement\]|[\d./\s-]+)\s+across|approximate\s+size\s*(?:\[measurement\]|[\d./\s-]+)?|approximate\s+measurement\s+from\s+photo|measurement\s+from\s+photo|based\s+on\s+(?:the\s+)?measurement\s+photo|from\s+measurement\s+photo|size\s+(?:provides\s+scale|listed\s+below|noted\s+below)|measurements?\s+listed\s+below|dimensions?\s+listed\s+below|see\s+measurements?\s+below|see\s+(?:the\s+)?(?:ruler|measurement(?:-reference)?|measurement board)\s+photo(?:s)?\s+for\s+scale\s+reference)\b/i;

const ETSY_MEDIA_ADVICE_PATTERN =
  /\b(?:Photo tips?|Video ideas?|For best presentation in your shop|include close-up photos|include a wrist shot|capture side angles|short video showing|video showing|show clasp|show scale|demonstrate scale|buyer confidence photo suggestion|listing video suggestion)\b/i;

const EMPTY_OPTIONAL_BODY_LABEL_PATTERN =
  /^\s*(?:Size|Styling|Style notes|Notes|Fit|Scale|Wear|Use|Details|Measurements|Search terms)\s*:\s*$/i;

const DUPLICATE_MEASUREMENT_OPTIONAL_BODY_LABEL_PATTERN =
  /^\s*(?:Size|Measurements?|Dimensions?|Scale|Fit|Approx(?:imate)? Size)\s*:\s*$/i;

const BODY_BULLET_LINE_PATTERN = /^\s*(?:[-*•]|\d+[.)])\s+/;

const BODY_FRAGMENT_START_PATTERN =
  /^\s*(?:with|and|plus|featuring|features|finished with|includes?|condition|closure|hardware|component|color|material|pattern|motif|clasp|zipper|button|strap|handle)\b/i;

const ETSY_CONSTRUCTION_FIRST_START_PATTERN =
  /^\s*(?:constructed|construction|made with|features|featuring|with|designed with|finished with|material|materials|closure|hardware|component|components|color|pattern|motif)\b/i;

const UNIVERSAL_MEASUREMENT_VALUE_PATTERN =
  String.raw`(?:\[measurement\]|(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)(?:\s*(?:-|–|to)\s*(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+))?(?:\s*(?:"|”|in(?:ches)?|inch|cm|mm|ft|feet))?(?:\s*(?:x|by)\s*(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+)(?:\s*(?:-|–|to)\s*(?:\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+))?(?:\s*(?:"|”|in(?:ches)?|inch|cm|mm|ft|feet))?)*)`;

const BODY_MEASUREMENT_ONLY_PATTERNS = [
  new RegExp(
    String.raw`^approx(?:imate(?:ly)?)?\.?\s+${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+across)?\.?$`,
    "i"
  ),
  new RegExp(
    String.raw`^measur(?:e|es|ing)\s+approx(?:imately)?\.?\s+${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+across)?\.?$`,
    "i"
  ),
  new RegExp(
    String.raw`^(?:the\s+|this\s+)?(?:item|[a-z][a-z /-]{0,60})\s+(?:measures?|measuring|is)\s+approx(?:imately)?\.?\s+${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+across)?\.?$`,
    "i"
  ),
  new RegExp(
    String.raw`^(?:approx(?:imate)?\s+)?size\s+(?:approx(?:imately)?\.?\s+)?${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}\.?$`,
    "i"
  ),
  new RegExp(
    String.raw`^approx\.?\s+size\s*:\s*(?:about\s+)?${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+(?:wide|tall|high|long|across))?(?:\s+(?:and|x|by)\s+${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+(?:wide|tall|high|long|across))?)*\.?$`,
    "i"
  ),
  new RegExp(
    String.raw`^size\s*:\s*(?:about\s+|approx(?:imately)?\.?\s+)?${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+(?:wide|tall|high|long|across))?(?:\s+(?:and|x|by)\s+${UNIVERSAL_MEASUREMENT_VALUE_PATTERN}(?:\s+(?:wide|tall|high|long|across))?)*\.?$`,
    "i"
  ),
  /^\s*size\s+noted\s+below\.?\s*$/i,
  /^\s*approx(?:imate)?\s+size\s+listed\s+below\.?\s*$/i,
  /^\s*measurements?\s+listed\s+below\.?\s*$/i,
  /^\s*dimensions?\s+listed\s+below\.?\s*$/i,
  /^\s*see\s+measurements?\s+below\.?\s*$/i,
  /^\s*see\s+ruler\s+photo\s+for\s+scale\s+reference\.?\s*$/i,
  /^\s*based\s+on\s+the\s+measurement\s+photo\.?\s*$/i,
  /^\s*from\s+measurement\s+photo\.?\s*$/i,
  /^\s*measurements?\s+shown\s+in\s+photo\.?\s*$/i,
];

function hasSellerProvidedFunctionalityCaveat(sellerInput: string): boolean {
  return SELLER_PROVIDED_FUNCTIONALITY_CAVEAT_PATTERN.test(sellerInput);
}

function isBuyerFacingBodyStartLine(platform: string, line: string): boolean {
  const normalizedPlatform = platform.toUpperCase();

  if (normalizedPlatform === "DEPOP") {
    return /^\s*Listing\s*:/i.test(line);
  }

  return (
    ["EBAY", "POSHMARK", "MERCARI", "ETSY"].includes(normalizedPlatform) &&
    /^\s*Description\s*:/i.test(line)
  );
}

function lineHasFinalOutputFieldLabel(line: string): boolean {
  return FINAL_OUTPUT_FIELD_LABEL_PATTERN.test(line);
}

function lineHasUnsupportedBrandFallback(line: string): boolean {
  return /^\s*(?:Brand|Brand \/ Maker|Brand\/Maker|Maker|Designer|Publisher|Manufacturer|Studio)\s*:\s*(?:Not specified(?:\s*\(see photos\))?|Unknown|See photos)\s*$/i.test(
    line
  );
}

function repairUnsupportedBrandFallback(line: string): string {
  return line.replace(
    /^(\s*(?:Brand|Brand \/ Maker|Brand\/Maker|Maker|Designer|Publisher|Manufacturer|Studio)\s*:\s*)(?:Not specified(?:\s*\(see photos\))?|Unknown|See photos)\s*$/i,
    "$1Unbranded"
  );
}

function repairUnsupportedSeePhotosFieldFallback(line: string): string {
  return line
    .replace(
      /^(\s*Country\/Region of Manufacture\s*:\s*)Not specified\s*\(see photos\)\s*$/i,
      "$1Not specified"
    )
    .replace(
      /^(\s*(?!Approximate Measurements\b)[A-Za-z][A-Za-z /-]{1,80}\s*:\s*)Not specified\s*\(see photos\)\s*$/i,
      "$1Not specified"
    );
}

function splitLeadingBuyerBodyLabel(
  line: string
): { label: string; body: string } | null {
  const match = line.match(/^(\s*(?:Listing|Description)\s*:\s*)(.*)$/i);

  if (!match) {
    return null;
  }

  return {
    label: match[1] ?? "",
    body: match[2] ?? "",
  };
}

function repairInternalSourceLanguage(line: string): string {
  if (!line.trim()) {
    return line;
  }

  let repairedLine = line
    .replace(/\bseller-confirmed\s+vintage\b/gi, "vintage")
    .replace(/\bseller confirmed\s+vintage\b/gi, "vintage")
    .replace(/\ball stones present\s+per seller\b/gi, "all stones present")
    .replace(/\bseller-provided\s+length\b/gi, "length")
    .replace(/\bseller provided\s+length\b/gi, "length")
    .replace(/\bvisible\s+surface\s+wear\b/gi, "light surface wear")
    .replace(/\bvisible\s+patina\b/gi, "light patina")
    .replace(/\bmark\s+visible\s+in\s+photos\b/gi, "mark present")
    .replace(/\bmark\s+visible\b/gi, "mark present")
    .replace(/\bphoto\s+evidence\s+shows\s+/gi, "")
    .replace(/\bphoto\s+evidence\s+showing\s+/gi, "")
    .replace(/\bphoto\s+evidence\s*:\s*/gi, "")
    .replace(/\b(?:seller-confirmed|seller confirmed|seller-provided|seller provided|seller states|seller stated|per seller|seller note|seller notes|visible in photos|photo evidence|photo-derived|evidence source|Known Details|provided by seller)\b/gi, "")
    .replace(/\bvisible\b/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\b(?:with|and|plus)\s*([,.;:])/gi, "$1")
    .replace(/\s+-\s*$/g, "")
    .replace(/:\s*$/g, ":");

  if (line.match(/^\s+/) && !repairedLine.match(/^\s+/)) {
    repairedLine = `${line.match(/^\s*/)?.[0] ?? ""}${repairedLine}`;
  }

  return repairedLine.trim() ? repairedLine : "";
}

function repairBuyerFacingUncertaintyLanguage(line: string): string {
  if (!line.trim()) {
    return line;
  }

  return line
    .replace(/\b(?:metal|material)\s+composition\s+not\s+specified\b/gi, "exact material not confirmed")
    .replace(/\bmaterial\s+composition\s+unknown\b/gi, "exact material not confirmed")
    .replace(/\bmaterial\s+not\s+specified\b/gi, "material not confirmed")
    .replace(/\bvisual\s+style\b/gi, "style")
    .replace(/\bmust\s+rely\s+on\s+buyer\s+photo\s+review\b/gi, "review photos for condition details")
    .replace(MEASUREMENT_REFERENCE_PHRASE_PATTERN, "approximate measurement from photo")
    .replace(/\bBrand\s*:\s*(?:Not specified(?:\s*\(see photos\))?|Unknown|See photos)\b/gi, "Brand: Unbranded")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function repairProvidedImagesLanguage(line: string): string {
  if (!line.trim()) {
    return line;
  }

  return line
    .replace(/\bbased\s+on\s+provided\s+images\b/gi, "shown in photos")
    .replace(
      /\b([A-Za-z][^.;:\n]{0,80}?)\s+appears\s+present\s+(?:in|from|shown in)\s+provided\s+images\b/gi,
      "$1 appears present; review photos for condition details"
    )
    .replace(
      /\bstones?\s+appear\s+present\s+(?:in|from|shown in)\s+provided\s+images\b/gi,
      "stones appear present; review photos for condition details"
    )
    .replace(
      /\bwear\s+(?:is\s+)?visible\s+(?:in|from|shown in)\s+provided\s+images\b/gi,
      "wear shown in photos"
    )
    .replace(
      /\bno\s+(?:obvious\s+)?missing\s+components?\s+(?:are\s+)?visible\s+(?:in|from|shown in)\s+provided\s+images\b/gi,
      "no obvious missing components shown"
    )
    .replace(
      /\bno\s+(?:obvious\s+)?missing\s+stones?\s+(?:are\s+)?visible\s+(?:in|from|shown in)\s+provided\s+images\b/gi,
      "no obvious missing stones shown"
    )
    .replace(/\bshown\s+in\s+provided\s+images\b/gi, "shown in photos")
    .replace(/\bin\s+provided\s+images\b/gi, "in photos")
    .replace(/\bfrom\s+provided\s+images\b/gi, "from photos")
    .replace(/\bprovided\s+images\b/gi, "photos")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ");
}

function hasConcreteMeasurementValue(line: string): boolean {
  return (
    (/\d/.test(line) || /\[measurement\]/i.test(line)) &&
    !/\b(?:not provided|not specified|see photos)\b/i.test(line)
  );
}

function getPlatformsWithApproximateMeasurements(lpuOutput: string): Set<string> {
  const platformsWithMeasurements = new Set<string>();
  let currentPlatform = "";
  let isInsideApproximateMeasurements = false;

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      isInsideApproximateMeasurements = false;
      continue;
    }

    if (/^\s*Approximate Measurements\s*:/i.test(line)) {
      isInsideApproximateMeasurements = true;
      if (currentPlatform && hasConcreteMeasurementValue(line)) {
        platformsWithMeasurements.add(currentPlatform);
      }
      continue;
    }

    if (
      isInsideApproximateMeasurements &&
      line.trim() &&
      lineHasFinalOutputFieldLabel(line)
    ) {
      isInsideApproximateMeasurements = false;
    }

    if (
      currentPlatform &&
      isInsideApproximateMeasurements &&
      hasConcreteMeasurementValue(line)
    ) {
      platformsWithMeasurements.add(currentPlatform);
    }
  }

  return platformsWithMeasurements;
}

function removeDuplicateMeasurementReferenceCopy(line: string): string {
  if (!line.trim()) {
    return line;
  }

  const leadingBodyLabel = splitLeadingBuyerBodyLabel(line);
  const linePrefix = leadingBodyLabel?.label ?? "";
  const bodyLine = leadingBodyLabel?.body ?? line;

  if (DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(bodyLine.trim())) {
    return "";
  }

  const leadingWhitespace = bodyLine.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = bodyLine.match(/\s*$/)?.[0] ?? "";
  const sentenceLikeParts = bodyLine.trim().split(/(?<=[.!?])\s+/);
  const repairedParts = sentenceLikeParts
    .filter((sentence) => {
      const trimmedSentence = sentence.trim();
      return (
        trimmedSentence &&
        !DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(trimmedSentence) &&
        !MEASUREMENT_REFERENCE_PHRASE_PATTERN.test(trimmedSentence) &&
        !BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN.test(trimmedSentence)
      );
    })
    .map((sentence) =>
      MEASUREMENT_REFERENCE_PHRASE_PATTERN.test(sentence)
        ? sentence.replace(MEASUREMENT_REFERENCE_PHRASE_PATTERN, "").trim()
        : sentence
    )
    .filter((sentence) => sentence.trim());

  return repairedParts.length
    ? `${linePrefix}${leadingWhitespace}${repairedParts.join(" ")}${trailingWhitespace}`
    : "";
}

function normalizeBodyMeasurementCandidate(line: string): string {
  return line
    .trim()
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isDuplicateMeasurementOnlyBodyLine(line: string): boolean {
  const normalizedLine = normalizeBodyMeasurementCandidate(line);

  if (!normalizedLine) {
    return false;
  }

  return (
    BODY_MEASUREMENT_ONLY_PATTERNS.some((pattern) =>
      pattern.test(normalizedLine)
    ) ||
    DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(normalizedLine) ||
    BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN.test(normalizedLine)
  );
}

function removeDuplicateMeasurementOnlyBodySentences(line: string): string {
  if (!line.trim()) {
    return line;
  }

  if (isDuplicateMeasurementOnlyBodyLine(line)) {
    return "";
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
  const sentenceLikeParts = line.trim().split(/(?<=[.!?])\s+/);

  if (sentenceLikeParts.length <= 1) {
    return line;
  }

  const repairedParts = sentenceLikeParts.filter(
    (sentence) => !isDuplicateMeasurementOnlyBodyLine(sentence)
  );

  if (
    repairedParts.length === sentenceLikeParts.length &&
    repairedParts.join(" ") === sentenceLikeParts.join(" ")
  ) {
    return line;
  }

  return repairedParts.length
    ? `${leadingWhitespace}${repairedParts.join(" ")}${trailingWhitespace}`
    : "";
}

function platformBodyLabelForMeasurementCleanup(platform: string): string | null {
  return platform === "DEPOP" ? "Listing" : "Description";
}

function getConcreteApproximateMeasurementBlockRange(
  block: string[]
): { startIndex: number; endIndex: number } | null {
  const startIndex = block.findIndex((line) =>
    /^\s*Approximate Measurements\s*:/i.test(line)
  );

  if (startIndex === -1) {
    return null;
  }

  let endIndex = block.length;
  for (let index = startIndex + 1; index < block.length; index += 1) {
    const line = block[index] ?? "";

    if (line.trim() && lineHasFinalOutputFieldLabel(line)) {
      endIndex = index;
      break;
    }
  }

  const measurementLines = block.slice(startIndex, endIndex);
  const hasConcreteMeasurement = measurementLines.some((line) =>
    hasConcreteMeasurementValue(line)
  );

  return hasConcreteMeasurement ? { startIndex, endIndex } : null;
}

function getBuyerFacingBodyRangeForPlatformBlock(
  platform: string,
  block: string[],
  measurementBlockStartIndex: number
): { startIndex: number; endIndex: number; label: string } | null {
  const bodyLabel = platformBodyLabelForMeasurementCleanup(platform);

  if (!bodyLabel) {
    return null;
  }

  const bodyLabelPattern = new RegExp(
    `^\\s*${escapeRegExp(bodyLabel)}\\s*:`,
    "i"
  );
  const startIndex = block.findIndex((line, index) => {
    return index < measurementBlockStartIndex && bodyLabelPattern.test(line);
  });

  if (startIndex === -1) {
    return null;
  }

  let endIndex = measurementBlockStartIndex;
  for (let index = startIndex + 1; index < measurementBlockStartIndex; index += 1) {
    const line = block[index] ?? "";

    if (
      line.trim() &&
      lineHasFinalOutputFieldLabel(line) &&
      !bodyLabelPattern.test(line)
    ) {
      endIndex = index;
      break;
    }
  }

  return { startIndex, endIndex, label: bodyLabel };
}

function cleanDuplicateMeasurementOptionalBodySubsections(lines: string[]): string[] {
  const cleanedLines: string[] = [];
  let pendingOptionalLabel: string | null = null;
  let pendingBlankLines: string[] = [];
  let pendingContentLines: string[] = [];

  function flushPendingOptionalSection() {
    if (!pendingOptionalLabel) {
      return;
    }

    const cleanedContentLines = pendingContentLines
      .map((line) => removeDuplicateMeasurementOnlyBodySentences(line))
      .filter((line) => line.trim());

    if (cleanedContentLines.length > 0) {
      cleanedLines.push(
        pendingOptionalLabel,
        ...pendingBlankLines,
        ...cleanedContentLines
      );
    }

    pendingOptionalLabel = null;
    pendingBlankLines = [];
    pendingContentLines = [];
  }

  for (const line of lines) {
    if (DUPLICATE_MEASUREMENT_OPTIONAL_BODY_LABEL_PATTERN.test(line)) {
      flushPendingOptionalSection();
      pendingOptionalLabel = line;
      continue;
    }

    if (pendingOptionalLabel) {
      if (!line.trim()) {
        pendingBlankLines.push(line);
        continue;
      }

      if (lineHasFinalOutputFieldLabel(line)) {
        flushPendingOptionalSection();
        cleanedLines.push(line);
        continue;
      }

      if (DUPLICATE_MEASUREMENT_OPTIONAL_BODY_LABEL_PATTERN.test(line)) {
        flushPendingOptionalSection();
        pendingOptionalLabel = line;
        continue;
      }

      pendingContentLines.push(line);
      continue;
    }

    const repairedLine = removeDuplicateMeasurementOnlyBodySentences(line);
    if (repairedLine.trim() || !line.trim()) {
      cleanedLines.push(repairedLine);
    }
  }

  flushPendingOptionalSection();

  return cleanedLines;
}

function cleanDuplicateMeasurementsFromPlatformBodyBlock(
  platform: string,
  block: string[]
): string[] {
  const measurementBlockRange = getConcreteApproximateMeasurementBlockRange(block);

  if (!measurementBlockRange) {
    return block;
  }

  const bodyRange = getBuyerFacingBodyRangeForPlatformBlock(
    platform,
    block,
    measurementBlockRange.startIndex
  );

  if (!bodyRange) {
    return block;
  }

  const bodyLabelLine = block[bodyRange.startIndex] ?? "";
  const leadingBodyLabel = splitLeadingBuyerBodyLabel(bodyLabelLine);
  const cleanedBodyLabelBody = leadingBodyLabel
    ? removeDuplicateMeasurementOnlyBodySentences(leadingBodyLabel.body)
    : bodyLabelLine;
  const cleanedBodyLines = cleanDuplicateMeasurementOptionalBodySubsections(
    block.slice(bodyRange.startIndex + 1, bodyRange.endIndex)
  );
  const rebuiltBodyLabelLine = leadingBodyLabel
    ? `${leadingBodyLabel.label}${cleanedBodyLabelBody.trimStart()}`
    : bodyLabelLine;

  return [
    ...block.slice(0, bodyRange.startIndex),
    rebuiltBodyLabelLine,
    ...cleanedBodyLines,
    ...block.slice(bodyRange.endIndex),
  ];
}

function cleanupDuplicateMeasurementsFromFinalFromBriefBodies(
  lpuOutput: string
): string {
  const rebuiltLines: string[] = [];
  let currentPlatform = "";
  let currentBlock: string[] = [];

  function flushCurrentBlock() {
    if (!currentPlatform) {
      rebuiltLines.push(...currentBlock);
      currentBlock = [];
      return;
    }

    rebuiltLines.push(
      ...cleanDuplicateMeasurementsFromPlatformBodyBlock(
        currentPlatform,
        currentBlock
      )
    );
    currentBlock = [];
  }

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      flushCurrentBlock();
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      rebuiltLines.push(line);
      continue;
    }

    currentBlock.push(line);
  }

  flushCurrentBlock();

  return rebuiltLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function repairSentenceLevelBodyCopyIssues({
  line,
  shouldRemoveFunctionalityCaveats,
  shouldRemoveEtsyMediaAdvice,
}: {
  line: string;
  shouldRemoveFunctionalityCaveats: boolean;
  shouldRemoveEtsyMediaAdvice: boolean;
}): string {
  if (!line.trim()) {
    return line;
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
  const trimmedLine = line.trim();
  const sentenceLikeParts = trimmedLine.split(/(?<=[.!?])\s+/);

  if (sentenceLikeParts.length <= 1) {
    const shouldRemoveLine =
      WEAK_GENERIC_BODY_COPY_PATTERN.test(trimmedLine) ||
      BUYER_FACING_NEGATIVE_UNCERTAINTY_PATTERN.test(trimmedLine) ||
      (shouldRemoveEtsyMediaAdvice && ETSY_MEDIA_ADVICE_PATTERN.test(trimmedLine)) ||
      (shouldRemoveFunctionalityCaveats &&
        UNSUPPORTED_FUNCTIONALITY_CAVEAT_PATTERN.test(trimmedLine));

    return shouldRemoveLine ? "" : line;
  }

  const repairedParts = sentenceLikeParts.filter((sentence) => {
    if (WEAK_GENERIC_BODY_COPY_PATTERN.test(sentence)) {
      return false;
    }

    if (BUYER_FACING_NEGATIVE_UNCERTAINTY_PATTERN.test(sentence)) {
      return false;
    }

    if (shouldRemoveEtsyMediaAdvice && ETSY_MEDIA_ADVICE_PATTERN.test(sentence)) {
      return false;
    }

    if (
      shouldRemoveFunctionalityCaveats &&
      UNSUPPORTED_FUNCTIONALITY_CAVEAT_PATTERN.test(sentence)
    ) {
      return false;
    }

    return true;
  });

  if (repairedParts.length === sentenceLikeParts.length) {
    return line;
  }

  if (repairedParts.length === 0) {
    return "";
  }

  return `${leadingWhitespace}${repairedParts.join(" ")}${trailingWhitespace}`;
}

function repairBodyGrammarDefects(line: string): string {
  if (!line.trim()) {
    return line;
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
  const trimmedLine = line.trim();
  const sentenceLikeParts = trimmedLine.split(/(?<=[.!?])\s+/);
  const repairedParts = sentenceLikeParts.flatMap((sentence) => {
    const trimmedSentence = sentence.trim();

    if (!trimmedSentence) {
      return [];
    }

    let repairedSentence = trimmedSentence
      .replace(
        /\b(?:and\s+)?no\s+(?:visible\s+)?(?:maker|brand|label|stamp|signature|manufacturer|designer)(?:\s+mark)?\s+is\s*\.?$/i,
        "No maker mark is present."
      )
      .replace(
        /\b(?:and\s+)?no\s+(?:visible\s+)?mark\s+is\s*\.?$/i,
        "No maker mark is present."
      )
      .replace(
        /\bno\s+obvious\s+missing\s+((?:component|components|part|parts|piece|pieces|accessory|accessories|hardware|closure|label|tag|elements?)(?:\s+[a-z][a-z-]*){0,4})\s+are\b/gi,
        "No obvious missing $1 shown"
      )
      .replace(/\s+([,.;:])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (/,\s*(?:and|with|plus|or|but)\s*\.?$/i.test(repairedSentence)) {
      repairedSentence = repairedSentence.replace(
        /,\s*(?:and|with|plus|or|but)\s*\.?$/i,
        "."
      );
    }

    if (/^(?:and|with|plus|or|but)\s*\.?$/i.test(repairedSentence)) {
      return [];
    }

    if (sentenceHasBodyGrammarDefect(repairedSentence)) {
      return [trimmedSentence];
    }

    return [repairedSentence];
  });

  if (repairedParts.length === 0) {
    return "";
  }

  const repairedLine = `${leadingWhitespace}${repairedParts.join(" ")}${trailingWhitespace}`;

  return repairedLine;
}

function sentenceHasAwkwardExactCandidateUse(
  sentence: string,
  safeWording: string
): boolean {
  const candidate = escapeRegExp(safeWording);

  return [
    new RegExp(`\\b(?:features|featuring)\\s+${candidate}\\s+with\\b`, "i"),
    new RegExp(`\\bhas\\s+${candidate}(?=\\s|[.!?,;:]|$)`, "i"),
    new RegExp(`\\bcreating\\s+(?:a|an)?\\s*${candidate}(?=\\s|[.!?,;:]|$)`, "i"),
    new RegExp(`\\bwith\\s+(?:a|an)?\\s*${candidate}(?=\\s|[.!?,;:]|$)`, "i"),
    new RegExp(`\\bwith\\s+${candidate}\\s+(?:arrangement|layout|construction|design|styling|look)\\b`, "i"),
    new RegExp(`${candidate}\\s+(?:arrangement|layout|construction|design|styling|look|inspired|effect)\\b`, "i"),
    new RegExp(`${candidate}-inspired\\b`, "i"),
    new RegExp(`\\bworks\\s+well\\s+for\\s+${candidate}\\s+looks\\b`, "i"),
    new RegExp(`\\breflects\\s+${candidate}\\s+(?:styling|design|influence)\\b`, "i"),
    new RegExp(`${candidate}\\s+(?:and|with)\\s+[A-Z][A-Za-z /-]{2,40}\\b`, "i"),
  ].some((pattern) => pattern.test(sentence));
}

function hasUsefulBodyEvidence(sentence: string): boolean {
  const normalizedSentence = sentence.trim();

  if (!normalizedSentence) {
    return false;
  }

  if (WEAK_GENERIC_BODY_COPY_PATTERN.test(normalizedSentence)) {
    return false;
  }

  return (
    /\[[^\]]+\]/.test(normalizedSentence) ||
    /\b(?:brand|maker|marked|signed|unbranded|type|condition|wear|surface|color|pattern|motif|material|finish|tone|construction|constructed|closure|hardware|component|included|includes|feature|features|form|shape|texture|strap|handle|cord|label|tag|stamp|model|part|set|piece)\b/i.test(
      normalizedSentence
    )
  );
}

function repairAwkwardExactCandidateSentence(
  sentence: string,
  safeWording: string
): string {
  const candidate = escapeRegExp(safeWording);
  let repairedSentence = sentence;

  repairedSentence = repairedSentence
    .replace(
      new RegExp(`\\b((?:features|featuring)\\s+)${candidate}\\s+with\\s+`, "gi"),
      "$1"
    )
    .replace(
      new RegExp(`\\bwith\\s+(?:a|an)?\\s*${candidate}\\s+(?:arrangement|layout|design|styling|look|effect)\\b`, "gi"),
      ""
    )
    .replace(
      new RegExp(`\\bwith\\s+(?:a|an)?\\s*${candidate}\\s+construction\\b`, "gi"),
      "with visible construction"
    )
    .replace(
      new RegExp(`\\bwith\\s+(?:a|an)?\\s*${candidate}(?=\\s|[.!?,;:]|$)`, "gi"),
      ""
    )
    .replace(
      new RegExp(`\\b${candidate}\\s+(?:arrangement|layout|design|styling|look|effect)\\b`, "gi"),
      ""
    )
    .replace(
      new RegExp(`\\b${candidate}\\s+construction\\b`, "gi"),
      "visible construction"
    )
    .replace(
      new RegExp(`\\b${candidate}-inspired\\b`, "gi"),
      ""
    )
    .replace(
      new RegExp(`\\breflects\\s+${candidate}\\s+(?:styling|design|influence)\\b`, "gi"),
      ""
    )
    .replace(
      new RegExp(`\\bworks\\s+well\\s+for\\s+${candidate}\\s+looks\\b`, "gi"),
      ""
    )
    .replace(
      new RegExp(`(?:,?\\s*creating\\s+(?:a|an)?\\s*${candidate}\\b(?:\\s+effect)?)`, "gi"),
      ""
    )
    .replace(
      new RegExp(`\\b${candidate}\\s+(?:and|with)\\s+([A-Z][A-Za-z /-]{2,40})\\b`, "g"),
      "$1"
    )
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\b(?:with|and|plus)\s*([,.;:])/gi, "$1")
    .replace(/^(?:with|and|plus)\s+/i, "")
    .trim();

  return repairedSentence;
}

function repairAwkwardExactCandidateBodySentences({
  line,
  exactSafeWordings,
}: {
  line: string;
  exactSafeWordings: string[];
}): string {
  if (!line.trim() || exactSafeWordings.length === 0) {
    return line;
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
  const sentenceLikeParts = line.trim().split(/(?<=[.!?])\s+/);
  const repairedParts = sentenceLikeParts.flatMap((sentence) => {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) return [];

    let repairedSentence = trimmedSentence;
    const originalHasUsefulEvidence = hasUsefulBodyEvidence(trimmedSentence);

    for (const safeWording of exactSafeWordings) {
      if (sentenceHasAwkwardExactCandidateUse(repairedSentence, safeWording)) {
        repairedSentence = repairAwkwardExactCandidateSentence(
          repairedSentence,
          safeWording
        );
      }
    }

    if (!repairedSentence.trim()) {
      return originalHasUsefulEvidence ? [trimmedSentence] : [];
    }

    if (
      exactSafeWordings.some((safeWording) =>
        sentenceHasAwkwardExactCandidateUse(repairedSentence, safeWording)
      )
    ) {
      return originalHasUsefulEvidence || hasUsefulBodyEvidence(repairedSentence)
        ? [trimmedSentence]
        : [];
    }

    return [repairedSentence];
  });

  if (repairedParts.join(" ") === sentenceLikeParts.map((sentence) => sentence.trim()).join(" ")) {
    return line;
  }

  if (repairedParts.length === 0) {
    return "";
  }

  return `${leadingWhitespace}${repairedParts.join(" ")}${trailingWhitespace}`;
}

function cleanupEmptyOptionalBodyLabels(lpuOutput: string): string {
  const cleanedLines: string[] = [];
  let currentPlatform = "";
  let isInsideBuyerFacingBodyBlock = false;
  let pendingOptionalLabel: string | null = null;
  let pendingBlankLines: string[] = [];

  function discardPendingOptionalLabel() {
    pendingOptionalLabel = null;
    pendingBlankLines = [];
  }

  function flushPendingOptionalLabel() {
    if (!pendingOptionalLabel) {
      return;
    }

    cleanedLines.push(pendingOptionalLabel, ...pendingBlankLines);
    discardPendingOptionalLabel();
  }

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      discardPendingOptionalLabel();
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      isInsideBuyerFacingBodyBlock = false;
      cleanedLines.push(line);
      continue;
    }

    const startsBuyerFacingBody = isBuyerFacingBodyStartLine(currentPlatform, line);
    if (startsBuyerFacingBody) {
      discardPendingOptionalLabel();
      isInsideBuyerFacingBodyBlock = true;
      cleanedLines.push(line);
      continue;
    }

    if (
      isInsideBuyerFacingBodyBlock &&
      line.trim() &&
      lineHasFinalOutputFieldLabel(line)
    ) {
      discardPendingOptionalLabel();
      isInsideBuyerFacingBodyBlock = false;
    }

    if (isInsideBuyerFacingBodyBlock && EMPTY_OPTIONAL_BODY_LABEL_PATTERN.test(line)) {
      discardPendingOptionalLabel();
      pendingOptionalLabel = line;
      continue;
    }

    if (pendingOptionalLabel && !line.trim()) {
      pendingBlankLines.push(line);
      continue;
    }

    if (pendingOptionalLabel) {
      flushPendingOptionalLabel();
    }

    cleanedLines.push(line);
  }

  discardPendingOptionalLabel();

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

type FinalFromBriefBodyIssue =
  | "empty_body"
  | "malformed_body_label"
  | "fragment_start"
  | "bullet_only_start"
  | "missing_identity_anchor"
  | "missing_evidence_anchor"
  | "grammar_defect"
  | "awkward_candidate_phrase"
  | "duplicate_measurement_body_copy"
  | "generic_filler"
  | "etsy_construction_first";

const FINAL_FROM_BRIEF_BODY_REPAIR_PLATFORMS = new Set([
  "EBAY",
  "DEPOP",
  "POSHMARK",
  "MERCARI",
  "ETSY",
]);

function appendSentencePunctuation(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  return /[.!?]$/.test(trimmedValue) ? trimmedValue : `${trimmedValue}.`;
}

function normalizeBodyAnchor(value: string): string {
  return value
    .replace(/\[[^\]]+\]/g, (match) => match.toLowerCase())
    .replace(/[^\p{L}\p{N}\[\]\s/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isUsefulFinalBodyAnchor(value: string): boolean {
  const normalizedValue = normalizeBodyAnchor(value);

  return (
    normalizedValue.length >= 3 &&
    !/^(?:not specified|not applicable|n\/a|unknown|see photos|not provided)$/i.test(
      normalizedValue
    )
  );
}

function bodyContainsAnchor(body: string, anchor: string): boolean {
  const normalizedBody = normalizeBodyAnchor(body);
  const normalizedAnchor = normalizeBodyAnchor(anchor);

  if (!isUsefulFinalBodyAnchor(normalizedAnchor)) {
    return false;
  }

  return normalizedBody.includes(normalizedAnchor);
}

function stripBodyListMarker(line: string): string {
  return line.replace(BODY_BULLET_LINE_PATTERN, "").trim();
}

function splitBodySentences(bodyText: string): string[] {
  return bodyText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => stripBodyListMarker(sentence).trim())
    .filter(Boolean);
}

function getFirstMeaningfulBodyLine(bodyLines: string[]): string {
  return bodyLines.find((line) => line.trim()) ?? "";
}

function getFirstMeaningfulBodySentence(bodyLines: string[]): string {
  const firstLine = stripBodyListMarker(getFirstMeaningfulBodyLine(bodyLines));
  return firstLine.split(/(?<=[.!?])\s+/)[0]?.trim() ?? firstLine.trim();
}

function extractInlineFinalBodyLabelValue(
  block: string[],
  label: string
): string {
  const labelPattern = new RegExp(
    `^\\s*${escapeRegExp(label)}\\s*:\\s*(.+?)\\s*$`,
    "i"
  );

  for (const line of block) {
    const match = line.match(labelPattern);
    if (match?.[1] && isUsefulFinalBodyAnchor(match[1])) {
      return match[1].trim();
    }
  }

  return "";
}

function extractFinalBodyFieldValues(
  block: string[],
  fieldNames: string[]
): string[] {
  const values: string[] = [];
  const fieldPattern = new RegExp(
    `^\\s*(?:[-*•]\\s*)?(?:${fieldNames
      .map(escapeRegExp)
      .join("|")})\\s*:\\s*(.+?)\\s*$`,
    "i"
  );

  for (const line of block) {
    const match = line.match(fieldPattern);
    if (match?.[1] && isUsefulFinalBodyAnchor(match[1])) {
      values.push(match[1].trim());
    }
  }

  return values;
}

function uniqueUsefulBodyAnchors(values: string[]): string[] {
  const seen = new Set<string>();
  const anchors: string[] = [];

  for (const value of values) {
    const normalizedValue = normalizeBodyAnchor(value);
    if (!isUsefulFinalBodyAnchor(value) || seen.has(normalizedValue)) {
      continue;
    }

    seen.add(normalizedValue);
    anchors.push(value.trim());
  }

  return anchors;
}

function getFinalBodyIdentityAnchors(platform: string, block: string[]): string[] {
  const identityValues: string[] = [];

  if (platform === "EBAY") {
    identityValues.push(
      ...extractFinalBodyFieldValues(block, ["Type", "Item type", "Item Type"]),
      extractInlineFinalBodyLabelValue(block, "Title A")
    );
  } else if (platform === "DEPOP") {
    identityValues.push(
      ...extractFinalBodyFieldValues(block, ["Type", "Item type", "Item Type"])
    );
  } else if (platform === "POSHMARK" || platform === "MERCARI") {
    identityValues.push(
      ...extractFinalBodyFieldValues(block, ["Type", "Item type", "Item Type"]),
      extractInlineFinalBodyLabelValue(block, "Title")
    );
  } else if (platform === "ETSY") {
    identityValues.push(
      ...extractFinalBodyFieldValues(block, ["Item type", "Item Type", "Type"]),
      extractInlineFinalBodyLabelValue(block, "Title")
    );
  }

  return uniqueUsefulBodyAnchors(identityValues);
}

function getFinalBodyEvidenceAnchors(block: string[]): string[] {
  return uniqueUsefulBodyAnchors(
    extractFinalBodyFieldValues(block, [
      "Brand",
      "Brand / Maker",
      "Brand/Maker",
      "Maker",
      "Designer",
      "Publisher",
      "Manufacturer",
      "Studio",
      "Color",
      "Material",
      "Materials",
      "Condition",
      "Features",
      "Feature",
      "Pattern",
      "Theme",
      "Subject",
      "Motif",
      "Closure",
      "Hardware",
      "Accents",
      "Finish",
      "Shape",
      "Component",
      "Components",
      "Included",
      "Included parts",
      "Model",
      "MPN",
      "Signed",
      "Attributes",
      "Attributes / Key Details",
    ])
  );
}

function getFinalBodyRangeForPlatformBlock(
  platform: string,
  block: string[]
): { startIndex: number; endIndex: number; label: string } | null {
  const bodyLabel = platformBodyLabelForMeasurementCleanup(platform);

  if (!bodyLabel) {
    return null;
  }

  const bodyLabelPattern = new RegExp(
    `^\\s*${escapeRegExp(bodyLabel)}\\s*:`,
    "i"
  );
  const startIndex = block.findIndex((line) => bodyLabelPattern.test(line));

  if (startIndex === -1) {
    return null;
  }

  let endIndex = block.length;
  for (let index = startIndex + 1; index < block.length; index += 1) {
    const line = block[index] ?? "";

    if (
      line.trim() &&
      lineHasFinalOutputFieldLabel(line) &&
      !bodyLabelPattern.test(line)
    ) {
      endIndex = index;
      break;
    }
  }

  return { startIndex, endIndex, label: bodyLabel };
}

function getBodyLinesFromRange(
  block: string[],
  bodyRange: { startIndex: number; endIndex: number; label: string }
): { labelPrefix: string; bodyLines: string[] } {
  const bodyLabelLine = block[bodyRange.startIndex] ?? "";
  const leadingBodyLabel = splitLeadingBuyerBodyLabel(bodyLabelLine);

  return {
    labelPrefix: `${bodyRange.label}:`,
    bodyLines: [
      leadingBodyLabel?.body ?? "",
      ...block.slice(bodyRange.startIndex + 1, bodyRange.endIndex),
    ],
  };
}

function bodyRangeHasInlineLabelBody(
  block: string[],
  bodyRange: { startIndex: number; label: string }
): boolean {
  const bodyLabelLine = block[bodyRange.startIndex] ?? "";
  const leadingBodyLabel = splitLeadingBuyerBodyLabel(bodyLabelLine);

  return Boolean(leadingBodyLabel?.body.trim());
}

function formatBuyerFacingBodyLabelLine(line: string): string[] {
  const match = line.match(/^(\s*(?:Description|Listing)\s*:\s*)(\S[\s\S]*)$/i);

  if (!match?.[2]) {
    return [line];
  }

  return [`${(match[1] ?? "").trimEnd()}`, match[2].trimStart()];
}

function formatBuyerFacingOptionalBodyLabelLine(line: string): string[] {
  const match = line.match(/^(\s*(?:Condition|Details)\s*:\s*)(\S[\s\S]*)$/i);

  if (!match?.[2]) {
    return [line];
  }

  return [`${(match[1] ?? "").trimEnd()}`, match[2].trimStart()];
}

function formatJoinedBuyerFacingBodyLabels(lpuOutput: string): string {
  const cleanedLines: string[] = [];
  let currentPlatform = "";
  let isInsideBuyerFacingBodyBlock = false;

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      isInsideBuyerFacingBodyBlock = false;
      cleanedLines.push(line);
      continue;
    }

    if (!FINAL_FROM_BRIEF_BODY_REPAIR_PLATFORMS.has(currentPlatform)) {
      cleanedLines.push(line);
      continue;
    }

    const startsBuyerFacingBody = isBuyerFacingBodyStartLine(currentPlatform, line);
    if (startsBuyerFacingBody) {
      isInsideBuyerFacingBodyBlock = true;
      cleanedLines.push(...formatBuyerFacingBodyLabelLine(line));
      continue;
    }

    if (
      isInsideBuyerFacingBodyBlock &&
      line.trim() &&
      lineHasFinalOutputFieldLabel(line)
    ) {
      if (/^\s*(?:Condition|Details)\s*:/i.test(line)) {
        cleanedLines.push(...formatBuyerFacingOptionalBodyLabelLine(line));
        continue;
      }

      isInsideBuyerFacingBodyBlock = false;
      cleanedLines.push(line);
      continue;
    }

    if (isInsideBuyerFacingBodyBlock) {
      cleanedLines.push(...formatBuyerFacingOptionalBodyLabelLine(line));
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function bodyHasIdentityAnchor(
  bodyText: string,
  firstSentence: string,
  identityAnchors: string[]
): boolean {
  if (identityAnchors.some((anchor) => bodyContainsAnchor(bodyText, anchor))) {
    return true;
  }

  return (
    identityAnchors.length === 0 &&
    Boolean(firstSentence) &&
    !BODY_FRAGMENT_START_PATTERN.test(firstSentence) &&
    !BODY_BULLET_LINE_PATTERN.test(firstSentence)
  );
}

function bodyHasEvidenceAnchor(
  bodyText: string,
  bodyLines: string[],
  evidenceAnchors: string[]
): boolean {
  return (
    evidenceAnchors.some((anchor) => bodyContainsAnchor(bodyText, anchor)) ||
    bodyLines.some((line) => hasUsefulBodyEvidence(stripBodyListMarker(line)))
  );
}

function bodyHasNonConditionEvidence(bodyText: string, bodyLines: string[]): boolean {
  const normalizedBodyText = bodyText.trim();

  if (!normalizedBodyText) {
    return false;
  }

  return bodyLines.some((line) => {
    const normalizedLine = stripBodyListMarker(line);
    return (
      hasUsefulBodyEvidence(normalizedLine) &&
      /\b(?:brand|maker|marked|signed|unbranded|type|color|pattern|motif|material|finish|tone|construction|constructed|closure|hardware|component|included|includes|feature|features|form|shape|texture|strap|handle|cord|label|tag|stamp|model|part|set|piece|attributes?)\b/i.test(
        normalizedLine
      )
    );
  });
}

function sentenceHasBodyGrammarDefect(sentence: string): boolean {
  const normalizedSentence = stripBodyListMarker(sentence)
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedSentence) {
    return false;
  }

  return [
    /\b(?:is|are)\s*[,.;:]?$/i,
    /(?:^|[.!?]\s*)and\s*\.?$/i,
    /,\s*and\s*\.?$/i,
    /\b(?:and\s+)?no\s+(?:visible\s+)?(?:maker|mark|brand|label|stamp|signature|manufacturer|designer)(?:\s+mark)?\s+is\s*\.?$/i,
    /\b(?:and\s+)?no\s+(?:visible\s+)?(?:component|components|part|parts|piece|pieces|accessory|accessories|hardware|closure|label|tag)\s+is\s*\.?$/i,
    /\bno\s+obvious\s+missing\s+(?:component|components|part|parts|piece|pieces|accessory|accessories|hardware|closure|label|tag|elements?)\s+are\b/i,
    /,\s*(?:and|with|plus|or|but)\s*\.?$/i,
    /\b(?:with|and|plus|or|but|featuring|features|includes?|has|is|are)\s*[,.;:]?$/i,
  ].some((pattern) => pattern.test(normalizedSentence));
}

function repairAwkwardUnbrandedBodyIdentitySentence(sentence: string): string {
  const weakIsUnbrandedMatch = sentence.trim().match(
    /^((?:[-*•]\s*)?(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?))\s+is\s+unbranded(?:[.!?])?(?:\s+(.*))?$/i
  );

  if (weakIsUnbrandedMatch) {
    const identity = (weakIsUnbrandedMatch[1] ?? "").trim();
    const remainder = (weakIsUnbrandedMatch[2] ?? "")
      .replace(/^(?:and|with)\s+/i, "")
      .trim();

    return remainder ? appendSentencePunctuation(`${identity} ${remainder}`) : "";
  }

  const awkwardOpeningMatch = sentence.trim().match(
    /^((?:[-*•]\s*)?(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?))\s+(?:with|by|from)\s+Unbranded(?:[.!?])?(?:\s+(.*))?$/i
  );

  if (!awkwardOpeningMatch) {
    return sentence;
  }

  const identity = (awkwardOpeningMatch[1] ?? "").trim();
  const remainder = (awkwardOpeningMatch[2] ?? "")
    .replace(/^(?:and|with)\s+/i, "")
    .trim();

  if (!remainder) {
    return "";
  }

  return appendSentencePunctuation(`${identity} with ${remainder}`);
}

function repairAwkwardUnbrandedBodyIdentity(line: string): string {
  if (!line.trim() || !/\bUnbranded\b/i.test(line)) {
    return line;
  }

  const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = line.match(/\s*$/)?.[0] ?? "";
  const sentenceLikeParts = line.trim().split(/(?<=[.!?])\s+/);
  const repairedParts = sentenceLikeParts.map((sentence) =>
    repairAwkwardUnbrandedBodyIdentitySentence(sentence)
  );

  return `${leadingWhitespace}${repairedParts.join(" ")}${trailingWhitespace}`;
}

function repairWeakGeneratedBodyOpening(line: string): string {
  if (!line.trim()) {
    return line;
  }

  return line
    .replace(
      /^(\s*(?:[-*•]\s*)?(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?))\s+with\s+detailing\s+in\s+/i,
      "$1 in "
    )
    .replace(
      /^(\s*(?:[-*•]\s*)?(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?))\s+with\s+visual\s+detail\b/i,
      "$1"
    )
    .replace(
      /^(\s*(?:[-*•]\s*)?(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?))\s+with\s+design\b/i,
      "$1"
    )
    .replace(
      /\b(?:\[[^\]]+\]|[A-Za-z][A-Za-z0-9'’ /-]{1,80}?)\s+with\s+detailing\s+(?=\[[^\]]+\]|[A-Za-z])/gi,
      ""
    )
    .replace(
      /\bwith\s+(?:detailing(?:\s+detail)?|detail\s+detail|design\s+detail|visual\s+detail|style\s+detail|look\s+detail|detailing)\b/gi,
      ""
    )
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function bodyHasGrammarDefect(bodyLines: string[]): boolean {
  return splitBodySentences(bodyLines.join("\n")).some((sentence) =>
    sentenceHasBodyGrammarDefect(sentence) ||
    VAGUE_BODY_FALLBACK_PATTERN.test(sentence) ||
    WEAK_UNBRANDED_BODY_OPENING_PATTERN.test(sentence)
  );
}

function getFinalFromBriefBodyIssues({
  platform,
  bodyLines,
  identityAnchors,
  evidenceAnchors,
  exactSafeWordings,
  hasConcreteMeasurements,
  hasMalformedBodyLabel = false,
}: {
  platform: string;
  bodyLines: string[];
  identityAnchors: string[];
  evidenceAnchors: string[];
  exactSafeWordings: string[];
  hasConcreteMeasurements: boolean;
  hasMalformedBodyLabel?: boolean;
}): FinalFromBriefBodyIssue[] {
  const issues = new Set<FinalFromBriefBodyIssue>();
  const bodyText = bodyLines.join("\n").trim();
  const firstLine = getFirstMeaningfulBodyLine(bodyLines);
  const firstSentence = getFirstMeaningfulBodySentence(bodyLines);

  if (!bodyText) {
    issues.add("empty_body");
  }

  if (hasMalformedBodyLabel) {
    issues.add("malformed_body_label");
  }

  if (firstLine && BODY_BULLET_LINE_PATTERN.test(firstLine)) {
    issues.add("bullet_only_start");
  }

  if (firstLine && /^\s*(?:Description|Listing)\s*:\s*\S/i.test(firstLine)) {
    issues.add("malformed_body_label");
  }

  if (firstSentence && BODY_FRAGMENT_START_PATTERN.test(firstSentence)) {
    issues.add("fragment_start");
  }

  if (bodyHasGrammarDefect(bodyLines)) {
    issues.add("grammar_defect");
  }

  if (
    platform === "ETSY" &&
    firstSentence &&
    ETSY_CONSTRUCTION_FIRST_START_PATTERN.test(firstSentence) &&
    !identityAnchors.some((anchor) => bodyContainsAnchor(firstSentence, anchor))
  ) {
    issues.add("etsy_construction_first");
  }

  if (!bodyHasIdentityAnchor(bodyText, firstSentence, identityAnchors)) {
    issues.add("missing_identity_anchor");
  }

  if (!bodyHasEvidenceAnchor(bodyText, bodyLines, evidenceAnchors)) {
    issues.add("missing_evidence_anchor");
  }

  if (
    exactSafeWordings.some((safeWording) =>
      bodyText
        .split(/(?<=[.!?])\s+|\n+/)
        .some((sentence) => sentenceHasAwkwardExactCandidateUse(sentence, safeWording))
    )
  ) {
    issues.add("awkward_candidate_phrase");
  }

  if (
    hasConcreteMeasurements &&
    bodyLines.some(
      (line) =>
        DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(line) ||
        MEASUREMENT_REFERENCE_PHRASE_PATTERN.test(line) ||
        BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN.test(line)
    )
  ) {
    issues.add("duplicate_measurement_body_copy");
  }

  if (bodyLines.some((line) => WEAK_GENERIC_BODY_COPY_PATTERN.test(line))) {
    issues.add("generic_filler");
  }

  if (
    platform === "ETSY" &&
    bodyText &&
    !bodyHasNonConditionEvidence(bodyText, bodyLines)
  ) {
    issues.add("missing_evidence_anchor");
  }

  return Array.from(issues);
}

function buildFinalBodyOpeningSentence({
  platform,
  identityAnchors,
  evidenceAnchors,
}: {
  platform: string;
  identityAnchors: string[];
  evidenceAnchors: string[];
}): string {
  const identity = identityAnchors[0]?.trim() ?? "";
  const concreteEvidence = evidenceAnchors.find(
    (anchor) => !/^unbranded$/i.test(anchor.trim()) && !bodyContainsAnchor(identity, anchor)
  );
  const evidence = concreteEvidence;

  if (!identity) {
    return "";
  }

  const baseSentence =
    evidence && !bodyContainsAnchor(identity, evidence)
      ? `${identity} with ${evidence}`
      : identity;

  if (platform === "DEPOP") {
    return appendSentencePunctuation(baseSentence);
  }

  return appendSentencePunctuation(baseSentence);
}

function cleanFinalBodyLinesForRepair({
  bodyLines,
  exactSafeWordings,
  hasConcreteMeasurements,
}: {
  bodyLines: string[];
  exactSafeWordings: string[];
  hasConcreteMeasurements: boolean;
}): string[] {
  const cleanedLines: string[] = [];

  for (const line of bodyLines) {
    let repairedLine = line;

    if (
      hasConcreteMeasurements &&
      (DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(repairedLine) ||
        MEASUREMENT_REFERENCE_PHRASE_PATTERN.test(repairedLine) ||
        BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN.test(repairedLine))
    ) {
      repairedLine = removeDuplicateMeasurementReferenceCopy(repairedLine);
    }

    repairedLine = repairAwkwardExactCandidateBodySentences({
      line: repairedLine,
      exactSafeWordings,
    });
    repairedLine = repairAwkwardUnbrandedBodyIdentity(repairedLine);
    repairedLine = repairWeakGeneratedBodyOpening(repairedLine);

    repairedLine = repairSentenceLevelBodyCopyIssues({
      line: repairedLine,
      shouldRemoveFunctionalityCaveats: true,
      shouldRemoveEtsyMediaAdvice: true,
    });
    repairedLine = repairBodyGrammarDefects(repairedLine);

    if (!repairedLine.trim()) {
      continue;
    }

    cleanedLines.push(repairedLine);
  }

  return cleanedLines;
}

function rebuildFinalBodySectionLines({
  labelPrefix,
  openingSentence,
  existingLines,
  identityAnchors,
}: {
  labelPrefix: string;
  openingSentence: string;
  existingLines: string[];
  identityAnchors: string[];
}): string[] {
  const repairedLines = existingLines.filter((line) => line.trim());
  const firstLine = getFirstMeaningfulBodyLine(repairedLines);
  const firstSentence = getFirstMeaningfulBodySentence(repairedLines);
  const firstLineIsValidOpening =
    firstLine &&
    !BODY_BULLET_LINE_PATTERN.test(firstLine) &&
    !BODY_FRAGMENT_START_PATTERN.test(firstSentence) &&
    identityAnchors.some((anchor) => bodyContainsAnchor(firstSentence, anchor));

  const shouldPrependOpening =
    openingSentence &&
    (!firstLineIsValidOpening ||
      !identityAnchors.some((anchor) =>
        bodyContainsAnchor(repairedLines.join("\n"), anchor)
      ));

  const bodyLines = shouldPrependOpening
    ? [
        openingSentence,
        ...repairedLines.filter(
          (line) => normalizeBodyAnchor(stripBodyListMarker(line)) !== normalizeBodyAnchor(openingSentence)
        ),
      ]
    : repairedLines;

  if (bodyLines.length === 0 && openingSentence) {
    bodyLines.push(openingSentence);
  }

  const [firstBodyLine = "", ...remainingBodyLines] = bodyLines;

  return [
    labelPrefix,
    firstBodyLine.trimStart(),
    ...remainingBodyLines,
  ];
}

function repairFinalFromBriefBodySections({
  lpuOutput,
  sellingBrief,
}: {
  lpuOutput: string;
  sellingBrief: string;
}): string {
  const exactSafeWordings = getExactConfirmedStyleCandidateSafeWordings(sellingBrief);
  const platformsWithApproximateMeasurements =
    getPlatformsWithApproximateMeasurements(lpuOutput);
  const rebuiltLines: string[] = [];
  let currentPlatform = "";
  let currentBlock: string[] = [];

  function flushCurrentBlock() {
    if (!currentPlatform) {
      rebuiltLines.push(...currentBlock);
      currentBlock = [];
      return;
    }

    if (!FINAL_FROM_BRIEF_BODY_REPAIR_PLATFORMS.has(currentPlatform)) {
      rebuiltLines.push(...currentBlock);
      currentBlock = [];
      return;
    }

    const bodyRange = getFinalBodyRangeForPlatformBlock(
      currentPlatform,
      currentBlock
    );

    if (!bodyRange) {
      rebuiltLines.push(...currentBlock);
      currentBlock = [];
      return;
    }

    const { labelPrefix, bodyLines } = getBodyLinesFromRange(
      currentBlock,
      bodyRange
    );
    const identityAnchors = getFinalBodyIdentityAnchors(
      currentPlatform,
      currentBlock
    );
    const evidenceAnchors = getFinalBodyEvidenceAnchors(currentBlock);
    const hasConcreteMeasurements =
      platformsWithApproximateMeasurements.has(currentPlatform);
    const issues = getFinalFromBriefBodyIssues({
      platform: currentPlatform,
      bodyLines,
      identityAnchors,
      evidenceAnchors,
      exactSafeWordings,
      hasConcreteMeasurements,
      hasMalformedBodyLabel: bodyRangeHasInlineLabelBody(currentBlock, bodyRange),
    });

    if (issues.length === 0) {
      rebuiltLines.push(...currentBlock);
      currentBlock = [];
      return;
    }

    const cleanedBodyLines = cleanFinalBodyLinesForRepair({
      bodyLines,
      exactSafeWordings,
      hasConcreteMeasurements,
    });
    const openingSentence = buildFinalBodyOpeningSentence({
      platform: currentPlatform,
      identityAnchors,
      evidenceAnchors,
    });
    const repairedBodySectionLines = rebuildFinalBodySectionLines({
      labelPrefix,
      openingSentence,
      existingLines: cleanedBodyLines,
      identityAnchors,
    });

    rebuiltLines.push(
      ...currentBlock.slice(0, bodyRange.startIndex),
      ...repairedBodySectionLines,
      ...currentBlock.slice(bodyRange.endIndex)
    );
    currentBlock = [];
  }

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      flushCurrentBlock();
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      rebuiltLines.push(line);
      continue;
    }

    currentBlock.push(line);
  }

  flushCurrentBlock();

  return rebuiltLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

type FinalFromBriefBodyIssueReport = {
  platform: string;
  label: string;
  issues: FinalFromBriefBodyIssue[];
};

function getFinalFromBriefBodyIssueReports({
  lpuOutput,
  sellingBrief,
}: {
  lpuOutput: string;
  sellingBrief: string;
}): FinalFromBriefBodyIssueReport[] {
  const exactSafeWordings = getExactConfirmedStyleCandidateSafeWordings(sellingBrief);
  const platformsWithApproximateMeasurements =
    getPlatformsWithApproximateMeasurements(lpuOutput);
  const reports: FinalFromBriefBodyIssueReport[] = [];
  let currentPlatform = "";
  let currentBlock: string[] = [];

  function flushCurrentBlock() {
    if (
      !currentPlatform ||
      !FINAL_FROM_BRIEF_BODY_REPAIR_PLATFORMS.has(currentPlatform)
    ) {
      currentBlock = [];
      return;
    }

    const bodyRange = getFinalBodyRangeForPlatformBlock(
      currentPlatform,
      currentBlock
    );

    if (!bodyRange) {
      currentBlock = [];
      return;
    }

    const { bodyLines } = getBodyLinesFromRange(currentBlock, bodyRange);
    const issues = getFinalFromBriefBodyIssues({
      platform: currentPlatform,
      bodyLines,
      identityAnchors: getFinalBodyIdentityAnchors(currentPlatform, currentBlock),
      evidenceAnchors: getFinalBodyEvidenceAnchors(currentBlock),
      exactSafeWordings,
      hasConcreteMeasurements:
        platformsWithApproximateMeasurements.has(currentPlatform),
      hasMalformedBodyLabel: bodyRangeHasInlineLabelBody(currentBlock, bodyRange),
    });

    if (issues.length > 0) {
      reports.push({
        platform: currentPlatform,
        label: bodyRange.label,
        issues,
      });
    }

    currentBlock = [];
  }

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      flushCurrentBlock();
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      continue;
    }

    currentBlock.push(line);
  }

  flushCurrentBlock();

  return reports;
}

function buildFinalFromBriefBodyOnlyRepairInstruction({
  lpuOutput,
  sellingBrief,
  reports,
}: {
  lpuOutput: string;
  sellingBrief: string;
  reports: FinalFromBriefBodyIssueReport[];
}): string {
  const defectList = reports
    .map(
      (report) =>
        `- ${report.platform} ${report.label}: ${report.issues.join(", ")}`
    )
    .join("\n");

  return `Repair only the failing buyer-facing body sections in this V2 final LP-U output.

This is a narrow body-only finalFromBrief repair.
Use only the Universal Selling Brief and current LP-U output below.

Defects to repair:
${defectList}

Rules:
- Change only the listed platform body sections: eBay Description, Depop Listing, Poshmark Description, Mercari Description, or Etsy Description.
- Do not change titles, tags, hashtags, item specifics, attributes, Poshmark Search keywords line, Style Tags, Compact 3-Tag Strategy, Approximate Measurements blocks, footer text, platform labels, platform order, or any unrelated body section.
- Each repaired body must identify the item type or item identity and include at least one evidence anchor from the brief or current LP-U output.
- If a defect includes grammar_defect, repair dangling sentence fragments such as bare is/are, trailing and, no maker/mark/brand is, no obvious missing component are, or connector-only endings without changing unrelated fields.
- eBay Description: produce one concise proof-driven item identity sentence plus bullets if bullets already exist.
- Depop Listing: produce a short complete item identity/search hook plus concise condition/detail line.
- Poshmark Description: preserve readable paragraph/bullets and preserve the Search keywords line outside the body.
- Mercari Description: produce concise item identity plus condition/details.
- Etsy Description: produce natural buyer-facing item identity opening plus evidence/condition paragraph.
- Do not add generic filler.
- Do not force exact Candidate Terms awkwardly into body sentences; use natural evidence wording when exact wording sounds awkward.
- If an awkward Candidate Term sentence contains useful evidence, preserve the useful evidence in natural buyer-facing wording instead of deleting the sentence.
- Do not add duplicate numeric measurement body text when Approximate Measurements exists.
- Return the full corrected LP-U output only.
- Do not add commentary.

Universal Selling Brief:
${sellingBrief}

Current LP-U output:
${lpuOutput}`;
}

async function repairFinalFromBriefBodySectionsWithAiIfNeeded({
  lpuOutput,
  sellingBrief,
  backgroundContext,
  phase,
}: {
  lpuOutput: string;
  sellingBrief: string;
  backgroundContext?: BackgroundGenerationContext;
  phase: "body_repair_primary" | "body_repair_secondary";
}): Promise<string> {
  const reports = getFinalFromBriefBodyIssueReports({ lpuOutput, sellingBrief });

  if (reports.length === 0) {
    return lpuOutput;
  }

  const response = await createGenerationResponse(phase, {
    model: getLpuOpenAIGenerationModel(),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildFinalFromBriefBodyOnlyRepairInstruction({
              lpuOutput,
              sellingBrief,
              reports,
            }),
          },
        ],
      },
    ],
  }, backgroundContext);

  const repairedOutput = response.output_text ?? "";

  return repairedOutput.trim() ? repairedOutput : lpuOutput;
}

const PLATFORM_SECTION_ORDER: Record<string, string[]> = {
  EBAY: [
    "Title A",
    "Title B",
    "Category",
    "Item Specifics",
    "Description",
    "Approximate Measurements",
  ],
  DEPOP: [
    "Aesthetic Mode",
    "Attributes",
    "Listing",
    "Hashtags",
    "Optional Brand Hashtags",
    "Approximate Measurements",
  ],
  POSHMARK: [
    "Title",
    "Description",
    "Style Tags",
    "Compact 3-Tag Strategy (Alt Option)",
    "Approximate Measurements",
  ],
  MERCARI: ["Title", "Description", "Hashtags", "Approximate Measurements"],
  ETSY: [
    "Title",
    "Category",
    "Materials",
    "Attributes / Key Details",
    "Tags",
    "Description",
    "Approximate Measurements",
  ],
};

function buildPlatformSectionLabelPattern(labels: string[]): RegExp {
  return new RegExp(
    `^\\s*(${labels.map(escapeRegExp).join("|")})\\s*:`,
    "i"
  );
}

function normalizePlatformSectionLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

function preservePlatformSectionOrderForBlock(
  platform: string,
  block: string[]
): string[] {
  const expectedLabels = PLATFORM_SECTION_ORDER[platform];

  if (!expectedLabels) {
    return block;
  }

  const labelPattern = buildPlatformSectionLabelPattern(expectedLabels);
  const prefixLines: string[] = [];
  const sections: Array<{ label: string; lines: string[]; index: number }> = [];
  let currentSection: { label: string; lines: string[]; index: number } | null = null;

  for (const line of block) {
    const labelMatch = line.match(labelPattern);

    if (labelMatch?.[1]) {
      currentSection = {
        label: labelMatch[1],
        lines: [line],
        index: sections.length,
      };
      sections.push(currentSection);
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      prefixLines.push(line);
    }
  }

  if (sections.length <= 1) {
    return block;
  }

  const originalLabelOrder = sections.map((section) =>
    normalizePlatformSectionLabel(section.label)
  );
  const sortedLabelOrder = [...sections]
    .sort((first, second) => {
      const firstIndex = expectedLabels.findIndex(
        (label) =>
          normalizePlatformSectionLabel(label) ===
          normalizePlatformSectionLabel(first.label)
      );
      const secondIndex = expectedLabels.findIndex(
        (label) =>
          normalizePlatformSectionLabel(label) ===
          normalizePlatformSectionLabel(second.label)
      );

      return firstIndex === secondIndex
        ? first.index - second.index
        : firstIndex - secondIndex;
    })
    .map((section) => normalizePlatformSectionLabel(section.label));

  if (originalLabelOrder.join("\u0000") === sortedLabelOrder.join("\u0000")) {
    return block;
  }

  const sectionsByLabel = new Map<string, Array<{ label: string; lines: string[]; index: number }>>();
  for (const section of sections) {
    const key = normalizePlatformSectionLabel(section.label);
    sectionsByLabel.set(key, [...(sectionsByLabel.get(key) ?? []), section]);
  }

  const reorderedLines = [...prefixLines];
  for (const label of expectedLabels) {
    const key = normalizePlatformSectionLabel(label);
    const matchingSections = sectionsByLabel.get(key) ?? [];
    for (const section of matchingSections) {
      reorderedLines.push(...section.lines);
    }
    sectionsByLabel.delete(key);
  }

  const remainingSections = Array.from(sectionsByLabel.values())
    .flat()
    .sort((first, second) => first.index - second.index);
  for (const section of remainingSections) {
    reorderedLines.push(...section.lines);
  }

  return reorderedLines;
}

function preserveFinalFromBriefPlatformSectionOrder(lpuOutput: string): string {
  const rebuiltLines: string[] = [];
  let currentPlatform = "";
  let currentBlock: string[] = [];

  function flushCurrentBlock() {
    if (!currentPlatform) {
      rebuiltLines.push(...currentBlock);
      currentBlock = [];
      return;
    }

    rebuiltLines.push(
      ...preservePlatformSectionOrderForBlock(currentPlatform, currentBlock)
    );
    currentBlock = [];
  }

  for (const line of lpuOutput.split("\n")) {
    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

    if (platformHeadingMatch?.[1]) {
      flushCurrentBlock();
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      rebuiltLines.push(line);
      continue;
    }

    currentBlock.push(line);
  }

  flushCurrentBlock();

  return rebuiltLines.join("\n").replace(/\n{3,}/g, "\n\n");
}

function repairFinalFromBriefExactCandidateSuffixes({
  lpuOutput,
  sellingBrief,
  sellerInput,
}: {
  lpuOutput: string;
  sellingBrief: string;
  sellerInput: string;
}): string {
  const exactSafeWordings = getExactConfirmedStyleCandidateSafeWordings(sellingBrief);

  if (!lpuOutput.trim()) {
    return lpuOutput;
  }

  const platformsWithApproximateMeasurements =
    getPlatformsWithApproximateMeasurements(lpuOutput);
  let isInsideDepopAestheticModeBlock = false;
  let currentPlatform = "";
  let isInsideBuyerFacingBodyBlock = false;
  const shouldRemoveFunctionalityCaveats =
    !hasSellerProvidedFunctionalityCaveat(sellerInput);

  const repairedOutput = lpuOutput
    .split("\n")
    .map((line) => {
      if (lineHasUnsupportedBrandFallback(line)) {
        return repairUnsupportedBrandFallback(line);
      }

      line = repairUnsupportedSeePhotosFieldFallback(line);

      const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);

      if (platformHeadingMatch?.[1]) {
        currentPlatform = platformHeadingMatch[1].toUpperCase();
        isInsideBuyerFacingBodyBlock = false;
      }

      const startsBuyerFacingBody = isBuyerFacingBodyStartLine(currentPlatform, line);
      if (startsBuyerFacingBody) {
        isInsideBuyerFacingBodyBlock = true;
      } else if (
        isInsideBuyerFacingBodyBlock &&
        line.trim() &&
        lineHasFinalOutputFieldLabel(line)
      ) {
        isInsideBuyerFacingBodyBlock = false;
      }

      const isAestheticModeLabel =
        /^\s*(?:Depop Aesthetic Mode|Aesthetic Mode)\s*:/i.test(line);
      const isAestheticModeValueLine =
        isInsideDepopAestheticModeBlock && /^\s*(?:Primary|Secondary)\s*:/i.test(line);

      if (isAestheticModeLabel) {
        isInsideDepopAestheticModeBlock = true;
      } else if (
        isInsideDepopAestheticModeBlock &&
        line.trim() &&
        !isAestheticModeValueLine
      ) {
        isInsideDepopAestheticModeBlock = false;
      }

      if (shouldSkipExactCandidateSuffixRepairLine(line) || isAestheticModeValueLine) {
        return line;
      }

      let repairedLine = line;

      repairedLine = repairProvidedImagesLanguage(repairedLine);

      for (const safeWording of exactSafeWordings) {
        const articleCandidateSuffixPattern = new RegExp(
          `\\b(?:a|an)\\s+(${escapeRegExp(safeWording)})(?:\\s+(?:style|look|inspired|design|styling|visual\\s+style|aesthetic|motif|influence)|-inspired)\\b`,
          "gi"
        );
        const suffixPattern = new RegExp(
          `(^|[^A-Za-z0-9])(${escapeRegExp(safeWording)})(?:\\s+(?:style|look|inspired|design|styling|visual\\s+style|aesthetic|motif|influence)|-inspired)\\b`,
          "gi"
        );
        const articleCandidatePattern = new RegExp(
          `\\b(?:a|an)\\s+(${escapeRegExp(safeWording)})\\b`,
          "gi"
        );
        const featuresCandidateWithPattern = new RegExp(
          `(\\bfeatures\\s+)${escapeRegExp(safeWording)}\\s+with\\s+`,
          "gi"
        );
        const candidateWithPattern = new RegExp(
          `(^|[.!?]\\s+)${escapeRegExp(safeWording)}\\s+with\\s+`,
          "gi"
        );
        const creatingCandidatePattern = new RegExp(
          `(?:,?\\s*creating\\s+(?:a|an)\\s+${escapeRegExp(safeWording)}\\b)`,
          "gi"
        );

        repairedLine = repairedLine.replace(
          articleCandidateSuffixPattern,
          (_match, candidate: string) => candidate
        );
        repairedLine = repairedLine.replace(
          suffixPattern,
          (_match, prefix: string) => `${prefix}${safeWording}`
        );
        repairedLine = repairedLine.replace(
          articleCandidatePattern,
          (_match, candidate: string) => candidate
        );

        if (!isInsideBuyerFacingBodyBlock) {
          repairedLine = repairedLine.replace(
            featuresCandidateWithPattern,
            (_match, prefix: string) => prefix
          );
          repairedLine = repairedLine.replace(
            candidateWithPattern,
            (_match, prefix: string) => prefix
          );
          repairedLine = repairedLine.replace(creatingCandidatePattern, "");
        }
      }

      const leadingBodyLabelBeforeSkip = splitLeadingBuyerBodyLabel(repairedLine);

      if (
        shouldSkipSentenceLevelBodyCopyRepairLine(repairedLine) &&
        !leadingBodyLabelBeforeSkip
      ) {
        return repairedLine;
      }

      if (!isInsideBuyerFacingBodyBlock) {
        return repairedLine;
      }

      if (
        platformsWithApproximateMeasurements.has(currentPlatform) &&
        (DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(repairedLine) ||
          MEASUREMENT_REFERENCE_PHRASE_PATTERN.test(repairedLine) ||
          BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN.test(repairedLine))
      ) {
        repairedLine = removeDuplicateMeasurementReferenceCopy(repairedLine);
        if (!repairedLine.trim()) {
          return "";
        }
      }

      if (
        INTERNAL_SOURCE_LANGUAGE_PATTERN.test(repairedLine) ||
        /\bvisible\b/i.test(repairedLine)
      ) {
        repairedLine = repairInternalSourceLanguage(repairedLine);
      }

      repairedLine = repairBuyerFacingUncertaintyLanguage(repairedLine);

      if (
        platformsWithApproximateMeasurements.has(currentPlatform) &&
        (DUPLICATE_MEASUREMENT_REFERENCE_LINE_PATTERN.test(repairedLine) ||
          MEASUREMENT_REFERENCE_PHRASE_PATTERN.test(repairedLine) ||
          BODY_DUPLICATE_MEASUREMENT_REFERENCE_PATTERN.test(repairedLine))
      ) {
        repairedLine = removeDuplicateMeasurementReferenceCopy(repairedLine);
        if (!repairedLine.trim()) {
          return "";
        }
      }

      const leadingBodyLabel = splitLeadingBuyerBodyLabel(repairedLine);

      if (lineHasFinalOutputFieldLabel(repairedLine) && !leadingBodyLabel) {
        return repairedLine;
      }

      const lineToRepair = leadingBodyLabel?.body ?? repairedLine;
      const candidateRepairedBodyCopy = repairAwkwardExactCandidateBodySentences({
        line: lineToRepair,
        exactSafeWordings,
      });
      const unbrandedRepairedBodyCopy =
        repairAwkwardUnbrandedBodyIdentity(candidateRepairedBodyCopy);
      const weakOpeningRepairedBodyCopy = repairWeakGeneratedBodyOpening(
        unbrandedRepairedBodyCopy
      );
      const repairedBodyCopy = repairSentenceLevelBodyCopyIssues({
        line: weakOpeningRepairedBodyCopy,
        shouldRemoveFunctionalityCaveats,
        shouldRemoveEtsyMediaAdvice: currentPlatform === "ETSY",
      });
      const grammarRepairedBodyCopy = repairBodyGrammarDefects(repairedBodyCopy);

      if (!leadingBodyLabel) {
        return grammarRepairedBodyCopy;
      }

      return `${leadingBodyLabel.label}${grammarRepairedBodyCopy.trimStart()}`;
    })
    .join("\n");

  const cleanedOutput = preserveFinalFromBriefPlatformSectionOrder(
    cleanupEmptyOptionalBodyLabels(
      cleanupDuplicateMeasurementsFromFinalFromBriefBodies(repairedOutput)
    )
  );
  const bodyRepairedOutput = repairFinalFromBriefBodySections({
    lpuOutput: cleanedOutput,
    sellingBrief,
  });

  return formatJoinedBuyerFacingBodyLabels(
    preserveFinalFromBriefPlatformSectionOrder(
      cleanupEmptyOptionalBodyLabels(
        cleanupDuplicateMeasurementsFromFinalFromBriefBodies(bodyRepairedOutput)
      )
    )
  );
}

function cleanupFinalFromBriefHardSafetyAfterBodyRepair({
  lpuOutput,
  sellerInput,
}: {
  lpuOutput: string;
  sellerInput: string;
}): string {
  const shouldRemoveFunctionalityCaveats =
    !hasSellerProvidedFunctionalityCaveat(sellerInput);
  const cleanedLines: string[] = [];
  let currentPlatform = "";
  let isInsideBuyerFacingBodyBlock = false;

  for (const originalLine of lpuOutput.split("\n")) {
    let line = originalLine;

    if (lineHasUnsupportedBrandFallback(line)) {
      line = repairUnsupportedBrandFallback(line);
    }

    line = repairUnsupportedSeePhotosFieldFallback(line);

    const platformHeadingMatch = line.match(PLATFORM_HEADING_PATTERN);
    if (platformHeadingMatch?.[1]) {
      currentPlatform = platformHeadingMatch[1].toUpperCase();
      isInsideBuyerFacingBodyBlock = false;
      cleanedLines.push(line);
      continue;
    }

    const startsBuyerFacingBody = isBuyerFacingBodyStartLine(currentPlatform, line);
    if (startsBuyerFacingBody) {
      isInsideBuyerFacingBodyBlock = true;
    } else if (
      isInsideBuyerFacingBodyBlock &&
      line.trim() &&
      lineHasFinalOutputFieldLabel(line)
    ) {
      isInsideBuyerFacingBodyBlock = false;
    }

    line = repairProvidedImagesLanguage(line);

    if (!isInsideBuyerFacingBodyBlock) {
      cleanedLines.push(line);
      continue;
    }

    if (
      INTERNAL_SOURCE_LANGUAGE_PATTERN.test(line) ||
      /\bvisible\b/i.test(line)
    ) {
      line = repairInternalSourceLanguage(line);
    }

    line = repairBuyerFacingUncertaintyLanguage(line);

    const leadingBodyLabel = splitLeadingBuyerBodyLabel(line);
    const bodyCopy = leadingBodyLabel?.body ?? line;
    const unbrandedRepairedBodyCopy = repairAwkwardUnbrandedBodyIdentity(bodyCopy);
    const weakOpeningRepairedBodyCopy = repairWeakGeneratedBodyOpening(
      unbrandedRepairedBodyCopy
    );
    const sentenceCleanedBodyCopy = repairSentenceLevelBodyCopyIssues({
      line: weakOpeningRepairedBodyCopy,
      shouldRemoveFunctionalityCaveats,
      shouldRemoveEtsyMediaAdvice: currentPlatform === "ETSY",
    });
    const grammarRepairedBodyCopy = repairBodyGrammarDefects(sentenceCleanedBodyCopy);

    cleanedLines.push(
      leadingBodyLabel
        ? `${leadingBodyLabel.label}${grammarRepairedBodyCopy.trimStart()}`
        : grammarRepairedBodyCopy
    );
  }

  return formatJoinedBuyerFacingBodyLabels(
    preserveFinalFromBriefPlatformSectionOrder(
      cleanupEmptyOptionalBodyLabels(
        cleanupDuplicateMeasurementsFromFinalFromBriefBodies(cleanedLines.join("\n"))
      )
    )
  );
}

function buildFinalFromBriefTargetedRepairInstruction({
  lpuOutput,
  sellingBrief,
}: {
  lpuOutput: string;
  sellingBrief: string;
}): string {
  return `Repair targeted Selling Brief enforcement issues in this V2 final LP-U output.

This is a narrow V2-only finalFromBrief repair pass.
Use only the Universal Selling Brief and current LP-U output below.
Do not use external research, brand history, category-specific assumptions, test-item examples, or any source outside these inputs.
Repair only these targeted issues and the directly affected surrounding words needed for readable grammar:
- Etsy Title strategy
- Depop Aesthetic Mode when a style-led brief incorrectly used Not applicable
- Unbranded brand fallback
- measurement-reference photo extraction into Approximate Measurements blocks and duplicate size/ruler body lines
- Etsy Tags rules
- Poshmark Description Search keywords line
- internal source language in buyer-facing body copy
- internal, negative, or overly defensive buyer-facing uncertainty phrases
- Etsy Description seller-facing photo/video advice
- rejected STYLE / THEME / AESTHETIC CANDIDATE BANK terms
- phrases from Generic Phrases to Avoid
- exact Confirmed style/theme/aesthetic Safe Wording
- Primary Style / Theme / Aesthetic Candidate placement
- weak generic marketplace body copy
- awkward Confirmed candidate term sentence fragments
- missing or invalid body opening sentences
- Etsy Description quality

Review the full final LP-U output, including:
- eBay Title B
- eBay Item Specifics
- eBay Description
- Depop Listing
- Depop hashtags
- Poshmark Title
- Poshmark Description
- Poshmark Search keywords line
- Etsy Title
- Etsy Tags
- Etsy Attributes / Key Details
- Etsy Description
- Mercari Description if present
- photo/video suggestions if present
- any other generated text where a Confirmed style/theme/aesthetic candidate appears

Buyer-facing body copy source-language repair:
- In eBay Description, Depop Listing, Poshmark Description, Mercari Description, and Etsy Description, remove seller/internal source language and rewrite it as direct buyer-facing item facts.
- Remove or rewrite these phrases in buyer-facing descriptions only: seller-confirmed, seller confirmed, seller-provided, seller provided, seller states, seller stated, per seller, seller note, seller notes, photo evidence, visible in photos, visible, photo-derived, evidence source, Known Details, provided by seller.
- Do not remove factual content. Rewrite source-framed wording into plain listing copy, such as vintage, marked/signed, light surface wear, light patina, condition wear, supported construction, supported components, or direct item detail when supported by the Selling Brief.
- Do not invent all-parts-present or all-stones-present claims. Use all stones present, all parts present, or complete only when the seller explicitly stated that fact. When photos support a softer condition observation but the seller did not state completeness, use stones appear present in provided images, no obvious missing stones shown, or no obvious missing components shown.
- Do not apply this cleanup to the Universal Selling Brief, required platform labels, item-specific field labels, Poshmark Style Tags, Depop Aesthetic Mode, footer text, or measurement labels.

Universal brand fallback repair:
- If no brand, maker, designer, publisher, manufacturer, label, studio, model family, or official mark is visible or seller-provided in the Selling Brief, every final brand/maker field that needs a value must use Unbranded.
- Replace Brand: Not specified, Brand: Unknown, Brand: Not specified (see photos), Brand: See photos, and equivalent unsupported brand/maker field values with Unbranded.
- Do not infer brand from style, category, visual appearance, item type, or platform category.
- If a supported brand/maker is visible or seller-provided in the Selling Brief, preserve that supported name.

Measurement-reference photo repair:
- If the Selling Brief Measurement Basis includes a readable ruler, measuring tape, measurement board, grid, scale reference, measurement-reference photo, typed measurement graphic, or approximate dimensions derived from photo evidence, final Approximate Measurements blocks must use those approximate measurements.
- Do not leave Approximate Measurements as Not provided (see photos) when the Selling Brief provides readable measurement-photo-derived values.
- Use the unit supplied by the Selling Brief.
- Use approx. for photo-derived measurements.
- Acceptable formats include:
  Approximate Measurements:
  [Dimension label] - approx. [value] from measurement photo
  or:
  Approximate Measurements:
  Approx. [length] x [width] from measurement photo
- Do not invent measurements that are not in the Selling Brief.
- Do not use "see ruler photo for scale reference" as a replacement for a readable measurement.
- Put numeric measurements only in Approximate Measurements blocks unless used in a title or structured platform field.
- Do not duplicate measurement values inside eBay Description, Depop Listing, Poshmark Description, Mercari Description, or Etsy Description.
- Do not create optional Size, Measurements, Scale, or Fit subsections when the standard Approximate Measurements block exists.
- If body copy needs scale context, use non-numeric, evidence-based language only, and only if it does not duplicate the measurement block.

Buyer-facing uncertainty cleanup:
- Remove or rewrite internal, negative, or defensive phrases in buyer-facing final copy.
- Bad phrases include: metal composition not specified, material composition not specified, visual style, not individually verified, completeness not verified, no confirmed missing parts, no confirmed missing stones, no confirmed missing components, no explicit missing parts confirmed, no explicit missing stones confirmed, must rely on buyer photo review, see ruler photo for scale reference, Brand: Not specified, Brand: Unknown, Country/Region of Manufacture: Not specified (see photos), stone completeness not verified, and component completeness not verified.
- Use clean buyer-facing wording instead: silver-tone finish, gold-tone finish, material not confirmed, exact material not confirmed, unsigned / no visible maker mark, unbranded, vintage wear shown, wear shown in photos, light surface wear, light dulling, surface wear to metal and stones, review photos for condition details, stones appear present in provided images, no obvious missing stones shown, or no obvious missing components shown.
- Do not remove legitimate flaw or condition notes.
- Do not invent positive condition, completeness, material, authenticity, or all-parts-present claims.

Etsy Description buyer-facing-only repair:
- Etsy Description must not include seller-instruction, shop-operation, photo recommendation, or video recommendation text.
- Remove Photo tip, Photo tips, Video idea, Video ideas, For best presentation in your shop, include close-up photos, include a wrist shot, capture side angles, short video showing, video showing, show clasp, show scale, demonstrate scale, buyer confidence photo suggestion, listing video suggestion, and similar media-advice text from Etsy Description entirely.
- Do not create a new photo/video recommendation section.
- Do not add media suggestions elsewhere in the final LP-U.

Exact Confirmed candidate wording behavior:
- The Selling Brief's Safe Wording is controlling.
- Treat the Selling Brief's Primary Style / Theme / Aesthetic Candidate as controlling guidance.
- Titles, tags, hashtags, item specifics, attributes, and keyword fields may use exact Confirmed Candidate Term / Safe Wording.
- Description and Listing body sentences should use the candidate only when it reads naturally.
- If exact Candidate Term wording sounds awkward in body copy, describe the visible evidence instead.
- Do not force Title Case Candidate Terms into body sentences.
- Treat STYLE / THEME / AESTHETIC CANDIDATE BANK Use In directions as controlling guidance.
- Identify the strongest Confirmed named style/theme/aesthetic candidate using this universal priority order:
  1. Seller-preferred Confirmed or Seller-provided style/theme/aesthetic candidate from Known Details or an edited Selling Brief
  2. Confirmed named style/theme/aesthetic candidate that is most specific and useful for buyer search
  3. Confirmed label/marking/packaging-derived style/theme/aesthetic term
  4. Confirmed photo-derived named style/theme/aesthetic term
  5. Confirmed motif/design-family term
  6. Confirmed construction/form descriptor
  7. Confirmed color/material/finish descriptor
  8. Generic visual adjective
- If the brief directs the Primary Style / Theme / Aesthetic Candidate into eBay Title B, Poshmark Title, Etsy Title, or Depop Listing opening, use that exact Safe Wording in the directed location unless it violates title length, would be misleading, is not useful for that platform, or the item is non-style-led and style language would hurt search.
- If final copy uses a different candidate in those fields, the Selling Brief must explicitly permit that fallback.
- Do not silently replace the primary candidate with a broader one.
- If the Primary Style / Theme / Aesthetic Candidate indicates Seller Preference and the candidate is Confirmed or Seller-provided, useful for buyer search, and not misleading, seller preference controls high-visibility placement. Do not demote it because another candidate is shorter, broader, safer-sounding, or easier to fit.
- Do not choose a shorter candidate solely because it is shorter when the primary or more specific candidate fits.
- If the brief directs a Confirmed style/theme/aesthetic candidate into eBay Title B, Poshmark Title, Etsy Title, or Depop Listing opening, use that exact Safe Wording in the directed location unless it violates title length, would be misleading, is not useful for that platform, or the item is non-style-led and style language would hurt search.
- Do not let generic visual descriptors such as ornate, decorative, scrollwork, textured, colorful, bold, structured, or similar broad adjectives replace a stronger Confirmed named style/theme/aesthetic candidate when that candidate fits, improves search, and is not misleading.
- Remove unwanted style, look, inspired, design, styling, visual style, aesthetic, motif, or influence suffixes from exact Confirmed style/theme/aesthetic Safe Wording unless that suffix appears in the Selling Brief Candidate Term or Safe Wording, the seller explicitly typed it, readable label/marking/packaging uses it, or exact wording would materially mislead.
- Do not repair awkward body copy by adding style, look, inspired, design, styling, visual style, aesthetic, motif, or influence after an exact Confirmed Safe Wording. Rewrite the sentence structure instead.
- If a body sentence reads "This item features [candidate] with..." or similar, do not leave the candidate between the verb and supported detail. Either rewrite the sentence around the item type and supported detail, or remove the candidate from that sentence and leave the candidate in title/tags/keywords/attributes where it already works.
- When exact candidate wording is awkward in a body sentence, prefer evidence-forward wording over candidate repetition: supported construction, motif, color/material appearance, closure/component, mark/label, condition basis, seller-confirmed Known Details, or claim limits.
- Claim Limit controls blocked overclaims. It does not require adding style, look, inspired, design, styling, visual style, aesthetic, motif, or influence suffixes.
- If a directed candidate cannot fit in a title/opening, leave that field within platform limits and keep the candidate in the closest already-allowed location such as description, item specifics, tags, or attributes if present. Do not invent a new section.
- Preserve seller-confirmed Known Details as direct facts. If Known Details states Vintage and the Selling Brief does not show a conflict, final copy should use vintage confidently and must not rewrite it as vintage style, vintage-inspired, appears vintage, or possibly vintage.
- Do not claim exact decade, antique status, production period, historical era, provenance, material composition, authenticity, designer intent, or rarity unless separately supported by the brief.
- Preserve material-safe and appearance-safe wording such as gold-tone, silver-tone, leather-like, wood-tone, glass-like, stone-like, rhinestone-style, material not confirmed, exact material not confirmed, metal not specified, and gemstone not confirmed.
- Do not add untested, not tested, functionality not tested, clasp not tested, not formally tested, working status unknown, or similar defensive functionality caveats unless the seller explicitly provided that information in Known Details, condition notes, flaw notes, or item notes.

Body opening validity repair:
- Repair only affected eBay Description, Depop Listing, Poshmark Description, Mercari Description, or Etsy Description body sections.
- Do not change titles, tags, hashtags, item specifics, attributes, Poshmark Search keywords line, Style Tags, Compact 3-Tag Strategy, Approximate Measurements blocks, footer text, platform labels, or platform order.
- Every repaired body must identify the item type or item identity and include at least one evidence anchor such as construction, material appearance, condition, closure/hardware, color/pattern/motif, brand/maker/Unbranded status, included component, or visible form.
- eBay Description must start with one concise proof-driven item identity sentence before bullets unless the first bullet clearly identifies the item.
- Depop Listing must start with a short complete item identity or natural search hook that mentions item type early; it must not start with closure-only, condition-only, component-only, or fragment text.
- Mercari Description must start with a concise item identity sentence before bullets or details.
- Etsy Description must open with item identity before construction details and remain natural buyer-facing copy.
- Do not delete the only item-identity sentence or the only useful evidence sentence from a Description or Listing.
- If awkward candidate wording appears in a useful body sentence, rewrite the awkward phrase into natural evidence-based wording instead of deleting the useful fact.
- Do not add duplicate numeric measurement body text when the Approximate Measurements block exists.

Depop Aesthetic Mode repair:
- Review the Selling Brief's Depop Angle, Platform Angle Map, STYLE / THEME / AESTHETIC CANDIDATE BANK, and Primary Style / Theme / Aesthetic Candidate.
- If the Selling Brief has Confirmed or Seller-provided style/theme/aesthetic candidates and the Depop Angle says the item is style-led, visual/vibe-driven, style-driven, aesthetic-driven, fashion-led, decor-led, collector/display-led, or otherwise style-relevant, Aesthetic Mode Primary and Secondary must not be "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}".
- In that style-led case, replace any "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}" Primary or Secondary value with an exact saved Depop Aesthetic Mode value only.
- Do not invent new Depop Aesthetic Mode values.
- Do not use custom candidate terms as Depop Aesthetic Mode values unless they already exist exactly in the saved Depop list.
- If no exact saved Depop value matches a candidate, choose the closest honest saved Depop modes based on the Selling Brief.
- If only one strong saved mode exists, choose a second broad-but-valid saved mode that does not conflict with the item.
- Do not choose contradictory modes unless the Selling Brief supports them.
- Do not force style/vibe modes for non-style-led functional items.
- Preserve the exact "Aesthetic Mode", "Primary", and "Secondary" labels.
- Do not change Depop hashtags for this Aesthetic Mode repair unless a tiny grammar repair is required.

Allowed Depop Aesthetic Mode values:
${DEPOP_AESTHETIC_MODE_LIST.join("; ")}
${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}

Etsy Title repair:
- Rewrite only the Etsy Title if it violates the Selling Brief's Etsy strategy.
- Etsy Title must be human-readable and conversational, not a comma-stuffed keyword string.
- Front-load the strongest useful buyer-search phrase in the first 40 characters.
- Keep it under 140 characters.
- Do not leave Etsy Title bare or minimal when the Selling Brief provides supported high-value details that fit naturally.
- If the title is too short and omits supported high-value search details, expand it naturally using only supported details from the Selling Brief and final listing evidence.
- Use as much room under 140 characters as useful, without filler, repetition, or unsupported terms.
- Include supported details when natural and useful: brand/maker, item type, Primary Style / Theme / Aesthetic Candidate, motif/design/construction, color/material appearance, size/measurement when important for title search, seller-confirmed Vintage when relevant, condition/age category, or standout buyer-search detail.
- If the Etsy Title misses the Primary Style / Theme / Aesthetic Candidate, add it when useful, not misleading, and natural under 140 characters.
- If it includes unwanted suffixes on exact Confirmed style/theme/aesthetic candidates, remove those suffixes unless they are part of the Selling Brief Safe Wording.
- Do not change eBay, Poshmark, Depop, or Mercari titles for this Etsy Title repair.

Etsy Tags repair:
- Rewrite only the Etsy Tags line/list if needed.
- Etsy Tags must contain exactly 13 tags.
- Every tag must be 20 characters or fewer.
- No duplicate tags.
- Avoid near-duplicate tags when a supported alternate search path is available.
- Do not use unsupported material, era, rarity, audience, or condition claims.
- Tags should cover alternate search paths rather than simply duplicating the title.
- If a tag is over 20 characters, replace it with a shorter meaningful supported phrase. Do not blindly truncate words into awkward or meaningless tags.
- Prefer meaningful supported alternatives from the Selling Brief and final evidence: brand/maker, item type, confirmed style/theme/aesthetic candidate, motif/design, color/material appearance, size/measurement as tag terms when useful, closure/component, use/display/function context when supported, known item category, or buyer search synonym.
- Preserve exactly 13 total tags after repair.

Poshmark Search keywords line repair:
- The final Poshmark Description must include a line beginning exactly with:
  Search keywords:
- This line must appear inside the Poshmark Description near the bottom, before Style Tags.
- If the line is missing, insert it before the Style Tags label.
- If present but spammy, hashtag-based, repetitive, unsupported, or unrelated, rewrite only that line.
- Do not use #.
- Keep it readable and not spammy.
- Use only supported comma-separated phrases from the Selling Brief and final listing evidence.
- Include relevant supported phrases such as brand, item type, confirmed style/theme/aesthetic candidate, color/material appearance, size/measurement as keyword terms when useful, condition, motif/pattern, use context, and category terms when useful.
- Do not invent Poshmark Style Tags.
- Do not alter Style Tags or Compact 3-Tag Strategy (Alt Option) values.
- Preserve Poshmark label order: Title, Description, Style Tags, Compact 3-Tag Strategy (Alt Option), Approximate Measurements, footer.

Rejected/generic phrase suppression:
- Read the Selling Brief's Generic Phrases to Avoid section.
- Read STYLE / THEME / AESTHETIC CANDIDATE BANK rows whose Evidence Source is Rejected or whose Confidence Level is Weak/Do not use.
- Remove or rewrite those phrases and rejected terms wherever they appear in final LP-U titles, descriptions, tags, hashtags, attributes, item specifics, keyword lines, and photo/video suggestions.
- Replace them only with supported evidence: confirmed candidate Safe Wording, motif/design/construction, form factor, color/material appearance, category, use context, or specific visual descriptor.
- Do not remove required platform labels.
- Do not remove valid saved Poshmark Style Tags merely because they are broad.
- Do not remove valid Depop Aesthetic Mode values.
- Do not remove material safety wording.
- If a generic phrase appears because it is part of a valid saved Poshmark Style Tag, leave it.
- If a generic phrase appears in a Depop hashtag, Etsy tag, title, or description, replace it with a supported specific term or remove it.
- If a rejected candidate appears in Etsy tags, remove or replace it with a supported tag.
- If a rejected candidate appears in description copy, remove or replace it with a supported confirmed candidate, motif, construction, form factor, or visual descriptor.
- Do not use rejected candidate terms in titles, tags, hashtags, item specifics, attributes, keyword lines, descriptions, or final guidance.

Weak generic marketplace language repair:
- Remove or rewrite weak generic phrases wherever they appear as standalone selling claims in body copy, tags, hashtags, keyword lines, attributes, key details, and photo/video suggestions.
- Weak generic phrases include: great for collectors, anyone drawn to, works well, statement piece, statement accessory, standout piece, beautiful piece, unique find, perfect for any outfit, great addition, timeless, high quality, stylish accessory, versatile piece, eye-catching, must-have, rare find, collector's item, collector’s item, decorative piece, classic design, pairs well, worn alone or layered, vintage-inspired outfits, classic styling, formal looks, ornate looks, great for styling, perfect gift, gift for her.
- Do not leave those phrases in eBay Description, Depop Listing, Poshmark Description, Mercari Description, Etsy Description, Etsy Tags, Depop Hashtags, Poshmark Search keywords line, Photo tips, Video ideas, Attributes, or Key Details unless the phrase is seller-provided exact text and still safe.
- If a weak phrase is seller-provided exact text and safe, preserve the seller-provided fact but improve the surrounding sentence so it is evidence-grounded.
- Replace weak phrases only with supported anchors from the Selling Brief and current final output.
- A replacement sentence must use at least two supported anchors, such as brand/maker/mark/model, confirmed candidate Safe Wording when natural, item type, supported construction, closure/hardware/component, color/pattern/motif, material appearance, condition basis, included/not-included details, seller-confirmed Known Details, claim limit, packaging/label/marking, or use/display/function context.
- Do not replace a weak phrase with another broad marketplace claim. If there are not at least two supported anchors for a replacement sentence, delete the weak sentence.
- Use/context language is allowed only when the sentence is tied to concrete evidence such as supported construction, brand/mark/model plus condition basis, included parts plus display/function context, or color/motif plus item type.
- Do not add filler to replace removed weak text.
- Do not hardcode examples into the output.
- Do not remove valid saved Poshmark Style Tags.
- Do not remove valid Depop Aesthetic Mode values.
- Do not remove required platform labels.
- Do not remove material-safe wording.

Awkward candidate wording repair:
- Scan every final LP-U sentence that contains an exact Confirmed candidate Safe Wording.
- If the sentence uses the candidate as an awkward fragment, rewrite only that sentence or remove it.
- Bad patterns include: features [candidate] with, creating a/an [candidate], with [candidate] when the candidate is not a natural noun phrase, [candidate] with, [candidate] that when the candidate cannot stand alone, This piece is [candidate] when awkward, reflects [candidate] styling, [candidate]-inspired, [candidate] look, [candidate] design, works well for [candidate] looks, creating a/an [candidate] effect, or any sentence that adds style/look/inspired/design/styling/visual style/aesthetic/motif/influence to exact Safe Wording without support.
- Preserve the exact Confirmed Safe Wording. Do not add unwanted suffixes to make grammar work.
- Use the candidate naturally as a search descriptor, adjective, title/tag term, or concise descriptive phrase only when it reads clearly. Do not force it into every description paragraph.
- If exact candidate wording cannot be used naturally in a sentence, remove that sentence and let the candidate remain in title, tags, hashtags, keywords, item specifics, or attributes where appropriate.
- Do not turn a candidate into an unsupported historical, origin, authenticity, rarity, material, designer-intent, or production-period claim.

Etsy Description quality repair:
- Specifically review Etsy Description after the generic phrase and awkward candidate repairs.
- If Etsy Description contains internal source language, seller-facing instructions, photo/video advice, weak generic copy, awkward candidate fragments, broad filler use/context language, unsupported caveats, or a thin generated tone, rewrite only Etsy Description.
- Preserve Etsy Title, Etsy Tags, Etsy Category, Etsy Materials, Etsy Attributes / Key Details, Measurements, and footer unless a sentence-level consistency repair inside Etsy Description requires changing description words.
- Etsy Description should use this structure without adding new labels unless the existing section already uses labels:
  1. Opening paragraph: human-readable item identification with supported brand/maker when available, primary confirmed style/theme/aesthetic candidate when useful and natural, item type, and one or two strongest supported design details.
  2. Evidence/design paragraph: concrete appeal based on supported construction, motif, color, material appearance, closure/component, mark/label, or condition basis.
  3. Buyer decision paragraph or bullets: condition basis, included/not-included detail when relevant, seller-confirmed Known Details, and claim limits where needed.
  4. Optional use/context sentence only when evidence-specific.
  5. No duplicate numeric measurement body text.
  6. No photo/video suggestions.
- Etsy Description must be buyer-facing listing copy only.
- Etsy Description must avoid broad generic lines such as great for collectors, anyone drawn to, perfect gift, gift for her, timeless, beautiful, rare, high quality, must-have, unique find, statement piece, statement accessory, decorative piece, works well, pairs well, worn alone or layered, vintage-inspired outfits, classic styling, formal looks, ornate looks, great for styling, or versatile.
- If a use/context sentence remains, tie it to supported evidence such as confirmed candidate Safe Wording when natural, supported construction or design detail, condition basis, brand/mark, included component, or use/display/function context.
- Etsy Description must not read like an eBay copy block, tag paragraph, or procedural checklist. Rewrite thin generated wording into buyer-facing paragraphs grounded in the brief's evidence anchors.
- Do not add untested, not tested, functionality not tested, clasp not tested, not formally tested, working status unknown, function unknown, or similar caveats in Etsy Description unless the seller explicitly supplied that caveat in the Selling Brief evidence.

Preservation rules:
- Do not alter final LP-U strict output labels.
- Do not alter platform order.
- Do not alter footer text.
- Do not alter measurement labels.
- Do not alter Poshmark Style Tags or Compact 3-Tag Strategy.
- Do not alter valid saved Depop Aesthetic Mode values except when replacing "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}" for a style-led item under the Depop Aesthetic Mode repair above.
- Do not alter material descriptors or material/appearance safety wording.
- Do not alter Mercari structure.
- Do not alter any unrelated platform content.
- Preserve title length limits.
- Return the full repaired LP-U output only.
- Do not add commentary before or after the LP-U output.

Universal Selling Brief:
${sellingBrief}

Current LP-U output:
${lpuOutput}`;
}

async function generateValidatedLpuOutput({
  imageUrls,
  instructions,
  notes,
  promptVersion,
  sellingBrief,
  backgroundContext,
}: {
  imageUrls: string[];
  instructions: string;
  notes: string;
  promptVersion: "v1" | "v2";
  sellingBrief?: string;
  backgroundContext?: BackgroundGenerationContext;
}) {
  const requestText = sellingBrief
    ? `Generate the full LP-U output for this item.

Use the Universal Selling Brief below as controlling guidance for merchandising strategy, platform angles, evidence use, and claim limits.
Do not create new platform angles from scratch unless the brief is missing required parts.
If the brief conflicts with the original notes or image evidence, preserve evidence accuracy and do not invent unsupported claims.
Treat STYLE / THEME / AESTHETIC CANDIDATE BANK Use In directions as controlling guidance.
Treat the Primary Style / Theme / Aesthetic Candidate as controlling guidance for high-visibility fields.
If the Primary Style / Theme / Aesthetic Candidate indicates Seller Preference and the candidate is Confirmed or Seller-provided, useful for buyer search, and not misleading, seller preference controls high-visibility placement. Do not demote it because another candidate is shorter, broader, safer-sounding, or easier to fit.
If the brief says the Primary Style / Theme / Aesthetic Candidate should be used in eBay Title B, Poshmark Title, Etsy Title, or Depop Listing opening, use that exact Safe Wording unless it violates title length, would be misleading, is not useful for that platform, or the item is non-style-led and style language would hurt search.
If final copy uses a different candidate in those fields, the Selling Brief must explicitly permit that fallback.
Do not silently replace the primary candidate with a broader one.
If the brief says a Confirmed style/theme/aesthetic candidate should be used in eBay Title B, Poshmark Title, Etsy Title, or Depop Listing opening, use that exact Safe Wording unless it violates title length, would be misleading, is not useful for that platform, or the item is non-style-led and style language would hurt search.
For Confirmed STYLE / THEME / AESTHETIC CANDIDATE BANK rows where Safe Wording equals the exact Candidate Term, preserve exact Safe Wording in titles, tags, hashtags, item specifics, attributes, and keyword fields when those fields use the candidate.
When choosing between candidates for high-visibility fields, prioritize seller-preferred candidates first, then the most specific and buyer-search-useful Confirmed named style/theme/aesthetic/search phrase over generic visual descriptors. Do not let generic visual adjectives replace the primary or strongest Confirmed named candidate when it fits, improves search, and is not misleading.
Do not prefer a shorter candidate solely because it is shorter when a more specific candidate also fits.
Do not silently ignore high-visibility placement instructions from the brief.
If a Confirmed candidate cannot fit in a title/opening, move it to the closest appropriate allowed structured or search field such as item specifics, tags, attributes, hashtags, or keyword lines. Use it in body descriptions only when it reads naturally.
Do not add style, look, inspired, design, styling, visual style, aesthetic, motif, or influence suffixes to Confirmed style/theme/aesthetic Safe Wording unless the suffix appears in the Selling Brief Safe Wording or Candidate Term, the seller explicitly typed it, readable label/marking/packaging uses it, or exact wording would materially mislead.
Claim Limit controls blocked overclaims. It does not require adding style, look, inspired, design, styling, visual style, aesthetic, motif, or influence suffixes.
For Depop Aesthetic Mode, if the Selling Brief has Confirmed or Seller-provided style/theme/aesthetic candidates and the Depop Angle is style-led, visual/vibe-driven, style-driven, aesthetic-driven, fashion-led, decor-led, collector/display-led, or otherwise style-relevant, do not use "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}" for Primary or Secondary. Use only exact saved Depop Aesthetic Mode values.
For Etsy Title, write a human-readable title under 140 characters that front-loads the strongest buyer-search phrase in the first 40 characters and expands naturally with supported high-value details. Do not leave it bare/minimal when brand/maker, item type, Primary Style / Theme / Aesthetic Candidate, motif/design/construction, color/material appearance, important size/measurement, seller-confirmed Vintage, or standout buyer-search detail can fit naturally.
For all final body copy, do not use weak generic marketplace claims such as great for collectors, anyone drawn to, works well, statement piece, statement accessory, standout piece, beautiful piece, unique find, perfect for any outfit, great addition, timeless, high quality, stylish accessory, versatile piece, eye-catching, must-have, rare find, collector's item, collector’s item, decorative piece, classic design, pairs well, worn alone or layered, vintage-inspired outfits, classic styling, formal looks, ornate looks, great for styling, perfect gift, or gift for her.
Use exact Confirmed candidate Safe Wording naturally. Do not soften it with unsupported suffixes, and do not force it into awkward fragments such as features [candidate] with, creating an [candidate], with [candidate], [candidate]-inspired, [candidate] look, reflects [candidate] styling, or works well for [candidate] looks. If it cannot read naturally in a sentence, leave it in search fields such as titles, tags, hashtags, keywords, item specifics, or attributes and describe the supported evidence in body copy.
For Etsy Description, write human curated buyer-facing copy grounded in the Selling Brief: identify the supported brand/maker and item type when available, use the primary confirmed candidate only when useful and natural, describe design/construction/color/material appearance/closure/marking details, include condition basis, preserve relevant seller-confirmed Known Details as direct buyer-facing facts, avoid broad gift/collector/styling filler, do not duplicate numeric measurements, and remove all seller-facing photo/video advice.
In eBay Description, Depop Listing, Poshmark Description, Mercari Description, and Etsy Description, do not use internal source language such as seller-confirmed, seller-provided, seller states, per seller, photo evidence, visible in photos, visible, photo-derived, evidence source, Known Details, or provided by seller. Rewrite those phrases as direct buyer-facing item facts without deleting supported facts.
If no brand, maker, designer, publisher, manufacturer, label, studio, model family, or official mark is visible or seller-provided in the Selling Brief, use Unbranded in all final brand/maker fields that need a value. Do not use Brand: Not specified, Brand: Unknown, Brand: See photos, or Brand: Not specified (see photos).
If the Selling Brief Measurement Basis provides approximate measurements from a readable ruler, measuring tape, measurement board, grid, scale reference, typed measurement graphic, or measurement-reference photo, place those measurements in each platform's required Approximate Measurements block using approx. and the unit supplied by the brief. Do not leave Not provided (see photos), and do not use "see ruler photo for scale reference" as a substitute.
Do not add duplicate size, ruler, scale, or measurement-reference lines inside platform descriptions when the standard Approximate Measurements block already contains the measurement. Do not create optional Size, Measurements, Scale, or Fit subsections when the standard Approximate Measurements block exists. If body copy needs scale context, use non-numeric, evidence-based language only, and only if it does not duplicate the measurement block.
Remove or rewrite buyer-facing defensive phrases such as metal composition not specified, material composition not specified, visual style, not individually verified, completeness not verified, no confirmed missing parts, no confirmed missing stones, no confirmed missing components, no explicit missing parts confirmed, no explicit missing stones confirmed, must rely on buyer photo review, stone completeness not verified, or component completeness not verified. Use clean uncertainty such as material not confirmed, exact material not confirmed, unsigned / no visible maker mark, unbranded, wear shown in photos, light surface wear, or review photos for condition details.
Do not add untested, not tested, functionality not tested, clasp not tested, not formally tested, working status unknown, or similar defensive functionality caveats unless the seller explicitly provided that information in Known Details, condition notes, flaw notes, or item notes.
Preserve seller-confirmed Known Details as direct facts. If Known Details states Vintage and the Selling Brief does not show a conflict, use vintage confidently and do not rewrite it as vintage style, vintage-inspired, appears vintage, or possibly vintage. Do not claim exact decade, antique status, production period, historical era, provenance, or rarity unless separately supported.
Keep material-safe and appearance-safe wording intact when material identity is not confirmed.
Preserve all final LP-U strict output labels, platform order, footer text, measurement labels, and validation-sensitive structure.

Original user notes:
${notes}

Editable Universal Selling Brief:
${sellingBrief}`
    : `Generate the full LP-U output for this item.

User notes:
${notes}`;

  const userContent: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
  > = [
    {
      type: "input_text",
      text: requestText,
    },
    ...imageUrls.map((imageUrl) => ({
      type: "input_image" as const,
      image_url: imageUrl,
      detail: "auto" as const,
    })),
  ];

  const response = await createGenerationResponse("initial_final_output", {
    model: getLpuOpenAIGenerationModel(),
    instructions,
    input: [
      {
        role: "user",
        content: userContent,
      },
    ],
  }, backgroundContext);

  let lpuOutput = response.output_text ?? "";

  const validationOptions = {
    itemType: "auto",
    requirePoshmarkCompactTagStrategy: true,
    enforceUnsupportedEstimatedMeasurements: promptVersion === "v2",
  } as const;

  let validation = validateLpuOutput(lpuOutput, validationOptions);

  if (hasPoshmarkOutputOrderIssues(validation)) {
    const revisionResponse = await createGenerationResponse("poshmark_order_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPoshmarkOrderRevisionInstruction(lpuOutput, validation),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasMercariOutputFormatIssues(validation)) {
    const revisionResponse = await createGenerationResponse("mercari_format_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildMercariOutputFormatRevisionInstruction(lpuOutput, validation),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasPoshmarkInvalidStyleTagIssues(validation)) {
    const revisionResponse = await createGenerationResponse("poshmark_style_tags_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildPoshmarkInvalidStyleTagRevisionInstruction(lpuOutput, validation),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasDepopInvalidAestheticModeIssues(validation)) {
    const revisionResponse = await createGenerationResponse("depop_aesthetic_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildDepopInvalidAestheticModeRevisionInstruction(lpuOutput, validation),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasEstimatedMeasurementUnsupportedIssues(validation)) {
    const revisionResponse = await createGenerationResponse("measurement_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildEstimatedMeasurementUnsupportedRevisionInstruction(lpuOutput, validation),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (hasOnlyTitleLengthIssues(validation)) {
    const revisionResponse = await createGenerationResponse("title_length_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildTitleRevisionInstruction(lpuOutput, validation),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (
    promptVersion === "v2" &&
    sellingBrief?.trim() &&
    hasRemainingValidationIssues(validation)
  ) {
    const revisionResponse = await createGenerationResponse("targeted_final_repair", {
      model: getLpuOpenAIGenerationModel(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildFinalFromBriefTargetedRepairInstruction({
                lpuOutput,
                sellingBrief,
              }),
            },
          ],
        },
      ],
    }, backgroundContext);

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && sellingBrief?.trim()) {
    const lpuOutputBeforeDeterministicSanitizer = lpuOutput;
    const repairedOutput = repairFinalFromBriefExactCandidateSuffixes({
      lpuOutput,
      sellingBrief,
      sellerInput: notes,
    });

    if (repairedOutput !== lpuOutput) {
      lpuOutput = repairedOutput;
      validation = validateLpuOutput(lpuOutput, validationOptions);
    }

    const aiBodyRepairedOutput =
      await repairFinalFromBriefBodySectionsWithAiIfNeeded({
        lpuOutput,
        sellingBrief,
        backgroundContext,
        phase: "body_repair_primary",
      });

    if (aiBodyRepairedOutput !== lpuOutput) {
      lpuOutput = aiBodyRepairedOutput;
      validation = validateLpuOutput(lpuOutput, validationOptions);
    }

    const hardSafetyOutput = cleanupFinalFromBriefHardSafetyAfterBodyRepair({
      lpuOutput,
      sellerInput: notes,
    });

    if (hardSafetyOutput !== lpuOutput) {
      lpuOutput = hardSafetyOutput;
      validation = validateLpuOutput(lpuOutput, validationOptions);
    }

    const finalBodyIssueReports = getFinalFromBriefBodyIssueReports({
      lpuOutput,
      sellingBrief,
    });

    if (finalBodyIssueReports.length > 0) {
      const finalBodyRepairedOutput =
        await repairFinalFromBriefBodySectionsWithAiIfNeeded({
          lpuOutput,
          sellingBrief,
          backgroundContext,
          phase: "body_repair_secondary",
        });

      if (finalBodyRepairedOutput !== lpuOutput) {
        lpuOutput = cleanupFinalFromBriefHardSafetyAfterBodyRepair({
          lpuOutput: finalBodyRepairedOutput,
          sellerInput: notes,
        });
        validation = validateLpuOutput(lpuOutput, validationOptions);
      }

      const remainingBodyIssueReports = getFinalFromBriefBodyIssueReports({
        lpuOutput,
        sellingBrief,
      });

      if (remainingBodyIssueReports.length > 0 && isLpuV2SanitizerDebugEnabled()) {
        console.info("[LPU_V2_SANITIZER_DEBUG] Remaining final body issues", {
          reports: remainingBodyIssueReports,
        });
      }
    }

    return {
      lpuOutput,
      validation,
      sanitizerDebugStages: isLpuV2SanitizerDebugEnabled()
        ? {
            beforeDeterministicSanitizer: lpuOutputBeforeDeterministicSanitizer,
            afterDeterministicSanitizer: lpuOutput,
          }
        : undefined,
    };
  }

  return { lpuOutput, validation };
}

export async function POST(request: Request) {
  try {
    if (isStagingDeployment()) {
      await requireQueueOwnerSession();
    }
    const body = (await request.json()) as GenerateBody;
    const notes = body?.notes?.trim();
    const images = Array.isArray(body?.images) ? body.images : [];
    // This runs after Queue-owner authentication and before resolving any
    // image reference or calling a generation model.  It cannot alter the
    // production path because the policy returns no legacy URLs outside
    // staging.
    const legacyMacImageUrls = stagingLegacyMacImageUrls(
      images,
      isStagingDeployment(),
      isStagingStoragePath
    );
    const mode = normalizeMode(body?.mode);
    const sellingBrief =
      typeof body?.sellingBrief === "string" ? body.sellingBrief.trim() : "";
    const includeGeneratorInstructionsReport = Boolean(
      body?.includeGeneratorInstructionsReport
    );
    const promptVersion = normalizePromptVersion(body?.promptVersion);
    const interfaceVersion = normalizeInterfaceVersion(body?.interfaceVersion);
    const instructions = getMasterPrompt(promptVersion);

    if (!notes) {
      return NextResponse.json(
        { error: "Notes are required." },
        { status: 400 }
      );
    }

    if (mode && (promptVersion !== "v2" || interfaceVersion !== "v2")) {
      return NextResponse.json(
        { error: "V2 workflow modes require promptVersion and interfaceVersion to be v2." },
        { status: 400 }
      );
    }

    if (mode === "finalFromBrief" && !sellingBrief) {
      return NextResponse.json(
        { error: "Selling Brief is required for finalFromBrief mode." },
        { status: 400 }
      );
    }
    if (body?.generationContinuation && mode !== "finalFromBrief") {
      return NextResponse.json(
        { error: "Generation continuation is valid only for finalFromBrief mode." },
        { status: 400 }
      );
    }

    const backgroundContext =
      mode === "finalFromBrief"
        ? backgroundGenerationContext({
            continuation: body?.generationContinuation,
            requestFingerprint: backgroundGenerationRequestFingerprint({
              notes,
              images,
              sellingBrief,
              promptVersion,
              interfaceVersion,
            }),
          })
        : undefined;

    const imageUrls = (
      await Promise.all(images.map((image, index) =>
        resolveGeneratorImageUrl(image, legacyMacImageUrls.get(index))
      ))
    ).filter((url) => typeof url === "string" && url.trim().length > 0);

    if (mode === "sellingBrief") {
      const briefOutput = await generateSellingBrief({ imageUrls, notes });
      const repairedBriefOutput = await repairSellingBriefCandidateBank(briefOutput, notes);

      return NextResponse.json({
        output: repairedBriefOutput,
        sellingBrief: repairedBriefOutput,
        promptVersion,
        ...(interfaceVersion ? { interfaceVersion } : {}),
      });
    }

    const { lpuOutput, validation, sanitizerDebugStages } =
      await generateValidatedLpuOutput({
      imageUrls,
      instructions,
      notes,
      promptVersion,
      ...(mode === "finalFromBrief" ? { sellingBrief, backgroundContext } : {}),
    });

    const responseBody = {
      output: lpuOutput,
      validation,
      promptVersion,
      ...(interfaceVersion ? { interfaceVersion } : {}),
      ...(includeGeneratorInstructionsReport
        ? {
            generatorInstructionsReport: buildGeneratorInstructionsReport({
              interfaceVersion,
              promptVersion,
            }),
          }
        : {}),
    };

    if (
      mode === "finalFromBrief" &&
      promptVersion === "v2" &&
      sanitizerDebugStages
    ) {
      await writeLpuV2SanitizerDebugCapture({
        routePath: "v2_finalFromBrief",
        generatedAt: new Date().toISOString(),
        stages: {
          before_deterministic_sanitizer: captureLpuV2SanitizerDebugStage(
            sanitizerDebugStages.beforeDeterministicSanitizer
          ),
          after_deterministic_sanitizer: captureLpuV2SanitizerDebugStage(
            sanitizerDebugStages.afterDeterministicSanitizer
          ),
          json_response_lpuOutput: captureLpuV2SanitizerDebugStage(
            responseBody.output
          ),
        },
      });
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    if (error instanceof BackgroundGenerationPending) {
      return NextResponse.json(
        {
          status: "in_progress",
          generationContinuation: error.continuation,
          retryAfterSeconds: 10,
        },
        { status: 202, headers: { "Retry-After": "10" } }
      );
    }
    if (error instanceof BackgroundGenerationContinuationError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    if (error instanceof QueueAuthError) {
      return NextResponse.json(
        { error: "Staging generation requires Queue sign-in. Use /lpu-v2 to sign in." },
        { status: 401 }
      );
    }
    if (error instanceof StagingLegacyMacImageError) {
      return NextResponse.json(
        { error: "Invalid staging image reference." },
        { status: 400 }
      );
    }
    console.error("LP-U generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate LP-U output." },
      { status: 500 }
    );
  }
}
