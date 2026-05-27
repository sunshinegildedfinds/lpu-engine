import {
  LABELS,
  JEWELRY_FOOTER,
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
