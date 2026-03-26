export type PlatformName = 'ebay' | 'depop' | 'poshmark' | 'mercari' | 'etsy';
export type ValidatorScope = PlatformName | 'global';

export type Severity = 'error' | 'warning';

export type FooterType = 'standard' | 'jewelry' | 'missing' | 'unknown';
export type ExpectedFooterType = 'standard' | 'jewelry' | 'unknown';

export interface ValidatorOptions {
  itemType?: 'jewelry' | 'non-jewelry' | 'auto';
  requirePoshmarkCompactTagStrategy?: boolean;
}

export interface ValidationIssue {
  platform: ValidatorScope;
  code: string;
  message: string;
  severity: Severity;
}

export interface PlatformValidationResult {
  platform: PlatformName;
  present: boolean;
  pass: boolean;
  issues: ValidationIssue[];
  metrics: Record<string, unknown>;
  rawSection: string;
}

export interface ParsedSections {
  raw: string;
  sections: Partial<Record<PlatformName, string>>;
  unknownBlocks: string[];
}

export interface ValidationResult {
  pass: boolean;
  issues: ValidationIssue[];
  parsed: ParsedSections;
  platformResults: Record<PlatformName, PlatformValidationResult>;
  metrics: {
    expectedFooterType: ExpectedFooterType;
    platformsPassed: number;
    platformsFailed: number;
  };
}