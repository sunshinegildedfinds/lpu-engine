import type { FinalTitleSelection } from "@/lib/ebay/selectFinalTitle";
import type { EbayValidationResult } from "@/lib/ebay/validateDraft";

export type ReadyToSendState = {
  isReadyToSend: boolean;
  reasons: string[];
  blockingIssues: string[];
  summaryLabel: string;
};

function hasPassedCheck(validation: EbayValidationResult, label: string): boolean {
  const check = validation.checks.find((item) => item.label === label);
  return check?.pass ?? false;
}

export function getReadyToSendState(input: {
  finalTitleSelection: FinalTitleSelection;
  validation: EbayValidationResult;
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

  const footerExists = hasPassedCheck(input.validation, "Standard footer exists");
  if (footerExists) {
    reasons.push("Standard footer exists.");
  } else {
    blockingIssues.push("Standard footer is missing.");
  }

  const isReadyToSend = blockingIssues.length === 0;

  return {
    isReadyToSend,
    reasons,
    blockingIssues,
    summaryLabel: isReadyToSend ? "Ready to send" : "Not ready to send",
  };
}
