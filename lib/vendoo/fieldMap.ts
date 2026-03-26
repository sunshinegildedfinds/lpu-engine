import type { PlatformKey, StructuredPayloadMap } from "@/lib/lpu/payloadMap";

export type VendooPlatform = PlatformKey;

export type PayloadPath =
  | "fullOutput"
  | "platforms.ebay.section"
  | "platforms.ebay.titleA"
  | "platforms.ebay.titleB"
  | "platforms.ebay.description"
  | "platforms.depop.section"
  | "platforms.depop.listing"
  | "platforms.depop.hashtags"
  | "platforms.depop.optionalBrandHashtags"
  | "platforms.poshmark.section"
  | "platforms.poshmark.title"
  | "platforms.poshmark.description"
  | "platforms.mercari.section"
  | "platforms.mercari.title"
  | "platforms.mercari.description"
  | "platforms.mercari.hashtags"
  | "platforms.etsy.section"
  | "platforms.etsy.title"
  | "platforms.etsy.tags"
  | "platforms.etsy.description";

export type VendooFieldDefinition = {
  key: string;
  label: string;
  payloadPath: PayloadPath;
  required: boolean;
  notes?: string;
};

export type VendooPlatformFieldMap = {
  platform: VendooPlatform;
  fields: VendooFieldDefinition[];
};

export type VendooResolvedField = VendooFieldDefinition & {
  value: string;
  ready: boolean;
};

export type VendooResolvedPlatformFieldMap = {
  platform: VendooPlatform;
  fields: VendooResolvedField[];
};

export const VENDOO_FIELD_MAP: Record<VendooPlatform, VendooPlatformFieldMap> = {
  ebay: {
    platform: "ebay",
    fields: [
      {
        key: "titleA",
        label: "Title A",
        payloadPath: "platforms.ebay.titleA",
        required: true,
        notes: "Primary eBay title option.",
      },
      {
        key: "titleB",
        label: "Title B",
        payloadPath: "platforms.ebay.titleB",
        required: true,
        notes: "Alternative eBay title option.",
      },
      {
        key: "description",
        label: "Description",
        payloadPath: "platforms.ebay.description",
        required: true,
      },
      {
        key: "section",
        label: "Full eBay Section",
        payloadPath: "platforms.ebay.section",
        required: true,
      },
    ],
  },

  depop: {
    platform: "depop",
    fields: [
      {
        key: "listing",
        label: "Listing",
        payloadPath: "platforms.depop.listing",
        required: true,
      },
      {
        key: "hashtags",
        label: "Hashtags",
        payloadPath: "platforms.depop.hashtags",
        required: true,
      },
      {
        key: "optionalBrandHashtags",
        label: "Optional Brand Hashtags",
        payloadPath: "platforms.depop.optionalBrandHashtags",
        required: false,
      },
      {
        key: "section",
        label: "Full Depop Section",
        payloadPath: "platforms.depop.section",
        required: true,
      },
    ],
  },

  poshmark: {
    platform: "poshmark",
    fields: [
      {
        key: "title",
        label: "Title",
        payloadPath: "platforms.poshmark.title",
        required: true,
      },
      {
        key: "description",
        label: "Description",
        payloadPath: "platforms.poshmark.description",
        required: true,
      },
      {
        key: "section",
        label: "Full Poshmark Section",
        payloadPath: "platforms.poshmark.section",
        required: true,
      },
    ],
  },

  mercari: {
    platform: "mercari",
    fields: [
      {
        key: "title",
        label: "Title",
        payloadPath: "platforms.mercari.title",
        required: true,
      },
      {
        key: "description",
        label: "Description",
        payloadPath: "platforms.mercari.description",
        required: true,
      },
      {
        key: "hashtags",
        label: "Hashtags",
        payloadPath: "platforms.mercari.hashtags",
        required: true,
      },
      {
        key: "section",
        label: "Full Mercari Section",
        payloadPath: "platforms.mercari.section",
        required: true,
      },
    ],
  },

  etsy: {
    platform: "etsy",
    fields: [
      {
        key: "title",
        label: "Title",
        payloadPath: "platforms.etsy.title",
        required: true,
      },
      {
        key: "tags",
        label: "Tags",
        payloadPath: "platforms.etsy.tags",
        required: true,
      },
      {
        key: "description",
        label: "Description",
        payloadPath: "platforms.etsy.description",
        required: true,
      },
      {
        key: "section",
        label: "Full Etsy Section",
        payloadPath: "platforms.etsy.section",
        required: true,
      },
    ],
  },
};

export function getPayloadValue(
  payloadMap: StructuredPayloadMap,
  payloadPath: PayloadPath
): string {
  const segments = payloadPath.split(".");
  let current: unknown = payloadMap;

  for (const segment of segments) {
    if (
      current !== null &&
      typeof current === "object" &&
      segment in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return "";
    }
  }

  return typeof current === "string" ? current : "";
}

export function buildVendooResolvedFieldMap(
  payloadMap: StructuredPayloadMap
): Record<VendooPlatform, VendooResolvedPlatformFieldMap> {
  return {
    ebay: {
      platform: "ebay",
      fields: VENDOO_FIELD_MAP.ebay.fields.map((field) => {
        const value = getPayloadValue(payloadMap, field.payloadPath);

        return {
          ...field,
          value,
          ready: value.trim().length > 0,
        };
      }),
    },

    depop: {
      platform: "depop",
      fields: VENDOO_FIELD_MAP.depop.fields.map((field) => {
        const value = getPayloadValue(payloadMap, field.payloadPath);

        return {
          ...field,
          value,
          ready: value.trim().length > 0,
        };
      }),
    },

    poshmark: {
      platform: "poshmark",
      fields: VENDOO_FIELD_MAP.poshmark.fields.map((field) => {
        const value = getPayloadValue(payloadMap, field.payloadPath);

        return {
          ...field,
          value,
          ready: value.trim().length > 0,
        };
      }),
    },

    mercari: {
      platform: "mercari",
      fields: VENDOO_FIELD_MAP.mercari.fields.map((field) => {
        const value = getPayloadValue(payloadMap, field.payloadPath);

        return {
          ...field,
          value,
          ready: value.trim().length > 0,
        };
      }),
    },

    etsy: {
      platform: "etsy",
      fields: VENDOO_FIELD_MAP.etsy.fields.map((field) => {
        const value = getPayloadValue(payloadMap, field.payloadPath);

        return {
          ...field,
          value,
          ready: value.trim().length > 0,
        };
      }),
    },
  };
}

export function getVendooPlatformRequiredFieldStatus(
  payloadMap: StructuredPayloadMap,
  platform: VendooPlatform
): {
  requiredFields: number;
  readyRequiredFields: number;
  allRequiredReady: boolean;
} {
  const fields = buildVendooResolvedFieldMap(payloadMap)[platform].fields;
  const requiredFields = fields.filter((field) => field.required);
  const readyRequiredFields = requiredFields.filter((field) => field.ready).length;

  return {
    requiredFields: requiredFields.length,
    readyRequiredFields,
    allRequiredReady: requiredFields.every((field) => field.ready),
  };
}