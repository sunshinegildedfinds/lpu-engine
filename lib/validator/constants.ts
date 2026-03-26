import { PlatformName } from './types';

export const TITLE_MIN_LENGTH = 70;
export const TITLE_MAX_LENGTH = 80;

export const REQUIRED_DEPOP_HASHTAGS = 5;
export const REQUIRED_MERCARI_HASHTAGS = 3;
export const REQUIRED_POSHMARK_STYLE_TAGS = 3;
export const REQUIRED_ETSY_TAGS = 13;

export const STANDARD_FOOTER =
  'Ships within one day after payment is received. Please see all pictures before purchasing. Stock photo is for reference only and may differ slightly from the actual item.';

export const JEWELRY_FOOTER =
  'Ships within one business day after purchase. Displays & boxes shown are not included.';

export const PLATFORM_ORDER: PlatformName[] = [
  'ebay',
  'depop',
  'poshmark',
  'mercari',
  'etsy',
];

export const SECTION_HEADER_ALIASES: Record<PlatformName, string[]> = {
  ebay: ['ebay', 'eBay', 'EBAY'],
  depop: ['depop', 'Depop', 'DEPOP'],
  poshmark: ['poshmark', 'Poshmark', 'POSHMARK'],
  mercari: ['mercari', 'Mercari', 'MERCARI'],
  etsy: ['etsy', 'Etsy', 'ETSY'],
};

export const LABELS = {
  ebay: {
    titleA: ['Title A'],
    titleB: ['Title B'],
    category: ['Category'],
    itemSpecifics: ['Item Specifics', 'Item Specifics Block'],
    description: ['Description'],
    measurements: ['Approximate Measurements', 'Measurements'],
  },
  depop: {
    aestheticMode: ['Aesthetic Mode'],
    listingBlock: ['Listing Block', 'Listing'],
    hashtags: ['Hashtags'],
    optionalBrandHashtags: ['Optional Brand Hashtags', 'Brand Hashtags'],
    measurements: ['Approximate Measurements', 'Measurements'],
  },
  poshmark: {
    title: ['Title'],
    description: ['Description'],
    styleTags: ['Style Tags'],
    compactAlt: ['Compact 3-Tag Strategy (Alt Option)', 'Compact 3-Tag Strategy'],
    measurements: ['Approximate Measurements', 'Measurements'],
  },
  mercari: {
    title: ['Title'],
    description: ['Description'],
    hashtags: ['Hashtags'],
    measurements: ['Approximate Measurements', 'Measurements'],
  },
  etsy: {
    title: ['Title'],
    category: ['Category'],
    materials: ['Materials'],
    attributesKeyDetails: ['Attributes / Key Details', 'Attributes/Key Details', 'Key Details'],
    tags: ['Tags'],
    description: ['Description'],
    measurements: ['Approximate Measurements', 'Measurements'],
  },
} as const;

export const KNOWN_FIELD_LABELS: string[] = Array.from(
  new Set(
    Object.values(LABELS).flatMap((platformLabels) =>
      Object.values(platformLabels).flatMap((labelList) => labelList),
    ),
  ),
);