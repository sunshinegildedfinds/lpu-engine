import {
  LABELS,
  JEWELRY_FOOTER,
  REQUIRED_MERCARI_HASHTAGS,
  STANDARD_FOOTER,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../constants';
import {
  addIssue,
  checkFooter,
  countHashtags,
  detectFooterType,
  extractLabeledBlockText,
  findLabeledLineIndex,
  hasLabeledContent,
  isLengthInRange,
  makeResult,
  normalizeWhitespace,
  requireSectionPresent,
  stripMarkdown,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult } from '../types';

type RequiredMercariField = {
  name: string;
  labels: readonly string[];
};

const REQUIRED_MERCARI_FIELDS: RequiredMercariField[] = [
  { name: 'Title', labels: LABELS.mercari.title },
  { name: 'Description', labels: LABELS.mercari.description },
  { name: 'Hashtags', labels: LABELS.mercari.hashtags },
  { name: 'Approximate Measurements', labels: LABELS.mercari.measurements },
];

function findAllLabeledLineIndexes(section: string, labels: readonly string[]): number[] {
  const lowerLabels = labels.map((label) => label.toLowerCase());

  return section
    .replace(/\r\n/g, '\n')
    .split('\n')
    .reduce<number[]>((indexes, line, index) => {
      const normalized = stripMarkdown(line).toLowerCase();
      const isMatch = lowerLabels.some(
        (label) => normalized === label || normalized.startsWith(`${label}:`),
      );

      return isMatch ? [...indexes, index] : indexes;
    }, []);
}

function countNormalizedOccurrences(value: string, searchValue: string): number {
  if (!searchValue) return 0;

  let count = 0;
  let startIndex = 0;

  while (startIndex < value.length) {
    const foundIndex = value.indexOf(searchValue, startIndex);
    if (foundIndex === -1) break;

    count += 1;
    startIndex = foundIndex + searchValue.length;
  }

  return count;
}

function findFooterLineIndexes(section: string): number[] {
  const standardFooter = normalizeWhitespace(STANDARD_FOOTER);
  const jewelryFooter = normalizeWhitespace(JEWELRY_FOOTER);

  return section
    .replace(/\r\n/g, '\n')
    .split('\n')
    .reduce<number[]>((indexes, line, index) => {
      const normalizedLine = normalizeWhitespace(line);
      const isFooter =
        normalizedLine.includes(standardFooter) || normalizedLine.includes(jewelryFooter);

      return isFooter ? [...indexes, index] : indexes;
    }, []);
}

function countFooterOccurrences(section: string): number {
  const normalizedSection = normalizeWhitespace(section);

  return (
    countNormalizedOccurrences(normalizedSection, normalizeWhitespace(STANDARD_FOOTER)) +
    countNormalizedOccurrences(normalizedSection, normalizeWhitespace(JEWELRY_FOOTER))
  );
}

function checkMercariStructure(result: PlatformValidationResult, section: string): void {
  const fieldPositions = REQUIRED_MERCARI_FIELDS.map((field) => ({
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
      'MERCARI_FIELD_ORDER',
      'Mercari fields must appear in this order: Title, Description, Hashtags, Approximate Measurements.',
    );
  }

  for (const field of REQUIRED_MERCARI_FIELDS) {
    const indexes = findAllLabeledLineIndexes(section, field.labels);

    if (indexes.length <= 1) continue;

    addIssue(
      result,
      'MERCARI_DUPLICATE_LABEL',
      `Mercari ${field.name} label may appear only once.`,
    );
  }

  const measurementsIndex = findLabeledLineIndex(section, LABELS.mercari.measurements);
  const hashtagsIndex = findLabeledLineIndex(section, LABELS.mercari.hashtags);
  const footerIndexes = findFooterLineIndexes(section);
  const firstFooterIndex = footerIndexes[0] ?? -1;
  const footerCount = Math.max(footerIndexes.length, countFooterOccurrences(section));

  result.metrics.footerCount = footerCount;
  result.metrics.footerAfterMeasurements =
    measurementsIndex !== -1 && firstFooterIndex !== -1 && firstFooterIndex > measurementsIndex;

  if (footerCount > 1) {
    addIssue(result, 'MERCARI_DUPLICATE_FOOTER', 'Mercari footer may appear only once.');
  }

  if (
    firstFooterIndex !== -1 &&
    ((measurementsIndex !== -1 && firstFooterIndex < measurementsIndex) ||
      (hashtagsIndex !== -1 && firstFooterIndex < hashtagsIndex))
  ) {
    addIssue(
      result,
      'MERCARI_FOOTER_ORDER',
      'Mercari footer must appear only after the Approximate Measurements block.',
    );
  }
}

export function validateMercari(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
): PlatformValidationResult {
  const result = makeResult('mercari', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';

  checkMercariStructure(result, section);

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
