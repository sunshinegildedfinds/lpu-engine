import { LABELS, TITLE_MAX_LENGTH, TITLE_MIN_LENGTH } from '../constants';
import {
  addIssue,
  checkFooter,
  detectFooterType,
  extractLabeledBlockText,
  hasLabeledContent,
  isLengthInRange,
  makeResult,
  requireSectionPresent,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult } from '../types';

export function validateEbay(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
): PlatformValidationResult {
  const result = makeResult('ebay', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';

  const titleA = extractLabeledBlockText(section, LABELS.ebay.titleA);
  const titleB = extractLabeledBlockText(section, LABELS.ebay.titleB);

  result.metrics.titleA = titleA ?? null;
  result.metrics.titleB = titleB ?? null;
  result.metrics.titleALength = titleA?.length ?? 0;
  result.metrics.titleBLength = titleB?.length ?? 0;

  if (!titleA) {
    addIssue(result, 'EBAY_TITLE_A_MISSING', 'eBay Title A is missing.');
  } else if (!isLengthInRange(titleA, TITLE_MIN_LENGTH, TITLE_MAX_LENGTH)) {
    addIssue(
      result,
      'EBAY_TITLE_A_LENGTH',
      `eBay Title A must be ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH} characters.`,
    );
  }

  if (!titleB) {
    addIssue(result, 'EBAY_TITLE_B_MISSING', 'eBay Title B is missing.');
  } else if (!isLengthInRange(titleB, TITLE_MIN_LENGTH, TITLE_MAX_LENGTH)) {
    addIssue(
      result,
      'EBAY_TITLE_B_LENGTH',
      `eBay Title B must be ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH} characters.`,
    );
  }

  result.metrics.hasCategory = hasLabeledContent(section, LABELS.ebay.category);
  result.metrics.hasItemSpecificsBlock = hasLabeledContent(section, LABELS.ebay.itemSpecifics);
  result.metrics.hasDescription = hasLabeledContent(section, LABELS.ebay.description);
  result.metrics.hasMeasurementsBlock = hasLabeledContent(section, LABELS.ebay.measurements);

  if (!result.metrics.hasCategory) {
    addIssue(result, 'EBAY_CATEGORY_MISSING', 'eBay category is missing.');
  }

  if (!result.metrics.hasItemSpecificsBlock) {
    addIssue(result, 'EBAY_ITEM_SPECIFICS_MISSING', 'eBay item specifics block is missing.');
  }

  if (!result.metrics.hasDescription) {
    addIssue(result, 'EBAY_DESCRIPTION_MISSING', 'eBay description is missing.');
  }

  if (!result.metrics.hasMeasurementsBlock) {
    addIssue(result, 'EBAY_MEASUREMENTS_MISSING', 'eBay measurements block is missing.');
  }

  checkFooter(result, detectFooterType(section), expectedFooterType);

  return result;
}