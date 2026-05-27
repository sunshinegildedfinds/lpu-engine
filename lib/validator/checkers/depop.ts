import {
  DEPOP_AESTHETIC_MODE_LIST,
  DEPOP_AESTHETIC_MODE_NOT_APPLICABLE,
  LABELS,
  REQUIRED_DEPOP_HASHTAGS,
} from '../constants';
import {
  addIssue,
  checkFooter,
  countHashtags,
  detectFooterType,
  extractLabeledBlockText,
  hasLabeledContent,
  makeResult,
  requireSectionPresent,
  stripMarkdown,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult } from '../types';

type DepopAestheticModeField = 'Primary' | 'Secondary';

const ALLOWED_DEPOP_AESTHETIC_MODES = new Set<string>([
  ...DEPOP_AESTHETIC_MODE_LIST,
  DEPOP_AESTHETIC_MODE_NOT_APPLICABLE,
]);

const DEPOP_AESTHETIC_MODE_FIELDS: DepopAestheticModeField[] = ['Primary', 'Secondary'];

function isDepopTopLevelLabel(line: string): boolean {
  const normalized = stripMarkdown(line).replace(/:$/, '').trim().toLowerCase();

  return Object.entries(LABELS.depop).some(
    ([key, labels]) =>
      key !== 'aestheticMode' &&
      labels.some((label) => normalized === label.toLowerCase()),
  );
}

function collectAestheticModeLines(section: string): string[] {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  const aestheticLabels = LABELS.depop.aestheticMode.map((label) => label.toLowerCase());
  const startIndex = lines.findIndex((line) => {
    const cleaned = stripMarkdown(line);
    const normalized = cleaned.toLowerCase();

    return aestheticLabels.some((label) => normalized === label || normalized.startsWith(`${label}:`));
  });

  if (startIndex === -1) {
    return [];
  }

  const collected: string[] = [];
  const startLine = stripMarkdown(lines[startIndex]);
  const colonIndex = startLine.indexOf(':');
  const firstValue = colonIndex >= 0 ? startLine.slice(colonIndex + 1).trim() : '';

  if (firstValue) {
    collected.push(firstValue);
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const cleaned = stripMarkdown(lines[i]);

    if (isDepopTopLevelLabel(cleaned)) {
      break;
    }

    if (cleaned) {
      collected.push(cleaned);
    }
  }

  return collected;
}

function extractAestheticModeValue(
  aestheticModeLines: string[],
  field: DepopAestheticModeField,
): string | null {
  const fieldPattern = new RegExp(
    `(?:^|\\b)${field}\\s*:\\s*(.*?)(?=\\s+(?:Primary|Secondary)\\s*:|$)`,
    'i',
  );

  for (const line of aestheticModeLines) {
    const match = line.match(fieldPattern);
    const value = match?.[1]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function validateAestheticModeValues(
  result: PlatformValidationResult,
  aestheticModeLines: string[],
): void {
  for (const field of DEPOP_AESTHETIC_MODE_FIELDS) {
    const value = extractAestheticModeValue(aestheticModeLines, field);

    if (!value) {
      continue;
    }

    result.metrics[`aestheticMode${field}`] = value;

    if (!ALLOWED_DEPOP_AESTHETIC_MODES.has(value)) {
      addIssue(
        result,
        'DEPOP_INVALID_AESTHETIC_MODE',
        `Depop Aesthetic Mode ${field} has invalid value "${value}". Use an exact saved Depop Aesthetic Mode value or "${DEPOP_AESTHETIC_MODE_NOT_APPLICABLE}".`,
      );
    }
  }
}

export function validateDepop(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
): PlatformValidationResult {
  const result = makeResult('depop', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';
  const aestheticModeLines = collectAestheticModeLines(section);

  result.metrics.hasAestheticMode =
    hasLabeledContent(section, LABELS.depop.aestheticMode) || aestheticModeLines.length > 0;
  result.metrics.hasAttributes = hasLabeledContent(section, LABELS.depop.attributes);
  result.metrics.hasListingBlock = hasLabeledContent(section, LABELS.depop.listingBlock);
  result.metrics.hasMeasurementsBlock = hasLabeledContent(section, LABELS.depop.measurements);

  if (!result.metrics.hasAestheticMode) {
    addIssue(result, 'DEPOP_AESTHETIC_MODE_MISSING', 'Depop Aesthetic Mode is missing.');
  }
  validateAestheticModeValues(result, aestheticModeLines);

  if (!result.metrics.hasAttributes) {
    addIssue(result, 'DEPOP_ATTRIBUTES_MISSING', 'Depop attributes section is missing.');
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

  if (requiredHashtagCount > REQUIRED_DEPOP_HASHTAGS) {
    addIssue(
      result,
      'DEPOP_REQUIRED_HASHTAGS_COUNT',
      `Depop required hashtags must be at most ${REQUIRED_DEPOP_HASHTAGS}. Optional brand hashtags are counted separately.`,
    );
  }

  checkFooter(result, detectFooterType(section), expectedFooterType);

  return result;
}
