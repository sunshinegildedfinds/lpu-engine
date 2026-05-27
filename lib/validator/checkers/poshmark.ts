import {
  LABELS,
  JEWELRY_FOOTER,
  POSHMARK_STYLE_TAG_MASTER_LIST,
  REQUIRED_POSHMARK_STYLE_TAGS,
  STANDARD_FOOTER,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../constants';
import {
  addIssue,
  checkFooter,
  detectFooterType,
  extractLabeledBlockText,
  findLabeledLineIndex,
  hasLabeledContent,
  isLengthInRange,
  makeResult,
  requireSectionPresent,
  splitListItems,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult, ValidatorOptions } from '../types';

const POSHMARK_STYLE_TAG_MASTER_SET = new Set<string>(POSHMARK_STYLE_TAG_MASTER_LIST);

function checkRequiredFieldOrder(result: PlatformValidationResult, section: string): void {
  const requiredFields = [
    { name: 'Title', labels: LABELS.poshmark.title },
    { name: 'Description', labels: LABELS.poshmark.description },
    { name: 'Style Tags', labels: LABELS.poshmark.styleTags },
    { name: 'Compact 3-Tag Strategy (Alt Option)', labels: LABELS.poshmark.compactAlt },
    { name: 'Approximate Measurements', labels: LABELS.poshmark.measurements },
  ];

  const fieldPositions = requiredFields.map((field) => ({
    name: field.name,
    index: findLabeledLineIndex(section, field.labels),
  }));
  const presentFieldPositions = fieldPositions.filter((field) => field.index !== -1);
  const isInRequiredOrder = presentFieldPositions.every(
    (field, index) => index === 0 || field.index > presentFieldPositions[index - 1].index,
  );

  result.metrics.fieldOrder = fieldPositions;

  if (!isInRequiredOrder) {
    addIssue(
      result,
      'POSHMARK_FIELD_ORDER',
      'Poshmark fields must appear in this order: Title, Description, Style Tags, Compact 3-Tag Strategy (Alt Option), Approximate Measurements.',
    );
  }

  const measurementsIndex = findLabeledLineIndex(section, LABELS.poshmark.measurements);
  const footerIndex = section
    .replace(/\r\n/g, '\n')
    .split('\n')
    .findIndex((line) => line.includes(STANDARD_FOOTER) || line.includes(JEWELRY_FOOTER));

  result.metrics.footerAfterMeasurements =
    measurementsIndex !== -1 && footerIndex !== -1 && footerIndex > measurementsIndex;

  if (measurementsIndex !== -1 && footerIndex !== -1 && footerIndex < measurementsIndex) {
    addIssue(
      result,
      'POSHMARK_FOOTER_ORDER',
      'Poshmark footer must appear after the Approximate Measurements block.',
    );
  }
}

function checkStyleTagsAgainstMasterList(
  result: PlatformValidationResult,
  blockName: string,
  tags: string[],
): void {
  const invalidTags = tags.filter((tag) => !POSHMARK_STYLE_TAG_MASTER_SET.has(tag));

  if (invalidTags.length === 0) return;

  const existingInvalidTags = Array.isArray(result.metrics.invalidStyleTags)
    ? result.metrics.invalidStyleTags
    : [];

  result.metrics.invalidStyleTags = [
    ...existingInvalidTags,
    ...invalidTags.map((tag) => ({ block: blockName, tag })),
  ];

  for (const tag of invalidTags) {
    addIssue(
      result,
      'POSHMARK_INVALID_STYLE_TAG',
      `${blockName} contains invalid Poshmark style tag "${tag}". Use exact tags from the saved Poshmark Style Tag master list only.`,
    );
  }
}

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

  checkRequiredFieldOrder(result, section);

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

  checkStyleTagsAgainstMasterList(result, 'Style Tags', styleTags);

  if (styleTags.length !== REQUIRED_POSHMARK_STYLE_TAGS) {
    addIssue(
      result,
      'POSHMARK_STYLE_TAG_COUNT',
      `Poshmark must have exactly ${REQUIRED_POSHMARK_STYLE_TAGS} style tags.`,
    );
  }

  const requireCompact = options?.requirePoshmarkCompactTagStrategy ?? false;
  const hasCompactAlt = hasLabeledContent(section, LABELS.poshmark.compactAlt);
  const compactAltBlock = extractLabeledBlockText(section, LABELS.poshmark.compactAlt) ?? '';
  const compactAltTags = splitListItems(compactAltBlock);

  result.metrics.requiresCompact3TagStrategy = requireCompact;
  result.metrics.hasCompact3TagStrategy = hasCompactAlt;
  result.metrics.compact3TagStrategyTags = compactAltTags;

  if (hasCompactAlt) {
    checkStyleTagsAgainstMasterList(
      result,
      'Compact 3-Tag Strategy (Alt Option)',
      compactAltTags,
    );
  }

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
