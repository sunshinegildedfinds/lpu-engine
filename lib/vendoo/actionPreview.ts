import type { StructuredPayloadMap } from "@/lib/lpu/payloadMap";
import {
  buildVendooResolvedFieldMap,
  type VendooPlatform,
  type VendooResolvedField,
} from "@/lib/vendoo/fieldMap";

export type VendooActionStep = {
  order: number;
  fieldKey: string;
  label: string;
  actionLabel: string;
  required: boolean;
  ready: boolean;
  value: string;
  notes?: string;
};

export type VendooPlatformActionPreview = {
  platform: VendooPlatform;
  steps: VendooActionStep[];
  totalSteps: number;
  readySteps: number;
  totalRequiredSteps: number;
  readyRequiredSteps: number;
  canRun: boolean;
};

export type VendooActionPreviewMap = Record<
  VendooPlatform,
  VendooPlatformActionPreview
>;

function buildPlatformPreview(
  platform: VendooPlatform,
  fields: VendooResolvedField[]
): VendooPlatformActionPreview {
  const steps: VendooActionStep[] = fields.map((field, index) => ({
    order: index + 1,
    fieldKey: field.key,
    label: field.label,
    actionLabel: `Fill ${field.label}`,
    required: field.required,
    ready: field.ready,
    value: field.value,
    notes: field.notes,
  }));

  const totalSteps = steps.length;
  const readySteps = steps.filter((step) => step.ready).length;
  const requiredSteps = steps.filter((step) => step.required);
  const readyRequiredSteps = requiredSteps.filter((step) => step.ready).length;

  return {
    platform,
    steps,
    totalSteps,
    readySteps,
    totalRequiredSteps: requiredSteps.length,
    readyRequiredSteps,
    canRun: requiredSteps.every((step) => step.ready),
  };
}

export function buildVendooActionPreview(
  payloadMap: StructuredPayloadMap
): VendooActionPreviewMap {
  const resolvedMap = buildVendooResolvedFieldMap(payloadMap);

  return {
    ebay: buildPlatformPreview("ebay", resolvedMap.ebay.fields),
    depop: buildPlatformPreview("depop", resolvedMap.depop.fields),
    poshmark: buildPlatformPreview("poshmark", resolvedMap.poshmark.fields),
    mercari: buildPlatformPreview("mercari", resolvedMap.mercari.fields),
    etsy: buildPlatformPreview("etsy", resolvedMap.etsy.fields),
  };
}