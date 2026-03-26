import {
  JEWELRY_FOOTER,
  KNOWN_FIELD_LABELS,
  PLATFORM_ORDER,
  SECTION_HEADER_ALIASES,
  STANDARD_FOOTER,
} from './constants';
import {
  ExpectedFooterType,
  FooterType,
  ParsedSections,
  PlatformName,
  PlatformValidationResult,
  Severity,
  ValidatorOptions,
} from './types';

export function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

export function stripMarkdown(line: string): string {
  return line
    .replace(/\r/g, '')
    .replace(/^\s*[-*+>]+\s*/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .trim();
}

export function normalizeHeaderToken(line: string): string {
  return stripMarkdown(line).replace(/:$/, '').trim().toLowerCase();
}

export function findPlatformHeader(line: string): PlatformName | null {
  const normalized = normalizeHeaderToken(line);

  for (const platform of PLATFORM_ORDER) {
    const aliases = SECTION_HEADER_ALIASES[platform];
    if (aliases.some((alias) => normalized === alias.toLowerCase())) {
      return platform;
    }
  }

  return null;
}

export function splitLpuSections(raw: string): ParsedSections {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const sections: Partial<Record<PlatformName, string>> = {};
  const unknownBlocks: string[] = [];

  let currentPlatform: PlatformName | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (!text) {
      buffer = [];
      return;
    }

    if (currentPlatform) {
      sections[currentPlatform] = sections[currentPlatform]
        ? `${sections[currentPlatform]}\n\n${text}`
        : text;
    } else {
      unknownBlocks.push(text);
    }

    buffer = [];
  };

  for (const line of lines) {
    const platform = findPlatformHeader(line);

    if (platform) {
      flush();
      currentPlatform = platform;
      continue;
    }

    buffer.push(line);
  }

  flush();

  return {
    raw,
    sections,
    unknownBlocks,
  };
}

export function isLikelyFieldLabel(line: string): boolean {
  const plain = stripMarkdown(line);
  const normalized = normalizeHeaderToken(line);

  if (!plain) return false;

  if (KNOWN_FIELD_LABELS.some((label) => normalized === label.toLowerCase())) {
    return true;
  }

  return /^[A-Za-z][A-Za-z0-9/&()' .+-]{1,80}:$/.test(plain);
}

function findLabelStartIndex(lines: string[], labels: readonly string[]): number {
  const lowerLabels = labels.map((label) => label.toLowerCase());

  for (let i = 0; i < lines.length; i += 1) {
    const plain = stripMarkdown(lines[i]);
    const normalized = plain.toLowerCase();

    for (const label of lowerLabels) {
      if (normalized === label || normalized.startsWith(`${label}:`)) {
        return i;
      }
    }
  }

  return -1;
}

export function extractLabeledBlockText(
  section: string,
  labels: readonly string[],
): string | null {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  const startIndex = findLabelStartIndex(lines, labels);

  if (startIndex === -1) {
    return null;
  }

  const startLine = stripMarkdown(lines[startIndex]);
  const colonIndex = startLine.indexOf(':');
  const firstValue = colonIndex >= 0 ? startLine.slice(colonIndex + 1).trim() : '';

  const collected: string[] = [];
  if (firstValue) {
    collected.push(firstValue);
  }

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const currentLine = lines[i];

    if (findPlatformHeader(currentLine)) {
      break;
    }

    if (isLikelyFieldLabel(currentLine)) {
      break;
    }

    const cleaned = stripMarkdown(currentLine);

    if (!cleaned) {
      if (collected.length > 0) {
        collected.push('');
      }
      continue;
    }

    collected.push(cleaned);
  }

  return collected.join('\n').trim();
}

export function hasLabeledContent(section: string, labels: readonly string[]): boolean {
  const block = extractLabeledBlockText(section, labels);
  return !!block && block.trim().length > 0;
}

export function splitListItems(value: string): string[] {
  return value
    .replace(/[•]/g, '\n')
    .split(/[\n,;|]+/)
    .map((item) => item.replace(/^\s*[-*+]\s*/, '').trim())
    .filter(Boolean);
}

export function countHashtags(value: string): number {
  const matches = value.match(/#[A-Za-z0-9][\w-]*/g);
  return matches ? matches.length : 0;
}

export function isLengthInRange(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max;
}

export function makeResult(
  platform: PlatformName,
  rawSection: string | undefined,
): PlatformValidationResult {
  return {
    platform,
    present: !!rawSection?.trim(),
    pass: !!rawSection?.trim(),
    issues: [],
    metrics: {},
    rawSection: rawSection ?? '',
  };
}

export function addIssue(
  result: PlatformValidationResult,
  code: string,
  message: string,
  severity: Severity = 'error',
): void {
  result.issues.push({
    platform: result.platform,
    code,
    message,
    severity,
  });

  if (severity === 'error') {
    result.pass = false;
  }
}

export function requireSectionPresent(result: PlatformValidationResult): boolean {
  if (!result.present) {
    addIssue(result, 'SECTION_MISSING', `${result.platform} section is missing.`);
    return false;
  }

  return true;
}

export function detectFooterType(section: string): FooterType {
  const normalized = normalizeWhitespace(section);
  const standard = normalizeWhitespace(STANDARD_FOOTER);
  const jewelry = normalizeWhitespace(JEWELRY_FOOTER);

  if (normalized.includes(standard)) return 'standard';
  if (normalized.includes(jewelry)) return 'jewelry';

  return section.trim() ? 'missing' : 'unknown';
}

export function resolveExpectedFooterType(
  raw: string,
  options?: ValidatorOptions,
): ExpectedFooterType {
  if (options?.itemType === 'jewelry') return 'jewelry';
  if (options?.itemType === 'non-jewelry') return 'standard';

  const normalized = normalizeWhitespace(raw);
  const standard = normalizeWhitespace(STANDARD_FOOTER);
  const jewelry = normalizeWhitespace(JEWELRY_FOOTER);

  const hasStandard = normalized.includes(standard);
  const hasJewelry = normalized.includes(jewelry);

  if (hasJewelry && !hasStandard) return 'jewelry';
  if (hasStandard && !hasJewelry) return 'standard';

  return 'unknown';
}

export function checkFooter(
  result: PlatformValidationResult,
  actualFooterType: FooterType,
  expectedFooterType: ExpectedFooterType,
): void {
  result.metrics.footerType = actualFooterType;
  result.metrics.expectedFooterType = expectedFooterType;

  if (expectedFooterType === 'unknown') {
    if (actualFooterType === 'missing' || actualFooterType === 'unknown') {
      addIssue(result, 'FOOTER_MISSING', 'Footer is missing.');
    }
    return;
  }

  if (actualFooterType !== expectedFooterType) {
    addIssue(
      result,
      'FOOTER_INCORRECT',
      `Expected ${expectedFooterType} footer, found ${actualFooterType}.`,
    );
  }
}