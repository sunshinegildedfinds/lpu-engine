(() => {
  if (window.LPU_VENDOO_ACTION_MODEL) return;

  function createFieldAction(input) {
    const selectorConfig = input.selectorConfig ?? {};
    const controlType = selectorConfig.controlType ?? "text";

    return {
      marketplace: input.marketplace,
      key: input.key,
      label: input.label,
      payloadValue: input.payloadValue,
      valuePolicy: input.valuePolicy ?? null,
      selectorConfig,
      controlType,
      adapterType: selectorConfig.adapterType ?? controlType,
    };
  }

  function createRunState() {
    return {
      filled: [],
      needsReview: [],
      skippedForSafety: [],
      stepOutcomes: {},
      diagnosticsByField: {},
    };
  }

  function applyActionResult(runState, action, result) {
    const status = result?.status ?? "needs_review";
    const reason = result?.reason ? ` (${result.reason})` : "";

    runState.stepOutcomes[action.key] = status;
    runState.diagnosticsByField[action.key] = result?.diagnostics ?? null;

    if (status === "filled") {
      runState.filled.push(action.label);
      return;
    }

    if (status === "skipped_for_safety") {
      runState.skippedForSafety.push(`${action.label}${reason}`);
      return;
    }

    runState.needsReview.push(`${action.label}${reason}`);
  }

  window.LPU_VENDOO_ACTION_MODEL = {
    createFieldAction,
    createRunState,
    applyActionResult,
  };
})();
