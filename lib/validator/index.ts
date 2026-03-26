import { PLATFORM_ORDER } from './constants';
import { splitLpuSections, resolveExpectedFooterType } from './helpers';
import { validateDepop } from './checkers/depop';
import { validateEbay } from './checkers/ebay';
import { validateEtsy } from './checkers/etsy';
import { validateMercari } from './checkers/mercari';
import { validatePoshmark } from './checkers/poshmark';
import { PlatformName, ValidationResult, ValidatorOptions } from './types';

export * from './types';
export * from './constants';

export function validateLpuOutput(
  raw: string,
  options?: ValidatorOptions,
): ValidationResult {
  const parsed = splitLpuSections(raw);
  const expectedFooterType = resolveExpectedFooterType(raw, options);

  const platformResults = {
    ebay: validateEbay(parsed.sections.ebay, expectedFooterType),
    depop: validateDepop(parsed.sections.depop, expectedFooterType),
    poshmark: validatePoshmark(parsed.sections.poshmark, expectedFooterType, options),
    mercari: validateMercari(parsed.sections.mercari, expectedFooterType),
    etsy: validateEtsy(parsed.sections.etsy, expectedFooterType),
  };

  const issues = PLATFORM_ORDER.flatMap(
    (platform: PlatformName) => platformResults[platform].issues,
  );

  const platformsPassed = PLATFORM_ORDER.filter(
    (platform) => platformResults[platform].pass,
  ).length;

  const platformsFailed = PLATFORM_ORDER.length - platformsPassed;

  return {
    pass: issues.every((issue) => issue.severity !== 'error'),
    issues,
    parsed,
    platformResults,
    metrics: {
      expectedFooterType,
      platformsPassed,
      platformsFailed,
    },
  };
}