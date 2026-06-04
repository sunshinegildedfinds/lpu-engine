import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
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

function normalizeMode(mode: unknown): "sellingBrief" | "finalFromBrief" | undefined {
  return mode === "sellingBrief" || mode === "finalFromBrief" ? mode : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

Universal rule:
- If the uploaded item photos or generated brief evidence clearly support a style/theme/aesthetic candidate as a buyer-search visual descriptor, mark Confidence Level: Confirmed.
- Claim Limit prevents overclaiming. Claim Limit is not a usage blocker.
- A candidate can be Confirmed and still have strong Claim Limit restrictions.
- Content entered in Known Details / user notes is seller-provided evidence.
- If Known Details contains a direct factual descriptor such as Vintage, Handmade, Deadstock, New, NOS, Signed, Tested, Untested, Complete, Sealed, or a similar seller-known item fact, treat it as seller-confirmed unless it conflicts with photos or the brief's evidence.
- If Known Details says Vintage, then Vintage = Yes. Do not weaken it into vintage style, vintage-inspired, appears vintage, or possibly vintage. Do not claim exact decade, antique status, production period, historical era, provenance, or rarity unless separately supported.
- If Known Details contains a style/theme/aesthetic term and the brief evidence does not contradict it, treat it as a seller-preferred candidate.
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
  Blocked Overclaims: Do not claim exact production date, documented design line, rarity, provenance, material composition, authenticity, or designer intent unless supported.
- Claim Limit is not a reason to add style, look, inspired, aesthetic, visual style, design, detailing, motif, influence, or similar caution suffixes.

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
    model: "gpt-5.3-chat-latest",
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
  sellingBrief: string
): Promise<string> {
  if (!sellingBrief.trim()) {
    return sellingBrief;
  }

  const response = await openai.responses.create({
    model: "gpt-5.3-chat-latest",
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

  return repairedBrief.trim() ? repairedBrief : sellingBrief;
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

function repairFinalFromBriefExactCandidateSuffixes({
  lpuOutput,
  sellingBrief,
}: {
  lpuOutput: string;
  sellingBrief: string;
}): string {
  const exactSafeWordings = getExactConfirmedStyleCandidateSafeWordings(sellingBrief);

  if (exactSafeWordings.length === 0 || !lpuOutput.trim()) {
    return lpuOutput;
  }

  let isInsideDepopAestheticModeBlock = false;

  return lpuOutput
    .split("\n")
    .map((line) => {
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

      for (const safeWording of exactSafeWordings) {
        const suffixPattern = new RegExp(
          `(^|[^A-Za-z0-9])(${escapeRegExp(safeWording)})(?:\\s+(?:style|look|inspired|design|styling|visual\\s+style|aesthetic|motif|influence)|-inspired)\\b`,
          "gi"
        );

        repairedLine = repairedLine.replace(
          suffixPattern,
          (_match, prefix: string) => `${prefix}${safeWording}`
        );
      }

      return repairedLine;
    })
    .join("\n");
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
- Etsy Tags rules
- Poshmark Description Search keywords line
- rejected STYLE / THEME / AESTHETIC CANDIDATE BANK terms
- phrases from Generic Phrases to Avoid
- exact Confirmed style/theme/aesthetic Safe Wording
- Primary Style / Theme / Aesthetic Candidate placement
- weak generic marketplace body copy
- awkward Confirmed candidate term sentence fragments
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

Exact Confirmed candidate wording behavior:
- The Selling Brief's Safe Wording is controlling.
- Treat the Selling Brief's Primary Style / Theme / Aesthetic Candidate as controlling guidance.
- For Confirmed STYLE / THEME / AESTHETIC CANDIDATE BANK rows where Safe Wording equals the exact Candidate Term, copy that exact Safe Wording in final LP-U copy.
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
- Claim Limit controls blocked overclaims. It does not require adding style, look, inspired, design, styling, visual style, aesthetic, motif, or influence suffixes.
- If a directed candidate cannot fit in a title/opening, leave that field within platform limits and keep the candidate in the closest already-allowed location such as description, item specifics, tags, or attributes if present. Do not invent a new section.
- Preserve seller-confirmed Known Details as direct facts. If Known Details states Vintage and the Selling Brief does not show a conflict, final copy should use vintage confidently and must not rewrite it as vintage style, vintage-inspired, appears vintage, or possibly vintage.
- Do not claim exact decade, antique status, production period, historical era, provenance, material composition, authenticity, designer intent, or rarity unless separately supported by the brief.
- Preserve material-safe and appearance-safe wording such as gold-tone, silver-tone, leather-like, wood-tone, glass-like, stone-like, rhinestone-style, material not confirmed, exact material not confirmed, metal not specified, and gemstone not confirmed.
- Do not add untested, not tested, functionality not tested, clasp not tested, not formally tested, working status unknown, or similar defensive functionality caveats unless the seller explicitly provided that information in Known Details, condition notes, flaw notes, or item notes.

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
- Include supported details when natural and useful: brand/maker, item type, Primary Style / Theme / Aesthetic Candidate, motif/design/construction, color/material appearance, size/measurement when important, seller-confirmed Vintage when relevant, condition/age category, or standout buyer-search detail.
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
- Prefer meaningful supported alternatives from the Selling Brief and final evidence: brand/maker, item type, confirmed style/theme/aesthetic candidate, motif/design, color/material appearance, size/measurement, closure/component, use/display/collector/gift context when supported, known item category, or buyer search synonym.
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
- Include relevant supported phrases such as brand, item type, confirmed style/theme/aesthetic candidate, color/material appearance, size/measurement, condition, motif/pattern, use context, and category terms when useful.
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

Weak generic marketplace language repair:
- Remove or rewrite weak generic phrases wherever they appear as standalone selling claims in body copy, tags, hashtags, keyword lines, attributes, key details, and photo/video suggestions.
- Weak generic phrases include: great for collectors, anyone drawn to, works well, statement piece, standout piece, beautiful piece, unique find, perfect for any outfit, great addition, timeless, high quality, stylish accessory, versatile piece, eye-catching, must-have, rare find, collector's item, collector’s item, decorative piece, classic design, perfect gift, gift for her.
- Do not leave those phrases in eBay Description, Depop Listing, Poshmark Description, Mercari Description, Etsy Description, Etsy Tags, Depop Hashtags, Poshmark Search keywords line, Photo tips, Video ideas, Attributes, or Key Details unless the phrase is seller-provided exact text and still safe.
- If a weak phrase is seller-provided exact text and safe, preserve the seller-provided fact but improve the surrounding sentence so it is evidence-grounded.
- Replace weak phrases only with supported anchors from the Selling Brief and current final output.
- A replacement sentence must use at least two supported anchors, such as brand/maker/mark/model, confirmed candidate Safe Wording, item type, visible construction, closure/hardware/component, color/pattern/motif, material appearance, measurement basis, condition basis, included/not-included details, seller-confirmed Known Details, claim limit, packaging/label/marking, or use/fit/display/function context.
- Do not hardcode examples into the output.
- Do not remove valid saved Poshmark Style Tags.
- Do not remove valid Depop Aesthetic Mode values.
- Do not remove required platform labels.
- Do not remove material-safe wording.

Awkward candidate wording repair:
- Scan every final LP-U sentence that contains an exact Confirmed candidate Safe Wording.
- If the sentence uses the candidate as an awkward fragment, rewrite only that sentence or remove it.
- Bad patterns include: creating an [candidate], with [candidate] when the candidate is not a natural noun phrase, [candidate] that when the candidate cannot stand alone, This piece is [candidate] when awkward, reflects [candidate] styling, works well for [candidate] looks, or any sentence that adds style/look/inspired/design/styling/visual style/aesthetic/motif/influence to exact Safe Wording without support.
- Preserve the exact Confirmed Safe Wording. Do not add unwanted suffixes to make grammar work.
- Use the candidate naturally as a search descriptor, adjective, title/tag term, or concise descriptive phrase only when it reads clearly.
- If exact candidate wording cannot be used naturally in a sentence, remove that sentence and let the candidate remain in title, tags, hashtags, keywords, item specifics, or attributes where appropriate.
- Do not turn a candidate into an unsupported historical, origin, authenticity, rarity, material, designer-intent, or production-period claim.

Etsy Description quality repair:
- Specifically review Etsy Description after the generic phrase and awkward candidate repairs.
- If Etsy Description contains weak generic copy, awkward candidate fragments, broad filler use/context language, unsupported caveats, or a thin generated tone, rewrite only Etsy Description.
- Preserve Etsy Title, Etsy Tags, Etsy Category, Etsy Materials, Etsy Attributes / Key Details, Measurements, and footer unless a sentence-level consistency repair inside Etsy Description requires changing description words.
- Etsy Description should use this structure without adding new labels unless the existing section already uses labels:
  1. Opening paragraph: human-readable item identification with supported brand/maker when available, primary confirmed style/theme/aesthetic candidate when useful, item type, and one or two strongest visible design details.
  2. Evidence/design paragraph: concrete appeal based on visible construction, motif, color, material appearance, closure/component, mark/label, measurement details, or condition basis.
  3. Buyer decision paragraph or bullets: condition basis, measurement/fit/scale basis, included/not-included detail when relevant, seller-confirmed Known Details, and claim limits where needed.
  4. Optional use/context sentence only when evidence-specific.
  5. Photo/video suggestions only if they add buyer trust and are specific to the item.
- Etsy Description must avoid broad generic lines such as great for collectors, anyone drawn to, perfect gift, gift for her, timeless, beautiful, rare, high quality, must-have, unique find, statement piece, decorative piece, works well, or versatile.
- If a use/context sentence remains, tie it to supported evidence such as confirmed candidate Safe Wording, visible construction or design detail, condition basis, measurement/fit/scale, brand/mark, included component, or use/display/function context.

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
}: {
  imageUrls: string[];
  instructions: string;
  notes: string;
  promptVersion: "v1" | "v2";
  sellingBrief?: string;
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
For Confirmed STYLE / THEME / AESTHETIC CANDIDATE BANK rows where Safe Wording equals the exact Candidate Term, copy that exact Safe Wording everywhere final LP-U copy uses the candidate.
When choosing between candidates for high-visibility fields, prioritize seller-preferred candidates first, then the most specific and buyer-search-useful Confirmed named style/theme/aesthetic/search phrase over generic visual descriptors. Do not let generic visual adjectives replace the primary or strongest Confirmed named candidate when it fits, improves search, and is not misleading.
Do not prefer a shorter candidate solely because it is shorter when a more specific candidate also fits.
Do not silently ignore high-visibility placement instructions from the brief.
If a Confirmed candidate cannot fit in a title/opening, move it to the closest appropriate allowed location such as description, item specifics, tags, or attributes.
Do not add style, look, inspired, design, or styling suffixes to Confirmed style/theme/aesthetic Safe Wording unless the suffix appears in the Selling Brief Safe Wording or Candidate Term, the seller explicitly typed it, readable label/marking/packaging uses it, or exact wording would materially mislead.
Claim Limit controls blocked overclaims. It does not require adding style, look, inspired, design, or styling suffixes.
For Depop Aesthetic Mode, if the Selling Brief has Confirmed or Seller-provided style/theme/aesthetic candidates and the Depop Angle is style-led, visual/vibe-driven, style-driven, aesthetic-driven, fashion-led, decor-led, collector/display-led, or otherwise style-relevant, do not use "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}" for Primary or Secondary. Use only exact saved Depop Aesthetic Mode values.
For Etsy Title, write a human-readable title under 140 characters that front-loads the strongest buyer-search phrase in the first 40 characters and expands naturally with supported high-value details. Do not leave it bare/minimal when brand/maker, item type, Primary Style / Theme / Aesthetic Candidate, motif/design/construction, color/material appearance, important size/measurement, seller-confirmed Vintage, or standout buyer-search detail can fit naturally.
For all final body copy, do not use weak generic marketplace claims such as great for collectors, anyone drawn to, works well, statement piece, standout piece, beautiful piece, unique find, perfect for any outfit, great addition, timeless, high quality, stylish accessory, versatile piece, eye-catching, must-have, rare find, collector's item, collector’s item, decorative piece, classic design, perfect gift, or gift for her unless rewritten with at least two supported evidence anchors from the Selling Brief.
Use exact Confirmed candidate Safe Wording naturally. Do not soften it with unsupported suffixes, and do not force it into awkward fragments such as creating an [candidate], with [candidate], reflects [candidate] styling, or works well for [candidate] looks. If it cannot read naturally in a sentence, leave it in search fields such as titles, tags, hashtags, keywords, item specifics, or attributes and describe the visible evidence in body copy.
For Etsy Description, write human curated copy grounded in the Selling Brief: identify the supported brand/maker and item type when available, use the primary confirmed candidate when useful, describe visible design/construction/color/material appearance/closure/marking details, include condition and measurement basis, preserve relevant seller-confirmed Known Details, and avoid broad gift/collector/styling filler.
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

  const validationOptions = {
    itemType: "auto",
    requirePoshmarkCompactTagStrategy: true,
    enforceUnsupportedEstimatedMeasurements: promptVersion === "v2",
  } as const;

  let validation = validateLpuOutput(lpuOutput, validationOptions);

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

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasMercariOutputFormatIssues(validation)) {
    const revisionResponse = await openai.responses.create({
      model: "gpt-5.3-chat-latest",
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
    });

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
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

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasDepopInvalidAestheticModeIssues(validation)) {
    const revisionResponse = await openai.responses.create({
      model: "gpt-5.3-chat-latest",
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
    });

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && hasEstimatedMeasurementUnsupportedIssues(validation)) {
    const revisionResponse = await openai.responses.create({
      model: "gpt-5.3-chat-latest",
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
    });

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
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

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && sellingBrief?.trim()) {
    const revisionResponse = await openai.responses.create({
      model: "gpt-5.3-chat-latest",
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
    });

    const revisedOutput = revisionResponse.output_text ?? "";

    if (revisedOutput.trim()) {
      lpuOutput = revisedOutput;

      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  if (promptVersion === "v2" && sellingBrief?.trim()) {
    const repairedOutput = repairFinalFromBriefExactCandidateSuffixes({
      lpuOutput,
      sellingBrief,
    });

    if (repairedOutput !== lpuOutput) {
      lpuOutput = repairedOutput;
      validation = validateLpuOutput(lpuOutput, validationOptions);
    }
  }

  return { lpuOutput, validation };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateBody;
    const notes = body?.notes?.trim();
    const images = Array.isArray(body?.images) ? body.images : [];
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

    const imageUrls = (
      await Promise.all(images.map((image) => resolveGeneratorImageUrl(image)))
    ).filter((url) => typeof url === "string" && url.trim().length > 0);

    if (mode === "sellingBrief") {
      const briefOutput = await generateSellingBrief({ imageUrls, notes });
      const repairedBriefOutput = await repairSellingBriefCandidateBank(briefOutput);

      return NextResponse.json({
        output: repairedBriefOutput,
        sellingBrief: repairedBriefOutput,
        promptVersion,
        ...(interfaceVersion ? { interfaceVersion } : {}),
      });
    }

    const { lpuOutput, validation } = await generateValidatedLpuOutput({
      imageUrls,
      instructions,
      notes,
      promptVersion,
      ...(mode === "finalFromBrief" ? { sellingBrief } : {}),
    });

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
