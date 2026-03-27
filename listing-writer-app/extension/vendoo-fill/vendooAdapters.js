(() => {
  if (window.LPU_VENDOO_ADAPTERS) return;

  async function runVendooFieldAction(action, context) {
    const rawValue = normalizePayloadValue(action.payloadValue);
    if (!rawValue) {
      return { status: "needs_review", reason: "payload missing" };
    }

    const adapterKey = action.adapterType ?? action.controlType ?? "text";
    const adapter = ADAPTERS[adapterKey] ?? ADAPTERS.default;
    return adapter(action, rawValue, context);
  }

  function adaptValueForAction(action, rawValue) {
    const selectorPolicy = action?.selectorConfig ?? {};
    const valuePolicy = action?.valuePolicy ?? {};
    const allowValueAdaptation =
      valuePolicy.allowValueAdaptation ?? selectorPolicy.allowValueAdaptation ?? false;
    const valueAdaptationType =
      valuePolicy.valueAdaptationType ?? selectorPolicy.valueAdaptationType ?? "";

    if (!allowValueAdaptation || !valueAdaptationType) {
      return { adaptedValue: null, wasAdapted: false };
    }

    if (valueAdaptationType === "alpha_apparel_size") {
      const adapted = adaptAlphaApparelSize(rawValue);
      return {
        adaptedValue: adapted,
        wasAdapted: !!adapted && normalizePayloadValue(adapted) !== normalizePayloadValue(rawValue),
      };
    }

    return { adaptedValue: null, wasAdapted: false };
  }

  async function runTextAdapter(action, value, context) {
    const field = context.resolveField(action);
    if (!field) return { status: "needs_review", reason: "field not found" };
    if (context.isUsed(field)) return { status: "skipped_for_safety", reason: "collision prevention" };
    if (!field.matches("input")) {
      return { status: "skipped_for_safety", reason: "unexpected control type" };
    }

    context.setValue(field, value);
    context.markUsed(field);
    return { status: "filled" };
  }

  async function runTextareaAdapter(action, value, context) {
    const field = context.resolveField(action);
    if (!field) return { status: "needs_review", reason: "field not found" };
    if (context.isUsed(field)) return { status: "skipped_for_safety", reason: "collision prevention" };
    if (!field.matches('textarea, [contenteditable="true"]')) {
      return { status: "skipped_for_safety", reason: "unexpected control type" };
    }

    context.setValue(field, value);
    context.markUsed(field);
    return { status: "filled" };
  }

  async function runReactSelectAdapter(action, value, context) {
    const field = context.resolveField(action);
    if (!field) return { status: "needs_review", reason: "field not found" };
    if (context.isUsed(field)) return { status: "skipped_for_safety", reason: "collision prevention" };

    const normalized = context.normalizeCustomSelectValue(action, value);
    if (!normalized.value) {
      return { status: "needs_review", reason: normalized.reason || "invalid value" };
    }

    const result = await context.fillReactSelect(action, field, normalized.value);
    return result;
  }

  async function runModalPickerAdapter(action, value, context) {
    const field = context.resolveField(action);
    if (!field) return { status: "needs_review", reason: "field not found" };
    if (context.isUsed(field)) return { status: "skipped_for_safety", reason: "collision prevention" };

    const result = await context.fillModalPicker(action, field, value);
    return result;
  }

  function normalizePayloadValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function adaptAlphaApparelSize(rawValue) {
    const normalizedRaw = normalizePayloadValue(rawValue);
    if (!normalizedRaw) return null;

    const lowered = normalizedRaw.toLowerCase();
    const blockedTerms = [
      "petite",
      "juniors",
      "junior",
      "one size",
      "onesize",
      "osfa",
      "shoe",
      "ring",
      "waist",
    ];
    if (blockedTerms.some((term) => lowered.includes(term))) return null;

    const compact = lowered.replace(/[^a-z0-9]/g, "");
    if (!compact) return null;
    if (/^\d+$/.test(compact)) return null;

    const safeMap = {
      "2xs": "2XS",
      "xxs": "2XS",
      "2xsmall": "2XS",
      "extrasextrasmall": "2XS",
      "extraextrasmall": "2XS",
      "xs": "XS",
      "xsmall": "XS",
      "extrasmall": "XS",
      "s": "S",
      "small": "S",
      "m": "M",
      "medium": "M",
      "l": "L",
      "large": "L",
      "xl": "XL",
      "xlarge": "XL",
      "extralarge": "XL",
      "2xl": "2XL",
      "xxl": "2XL",
      "2xlarge": "2XL",
      "extraextralarge": "2XL",
      "3xl": "3XL",
      "xxxl": "3XL",
      "3xlarge": "3XL",
      "xxxlarge": "3XL",
      "4xl": "4XL",
      "xxxxl": "4XL",
      "4xlarge": "4XL",
      "xxxxlarge": "4XL",
    };

    return safeMap[compact] ?? null;
  }

  const ADAPTERS = {
    text: runTextAdapter,
    text_input: runTextAdapter,
    textarea: runTextareaAdapter,
    react_select: runReactSelectAdapter,
    modal_picker: runModalPickerAdapter,
    custom_select: runReactSelectAdapter,
    default: runTextAdapter,
  };

  window.LPU_VENDOO_ADAPTERS = {
    runVendooFieldAction,
    adaptValueForAction,
  };
})();
