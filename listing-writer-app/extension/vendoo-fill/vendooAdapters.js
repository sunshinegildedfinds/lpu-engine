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
  };
})();
