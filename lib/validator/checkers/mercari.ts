import {
  LABELS,
  REQUIRED_MERCARI_HASHTAGS,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../constants';
import {
  addIssue,
  checkFooter,
  countHashtags,
  detectFooterType,
  extractLabeledBlockText,
  hasLabeledContent,
  isLengthInRange,
  makeResult,
  requireSectionPresent,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult } from '../types';

export function validateMercari(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
): PlatformValidationResult {
  const result = makeResult('mercari', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';

  const title = extractLabeledBlockText(section, LABELS.mercari.title);
  result.metrics.title = title ?? null;
  result.metrics.titleLength = title?.length ?? 0;

  if (!title) {
    addIssue(result, 'MERCARI_TITLE_MISSING', 'Mercari title is missing.');
  } else if (!isLengthInRange(title, TITLE_MIN_LENGTH, TITLE_MAX_LENGTH)) {
    addIssue(
      result,
      'MERCARI_TITLE_LENGTH',
      `Mercari title must be ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH} characters.`,
    );
  }

  result.metrics.hasDescription = hasLabeledContent(section, LABELS.mercari.description);
  result.metrics.hasMeasurementsBlock = hasLabeledContent(section, LABELS.mercari.measurements);

  if (!result.metrics.hasDescription) {
    addIssue(result, 'MERCARI_DESCRIPTION_MISSING', 'Mercari description is missing.');
  }

  if (!result.metrics.hasMeasurementsBlock) {
    addIssue(result, 'MERCARI_MEASUREMENTS_MISSING', 'Mercari measurements block is missing.');
  }

  const hashtagsBlock = extractLabeledBlockText(section, LABELS.mercari.hashtags) ?? '';
  const hashtagCount = countHashtags(hashtagsBlock);

  result.metrics.hashtagCount = hashtagCount;

  if (hashtagCount !== REQUIRED_MERCARI_HASHTAGS) {
    addIssue(
      result,
      'MERCARI_HASHTAG_COUNT',
      `Mercari must have exactly ${REQUIRED_MERCARI_HASHTAGS} hashtags.`,
    );
  }

  checkFooter(result, detectFooterType(section), expectedFooterType);

  return result;
}