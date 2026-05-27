import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { getMasterPrompt } from "@/lib/lpu/masterPrompt";
import {
  POSHMARK_STYLE_TAG_MASTER_LIST,
  validateLpuOutput,
} from "@/lib/validator";

type IncomingImage = {
  name: string;
  type: string;
  imageUrl: string;
  storagePath?: string;
};

type GenerateBody = {
  notes: string;
  images: IncomingImage[];
  includeGeneratorInstructionsReport?: boolean;
  interfaceVersion?: string;
  promptVersion?: string;
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

function normalizePromptVersion(promptVersion: unknown): "v1" | "v2" {
  return promptVersion === "v2" ? "v2" : "v1";
}

function normalizeInterfaceVersion(interfaceVersion: unknown): string | undefined {
  if (typeof interfaceVersion !== "string") return undefined;

  const normalized = interfaceVersion.trim();
  return normalized || undefined;
}

async function resolveGeneratorImageUrl(
  image: IncomingImage
): Promise<string> {
  const directUrl =
    typeof image?.imageUrl === "string" ? image.imageUrl.trim() : "";
  const storagePath =
    typeof image?.storagePath === "string" ? image.storagePath.trim() : "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucketName =
    process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET?.trim() ||
    "lpu-generator-images";

  if (!storagePath || !supabaseUrl || !serviceRoleKey) {
    return directUrl;
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
    return directUrl;
  }

  const signData = (await signResponse.json()) as { signedURL?: string };
  const signedPath = typeof signData?.signedURL === "string" ? signData.signedURL : "";
  if (!signedPath) return directUrl;

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateBody;
    const notes = body?.notes?.trim();
    const images = Array.isArray(body?.images) ? body.images : [];
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

    const imageUrls = (
      await Promise.all(images.map((image) => resolveGeneratorImageUrl(image)))
    ).filter((url) => typeof url === "string" && url.trim().length > 0);

    const userContent: Array<
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" }
> = [
  {
    type: "input_text",
    text: `Generate the full LP-U output for this item.

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
  model: "gpt-5.3-chat-latest",
  instructions,
  input: [
    {
      role: "user",
      content: userContent,
    },
  ],
});

let lpuOutput = response.output_text ?? "";

let validation = validateLpuOutput(lpuOutput, {
  itemType: "auto",
  requirePoshmarkCompactTagStrategy: true,
});

if (hasPoshmarkOutputOrderIssues(validation)) {
  const revisionResponse = await openai.responses.create({
    model: "gpt-5.3-chat-latest",
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
  });

  const revisedOutput = revisionResponse.output_text ?? "";

  if (revisedOutput.trim()) {
    lpuOutput = revisedOutput;

    validation = validateLpuOutput(lpuOutput, {
      itemType: "auto",
      requirePoshmarkCompactTagStrategy: true,
    });
  }
}

if (promptVersion === "v2" && hasPoshmarkInvalidStyleTagIssues(validation)) {
  const revisionResponse = await openai.responses.create({
    model: "gpt-5.3-chat-latest",
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
  });

  const revisedOutput = revisionResponse.output_text ?? "";

  if (revisedOutput.trim()) {
    lpuOutput = revisedOutput;

    validation = validateLpuOutput(lpuOutput, {
      itemType: "auto",
      requirePoshmarkCompactTagStrategy: true,
    });
  }
}

if (hasOnlyTitleLengthIssues(validation)) {
  const revisionResponse = await openai.responses.create({
    model: "gpt-5.3-chat-latest",
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
  });

  const revisedOutput = revisionResponse.output_text ?? "";

  if (revisedOutput.trim()) {
    lpuOutput = revisedOutput;

    validation = validateLpuOutput(lpuOutput, {
      itemType: "auto",
      requirePoshmarkCompactTagStrategy: true,
    });
  }
}

return NextResponse.json({
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
});
  } catch (error) {
    console.error("LP-U generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate LP-U output." },
      { status: 500 }
    );
  }
}
