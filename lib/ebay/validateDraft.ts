import { getStandardFooter } from "@/lib/ebay/generateDraft";

export type EbayValidationCheck = {
  label: string;
  pass: boolean;
  details: string;
};

export type EbayValidationResult = {
  checks: EbayValidationCheck[];
  passed: number;
  total: number;
  isValid: boolean;
};

function isBetween(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export function validateEbayDraft(input: {
  titleA: string;
  titleB: string;
  description: string;
}): EbayValidationResult {
  const footer = getStandardFooter();

  const checks: EbayValidationCheck[] = [
    {
      label: "Title A exists",
      pass: input.titleA.trim().length > 0,
      details: input.titleA.trim().length > 0 ? "Present" : "Missing",
    },
    {
      label: "Title A length is 70 to 80",
      pass: isBetween(input.titleA.trim().length, 70, 80),
      details: `Length: ${input.titleA.trim().length}`,
    },
    {
      label: "Title B exists",
      pass: input.titleB.trim().length > 0,
      details: input.titleB.trim().length > 0 ? "Present" : "Missing",
    },
    {
      label: "Title B length is 70 to 80",
      pass: isBetween(input.titleB.trim().length, 70, 80),
      details: `Length: ${input.titleB.trim().length}`,
    },
    {
      label: "Description exists",
      pass: input.description.trim().length > 0,
      details: input.description.trim().length > 0 ? "Present" : "Missing",
    },
    {
      label: "Measurements block exists",
      pass: input.description.includes("Approximate Measurements:"),
      details: input.description.includes("Approximate Measurements:")
        ? "Found"
        : "Missing",
    },
    {
      label: "Standard footer exists",
      pass: input.description.includes(footer),
      details: input.description.includes(footer) ? "Found" : "Missing",
    },
  ];

  const passed = checks.filter((check) => check.pass).length;

  return {
    checks,
    passed,
    total: checks.length,
    isValid: passed === checks.length,
  };
}