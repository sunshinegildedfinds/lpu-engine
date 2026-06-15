import { LABELS, REQUIRED_ETSY_TAGS } from '../constants';
import {
  addIssue,
  checkFooter,
  detectFooterType,
  extractLabeledBlockText,
  hasLabeledContent,
  makeResult,
  requireSectionPresent,
  splitListItems,
} from '../helpers';
import { ExpectedFooterType, PlatformValidationResult } from '../types';

export function validateEtsy(
  rawSection: string | undefined,
  expectedFooterType: ExpectedFooterType,
): PlatformValidationResult {
  const result = makeResult('etsy', rawSection);

  if (!requireSectionPresent(result)) {
    return result;
  }

  const section = rawSection ?? '';

  result.metrics.hasTitle = hasLabeledContent(section, LABELS.etsy.title);
  result.metrics.hasCategory = hasLabeledContent(section, LABELS.etsy.category);
  result.metrics.hasMaterials = hasLabeledContent(section, LABELS.etsy.materials);
  result.metrics.hasAttributesKeyDetails = hasLabeledContent(
    section,
    LABELS.etsy.attributesKeyDetails,
  );
  result.metrics.hasDescription = hasLabeledContent(section, LABELS.etsy.description);
  result.metrics.hasMeasurementsBlock = hasLabeledContent(section, LABELS.etsy.measurements);

  if (!result.metrics.hasTitle) {
    addIssue(result, 'ETSY_TITLE_MISSING', 'Etsy title is missing.');
  }

  if (!result.metrics.hasMaterials) {
    addIssue(result, 'ETSY_MATERIALS_MISSING', 'Etsy materials block is missing.');
  }

  if (!result.metrics.hasAttributesKeyDetails) {
    addIssue(
      result,
      'ETSY_ATTRIBUTES_KEY_DETAILS_MISSING',
      'Etsy attributes/key details block is missing.',
    );
  }

  if (!result.metrics.hasDescription) {
    addIssue(result, 'ETSY_DESCRIPTION_MISSING', 'Etsy description is missing.');
  }

  if (!result.metrics.hasMeasurementsBlock) {
    addIssue(result, 'ETSY_MEASUREMENTS_MISSING', 'Etsy measurements block is missing.');
  }

  const tagsBlock = extractLabeledBlockText(section, LABELS.etsy.tags) ?? '';
  const tags = splitListItems(tagsBlock);

  result.metrics.tagCount = tags.length;
  result.metrics.tags = tags;

  if (tags.length !== REQUIRED_ETSY_TAGS) {
    addIssue(
      result,
      'ETSY_TAG_COUNT',
      `Etsy must have exactly ${REQUIRED_ETSY_TAGS} tags.`,
    );
  }

  checkFooter(result, detectFooterType(section), expectedFooterType);

  return result;
}
