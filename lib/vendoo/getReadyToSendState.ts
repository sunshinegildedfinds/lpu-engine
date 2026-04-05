import type { FinalTitleSelection } from "@/lib/ebay/selectFinalTitle";
import type { EbayValidationResult } from "@/lib/ebay/validateDraft";

export type ReadyToSendState = {
  isReadyToSend: boolean;
  reasons: string[];
  blockingIssues: string[];
  summaryLabel: string;
};

export const STANDARD_FOOTER =
  "Ships within one day after payment is received. Please see all pictures before purchasing. Stock photo is for reference only and may differ slightly from the actual item.";
export const JEWELRY_FOOTER =
  "Ships within one business day after purchase. Displays & boxes shown are not included.";

function normalizeForFooterCheck(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function isJewelryLike(value: string): boolean {
  const normalized = normalizeForFooterCheck(value);
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

function hasPassedCheck(validation: EbayValidationResult, label: string): boolean {
  const check = validation.checks.find((item) => item.label === label);
  return check?.pass ?? false;
}

export function getReadyToSendState(input: {
  finalTitleSelection: FinalTitleSelection;
  validation: EbayValidationResult;
  description: string;
}): ReadyToSendState {
  const reasons: string[] = [];
  const blockingIssues: string[] = [];

  const finalTitle = input.finalTitleSelection.selectedTitle.trim();
  const finalTitleLength = finalTitle.length;

  const finalTitleExists = finalTitleLength > 0;
  if (finalTitleExists) {
    reasons.push("Final selected eBay title exists.");
  } else {
    blockingIssues.push("Final selected eBay title is missing.");
  }

  const finalTitleLengthIsValid = finalTitleLength >= 70 && finalTitleLength <= 80;
  if (finalTitleLengthIsValid) {
    reasons.push("Final selected eBay title length is between 70 and 80.");
  } else {
    blockingIssues.push(
      `Final selected eBay title length must be 70 to 80 characters (current: ${finalTitleLength}).`
    );
  }

  const descriptionExists = hasPassedCheck(input.validation, "Description exists");
  if (descriptionExists) {
    reasons.push("Description exists.");
  } else {
    blockingIssues.push("Description is missing.");
  }

  const measurementsExist = hasPassedCheck(input.validation, "Measurements block exists");
  if (measurementsExist) {
    reasons.push("Measurements block exists.");
  } else {
    blockingIssues.push("Measurements block is missing.");
  }

  const footerSource = `${input.finalTitleSelection.titleA.title ?? ""} ${
    input.finalTitleSelection.titleB.title ?? ""
  } ${input.description ?? ""}`;
  const jewelryItem = isJewelryLike(footerSource);
  const expectedFooter = jewelryItem ? JEWELRY_FOOTER : STANDARD_FOOTER;
  const hasExpectedFooter = normalizeForFooterCheck(input.description ?? "").includes(
    normalizeForFooterCheck(expectedFooter)
  );

  if (hasExpectedFooter) {
    reasons.push(jewelryItem ? "Jewelry footer exists." : "Standard footer exists.");
  } else {
    blockingIssues.push(jewelryItem ? "Jewelry footer is missing." : "Standard footer is missing.");
  }

  const isReadyToSend = blockingIssues.length === 0;

  return {
    isReadyToSend,
    reasons,
    blockingIssues,
    summaryLabel: isReadyToSend ? "Ready to send" : "Not ready to send",
  };
}
