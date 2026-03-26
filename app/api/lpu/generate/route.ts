import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { MASTER_LPU_INSTRUCTIONS } from "@/lib/lpu/masterPrompt";
import { validateLpuOutput } from "@/lib/validator";

type IncomingImage = {
  name: string;
  type: string;
  dataUrl: string;
};

type GenerateBody = {
  notes: string;
  images: IncomingImage[];
};

function hasOnlyTitleLengthIssues(validation: any): boolean {
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
    (issue: any) => issue?.severity === "error" && allowedCodes.has(issue?.code)
  );
}

function buildTitleRevisionInstruction(output: string, validation: any): string {
  const issueLines = (validation?.issues ?? []).map(
    (issue: any) => `- ${issue.code}: ${issue.message}`
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateBody;
    const notes = body?.notes?.trim();
    const images = Array.isArray(body?.images) ? body.images : [];

    if (!notes) {
      return NextResponse.json(
        { error: "Notes are required." },
        { status: 400 }
      );
    }

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
  ...images.map((image) => ({
    type: "input_image" as const,
    image_url: image.dataUrl,
    detail: "auto" as const,
  })),
];

    const response = await openai.responses.create({
  model: "gpt-5.3-chat-latest",
  instructions: MASTER_LPU_INSTRUCTIONS,
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
});
  } catch (error) {
    console.error("LP-U generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate LP-U output." },
      { status: 500 }
    );
  }
}