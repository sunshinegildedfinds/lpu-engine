import { LABELS, REQUIRED_DEPOP_HASHTAGS } from '../constants';
import {
  addIssue,
  checkFooter,
  countHashtags,
  detectFooterType,
  extractLabeledBlockText,
  hasLabeledContent,
  makeResult,
  requireSectionPresent,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult } from '../types';

export function validateDepop(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
): PlatformValidationResult {
  const result = makeResult('depop', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';

  result.metrics.hasAestheticMode = hasLabeledContent(section, LABELS.depop.aestheticMode);
  result.metrics.hasListingBlock = hasLabeledContent(section, LABELS.depop.listingBlock);
  result.metrics.hasMeasurementsBlock = hasLabeledContent(section, LABELS.depop.measurements);

  if (!result.metrics.hasAestheticMode) {
    addIssue(result, 'DEPOP_AESTHETIC_MODE_MISSING', 'Depop Aesthetic Mode is missing.');
  }

  if (!result.metrics.hasListingBlock) {
    addIssue(result, 'DEPOP_LISTING_BLOCK_MISSING', 'Depop listing block is missing.');
  }

  if (!result.metrics.hasMeasurementsBlock) {
    addIssue(result, 'DEPOP_MEASUREMENTS_MISSING', 'Depop measurements block is missing.');
  }

  const requiredHashtagsBlock = extractLabeledBlockText(section, LABELS.depop.hashtags) ?? '';
  const brandHashtagsBlock =
    extractLabeledBlockText(section, LABELS.depop.optionalBrandHashtags) ?? '';

  const requiredHashtagCount = countHashtags(requiredHashtagsBlock);
  const brandHashtagCount = countHashtags(brandHashtagsBlock);

  result.metrics.requiredHashtagCount = requiredHashtagCount;
  result.metrics.brandHashtagCount = brandHashtagCount;
  result.metrics.totalHashtagCount = requiredHashtagCount + brandHashtagCount;

  if (requiredHashtagCount !== REQUIRED_DEPOP_HASHTAGS) {
    addIssue(
      result,
      'DEPOP_REQUIRED_HASHTAGS_COUNT',
      `Depop required hashtags must equal ${REQUIRED_DEPOP_HASHTAGS}. Optional brand hashtags are counted separately.`,
    );
  }

  checkFooter(result, detectFooterType(section), expectedFooterType);

  return result;
}