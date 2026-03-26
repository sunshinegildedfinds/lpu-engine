import {
  LABELS,
  REQUIRED_POSHMARK_STYLE_TAGS,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../constants';
import {
  addIssue,
  checkFooter,
  detectFooterType,
  extractLabeledBlockText,
  hasLabeledContent,
  isLengthInRange,
  makeResult,
  requireSectionPresent,
  splitListItems,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult, ValidatorOptions } from '../types';

export function validatePoshmark(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
  options?: ValidatorOptions,
): PlatformValidationResult {
  const result = makeResult('poshmark', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';

  const title = extractLabeledBlockText(section, LABELS.poshmark.title);
  result.metrics.title = title ?? null;
  result.metrics.titleLength = title?.length ?? 0;

  if (!title) {
    addIssue(result, 'POSHMARK_TITLE_MISSING', 'Poshmark title is missing.');
  } else if (!isLengthInRange(title, TITLE_MIN_LENGTH, TITLE_MAX_LENGTH)) {
    addIssue(
      result,
      'POSHMARK_TITLE_LENGTH',
      `Poshmark title must be ${TITLE_MIN_LENGTH}-${TITLE_MAX_LENGTH} characters.`,
    );
  }

  result.metrics.hasDescription = hasLabeledContent(section, LABELS.poshmark.description);
  result.metrics.hasMeasurementsBlock = hasLabeledContent(section, LABELS.poshmark.measurements);

  if (!result.metrics.hasDescription) {
    addIssue(result, 'POSHMARK_DESCRIPTION_MISSING', 'Poshmark description is missing.');
  }

  if (!result.metrics.hasMeasurementsBlock) {
    addIssue(result, 'POSHMARK_MEASUREMENTS_MISSING', 'Poshmark measurements block is missing.');
  }

  const styleTagsBlock = extractLabeledBlockText(section, LABELS.poshmark.styleTags) ?? '';
  const styleTags = splitListItems(styleTagsBlock);

  result.metrics.styleTagCount = styleTags.length;
  result.metrics.styleTags = styleTags;

  if (styleTags.length !== REQUIRED_POSHMARK_STYLE_TAGS) {
    addIssue(
      result,
      'POSHMARK_STYLE_TAG_COUNT',
      `Poshmark must have exactly ${REQUIRED_POSHMARK_STYLE_TAGS} style tags.`,
    );
  }

  const requireCompact = options?.requirePoshmarkCompactTagStrategy ?? false;
  const hasCompactAlt = hasLabeledContent(section, LABELS.poshmark.compactAlt);

  result.metrics.requiresCompact3TagStrategy = requireCompact;
  result.metrics.hasCompact3TagStrategy = hasCompactAlt;

  if (requireCompact && !hasCompactAlt) {
    addIssue(
      result,
      'POSHMARK_COMPACT_ALT_MISSING',
      'Compact 3-Tag Strategy (Alt Option) is required but missing.',
    );
  }

  checkFooter(result, detectFooterType(section), expectedFooterType);

  return result;
}