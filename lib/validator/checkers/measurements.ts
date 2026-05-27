import { LABELS } from '../constants';
import {
  addIssue,
  extractLabeledBlockText,
  isLikelyFieldLabel,
  normalizeWhitespace,
  stripMarkdown,
} from '../helpers';
import { PlatformName, PlatformValidationResult } from '../types';

const ESTIMATED_MEASUREMENT_UNSUPPORTED = 'ESTIMATED_MEASUREMENT_UNSUPPORTED';
const MEASUREMENT_SHOULD_BE_IN_BLOCK = 'MEASUREMENT_SHOULD_BE_IN_BLOCK';

const PHYSICAL_DIMENSION_PATTERN =
  /\b(?:approx\.?|approximately|estimated|estimate|visually estimated|visual estimate|appears?|appear)?\s*\d+(?:\.\d+)?(?:\s*(?:-|\u2013|\u2014|to)\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|inches|inch|in\.|["\u201d])\b/i;

const PHYSICAL_DIMENSION_BEFORE_ESTIMATE_PATTERN =
  /\b\d+(?:\.\d+)?(?:\s*(?:-|\u2013|\u2014|to)\s*\d+(?:\.\d+)?)?\s*(?:mm|cm|inches|inch|in\.|["\u201d])[\s\S]{0,60}?\b(?:approx\.?|approximately|estimated|estimate|visually estimated|visual estimate)\b/i;

const MEASUREMENT_REFERENCE_PATTERNS = [
  /\bruler(?:\s+photo|\s+image|\s+picture)?\b/i,
  /\bmeasurement[-\s]?(?:board|reference|photo|image|picture|graphic)\b/i,
  /\btyped measurement graphic\b/i,
  /\bvisible measurement\b/i,
  /\bvisual comparison\b/i,
  /\bbased on (?:the )?(?:ruler|measurement|photo|image|picture|visual comparison)\b/i,
];

type PhysicalMeasurementMatch = {
  phrase: string;
  context: string;
};

function hasMeasurementsNotProvided(section: string, platform: PlatformName): boolean {
  const measurementsBlock = extractLabeledBlockText(section, LABELS[platform].measurements);

  return /\bnot provided\s*\(see photos\)/i.test(measurementsBlock ?? '');
}

function removeMeasurementsBlock(section: string, platform: PlatformName): string {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  const lowerLabels = LABELS[platform].measurements.map((label) => label.toLowerCase());
  const startIndex = lines.findIndex((line) => {
    const normalized = stripMarkdown(line).replace(/:$/, '').toLowerCase();

    return lowerLabels.some((label) => normalized === label || normalized.startsWith(`${label}:`));
  });

  if (startIndex === -1) {
    return section;
  }

  const endIndex = lines.findIndex((line, index) => {
    if (index <= startIndex) return false;

    return isLikelyFieldLabel(line);
  });

  const before = lines.slice(0, startIndex);
  const after = endIndex === -1 ? [] : lines.slice(endIndex);

  return [...before, ...after].join('\n');
}

function hasMeasurementReferenceLanguage(value: string): boolean {
  return MEASUREMENT_REFERENCE_PATTERNS.some((pattern) => pattern.test(value));
}

function findPhysicalMeasurementOutsideBlock(
  section: string,
  platform: PlatformName,
): PhysicalMeasurementMatch | null {
  const sectionWithoutMeasurements = removeMeasurementsBlock(section, platform);

  for (const line of sectionWithoutMeasurements.replace(/\r\n/g, '\n').split('\n')) {
    const normalizedLine = normalizeWhitespace(stripMarkdown(line));
    const dimensionMatch =
      normalizedLine.match(PHYSICAL_DIMENSION_PATTERN) ??
      normalizedLine.match(PHYSICAL_DIMENSION_BEFORE_ESTIMATE_PATTERN);

    if (dimensionMatch?.[0]) {
      return {
        phrase: dimensionMatch[0].trim(),
        context: normalizedLine,
      };
    }
  }

  return null;
}

export function checkUnsupportedEstimatedMeasurements(
  result: PlatformValidationResult,
  section: string | undefined,
): void {
  if (!section || !hasMeasurementsNotProvided(section, result.platform)) {
    return;
  }

  const offendingMeasurement = findPhysicalMeasurementOutsideBlock(section, result.platform);

  if (!offendingMeasurement) {
    return;
  }

  result.metrics.estimatedMeasurementUnsupportedPhrase = offendingMeasurement.phrase;

  if (hasMeasurementReferenceLanguage(offendingMeasurement.context)) {
    addIssue(
      result,
      MEASUREMENT_SHOULD_BE_IN_BLOCK,
      `${result.platform} contains a ruler/photo-supported physical measurement while Approximate Measurements is Not provided; move the measurement into the Approximate Measurements block: "${offendingMeasurement.phrase}".`,
    );
    return;
  }

  addIssue(
    result,
    ESTIMATED_MEASUREMENT_UNSUPPORTED,
    `${result.platform} contains unsupported estimated physical measurement language while Approximate Measurements is Not provided: "${offendingMeasurement.phrase}".`,
  );
}
