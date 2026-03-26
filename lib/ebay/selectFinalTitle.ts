import type { EbayDraftInput } from "@/lib/ebay/generateDraft";

export type TitleScoreBreakdown = {
  title: string;
  score: number;
  length: number;
  reasons: string[];
};

export type FinalTitleSelection = {
  selectedTitle: string;
  selectedSource: "A" | "B";
  titleA: TitleScoreBreakdown;
  titleB: TitleScoreBreakdown;
};

function clean(value: string): string {
  return value.trim().toLowerCase();
}

function includesValue(title: string, value: string): boolean {
  const normalizedTitle = clean(title);
  const normalizedValue = clean(value);

  if (!normalizedValue) return false;
  return normalizedTitle.includes(normalizedValue);
}

function scoreTitle(title: string, input: EbayDraftInput): TitleScoreBreakdown {
  const reasons: string[] = [];
  let score = 0;
  const length = title.trim().length;

  if (length >= 70 && length <= 80) {
    score += 40;
    reasons.push("Length is between 70 and 80");
  } else if (length >= 65 && length <= 80) {
    score += 30;
    reasons.push("Length is close to target range");
  } else if (length >= 55) {
    score += 15;
    reasons.push("Length is usable but short of target");
  } else {
    reasons.push("Length is too short");
  }

  if (includesValue(title, input.brand)) {
    score += 15;
    reasons.push("Includes brand");
  }

  if (includesValue(title, input.itemType)) {
    score += 15;
    reasons.push("Includes item type");
  }

  if (input.size.trim() && includesValue(title, `size ${input.size}`)) {
    score += 10;
    reasons.push("Includes size");
  }

  if (includesValue(title, input.color)) {
    score += 10;
    reasons.push("Includes color");
  }

  if (includesValue(title, input.feature1)) {
    score += 5;
    reasons.push("Includes feature 1");
  }

  if (includesValue(title, input.feature2)) {
    score += 5;
    reasons.push("Includes feature 2");
  }

  return {
    title,
    score,
    length,
    reasons,
  };
}

export function selectFinalEbayTitle(input: {
  titleA: string;
  titleB: string;
  draftInput: EbayDraftInput;
}): FinalTitleSelection {
  const scoredA = scoreTitle(input.titleA, input.draftInput);
  const scoredB = scoreTitle(input.titleB, input.draftInput);

  const selectedSource = scoredA.score >= scoredB.score ? "A" : "B";
  const selectedTitle = selectedSource === "A" ? input.titleA : input.titleB;

  return {
    selectedTitle,
    selectedSource,
    titleA: scoredA,
    titleB: scoredB,
  };
}