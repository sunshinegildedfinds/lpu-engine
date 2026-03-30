(() => {
  if (window.__LPU_VENDOO_PAGE_BRIDGE__) return;
  window.__LPU_VENDOO_PAGE_BRIDGE__ = true;

  const PANEL_ID = "lpu-vendoo-panel";

  init();

  async function init() {
    createPanel();
    await refreshPanel();
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;">LPU Vendoo Fill</div>
      <div id="lpu-vendoo-status" style="font-size:12px;line-height:1.4;margin-bottom:10px;color:#374151;">
        Checking stored payload...
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="lpu-vendoo-refresh" type="button">Refresh</button>
        <button id="lpu-vendoo-fill-ebay" type="button">Fill eBay</button>
        <button id="lpu-vendoo-clear" type="button">Clear</button>
      </div>
      <div id="lpu-vendoo-report" style="font-size:12px;line-height:1.4;margin-top:10px;color:#111827;"></div>
      <div id="lpu-vendoo-last-run" style="font-size:12px;line-height:1.4;margin-top:10px;color:#111827;white-space:pre-line;border-top:1px solid #e5e7eb;padding-top:8px;">
        Last run: none yet.
      </div>
    `;

    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "2147483647";
    panel.style.width = "280px";
    panel.style.background = "#ffffff";
    panel.style.border = "1px solid #d1d5db";
    panel.style.borderRadius = "12px";
    panel.style.padding = "12px";
    panel.style.boxShadow = "0 12px 28px rgba(0,0,0,0.18)";
    panel.style.fontFamily = "system-ui, sans-serif";
    panel.style.fontSize = "13px";

    document.documentElement.appendChild(panel);

    styleButton("lpu-vendoo-refresh");
    styleButton("lpu-vendoo-fill-ebay");
    styleButton("lpu-vendoo-clear");

    document
      .getElementById("lpu-vendoo-refresh")
      .addEventListener("click", refreshPanel);

    document
      .getElementById("lpu-vendoo-fill-ebay")
      .addEventListener("click", fillEbayFields);

    document
      .getElementById("lpu-vendoo-clear")
      .addEventListener("click", clearStoredPayload);
  }

  function styleButton(id) {
    const button = document.getElementById(id);
    if (!button) return;

    button.style.border = "1px solid #d1d5db";
    button.style.background = "#f9fafb";
    button.style.borderRadius = "8px";
    button.style.padding = "8px 10px";
    button.style.fontSize = "12px";
    button.style.cursor = "pointer";
  }

  async function refreshPanel() {
    const statusEl = document.getElementById("lpu-vendoo-status");
    const reportEl = document.getElementById("lpu-vendoo-report");

    const record = await getStoredPayload();
    reportEl.textContent = "";

    if (!record?.payload) {
      statusEl.textContent = "No payload stored yet. Send one from your app first.";
      return;
    }

    const ebayPayload = record.payload?.marketplaces?.ebay ?? {};
    const title = pickEbayTitle(record.payload);
    const description = ebayPayload.description ?? "";
    const category = pickEbayCategoryPath(record.payload);
    const canonicalCategory = pickEbayCanonicalCategoryPath(record.payload);
    const brand = pickEbayBrand(record.payload);
    const size = pickEbaySize(record.payload);
    const color = pickEbayColor(record.payload);
    const savedAt = record.savedAt
      ? new Date(record.savedAt).toLocaleString()
      : "unknown";

    statusEl.innerHTML = `
      <div><strong>Stored:</strong> ${savedAt}</div>
      <div><strong>eBay title:</strong> ${title ? "ready" : "missing"}</div>
      <div><strong>eBay description:</strong> ${description ? "ready" : "missing"}</div>
      <div><strong>eBay category:</strong> ${category ? "ready" : "missing"}</div>
      <div><strong>Canonical category path:</strong> ${canonicalCategory ? "ready" : "missing"}</div>
      <div><strong>eBay brand:</strong> ${brand ? "ready" : "missing"}</div>
      <div><strong>eBay size:</strong> ${size ? "ready" : "missing"}</div>
      <div><strong>eBay color:</strong> ${color ? "ready" : "missing"}</div>
    `;
  }

  async function clearStoredPayload() {
    const statusEl = document.getElementById("lpu-vendoo-status");
    const reportEl = document.getElementById("lpu-vendoo-report");

    chrome.runtime.sendMessage({ type: "CLEAR_PAYLOAD" }, async (response) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError) {
        reportEl.textContent = `Clear failed: ${runtimeError}`;
        return;
      }

      if (!response?.ok) {
        reportEl.textContent = `Clear failed: ${response?.error ?? "Unknown error"}`;
        return;
      }

      statusEl.textContent = "No payload stored yet. Send one from your app first.";
      reportEl.textContent = "Stored payload cleared.";
    });
  }

  async function fillEbayFields() {
    const reportEl = document.getElementById("lpu-vendoo-report");
    reportEl.textContent = "Attempting fill...";

    const record = await getStoredPayload();
    const payload = record?.payload;

    if (!payload) {
      reportEl.textContent = "No stored payload found.";
      return;
    }

    const selectors = getSelectorMap().ebay;
    const actionModel = getActionModel();
    const fieldDefinitions = getFieldDefinitions();
    const adapters = getAdapters();

    const fillSteps = fieldDefinitions
      .buildEbayFieldDefinitions(payload, selectors, {
        pickEbayTitle,
        pickEbayCategoryPath,
        pickEbayBrand,
        pickEbaySize,
        pickEbayColor,
        pickEbaySignedMaker,
        pickEbayMaterial,
        pickEbayStyleType,
      })
      .map((definition) => {
        const action = actionModel.createFieldAction(definition);
        return {
          ...action,
          value: action.payloadValue,
        };
      });

    const runState = actionModel.createRunState();
    const usedElements = new Set();

    for (const step of fillSteps) {
      const result = await adapters.runVendooFieldAction(step, {
        resolveField(action) {
          return findElementBySelectorMap(action.selectorConfig);
        },
        isUsed(field) {
          return usedElements.has(field);
        },
        markUsed(field) {
          usedElements.add(field);
        },
        setValue(field, value) {
          setElementValue(field, value);
        },
        normalizeCustomSelectValue(action, value) {
          return getCustomSelectAttemptValue(action.key, value);
        },
        async fillReactSelect(action, control, value) {
          return tryFillCustomSelect({
            step: action,
            value,
            control,
            usedElements,
          });
        },
        async fillModalPicker(action, control, value) {
          const result = await tryFillCategoryByStages({
            value,
            control,
            fieldConfig: action.selectorConfig ?? {},
          });

          if (result.status === "filled") {
            usedElements.add(control);
          }

          return result;
        },
      });

      actionModel.applyActionResult(runState, step, result);
    }

    await retrySizeAfterCategorySuccess({
      fillSteps,
      stepOutcomes: runState.stepOutcomes,
      usedElements,
      filled: runState.filled,
      needsReview: runState.needsReview,
      skippedForSafety: runState.skippedForSafety,
    });

    await fillDynamicVisibleFieldsAfterCategory({
      payload,
      selectors,
      stepOutcomes: runState.stepOutcomes,
      usedElements,
      filled: runState.filled,
      needsReview: runState.needsReview,
      skippedForSafety: runState.skippedForSafety,
    });

    reportEl.textContent = "Fill run completed.";
    renderLastRunResults({
      filled: runState.filled,
      needsReview: runState.needsReview,
      skippedForSafety: runState.skippedForSafety,
    });
    await refreshPanel();
  }

  async function tryFillCustomSelect(input) {
    const { step, value, control, usedElements } = input;
    const fieldConfig = step.selectorConfig ?? {};

    if (!isSafeCustomSelectControl(control)) {
      return { status: "skipped_for_safety", reason: "unexpected control type" };
    }

    if (step.key === "category") {
      const stagedCategoryResult = await tryFillCategoryByStages({
        value,
        control,
        fieldConfig,
      });

      if (stagedCategoryResult.status === "filled") {
        usedElements.add(control);
      }

      return stagedCategoryResult;
    }

    openCustomSelectControl(control);
    await wait(140);

    const optionDiscovery = findVisibleOptionEntries(fieldConfig.optionSelectors ?? []);
    const matchingOptions = findMatchingOptions(optionDiscovery.entries, value);

    if (matchingOptions.length === 1) {
      clickElement(matchingOptions[0].clickTarget);
      usedElements.add(control);
      return {
        status: "filled",
        diagnostics: {
          visibleSample: optionDiscovery.visibleSample || "none",
          exactMatchFound: true,
        },
      };
    }

    if (matchingOptions.length > 1) {
      return {
        status: "needs_review",
        reason: "multiple matching options",
        diagnostics: {
          visibleSample: optionDiscovery.visibleSample || "none",
          exactMatchFound: true,
        },
      };
    }

    if (fieldConfig.allowTypedEntry) {
      const typedEntry = tryTypedEntry(control, value);
      if (typedEntry) {
        usedElements.add(control);
        return {
          status: "filled",
          diagnostics: {
            visibleSample: optionDiscovery.visibleSample || "none",
            exactMatchFound: false,
          },
        };
      }
    }

    return {
      status: "needs_review",
      reason: "no safe visible option match",
      diagnostics: {
        visibleSample: optionDiscovery.visibleSample || "none",
        exactMatchFound: false,
      },
    };
  }

  async function tryFillCategoryByStages(input) {
    const { value, control, fieldConfig } = input;
    const stages = splitCategoryStages(value);
    if (!stages.length) {
      return { status: "needs_review", reason: "no category stages found" };
    }

    openCustomSelectControl(control);
    await wait(150);

    let stageOneChosenDebug = "";
    const confirmedStages = [];
    for (let index = 0; index < stages.length; index += 1) {
      const stageLabel = stages[index];
      const stageLabelsToTry = getStageLabelsForMatch(stageLabel, index, fieldConfig);
      const pickerInfo = findVisibleCategoryPicker(fieldConfig.pickerContainerSelectors ?? []);
      if (!pickerInfo?.element) {
        return {
          status: "needs_review",
          reason: `stopped at stage ${index + 1}: picker not found`,
        };
      }

      const pickerScope = resolveCategoryOptionScope(
        pickerInfo.element,
        fieldConfig.optionSelectors ?? []
      );

      let optionDiscovery = findVisibleOptionEntries(
        fieldConfig.optionSelectors ?? [],
        pickerScope,
        "category_modal_scope"
      );
      let optionEntries = optionDiscovery.entries;
      let stageMatchResult = findCategoryStageMatches({
        optionEntries,
        stageLabelsToTry,
        stageIndex: index,
        confirmedStages,
        pickerElement: pickerInfo.element,
        optionSelectors: fieldConfig.optionSelectors ?? [],
      });
      optionEntries = stageMatchResult.candidateEntries;
      let matches = stageMatchResult.matches;

      if (matches.length !== 1) {
        const searchInput = findPickerSearchInput(
          pickerScope ?? pickerInfo.element,
          fieldConfig.searchInputSelectors ?? []
        );

        if (searchInput) {
          setElementValue(searchInput, stageLabel);
          await wait(140);
          optionDiscovery = findVisibleOptionEntries(
            fieldConfig.optionSelectors ?? [],
            pickerScope,
            "category_modal_scope"
          );
          optionEntries = optionDiscovery.entries;
          stageMatchResult = findCategoryStageMatches({
            optionEntries,
            stageLabelsToTry,
            stageIndex: index,
            confirmedStages,
            pickerElement: pickerInfo.element,
            optionSelectors: fieldConfig.optionSelectors ?? [],
          });
          optionEntries = stageMatchResult.candidateEntries;
          matches = stageMatchResult.matches;
        }
      }

      if (matches.length !== 1) {
        const wanted = stageLabelsToTry[0] ?? stageLabel;
        const visiblePreview = buildVisibleOptionsPreview(optionEntries, 8);
        const aliasTried = index === 0 && stageLabelsToTry.length > 1 ? "yes" : "no";
        const exactMatchFound = matches.length > 0 ? "yes" : "no";
        const stageDiagnostics =
          index === 0 ? buildStageOneOptionDiagnostics(optionEntries, 8) : "";
        const pickerStatus = pickerInfo?.element ? "found" : "not found";
        const pickerSelector = pickerInfo?.selector ?? "none";
        const breadcrumbMode = stageMatchResult.breadcrumbMode ? "yes" : "no";
        const confirmedPrefix = stageMatchResult.confirmedPrefix || "none";
        const safeCandidateFound = matches.length > 0 ? "yes" : "no";
        const prefixFilterApplied = stageMatchResult.prefixFilterApplied ? "yes" : "no";
        const filteredCandidateCount = stageMatchResult.filteredCandidateCount ?? 0;
        const filteredVisibleSample = stageMatchResult.filteredVisibleSample || "none";
        const candidateSourceType = stageMatchResult.candidateSourceType || "unknown";
        const candidateElementSelector = stageMatchResult.candidateElementSelector || "none";
        const extractedRowText = stageMatchResult.extractedRowText || "none";
        const clickableRowCount = stageMatchResult.clickableRowCount ?? 0;
        const breadcrumbRowCount = stageMatchResult.breadcrumbRowCount ?? 0;
        const sampledRowTexts = stageMatchResult.sampledRowTexts || "none";
        const activeRowListSelectorUsed = stageMatchResult.activeRowListSelectorUsed || "none";
        const stageRowCount = stageMatchResult.stageRowCount ?? 0;
        const parentRowExcluded = stageMatchResult.excludedParentRow ? "true" : "false";

        const detail =
          `stopped at stage ${index + 1}: wanted "${wanted}"; ` +
          `prefix "${confirmedPrefix}"; breadcrumb mode: ${breadcrumbMode}; ` +
          `picker: ${pickerStatus} (${pickerSelector}); ` +
          `raw candidates: ${optionDiscovery.rawCount}; visible candidates: ${optionDiscovery.visibleCount}; ` +
          `raw sample: ${optionDiscovery.rawSample || "none"}; visible sample: ${optionDiscovery.visibleSample || "none"}; ` +
          `candidate source: ${candidateSourceType}; selector: ${candidateElementSelector}; ` +
          `extracted row text: "${extractedRowText}"; clickable rows: ${clickableRowCount}; breadcrumb rows: ${breadcrumbRowCount}; ` +
          `sampled rows: ${sampledRowTexts}; ` +
          `activeRowListSelectorUsed: ${activeRowListSelectorUsed}; stageRowCount: ${stageRowCount}; excludedParentRow: ${parentRowExcluded}; ` +
          `prefix-compatible filtering: ${prefixFilterApplied}; filtered candidates: ${filteredCandidateCount}; filtered sample: ${filteredVisibleSample}; ` +
          `scope: ${optionDiscovery.scopeMode}; ` +
          `visible: ${visiblePreview || "none"}; ` +
          `alias tried: ${aliasTried}; exact match found: ${exactMatchFound}; ` +
          `safe candidate found: ${safeCandidateFound}`;

        const withDiagnostics =
          stageDiagnostics && index === 0 ? `${detail}; nodes: ${stageDiagnostics}` : detail;
        const withChosen =
          stageOneChosenDebug && index > 0
            ? `${withDiagnostics}; stage1 click: ${stageOneChosenDebug}`
            : withDiagnostics;

        console.debug("[LPU Vendoo] Category stage diagnostics", {
          stageIndex: index + 1,
          wanted,
          aliasesTried: stageLabelsToTry,
          pickerStatus,
          pickerSelector,
          scopeMode: optionDiscovery.scopeMode,
          rawCandidates: optionDiscovery.rawCount,
          visibleCandidates: optionDiscovery.visibleCount,
          rawSample: optionDiscovery.rawSample,
          visibleSample: optionDiscovery.visibleSample,
          visiblePreview,
          breadcrumbMode: stageMatchResult.breadcrumbMode,
          confirmedPrefix: stageMatchResult.confirmedPrefix,
          prefixFilterApplied: stageMatchResult.prefixFilterApplied,
          filteredCandidateCount: stageMatchResult.filteredCandidateCount,
          filteredVisibleSample: stageMatchResult.filteredVisibleSample,
          candidateSourceType: stageMatchResult.candidateSourceType,
          candidateElementSelector: stageMatchResult.candidateElementSelector,
          extractedRowText: stageMatchResult.extractedRowText,
          clickableRowCount: stageMatchResult.clickableRowCount,
          breadcrumbRowCount: stageMatchResult.breadcrumbRowCount,
          sampledRowTexts: stageMatchResult.sampledRowTexts,
          activeRowListSelectorUsed: stageMatchResult.activeRowListSelectorUsed,
          stageRowCount: stageMatchResult.stageRowCount,
          excludedParentRow: stageMatchResult.excludedParentRow,
          exactMatchFound: matches.length > 0,
          safeCandidateFound: matches.length > 0,
          stageOneNodes: index === 0 ? stageDiagnostics : "",
          stageOneClick: stageOneChosenDebug,
        });

        return {
          status: "needs_review",
          reason: withChosen,
        };
      }

      if (index === 0) {
        stageOneChosenDebug = describeOptionEntry(matches[0]);
      }

      clickElement(matches[0].clickTarget);
      confirmedStages.push(stageLabel);
      await wait(180);
    }

    const completionConfirmed = isCategoryCompletionConfirmed({
      control,
      fullPath: value,
      fieldConfig,
    });

    if (!completionConfirmed) {
      return { status: "needs_review", reason: "completion not confirmed" };
    }

    return { status: "filled" };
  }

  function isSafeCustomSelectControl(control) {
    return control.matches('button, [role="combobox"], input[type="text"], input:not([type])');
  }

  function openCustomSelectControl(control) {
    control.focus();
    clickElement(control);
  }

  function findVisibleCategoryPicker(pickerContainerSelectors) {
    for (const selector of pickerContainerSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const visible = candidates.find((candidate) => isVisible(candidate));
      if (visible) {
        return {
          element: visible,
          selector,
        };
      }
    }

    return score;
  }

  function findPickerSearchInput(pickerRoot, searchInputSelectors) {
    const selectors = searchInputSelectors.length
      ? searchInputSelectors
      : ['input[type="search"]', 'input[aria-label*="search"]', 'input[placeholder*="search"]'];

    for (const selector of selectors) {
      const candidates = Array.from(pickerRoot.querySelectorAll(selector));
      const safeInput = candidates.find((candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (!candidate.matches("input")) return false;
        if (!isVisible(candidate)) return false;

        const metadata = normalizeText(
          [
            candidate.getAttribute("aria-label"),
            candidate.getAttribute("placeholder"),
            candidate.getAttribute("title"),
            candidate.getAttribute("name"),
          ]
            .filter(Boolean)
            .join(" ")
        );

        return metadata.includes("search");
      });

      if (safeInput) return safeInput;
    }

    return score;
  }

  function resolveCategoryOptionScope(pickerRoot, optionSelectors) {
    const directCategoryRows = pickerRoot.querySelectorAll(
      'div[data-testid="category-option-dropdown"][role="option"]'
    ).length;
    if (directCategoryRows > 0) {
      return pickerRoot;
    }

    const selectorsToTry = [
      '[role="listbox"]',
      '[data-radix-select-viewport]',
      '[role="document"]',
      '[class*="list"]',
      '[class*="menu"]',
      '[class*="content"]',
    ];

    let bestScope = pickerRoot;
    let bestCount = 0;

    for (const selector of selectorsToTry) {
      const candidates = Array.from(pickerRoot.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        if (!isVisible(candidate)) continue;

        const count = candidate.querySelectorAll(
          optionSelectors.join(",")
        ).length;

        if (count > bestCount) {
          bestCount = count;
          bestScope = candidate;
        }
      }
    }

    return bestScope;
  }

  function findVisibleOptionEntries(optionSelectors, root, scopeModeOverride) {
    const selectors = optionSelectors.length
      ? optionSelectors
      : [
          '[role="option"]',
          '[data-radix-collection-item]',
          '.select__option',
          'li[role="option"]',
        ];

    const rawEntries = [];
    const seenRawCandidates = new Set();

    function pushRawEntry(candidate, selector) {
      if (!(candidate instanceof Element)) return;
      if (seenRawCandidates.has(candidate)) return;
      seenRawCandidates.add(candidate);
      const clickTarget = resolveOptionClickTarget(candidate);
      rawEntries.push({
        element: candidate,
        selector,
        clickTarget,
      });
    }

    const scope = root ?? document;
    const scopeMode = scopeModeOverride ?? (root ? "picker_scope" : "document_scope");
    for (const selector of selectors) {
      const candidates = Array.from(scope.querySelectorAll(selector));
      for (const candidate of candidates) {
        pushRawEntry(candidate, selector);
      }
    }

    // If a narrowed picker scope finds zero rows, retry on the active category modal root.
    if (rawEntries.length === 0 && root instanceof Element) {
      const modalRoot =
        (root.matches('[aria-label*="Category Selector"]') ? root : null) ??
        root.closest('[aria-label*="Category Selector"]') ??
        null;

      if (modalRoot) {
        const categoryRowSelectors = Array.from(
          new Set([
            ...selectors,
            'div[data-testid="category-option-dropdown"][role="option"]',
            'div[data-testid="category-option-dropdown"]',
          ])
        );

        for (const selector of categoryRowSelectors) {
          const candidates = Array.from(modalRoot.querySelectorAll(selector));
          for (const candidate of candidates) {
            pushRawEntry(candidate, selector);
          }
        }
      }
    }

    const scopedCategoryRows = root instanceof Element
      ? Array.from(
          root.querySelectorAll('div[data-testid="category-option-dropdown"][role="option"]')
        ).filter((row) => row instanceof Element && isVisible(row))
      : [];

    // When real category row containers are present, ignore generic modal nodes.
    if (scopedCategoryRows.length > 0) {
      const filteredToCategoryRows = rawEntries.filter(
        (entry) =>
          resolveCategoryOptionRow(entry.element) instanceof Element ||
          resolveCategoryOptionRow(entry.clickTarget) instanceof Element
      );

      if (filteredToCategoryRows.length > 0) {
        rawEntries.length = 0;
        rawEntries.push(...filteredToCategoryRows);
      }
    }

    const seenClickTargets = new Set();
    const optionEntries = [];

    for (const entry of rawEntries) {
      const visibleEntry = isVisible(entry.clickTarget) || isVisible(entry.element);
      if (!visibleEntry) continue;
      if (seenClickTargets.has(entry.clickTarget)) continue;

      seenClickTargets.add(entry.clickTarget);
      optionEntries.push(entry);
    }

    return {
      entries: optionEntries,
      rawCount: rawEntries.length,
      visibleCount: optionEntries.length,
      rawSample: buildVisibleOptionsPreview(rawEntries, 6),
      visibleSample: buildVisibleOptionsPreview(optionEntries, 6),
      scopeMode,
    };
  }

  function findMatchingOptions(optionEntries, value) {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) return [];

    return optionEntries.filter((entry) =>
      getOptionTextCandidates(entry).some((candidate) => normalizeText(candidate) === normalizedValue)
    );
  }

  function findMatchingOptionsForStage(optionEntries, candidateLabels) {
    const normalizedCandidates = candidateLabels
      .map((label) => normalizeText(label))
      .filter(Boolean);

    if (!normalizedCandidates.length) return [];

    return optionEntries.filter((entry) =>
      getOptionTextCandidates(entry).some((candidate) =>
        normalizedCandidates.includes(normalizeText(candidate))
      )
    );
  }

  function findCategoryStageMatches(input) {
    const {
      optionEntries,
      stageLabelsToTry,
      stageIndex,
      confirmedStages,
      pickerElement,
      optionSelectors,
    } = input;
    const confirmedPrefix = confirmedStages.join(" > ");
    const stageCandidateResult = getStageCandidateEntries({
      optionEntries,
      stageLabelsToTry,
      stageIndex,
      confirmedStages,
      pickerElement,
      optionSelectors,
    });
    const candidateEntries = stageCandidateResult.entries;
    const candidateSummary = summarizeCategoryCandidates(candidateEntries);
    const filteredVisibleSample = buildVisibleOptionsPreview(candidateEntries, 8);
    const filteredCandidateCount = candidateEntries.length;
    const prefixFilterApplied = stageIndex > 0 && confirmedStages.length > 0;

    if (stageIndex === 0) {
      return {
        matches: findMatchingOptionsForStage(candidateEntries, stageLabelsToTry),
        breadcrumbMode: false,
        confirmedPrefix,
        candidateEntries,
        prefixFilterApplied,
        filteredCandidateCount,
        filteredVisibleSample,
        candidateSourceType: candidateSummary.candidateSourceType,
        candidateElementSelector: candidateSummary.candidateElementSelector,
        extractedRowText: candidateSummary.extractedRowText,
        clickableRowCount: candidateSummary.clickableRowCount,
        breadcrumbRowCount: candidateSummary.breadcrumbRowCount,
        sampledRowTexts: candidateSummary.sampledRowTexts,
        activeRowListSelectorUsed: stageCandidateResult.activeRowListSelectorUsed,
        stageRowCount: stageCandidateResult.stageRowCount,
        excludedParentRow: stageCandidateResult.excludedParentRow,
      };
    }

    const breadcrumbMode = isBreadcrumbResultMode(candidateEntries, confirmedStages);
    if (!breadcrumbMode) {
      return {
        matches: findMatchingOptionsForStage(candidateEntries, stageLabelsToTry),
        breadcrumbMode: false,
        confirmedPrefix,
        candidateEntries,
        prefixFilterApplied,
        filteredCandidateCount,
        filteredVisibleSample,
        candidateSourceType: candidateSummary.candidateSourceType,
        candidateElementSelector: candidateSummary.candidateElementSelector,
        extractedRowText: candidateSummary.extractedRowText,
        clickableRowCount: candidateSummary.clickableRowCount,
        breadcrumbRowCount: candidateSummary.breadcrumbRowCount,
        sampledRowTexts: candidateSummary.sampledRowTexts,
        activeRowListSelectorUsed: stageCandidateResult.activeRowListSelectorUsed,
        stageRowCount: stageCandidateResult.stageRowCount,
        excludedParentRow: stageCandidateResult.excludedParentRow,
      };
    }

    return {
      matches: findBreadcrumbStageMatches({
        optionEntries: candidateEntries,
        stageLabelsToTry,
        confirmedStages,
      }),
      breadcrumbMode: true,
      confirmedPrefix,
      candidateEntries,
      prefixFilterApplied,
      filteredCandidateCount,
      filteredVisibleSample,
      candidateSourceType: candidateSummary.candidateSourceType,
      candidateElementSelector: candidateSummary.candidateElementSelector,
      extractedRowText: candidateSummary.extractedRowText,
      clickableRowCount: candidateSummary.clickableRowCount,
      breadcrumbRowCount: candidateSummary.breadcrumbRowCount,
      sampledRowTexts: candidateSummary.sampledRowTexts,
      activeRowListSelectorUsed: stageCandidateResult.activeRowListSelectorUsed,
      stageRowCount: stageCandidateResult.stageRowCount,
      excludedParentRow: stageCandidateResult.excludedParentRow,
    };
  }

  function getStageCandidateEntries(input) {
    const { optionEntries, stageLabelsToTry, stageIndex, confirmedStages, pickerElement } =
      input;
    if (stageIndex === 0) {
      return {
        entries: optionEntries,
        activeRowListSelectorUsed: "none",
        stageRowCount: optionEntries.length,
        excludedParentRow: false,
      };
    }

    const stagePanelResult = collectStageOptionRowsFromModal({
      confirmedStages,
      pickerElement,
    });
    const stageSourceEntries = stagePanelResult.entries.length
      ? stagePanelResult.entries
      : optionEntries;

    const normalizedPrefix = normalizeText(confirmedStages.join(" > "));
    const normalizedPrefixFlat = normalizeText(confirmedStages.join(" "));
    const normalizedWanted = stageLabelsToTry.map((label) => normalizeText(label)).filter(Boolean);
    const candidateProfiles = stageSourceEntries.map((entry) => {
      const extractedRowText = cleanCategoryStage(getOptionTextFromEntry(entry));
      const normalizedRowText = normalizeText(extractedRowText);
      const hasBreadcrumb = containsBreadcrumbSeparator(extractedRowText);
      const hasPrefix =
        !!normalizedPrefix &&
        (normalizedRowText.includes(normalizedPrefix) ||
          (normalizedPrefixFlat && containsStagesInOrder(normalizedRowText, confirmedStages)));

      return {
        entry,
        extractedRowText,
        normalizedRowText,
        hasBreadcrumb,
        hasPrefix,
      };
    });

    // Stage 2+ should prefer actual breadcrumb/result rows under the confirmed prefix path.
    const prefixCompatibleProfiles = candidateProfiles.filter(
      (profile) => profile.hasPrefix || (profile.hasBreadcrumb && profile.normalizedRowText.includes(" > "))
    );
    if (prefixCompatibleProfiles.length > 0) {
      return {
        entries: prefixCompatibleProfiles.map((profile) => profile.entry),
        activeRowListSelectorUsed: stagePanelResult.activeRowListSelectorUsed,
        stageRowCount: stagePanelResult.stageRowCount,
        excludedParentRow: stagePanelResult.excludedParentRow,
      };
    }

    // If no breadcrumb-prefix rows are available, fall back to rows that at least match wanted stage labels.
    const wantedCompatibleProfiles = candidateProfiles.filter((profile) =>
      normalizedWanted.some(
        (wanted) =>
          profile.normalizedRowText === wanted || profile.normalizedRowText.includes(wanted)
      )
    );
    if (wantedCompatibleProfiles.length > 0) {
      return {
        entries: wantedCompatibleProfiles.map((profile) => profile.entry),
        activeRowListSelectorUsed: stagePanelResult.activeRowListSelectorUsed,
        stageRowCount: stagePanelResult.stageRowCount,
        excludedParentRow: stagePanelResult.excludedParentRow,
      };
    }

    const preferred = stageSourceEntries.filter((entry) => {
      const candidates = getOptionTextCandidates(entry);
      return candidates.some((candidate) => {
        const cleaned = cleanCategoryStage(candidate);
        const normalized = normalizeText(cleaned);
        if (!normalized) return false;

        if (
          normalizedWanted.some(
            (wanted) => normalized === wanted || normalized.includes(wanted)
          ) &&
          (containsBreadcrumbSeparator(cleaned) ||
            (normalizedPrefix && normalized.includes(normalizedPrefix)) ||
            (normalizedPrefixFlat && containsStagesInOrder(normalized, confirmedStages)))
        ) {
          return true;
        }

        if (
          normalizedPrefix &&
          normalized.includes(normalizedPrefix) &&
          normalized !== normalizedPrefix
        ) {
          return true;
        }

        if (
          normalizedPrefixFlat &&
          containsStagesInOrder(normalized, confirmedStages) &&
          normalized !== normalizedPrefixFlat
        ) {
          return true;
        }

        return false;
      });
    });

    if (confirmedStages.length > 0) {
      if (stageIndex >= 2 && !preferred.length) {
        return {
          entries: stageSourceEntries,
          activeRowListSelectorUsed: stagePanelResult.activeRowListSelectorUsed,
          stageRowCount: stagePanelResult.stageRowCount,
          excludedParentRow: stagePanelResult.excludedParentRow,
        };
      }

      return {
        entries: preferred,
        activeRowListSelectorUsed: stagePanelResult.activeRowListSelectorUsed,
        stageRowCount: stagePanelResult.stageRowCount,
        excludedParentRow: stagePanelResult.excludedParentRow,
      };
    }

    return {
      entries: preferred.length ? preferred : stageSourceEntries,
      activeRowListSelectorUsed: stagePanelResult.activeRowListSelectorUsed,
      stageRowCount: stagePanelResult.stageRowCount,
      excludedParentRow: stagePanelResult.excludedParentRow,
    };
  }

  function collectStageOptionRowsFromModal(input) {
    const { confirmedStages, pickerElement } = input;
    if (!(pickerElement instanceof Element) || !confirmedStages.length) {
      return {
        entries: [],
        activeRowListSelectorUsed: "none",
        stageRowCount: 0,
        excludedParentRow: false,
      };
    }

    const rowSelectorUsed = 'div[data-testid="category-option-dropdown"][role="option"]';
    const sourceRows = Array.from(pickerElement.querySelectorAll(rowSelectorUsed)).filter(
      (row) => row instanceof Element && isVisible(row)
    );
    const parentLabel = normalizeText(confirmedStages[confirmedStages.length - 1] ?? "");

    const entries = [];
    for (const row of sourceRows) {
      if (!(row instanceof Element)) continue;
      entries.push({
        element: row,
        selector: rowSelectorUsed,
        clickTarget: resolveOptionClickTarget(row),
      });
    }

    const entriesWithoutParent = parentLabel
      ? entries.filter((entry) => {
          const row = resolveCategoryOptionRow(entry.clickTarget) ?? resolveCategoryOptionRow(entry.element);
          const rowLabel = normalizeText(getCategoryOptionRowLabel(row ?? entry.element));
          return rowLabel !== parentLabel;
        })
      : entries;

    return {
      entries: entriesWithoutParent,
      activeRowListSelectorUsed: rowSelectorUsed,
      stageRowCount: entries.length,
      excludedParentRow: !!parentLabel && entriesWithoutParent.length !== entries.length,
    };
  }

  function summarizeCategoryCandidates(optionEntries) {
    const sampledRowTexts = [];
    const selectors = new Set();
    let clickableRowCount = 0;
    let breadcrumbRowCount = 0;

    for (const entry of optionEntries) {
      selectors.add(entry.selector);
      if (entry.clickTarget instanceof Element) clickableRowCount += 1;

      const text = cleanCategoryStage(getOptionTextFromEntry(entry));
      if (!text) continue;
      if (containsBreadcrumbSeparator(text)) breadcrumbRowCount += 1;
      if (sampledRowTexts.length < 8) {
        sampledRowTexts.push(text);
      }
    }

    const candidateElementSelector = Array.from(selectors).slice(0, 3).join(", ") || "none";
    const candidateSourceType = breadcrumbRowCount > 0 ? "breadcrumb_rows" : "stage_rows";
    const extractedRowText = sampledRowTexts[0] ?? "";

    return {
      candidateSourceType,
      candidateElementSelector,
      extractedRowText,
      clickableRowCount,
      breadcrumbRowCount,
      sampledRowTexts: sampledRowTexts.join(" | ") || "none",
    };
  }

  function isBreadcrumbResultMode(optionEntries, confirmedStages) {
    const normalizedConfirmedPrefix = normalizeText(confirmedStages.join(" > "));
    const normalizedConfirmedPrefixFlat = normalizeText(confirmedStages.join(" "));

    for (const entry of optionEntries) {
      const candidates = getOptionTextCandidates(entry);
      for (const candidate of candidates) {
        const cleaned = cleanCategoryStage(candidate);
        const normalized = normalizeText(cleaned);
        if (!normalized) continue;

        if (containsBreadcrumbSeparator(cleaned)) {
          return true;
        }

        const segments = splitCategoryPathSegments(cleaned);
        if (segments.length >= 3) {
          return true;
        }

        if (
          normalizedConfirmedPrefix &&
          normalized.includes(normalizedConfirmedPrefix) &&
          normalized !== normalizedConfirmedPrefix
        ) {
          return true;
        }

        if (
          normalizedConfirmedPrefixFlat &&
          containsStagesInOrder(normalized, confirmedStages) &&
          normalized !== normalizedConfirmedPrefixFlat
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function findBreadcrumbStageMatches(input) {
    const { optionEntries, stageLabelsToTry, confirmedStages } = input;
    const normalizedWanted = stageLabelsToTry.map((label) => normalizeText(label)).filter(Boolean);
    const normalizedPrefix = confirmedStages.map((stage) => normalizeText(stage)).filter(Boolean);
    if (!normalizedWanted.length || !normalizedPrefix.length) return [];

    return optionEntries.filter((entry) => {
      const candidates = getOptionTextCandidates(entry);
      return candidates.some((candidate) => {
        const breadcrumbStages = splitCategoryPathSegments(candidate)
          .map((stage) => normalizeText(stage))
          .filter(Boolean);

        if (breadcrumbStages.length > normalizedPrefix.length) {
          const prefixStart = findStageSequenceStart(breadcrumbStages, normalizedPrefix);
          if (prefixStart >= 0) {
            const nextIndex = prefixStart + normalizedPrefix.length;
            if (nextIndex < breadcrumbStages.length) {
              return normalizedWanted.includes(breadcrumbStages[nextIndex]);
            }
          }
        }

        return containsWantedAfterPrefixInFlatText({
          candidateText: normalizeText(candidate),
          confirmedStages,
          stageLabelsToTry,
        });
      });
    });
  }

  function splitCategoryPathSegments(value) {
    const normalized = String(value ?? "")
      .replace(/[›»]/g, ">")
      .replace(/\s*>\s*/g, " > ");
    return splitCategoryStages(normalized);
  }

  function containsBreadcrumbSeparator(value) {
    return /[>›»]/.test(String(value ?? ""));
  }

  function containsStagesInOrder(normalizedText, stages) {
    const normalizedStages = stages.map((stage) => normalizeText(stage)).filter(Boolean);
    if (!normalizedStages.length) return false;

    let searchStart = 0;
    for (const stage of normalizedStages) {
      const index = normalizedText.indexOf(stage, searchStart);
      if (index < 0) return false;
      searchStart = index + stage.length;
    }
    return true;
  }

  function containsWantedAfterPrefixInFlatText(input) {
    const { candidateText, confirmedStages, stageLabelsToTry } = input;
    if (!candidateText) return false;

    if (!containsStagesInOrder(candidateText, confirmedStages)) {
      return false;
    }

    const normalizedStages = confirmedStages.map((stage) => normalizeText(stage)).filter(Boolean);
    let searchStart = 0;
    for (const stage of normalizedStages) {
      const index = candidateText.indexOf(stage, searchStart);
      if (index < 0) return false;
      searchStart = index + stage.length;
    }

    const normalizedWanted = stageLabelsToTry.map((label) => normalizeText(label)).filter(Boolean);
    return normalizedWanted.some((wanted) => {
      const wantedIndex = candidateText.indexOf(wanted, searchStart);
      return wantedIndex >= 0;
    });
  }

  function findStageSequenceStart(haystackStages, needleStages) {
    if (!needleStages.length) return -1;
    const maxStart = haystackStages.length - needleStages.length;
    for (let start = 0; start <= maxStart; start += 1) {
      let allMatch = true;
      for (let index = 0; index < needleStages.length; index += 1) {
        if (haystackStages[start + index] !== needleStages[index]) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) return start;
    }
    return -1;
  }

  function getOptionTextFromEntry(entry) {
    const categoryRow = resolveCategoryOptionRow(entry.element) ?? resolveCategoryOptionRow(entry.clickTarget);
    if (categoryRow) {
      const rowCandidates = getOptionTextCandidates(entry);
      const breadcrumbCandidate = rowCandidates.find((candidate) =>
        containsBreadcrumbSeparator(candidate)
      );
      if (breadcrumbCandidate) {
        return cleanCategoryStage(breadcrumbCandidate);
      }

      const rowLabel = getCategoryOptionRowLabel(categoryRow);
      if (rowLabel) return rowLabel;
    }

    const directText = cleanCategoryStage(getOptionText(entry.element));
    if (directText) return directText;

    return cleanCategoryStage(getOptionText(entry.clickTarget));
  }

  function getOptionTextCandidates(entry) {
    const candidates = [];
    const seen = new Set();

    function addCandidate(text) {
      const cleaned = cleanCategoryStage(text);
      if (isSeparatorOptionLabel(cleaned)) return;
      const normalized = normalizeText(cleaned);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(cleaned);
    }

    const categoryRow = resolveCategoryOptionRow(entry.element) ?? resolveCategoryOptionRow(entry.clickTarget);
    if (categoryRow) {
      addCandidate(getCategoryOptionRowLabel(categoryRow));
      addCandidate(getOptionText(categoryRow));
      return candidates;
    }

    addCandidate(getOptionText(entry.element));
    addCandidate(getOptionText(entry.clickTarget));

    const labelLikeChildren = Array.from(
      entry.clickTarget.querySelectorAll("span, div, p, strong, label")
    );

    for (const child of labelLikeChildren) {
      if (!(child instanceof Element)) continue;
      if (!isVisible(child)) continue;
      const childText = cleanCategoryStage(child.textContent ?? "");
      if (!childText || childText.length > 90) continue;
      addCandidate(childText);
    }

    return candidates;
  }

  function getOptionText(option) {
    const uniqueValues = [];
    const seen = new Set();
    const orderedCandidates = [
      option.innerText,
      option.textContent,
      option.getAttribute("aria-label"),
      option.getAttribute("title"),
      option.getAttribute("data-value"),
      option.getAttribute("value"),
    ];

    for (const candidate of orderedCandidates) {
      const cleaned = cleanCategoryStage(candidate);
      const normalized = normalizeText(cleaned);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      uniqueValues.push(cleaned);
    }

    return uniqueValues[0] ?? "";
  }

  function isSeparatorOptionLabel(value) {
    const cleaned = cleanCategoryStage(value);
    if (!cleaned) return true;
    const compact = cleaned.replace(/[\s\-–—_•·|:()[\]{}.,/\\]+/g, "");
    return compact.length === 0;
  }

  function getCustomSelectAttemptValue(fieldKey, value) {
    if (fieldKey !== "color") {
      return { value, reason: "" };
    }

    const baseColor = extractSafeBaseColor(value);
    if (!baseColor) {
      return { value: null, reason: "no safe base color" };
    }

    return { value: baseColor, reason: "" };
  }

  function splitCategoryStages(value) {
    return value
      .split(">")
      .map((part) => cleanCategoryStage(part))
      .filter(Boolean);
  }

  function cleanCategoryStage(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function getStageLabelsForMatch(stageLabel, stageIndex, fieldConfig) {
    if (stageIndex !== 0) return [stageLabel];

    const stageOneAliases = fieldConfig?.stageOneAliases ?? {};
    const aliases = stageOneAliases[stageLabel] ?? [];
    return [stageLabel, ...aliases].filter(Boolean);
  }

  function buildVisibleOptionsPreview(options, maxItems) {
    const labels = [];
    const seen = new Set();

    for (const entry of options) {
      const label = cleanCategoryStage(getOptionTextFromEntry(entry));
      const normalizedLabel = normalizeText(label);
      if (!normalizedLabel || seen.has(normalizedLabel)) continue;
      seen.add(normalizedLabel);
      labels.push(`"${label}"`);
      if (labels.length >= maxItems) break;
    }

    return labels.join(", ");
  }

  function buildStageOneOptionDiagnostics(optionEntries, maxItems) {
    const snippets = [];
    for (let index = 0; index < optionEntries.length && snippets.length < maxItems; index += 1) {
      snippets.push(`#${index + 1} ${describeOptionEntry(optionEntries[index])}`);
    }
    return snippets.join(" | ");
  }

  function describeOptionEntry(entry) {
    const label = cleanCategoryStage(getOptionTextFromEntry(entry));
    const alternatives = getOptionTextCandidates(entry).slice(0, 3).join(" / ");
    const nodeType = detectOptionNodeType(entry.element);
    const clickType = detectOptionNodeType(entry.clickTarget);
    return `sel:${entry.selector} node:${nodeType} text:"${label}" alt:"${alternatives}" click:${clickType}`;
  }

  function detectOptionNodeType(node) {
    if (!(node instanceof Element)) return "unknown";

    if (
      node.matches(
        '[role="option"], [data-radix-collection-item], li[role="option"], .select__option, .option'
      )
    ) {
      return "row";
    }

    if (node.matches("button")) {
      return "row";
    }

    const text = cleanCategoryStage(getOptionText(node));
    if (text && node.children.length <= 1) {
      return "child_label";
    }

    return "icon_or_child";
  }

  function resolveOptionClickTarget(node) {
    if (!(node instanceof Element)) return node;

    const categoryRow = resolveCategoryOptionRow(node);
    if (categoryRow) return categoryRow;

    const row = node.closest(
      '[role="option"], [data-radix-collection-item], li[role="option"], .select__option, .option, button'
    );

    return row ?? node;
  }

  function resolveCategoryOptionRow(node) {
    if (!(node instanceof Element)) return null;
    return (
      node.closest('div[data-testid="category-option-dropdown"][role="option"]') ??
      node.closest('div[data-testid="category-option-dropdown"]')
    );
  }

  function getCategoryOptionRowLabel(row) {
    if (!(row instanceof Element)) return "";

    const ariaLabel = cleanCategoryStage(row.getAttribute("aria-label") || "");
    if (ariaLabel) return ariaLabel;

    const leafDescendantTexts = Array.from(row.querySelectorAll("div, span, p, label, strong"))
      .filter((child) => child instanceof Element && isVisible(child))
      .filter((child) => child.children.length === 0)
      .map((child) => cleanCategoryStage(child.innerText || child.textContent || ""))
      .filter(Boolean)
      .filter((text) => /[a-z0-9]/i.test(text));

    const directWithSeparators = leafDescendantTexts.find((text) => /[>›»]/.test(text));
    if (directWithSeparators) return directWithSeparators;

    if (leafDescendantTexts.length > 0) {
      // Prefer the longest visible leaf text-bearing descendant.
      return leafDescendantTexts.sort((a, b) => b.length - a.length)[0];
    }

    return cleanCategoryStage(row.innerText || row.textContent || "");
  }

  function isCategoryCompletionConfirmed(input) {
    const { control, fullPath, fieldConfig } = input;
    const fullPathNormalized = normalizeText(String(fullPath).replace(/>/g, " "));
    const stages = splitCategoryStages(fullPath);
    const finalStage = stages[stages.length - 1] ?? "";
    const normalizedFinalStage = normalizeText(finalStage);

    const controlSummary = normalizeText(getControlSummaryText(control));
    if (fullPathNormalized && controlSummary.includes(fullPathNormalized)) {
      return true;
    }

    if (normalizedFinalStage && controlSummary.includes(normalizedFinalStage)) {
      return true;
    }

    const pickerInfo = findVisibleCategoryPicker(fieldConfig.pickerContainerSelectors ?? []);
    if (!pickerInfo?.element) {
      return false;
    }

    const selectedCandidates = findVisibleSelectedCategoryOptions(
      pickerInfo.element,
      fieldConfig.selectedStateSelectors ?? []
    );

    return selectedCandidates.some((candidate) => {
      const candidateText = normalizeText(getOptionText(candidate));
      return candidateText === normalizedFinalStage;
    });
  }

  function getControlSummaryText(control) {
    return [
      control.textContent,
      control.getAttribute("value"),
      control.getAttribute("aria-label"),
      control.getAttribute("title"),
      control.getAttribute("data-value"),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function findVisibleSelectedCategoryOptions(pickerRoot, selectedStateSelectors) {
    const selectors = selectedStateSelectors.length
      ? selectedStateSelectors
      : ['[aria-selected="true"]', '[data-state="checked"]', '[data-selected="true"]'];

    const seen = new Set();
    const selected = [];

    for (const selector of selectors) {
      const candidates = Array.from(pickerRoot.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        if (!isVisible(candidate)) continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        selected.push(candidate);
      }
    }

    return selected;
  }

  async function retrySizeAfterCategorySuccess(input) {
    const { fillSteps, stepOutcomes, usedElements, filled, needsReview, skippedForSafety } = input;

    if (stepOutcomes.category !== "filled") {
      if (stepOutcomes.size !== "filled") {
        const sizeStep = fillSteps.find((step) => step.key === "size");
        if (!sizeStep) return;

        clearStepResultsFromLists(sizeStep.label, [filled, needsReview, skippedForSafety]);
        skippedForSafety.push(`${sizeStep.label} (category not confirmed)`);
        stepOutcomes.size = "skipped_for_safety";
      }
      return;
    }
    if (stepOutcomes.size === "filled") return;

    const sizeStep = fillSteps.find((step) => step.key === "size");
    if (!sizeStep) return;

    clearStepResultsFromLists(sizeStep.label, [filled, needsReview, skippedForSafety]);

    const rawValue = typeof sizeStep.value === "string" ? sizeStep.value.trim() : "";
    if (!rawValue) {
      needsReview.push(`${sizeStep.label} (payload missing)`);
      stepOutcomes.size = "needs_review";
      return;
    }

    await wait(220);

    const sizeDiscovery = await findPostCategorySizeField(sizeStep.selectorConfig);
    if (!sizeDiscovery.sizeControl) {
      needsReview.push(
        `${sizeStep.label} (retry: specifics found: ${sizeDiscovery.specificsFound ? "yes" : "no"}; ` +
          `size field found: ${sizeDiscovery.sizeFieldFound ? "yes" : "no"}; size control found: no)`
      );
      stepOutcomes.size = "needs_review";
      return;
    }

    if (usedElements.has(sizeDiscovery.sizeControl)) {
      skippedForSafety.push(`${sizeStep.label} (retry: collision prevention)`);
      stepOutcomes.size = "skipped_for_safety";
      return;
    }

    const sizeFillResult = await tryFillSizeReactSelect({
      value: rawValue,
      sizeAction: sizeStep,
      sizeDiscovery,
      sizeConfig: sizeStep.selectorConfig ?? {},
    });

    if (sizeFillResult.status === "filled") {
      usedElements.add(sizeDiscovery.sizeControl);
      filled.push(sizeStep.label);
      stepOutcomes.size = "filled";
      return;
    }

    if (sizeFillResult.status === "needs_review") {
      needsReview.push(
        `${sizeStep.label} (retry: specifics found: ${sizeDiscovery.specificsFound ? "yes" : "no"}; ` +
          `size field found: ${sizeDiscovery.sizeFieldFound ? "yes" : "no"}; size control found: yes; ` +
          `raw: "${sizeFillResult.diagnostics?.rawValue ?? rawValue}"; ` +
          `adapted target: ${sizeFillResult.diagnostics?.adaptedTarget || "none"}; ` +
          `listbox found: ${sizeFillResult.diagnostics?.listboxFound ? "yes" : "no"}; ` +
          `visible options: ${sizeFillResult.diagnostics?.visibleOptionsSample || "none"}; ` +
          `exact match found: ${sizeFillResult.diagnostics?.exactMatchFound ? "yes" : "no"})`
      );
      stepOutcomes.size = "needs_review";
      return;
    }

    skippedForSafety.push(`${sizeStep.label} (retry: ${sizeFillResult.reason})`);
    stepOutcomes.size = "skipped_for_safety";
  }

  const DYNAMIC_FIELD_SYNONYMS = {
    brand: ["brand", "maker"],
    signed: ["signed", "signed/maker", "signed maker", "maker", "designer"],
    signedmaker: ["signed", "signed maker", "signed/maker", "designer", "maker"],
    material: ["material", "materials", "metal", "base material", "base metal"],
    style: ["style", "type", "style type", "style/theme", "style theme"],
    type: ["type", "style", "style type", "style/theme"],
    styletype: ["style", "type", "style type", "style/theme", "style theme", "theme"],
    setincludes: ["set includes", "includes", "included"],
    color: ["color", "colour"],
    size: ["size"],
    department: ["department"],
    jewelrydepartment: ["jewelry department"],
  };

  async function fillDynamicVisibleFieldsAfterCategory(input) {
    const { payload, selectors, stepOutcomes, usedElements, filled, needsReview, skippedForSafety } =
      input;

    if (stepOutcomes.category !== "filled") {
      skippedForSafety.push("Dynamic optional fields (category not confirmed)");
      return;
    }

    const specificsSelectors = selectors?.size?.postCategorySpecificsContainerSelectors ?? [];
    const revealStatus = await revealOptionalFieldsIfPresent(specificsSelectors);
    await wait(180);

    const specificsRoot = await waitForSpecificsContainer(specificsSelectors);
    if (!specificsRoot) {
      const reason = revealStatus.buttonFound
        ? revealStatus.clicked
          ? revealStatus.expandedDetected
            ? "clicked but specifics section not found"
            : "clicked but expansion not detected"
          : "button found but not clicked"
        : "button not found";
      needsReview.push(`Dynamic optional fields (${reason})`);
      return;
    }

    let visibleRegistry = discoverVisibleFieldRegistry(specificsRoot);
    if (!visibleRegistry.length) {
      await wait(220);
      visibleRegistry = discoverVisibleFieldRegistry(specificsRoot);
    }
    if (!visibleRegistry.length) {
      needsReview.push(
        "Dynamic optional fields (expanded but no visible fields discovered)"
      );
      return;
    }

    const {
      candidates,
      excludedPayloadKeys,
      hasVisibleDepartmentLikeField,
      visibleDepartmentLikeLabels,
      departmentOverrideApplied,
      exclusionReasonByKey,
    } = buildDynamicPayloadCandidates(
      payload,
      stepOutcomes,
      visibleRegistry
    );
    if (!candidates.length) {
      skippedForSafety.push("Dynamic optional fields (no payload values)");
      return;
    }

    let matchedCount = 0;
    let filledCount = 0;
    const adapterAttemptedByField = [];
    const unattemptedFieldReasons = [];
    const finalRouteByKey = [];

    for (const field of visibleRegistry) {
      const initialMatches = candidates.filter((candidate) =>
        isDynamicLabelMatch(field.normalizedLabel, candidate.matchTerms)
      );
      const resolved = resolveFinalMatchesByPrecedence(
        field.normalizedLabel,
        initialMatches,
        candidates
      );
      const matches = resolved.matches;
      finalRouteByKey.push({
        label: field.label,
        matchedKeysBeforeResolution: initialMatches.map((candidate) => candidate.key),
        matchedKeysAfterResolution: matches.map((candidate) => candidate.key),
        resolutionPhase: resolved.phase,
        matchedKeys: matches.map((candidate) => candidate.key),
      });
      if (matches.length === 0) {
        unattemptedFieldReasons.push({
          label: field.label,
          controlFamily: field.controlFamily,
          reason: "no_payload_match",
        });
        continue;
      }
      if (matches.length > 1) {
        unattemptedFieldReasons.push({
          label: field.label,
          controlFamily: field.controlFamily,
          reason: "ambiguous_payload_match",
          matchedKeys: matches.map((candidate) => candidate.key),
        });
        continue;
      }
      const candidate = matches[0];
      matchedCount += 1;

      if (usedElements.has(field.control)) {
        skippedForSafety.push(`eBay ${field.label} (collision prevention)`);
        adapterAttemptedByField.push({
          label: field.label,
          payloadKey: candidate.key,
          controlFamily: field.controlFamily,
          adapterSelected: "collision_prevention_skip",
          status: "skipped_for_safety",
          reason: "collision_prevention",
        });
        continue;
      }

      const result = await fillDynamicFieldValue(field, candidate.value, selectors);
      adapterAttemptedByField.push({
        label: field.label,
        payloadKey: candidate.key,
        controlFamily: result.controlFamily ?? field.controlFamily,
        adapterSelected: result.adapterSelected ?? "unknown",
        status: result.status,
        reason: result.reason ?? "",
      });
      if (result.status === "filled") {
        usedElements.add(field.control);
        filled.push(`eBay ${field.label}`);
        filledCount += 1;
        continue;
      }

      if (result.status === "needs_review") {
        needsReview.push(`eBay ${field.label} (${result.reason})`);
        continue;
      }

      skippedForSafety.push(`eBay ${field.label} (${result.reason})`);
    }

    console.debug("[LPU Vendoo] Dynamic visible fields", {
      revealStatus,
      payloadDepartmentState: {
        department:
          typeof payload?.marketplaces?.ebay?.itemSpecifics?.department === "string"
            ? payload.marketplaces.ebay.itemSpecifics.department.trim()
              ? "present"
              : "blank"
            : "omitted",
        jewelryDepartment:
          typeof (
            payload?.marketplaces?.ebay?.itemSpecifics?.jewelryDepartment ??
            payload?.marketplaces?.ebay?.jewelryDepartment
          ) === "string"
            ? String(
                payload.marketplaces.ebay.itemSpecifics?.jewelryDepartment ??
                  payload.marketplaces.ebay.jewelryDepartment
              ).trim()
              ? "present"
              : "blank"
            : "omitted",
      },
      discovered: visibleRegistry.map((field) => ({
        label: field.label,
        normalizedLabel: field.normalizedLabel,
        controlType: field.controlType,
        controlFamily: field.controlFamily,
        allowedOptions: field.allowedOptions.slice(0, 8),
      })),
      candidateKeys: candidates.map((candidate) => candidate.key),
      excludedPayloadKeys,
      hasVisibleDepartmentLikeField,
      visibleDepartmentLikeLabels,
      departmentOverrideApplied,
      exclusionReasonByKey,
      adapterAttemptedByField,
      unattemptedFieldReasons,
      finalRouteByKey,
      matchedCount,
      filledCount,
    });
  }

  async function revealOptionalFieldsIfPresent(specificsSelectors) {
    const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
    const showOptional = buttons.find((button) => {
      if (!(button instanceof Element)) return false;
      if (!isVisible(button)) return false;
      const text = normalizeText(button.textContent || "");
      return text.includes("show optional fields") || text === "show optional";
    });

    if (!showOptional) {
      return {
        buttonFound: false,
        clicked: false,
        expandedDetected: false,
        reason: "button not found",
      };
    }

    const wasExpandedBefore = isOptionalFieldsExpanded(showOptional, specificsSelectors);
    if (wasExpandedBefore) {
      return {
        buttonFound: true,
        clicked: false,
        expandedDetected: true,
        reason: "already expanded",
      };
    }

    clickElement(showOptional);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(140);
      if (isOptionalFieldsExpanded(showOptional, specificsSelectors)) {
        return {
          buttonFound: true,
          clicked: true,
          expandedDetected: true,
          reason: "expanded after click",
        };
      }
    }

    return {
      buttonFound: true,
      clicked: true,
      expandedDetected: false,
      reason: "clicked but expansion not detected",
    };
  }

  async function waitForSpecificsContainer(selectors) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const found = findVisibleSpecificsContainer(selectors);
      if (found) return found;
      await wait(140);
    }
    return null;
  }

  function isOptionalFieldsExpanded(button, specificsSelectors) {
    if (!(button instanceof Element)) return false;

    const ariaExpanded = button.getAttribute("aria-expanded");
    if (ariaExpanded === "true") return true;

    const buttonText = normalizeText(button.textContent || "");
    if (buttonText.includes("hide optional fields")) return true;

    const specificsRoot = findVisibleSpecificsContainer(specificsSelectors ?? []);
    if (!specificsRoot) return false;

    const visibleLabels = Array.from(specificsRoot.querySelectorAll("label")).filter(
      (label) => label instanceof Element && isVisible(label)
    );
    return visibleLabels.length > 0;
  }

  function buildDynamicPayloadCandidates(payload, _stepOutcomes, visibleRegistry) {
    const ebay = payload?.marketplaces?.ebay ?? {};
    const specifics = ebay?.itemSpecifics ?? {};
    const candidates = [];
    const excludedPayloadKeys = [];
    const seenKeys = new Set();
    const visibleLabels = new Set(
      Array.isArray(visibleRegistry)
        ? visibleRegistry.map((field) => normalizeText(field.label)).filter(Boolean)
        : []
    );
    const visibleDepartmentLikeLabels = Array.from(visibleLabels).filter((label) =>
      /\bdepartment\b/.test(label)
    );
    const hasVisibleDepartmentLikeField = visibleDepartmentLikeLabels.length > 0;
    const departmentOverrideApplied = {};
    const exclusionReasonByKey = {};

    function isDepartmentLikeKey(rawKey) {
      const normalized = normalizeText(rawKey).replace(/[^a-z0-9]/g, "");
      return normalized === "department" || normalized === "jewelrydepartment";
    }

    function addCandidateEntry(key, value) {
      const rawKey = String(key);
      const allowDepartmentOverride =
        hasVisibleDepartmentLikeField && isDepartmentLikeKey(rawKey);
      if (isDepartmentLikeKey(rawKey)) {
        departmentOverrideApplied[rawKey] = allowDepartmentOverride;
      }
      if (typeof value !== "string" || !value.trim()) {
        excludedPayloadKeys.push(rawKey);
        exclusionReasonByKey[rawKey] = "missing_or_blank_value";
        return;
      }
      const normalizedValue = normalizeOptionValue(value);
      if (normalizedValue === "not applicable") {
        excludedPayloadKeys.push(rawKey);
        exclusionReasonByKey[rawKey] = "not_applicable";
        return;
      }
      const dedupeKey = normalizeText(rawKey).replace(/[^a-z0-9]/g, "");
      if (!dedupeKey) return;
      if (seenKeys.has(dedupeKey)) {
        excludedPayloadKeys.push(rawKey);
        exclusionReasonByKey[rawKey] = "duplicate_key";
        return;
      }
      seenKeys.add(dedupeKey);

      const normalizedKey = normalizeText(rawKey).replace(/[^a-z0-9]/g, "");
      const synonyms = DYNAMIC_FIELD_SYNONYMS[normalizedKey] ?? [];
      const keyTerms = buildKeyTermsFromKey(rawKey);
      const matchTerms = Array.from(new Set([...synonyms, ...keyTerms].map(normalizeText)));
      candidates.push({
        key: rawKey,
        value: String(value).trim(),
        matchTerms,
      });
    }

    for (const [key, value] of Object.entries(specifics)) {
      addCandidateEntry(key, value);
    }

    for (const key of ["department", "jewelryDepartment"]) {
      addCandidateEntry(key, ebay?.[key]);
    }

    return {
      candidates,
      excludedPayloadKeys: Array.from(new Set(excludedPayloadKeys)),
      hasVisibleDepartmentLikeField,
      visibleDepartmentLikeLabels,
      departmentOverrideApplied,
      exclusionReasonByKey,
    };
  }

  function buildKeyTermsFromKey(key) {
    const expanded = key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim();
    const normalized = normalizeText(expanded);
    if (!normalized) return [];
    return [normalized];
  }

  function discoverVisibleFieldRegistry(root) {
    if (!(root instanceof Element)) return [];

    const labels = Array.from(root.querySelectorAll("label"));
    const seenControls = new Set();
    const fields = [];

    for (const labelEl of labels) {
      if (!(labelEl instanceof Element)) continue;
      if (!isVisible(labelEl)) continue;

      const label = cleanCategoryStage(labelEl.textContent || "");
      const normalizedLabel = normalizeText(label);
      if (!normalizedLabel) continue;

      const control = findControlForVisibleLabel(labelEl, root);
      if (!control || seenControls.has(control)) continue;
      seenControls.add(control);

      const controlType = detectDynamicControlType(control);
      const controlFamily = classifyDynamicControlFamily({
        label,
        normalizedLabel,
        control,
        controlType,
      });
      const allowedOptions = discoverAllowedOptions(control, controlType);

      fields.push({
        label,
        normalizedLabel,
        control,
        controlType,
        controlFamily,
        allowedOptions,
      });
    }

    return fields;
  }

  function findControlForVisibleLabel(labelEl, root) {
    const forId = labelEl.getAttribute("for");
    if (forId) {
      const linked = document.getElementById(forId);
      if (linked instanceof Element && root.contains(linked) && isVisible(linked)) {
        return linked;
      }
    }

    const container = labelEl.closest("div, section, fieldset") ?? labelEl.parentElement;
    if (!(container instanceof Element)) return null;

    const selectors = [
      ".react-select__control",
      "[role='combobox']",
      "select",
      "textarea",
      "input:not([type='hidden'])",
      "button[aria-haspopup='listbox']",
      "button",
    ];

    const normalizedLabel = normalizeText(labelEl.textContent || "");
    const candidates = [];
    const seen = new Set();

    function addCandidatesFrom(scope) {
      if (!(scope instanceof Element)) return;
      for (const selector of selectors) {
        const found = Array.from(scope.querySelectorAll(selector)).filter(
          (candidate) =>
            candidate instanceof Element && isVisible(candidate) && !seen.has(candidate)
        );
        for (const candidate of found) {
          seen.add(candidate);
          candidates.push(candidate);
        }
      }
    }

    addCandidatesFrom(container);
    const nearestSection = container.closest("section, fieldset, form");
    if (nearestSection instanceof Element) {
      addCandidatesFrom(nearestSection);
    }

    if (!candidates.length) return null;

    const scored = candidates.map((candidate) => ({
      candidate,
      score: scoreControlForLabelMatch(candidate, normalizedLabel, labelEl),
    }));
    scored.sort((a, b) => b.score - a.score);

    if (scored[0]?.score > 0) return scored[0].candidate;
    return candidates[0] ?? null;
  }

  function scoreControlForLabelMatch(control, normalizedLabel, labelEl) {
    if (!(control instanceof Element)) return 0;
    let score = 0;

    const controlMetadata = normalizeText(
      [
        control.getAttribute("name"),
        control.getAttribute("id"),
        control.getAttribute("aria-label"),
        control.getAttribute("placeholder"),
        control.getAttribute("title"),
        control.className,
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (controlMetadata.includes(normalizedLabel)) score += 5;
    const labelTokens = normalizedLabel.split(" ").filter(Boolean);
    for (const token of labelTokens) {
      if (controlMetadata.includes(token)) score += 1;
    }

    const sameContainer = control.closest("div, section, fieldset");
    const labelContainer = labelEl.closest("div, section, fieldset");
    if (sameContainer && labelContainer && sameContainer === labelContainer) {
      score += 3;
    }

    if (control.matches(".react-select__control, [role='combobox']")) score += 2;
    if (control.matches("select, textarea, input:not([type='hidden'])")) score += 1;

    return score;
  }

  function detectDynamicControlType(control) {
    if (!(control instanceof Element)) return "unknown";
    if (control.matches("textarea, [contenteditable='true']")) return "textarea";
    if (control.matches("select")) return "select";
    if (control.matches("input[type='checkbox']")) return "checkbox";
    if (control.matches("input[type='radio']")) return "radio";
    if (
      control.matches(".react-select__control, [role='combobox'], button[aria-haspopup='listbox']")
    ) {
      return "combobox";
    }
    if (control.matches("input:not([type='hidden'])")) return "text";
    return "unknown";
  }

  function classifyDynamicControlFamily(field) {
    const label = normalizeText(field?.normalizedLabel ?? field?.label ?? "");
    const controlType = field?.controlType ?? "unknown";
    const control = field?.control;

    if (label.includes("category") && (controlType === "combobox" || controlType === "select")) {
      return "category_picker";
    }
    if (controlType === "text") return "text_input";
    if (controlType === "textarea") return "textarea";
    if (controlType === "select") return "single_select_combobox";
    if (controlType === "combobox") {
      return isLikelyMultiValueControl(control) ? "multi_value_chip" : "single_select_combobox";
    }
    if (controlType === "checkbox") return "checkbox_group";
    if (controlType === "radio") return "radio_group";
    return "unknown_unsupported";
  }

  function resolveDynamicAdapterRoute(field) {
    const controlFamily = field.controlFamily || classifyDynamicControlFamily(field);
    if (controlFamily === "text_input") {
      return { controlFamily, adapterSelected: "text_set_value" };
    }
    if (controlFamily === "textarea") {
      return { controlFamily, adapterSelected: "textarea_set_value" };
    }
    if (controlFamily === "single_select_combobox") {
      if (field.controlType === "select" && field.control instanceof HTMLSelectElement) {
        return { controlFamily, adapterSelected: "select_exact_option" };
      }
      return { controlFamily, adapterSelected: "combobox_normalized_option" };
    }
    if (controlFamily === "multi_value_chip") {
      return { controlFamily, adapterSelected: "combobox_multi_value" };
    }
    if (controlFamily === "checkbox_group") {
      return { controlFamily, adapterSelected: "checkbox_group_unsupported" };
    }
    if (controlFamily === "radio_group") {
      return { controlFamily, adapterSelected: "radio_group_unsupported" };
    }
    if (controlFamily === "category_picker") {
      return { controlFamily, adapterSelected: "category_picker_unsupported" };
    }
    return { controlFamily: "unknown_unsupported", adapterSelected: "unknown_unsupported" };
  }

  function discoverAllowedOptions(control, controlType) {
    if (controlType !== "select" || !(control instanceof HTMLSelectElement)) return [];
    return Array.from(control.options)
      .map((option) => cleanCategoryStage(option.textContent || option.value || ""))
      .filter(Boolean)
      .slice(0, 12);
  }

  function isDynamicLabelMatch(label, terms) {
    const normalizedLabel = normalizeText(label);
    if (!normalizedLabel) return false;
    return terms.some((term) => {
      const normalizedTerm = normalizeText(term);
      if (!normalizedTerm) return false;
      return (
        normalizedLabel === normalizedTerm ||
        normalizedLabel.includes(normalizedTerm) ||
        normalizedTerm.includes(normalizedLabel)
      );
    });
  }

  function normalizePayloadKey(value) {
    return normalizeText(value).replace(/[^a-z0-9]/g, "");
  }

  function resolveFinalMatchesByPrecedence(fieldLabel, matches, allCandidates) {
    const normalizedFieldLabel = normalizeText(fieldLabel);
    const normalizedFieldKey = normalizePayloadKey(fieldLabel);
    if (!matches.length) return { matches: [], phase: "none" };

    const exactKeyMatches = matches.filter(
      (candidate) => normalizePayloadKey(candidate.key) === normalizedFieldKey
    );
    if (exactKeyMatches.length) {
      return { matches: exactKeyMatches, phase: "exact_key" };
    }

    const aliasKeys = getAliasKeysForLabel(normalizedFieldLabel);
    if (aliasKeys.size > 0) {
      const aliasMatches = matches.filter((candidate) =>
        aliasKeys.has(normalizePayloadKey(candidate.key))
      );
      if (aliasMatches.length) {
        return { matches: aliasMatches, phase: "alias_key" };
      }
    }

    const knownCandidateKeys = new Set(
      Array.isArray(allCandidates)
        ? allCandidates.map((candidate) => normalizePayloadKey(candidate.key))
        : []
    );
    const knownSynonymKeys = new Set(
      Object.keys(DYNAMIC_FIELD_SYNONYMS).map((key) => normalizePayloadKey(key))
    );
    const hasKnownFieldIdentity =
      !!normalizedFieldKey &&
      (knownCandidateKeys.has(normalizedFieldKey) || knownSynonymKeys.has(normalizedFieldKey));
    if (hasKnownFieldIdentity) {
      return { matches: [], phase: "no_exact_or_alias" };
    }

    const broaderMatches = matches.filter((candidate) =>
      isBroaderFallbackLabelMatch(normalizedFieldLabel, candidate.matchTerms)
    );
    if (broaderMatches.length) {
      return { matches: broaderMatches, phase: "broader" };
    }

    return { matches: [], phase: "none" };
  }

  function getAliasKeysForLabel(normalizedFieldLabel) {
    const aliasKeys = new Set();
    if (!normalizedFieldLabel) return aliasKeys;

    for (const [key, terms] of Object.entries(DYNAMIC_FIELD_SYNONYMS)) {
      if (!Array.isArray(terms)) continue;
      if (terms.some((term) => normalizeText(term) === normalizedFieldLabel)) {
        aliasKeys.add(normalizePayloadKey(key));
      }
    }

    return aliasKeys;
  }

  function isBroaderFallbackLabelMatch(normalizedFieldLabel, matchTerms) {
    if (!normalizedFieldLabel || !Array.isArray(matchTerms)) return false;
    return matchTerms.some((term) => {
      const normalizedTerm = normalizeText(term);
      if (!normalizedTerm) return false;
      if (normalizedTerm === normalizedFieldLabel) return true;
      return normalizedTerm.includes(normalizedFieldLabel);
    });
  }

  async function fillDynamicFieldValue(field, value, selectors) {
    const route = resolveDynamicAdapterRoute(field);
    if (!value || !value.trim()) {
      return {
        status: "needs_review",
        reason: "payload missing",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
      };
    }

    if (route.controlFamily === "text_input" || route.controlFamily === "textarea") {
      setElementValue(field.control, value);
      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
      };
    }

    if (
      route.controlFamily === "single_select_combobox" &&
      field.controlType === "select" &&
      field.control instanceof HTMLSelectElement
    ) {
      const payloadValues = buildNormalizedPayloadValues(value);
      if (!payloadValues.values.length) {
        return {
          status: "needs_review",
          reason: "payload missing after normalization",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
        };
      }
      if (payloadValues.multiValue) {
        return {
          status: "skipped_for_safety",
          reason: "multi-value payload for single-value select",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
        };
      }
      const normalizedValue = payloadValues.values[0];
      const exactOptions = Array.from(field.control.options).filter((option) => {
        const optionText = cleanCategoryStage(option.textContent || option.value || "");
        return normalizeOptionValue(optionText) === normalizedValue;
      });

      if (exactOptions.length !== 1) {
        return {
          status: "needs_review",
          reason: exactOptions.length > 1 ? "multiple exact select options" : "no exact select option",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
        };
      }

      field.control.value = exactOptions[0].value;
      field.control.dispatchEvent(new Event("change", { bubbles: true }));
      field.control.dispatchEvent(new Event("blur", { bubbles: true }));
      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
      };
    }

    if (
      route.controlFamily === "single_select_combobox" ||
      route.controlFamily === "multi_value_chip"
    ) {
      const optionSelectors = selectors?.color?.optionSelectors ?? [
        '[role="option"]',
        '[data-radix-collection-item]',
        '.react-select__option',
        'li[role="option"]',
      ];

      const payloadValues = buildNormalizedPayloadValues(value);
      if (!payloadValues.values.length) {
        return {
          status: "needs_review",
          reason: "payload missing after normalization",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
        };
      }
      const valueMode = payloadValues.multiValue ? "multi-value" : "single-value";
      if (payloadValues.multiValue && route.controlFamily !== "multi_value_chip") {
        return {
          status: "skipped_for_safety",
          reason: `${valueMode} payload for single-value control (raw: "${String(
            value
          ).trim()}"; canonical: "${payloadValues.canonicalValue}")`,
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
        };
      }

      for (const target of payloadValues.values) {
        const selectResult = await selectComboboxValueByNormalizedMatch({
          control: field.control,
          optionSelectors,
          target,
          fieldLabel: field.label,
          payloadRaw: String(value ?? "").trim(),
          payloadCanonical: payloadValues.canonicalValue,
          valueMode,
        });

        if (selectResult.status !== "filled") {
          return {
            ...selectResult,
            controlFamily: route.controlFamily,
            adapterSelected: route.adapterSelected,
          };
        }
      }

      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
      };
    }

    return {
      status: "skipped_for_safety",
      reason: `unsupported control family (${route.controlFamily})`,
      controlFamily: route.controlFamily,
      adapterSelected: route.adapterSelected,
    };
  }

  function findVisibleComboboxOptionEntries(control, optionSelectors) {
    const activeContext = resolveActiveComboboxContext(control);
    if (activeContext?.listbox) {
      const activeDiscovery = findVisibleOptionEntries(
        optionSelectors,
        activeContext.listbox,
        "combobox_active_control_scope"
      );
      if (activeDiscovery.entries.length) {
        return {
          ...activeDiscovery,
          activeControlIdentified: true,
          activeControlSource: activeContext.source,
          harvestedFromFallback: false,
        };
      }
    }

    const menuRoot =
      control.closest("div")?.querySelector(".react-select__menu") ??
      document.querySelector(".react-select__menu");
    if (menuRoot instanceof Element) {
      const menuDiscovery = findVisibleOptionEntries(
        optionSelectors,
        menuRoot,
        "combobox_menu_scope"
      );
      if (menuDiscovery.entries.length) {
        return {
          ...menuDiscovery,
          activeControlIdentified: !!activeContext,
          activeControlSource: activeContext?.source ?? "none",
          harvestedFromFallback: true,
        };
      }
    }

    const documentDiscovery = findVisibleOptionEntries(
      optionSelectors,
      null,
      "combobox_document_scope"
    );
    return {
      ...documentDiscovery,
      activeControlIdentified: !!activeContext,
      activeControlSource: activeContext?.source ?? "none",
      harvestedFromFallback: true,
    };
  }

  function resolveActiveComboboxContext(control) {
    const controlCandidates = [];
    const directInput = control.querySelector("input[aria-controls], input[aria-owns]");
    if (directInput instanceof HTMLInputElement) {
      controlCandidates.push({ source: "control-input", input: directInput });
    }

    if (document.activeElement instanceof HTMLInputElement) {
      const activeInput = document.activeElement;
      if (
        activeInput.matches("input[aria-controls], input[aria-owns]") &&
        (control.contains(activeInput) || control.closest("div")?.contains(activeInput))
      ) {
        controlCandidates.push({ source: "active-input", input: activeInput });
      }
    }

    for (const candidate of controlCandidates) {
      const controlledId =
        candidate.input.getAttribute("aria-controls") ||
        candidate.input.getAttribute("aria-owns") ||
        "";
      if (!controlledId) continue;
      const listbox = document.getElementById(controlledId);
      if (listbox instanceof Element && isVisible(listbox)) {
        return {
          source: candidate.source,
          listbox,
        };
      }
    }

    return null;
  }

  async function selectComboboxValueByNormalizedMatch(input) {
    const { control, optionSelectors, target, fieldLabel, payloadRaw, payloadCanonical, valueMode } =
      input;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      openCustomSelectControl(control);
      await wait(120 + attempt * 40);

      const optionDiscovery = findVisibleComboboxOptionEntries(control, optionSelectors);
      if (!optionDiscovery.entries.length) {
        if (attempt === 2) {
          const debugSummary = buildComboboxDebugSummary({
            fieldLabel,
            payloadRaw,
            payloadCanonical,
            valueMode,
            optionDiscovery,
            rawOptions: [],
            normalizedOptions: [],
            target,
            exactMatchFound: false,
          });
          console.debug("[LPU Vendoo] Combobox debug", debugSummary);
          return {
            status: "needs_review",
            reason: `active control opened but no options rendered (${optionDiscovery.scopeMode}; active: ${
              optionDiscovery.activeControlIdentified ? "yes" : "no"
            })`,
          };
        }
        continue;
      }

      const rawOptions = getUniqueComboboxOptionTexts(optionDiscovery.entries, 14);
      const normalizedEntries = optionDiscovery.entries.map((entry) => ({
        entry,
        values: getNormalizedOptionValuesFromEntry(entry),
      }));
      const normalizedOptions = getUniqueComboboxNormalizedValues(normalizedEntries, 18);
      const normalizedPayloadValue = normalizeOptionValue(target);
      const matches = normalizedEntries.filter((candidate) =>
        candidate.values.some((value) => normalizeOptionValue(value) === normalizedPayloadValue)
      );
      const debugSummary = buildComboboxDebugSummary({
        fieldLabel,
        payloadRaw,
        payloadCanonical,
        valueMode,
        optionDiscovery,
        rawOptions,
        normalizedOptions,
        target,
        normalizedPayloadValue,
        exactMatchFound: matches.length > 0,
      });
      console.debug("[LPU Vendoo] Combobox debug", debugSummary);

      if (!matches.length) {
        return {
          status: "needs_review",
          reason:
            `options rendered but no normalized match (${optionDiscovery.scopeMode}; active: ${
              optionDiscovery.activeControlIdentified ? "yes" : "no"
            }; mode: ${valueMode}; canonical: "${payloadCanonical}")`,
        };
      }

      if (matches.length > 1) {
        return {
          status: "needs_review",
          reason: "multiple normalized combobox options",
        };
      }

      clickElement(matches[0].entry.clickTarget);
      await wait(110);
      return { status: "filled" };
    }

    return {
      status: "needs_review",
      reason: "control opened but options could not be harvested",
    };
  }

  function getUniqueComboboxOptionTexts(entries, maxItems) {
    const values = [];
    const seen = new Set();
    for (const entry of entries) {
      const text = cleanCategoryStage(getOptionTextFromEntry(entry));
      const normalized = normalizeText(text);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(text);
      if (values.length >= maxItems) break;
    }
    return values;
  }

  function getUniqueComboboxNormalizedValues(normalizedEntries, maxItems) {
    const values = [];
    const seen = new Set();
    for (const entry of normalizedEntries) {
      for (const value of entry.values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
        if (values.length >= maxItems) return values;
      }
    }
    return values;
  }

  function buildComboboxDebugSummary(input) {
    const {
      fieldLabel,
      payloadRaw,
      payloadCanonical,
      valueMode,
      optionDiscovery,
      rawOptions,
      normalizedOptions,
      target,
      normalizedPayloadValue,
      exactMatchFound,
    } = input;

    return {
      fieldLabel,
      payloadRaw,
      payloadCanonical,
      valueMode,
      target,
      normalizedPayloadValue,
      activeControlIdentified: optionDiscovery.activeControlIdentified,
      activeControlSource: optionDiscovery.activeControlSource,
      harvestedFromFallback: optionDiscovery.harvestedFromFallback,
      optionScope: optionDiscovery.scopeMode,
      rawOptionTexts: rawOptions,
      normalizedOptionValues: normalizedOptions,
      exactMatchFound,
    };
  }

  function normalizeOptionValue(value) {
    const normalized = normalizeText(
      String(value ?? "")
        .replace(/[._-]/g, " ")
        .replace(/[()]/g, " ")
        .replace(/[\/\\]/g, " ")
        .replace(/['’]/g, "")
    );
    if (!normalized) return "";

    if (["yes", "y", "true", "1"].includes(normalized)) return "yes";
    if (["no", "n", "false", "0"].includes(normalized)) return "no";
    if (
      normalized === "not applicable" ||
      normalized === "notapplicable" ||
      normalized === "not available" ||
      normalized === "n a" ||
      normalized === "na" ||
      normalized === "n/a"
    ) {
      return "not applicable";
    }

    return normalized;
  }

  function stripMatcherAnnotations(value) {
    return String(value ?? "")
      .replace(/\(([^)]*(inference|confidence)[^)]*)\)/gi, " ")
      .replace(/\[([^]]*(inference|confidence)[^]]*)\]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getNormalizedOptionValuesFromEntry(entry) {
    const values = [];
    const seen = new Set();

    function add(raw) {
      const normalized = normalizeOptionValue(raw);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(normalized);
    }

    const primaryText = getOptionTextFromEntry(entry);
    add(primaryText);

    const candidates = getOptionTextCandidates(entry);
    for (const candidate of candidates) {
      add(candidate);
      const lines = String(candidate ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (const line of lines) {
        add(line);
      }
    }

    return values;
  }

  function buildNormalizedPayloadValues(value) {
    const raw = stripMatcherAnnotations(value);
    if (!raw) return { values: [], multiValue: false };

    const splitValues = raw
      .split(/[;,]/)
      .map((part) => normalizeOptionValue(part))
      .filter(Boolean);

    if (splitValues.length > 1) {
      return {
        values: Array.from(new Set(splitValues)),
        multiValue: true,
        canonicalValue: raw,
      };
    }

    const single = normalizeOptionValue(raw);
    return {
      values: single ? [single] : [],
      multiValue: false,
      canonicalValue: raw,
    };
  }

  function isLikelyMultiValueControl(control) {
    const metadata = normalizeText(
      [
        control.getAttribute("aria-multiselectable"),
        control.getAttribute("aria-label"),
        control.getAttribute("name"),
        control.className,
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (metadata.includes("true") && metadata.includes("multiselectable")) return true;
    if (metadata.includes("multi") || metadata.includes("tags")) return true;
    if (metadata.includes("checkbox")) return true;

    const multiChip = control.querySelector(
      ".react-select__multi-value, [class*='multi-value'], [class*='chip']"
    );
    return multiChip instanceof Element;
  }

  async function findPostCategorySizeField(sizeConfig) {
    const selectors = sizeConfig?.postCategorySpecificsContainerSelectors ?? [];
    let specificsFound = false;
    let sizeFieldFound = false;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const specificsContainer = findVisibleSpecificsContainer(selectors);
      if (specificsContainer) {
        specificsFound = true;

        const sizeFieldBlock = findSizeFieldBlock(specificsContainer, sizeConfig);
        if (sizeFieldBlock) {
          sizeFieldFound = true;
          const sizeControl = findSizeReactSelectControl(sizeFieldBlock, sizeConfig);
          const sizeHiddenInput = findSizeHiddenInput(sizeFieldBlock, sizeConfig);
          if (sizeControl) {
            return {
              specificsFound: true,
              sizeFieldFound: true,
              sizeFieldBlock,
              sizeControl,
              sizeHiddenInput,
            };
          }
        }

        const fallbackField = findElementBySelectorMap(sizeConfig, specificsContainer);
        if (fallbackField) {
          return {
            specificsFound: true,
            sizeFieldFound,
            sizeFieldBlock: sizeFieldBlock ?? null,
            sizeControl: fallbackField,
            sizeHiddenInput: null,
          };
        }
      }

      await wait(180);
    }

    return {
      specificsFound,
      sizeFieldFound,
      sizeFieldBlock: null,
      sizeControl: null,
      sizeHiddenInput: null,
    };
  }

  async function tryFillSizeReactSelect(input) {
    const { value, sizeAction, sizeDiscovery, sizeConfig } = input;
    const sizeControl = sizeDiscovery.sizeControl;
    const sizeHiddenInput = sizeDiscovery.sizeHiddenInput;
    const sizeFieldBlock = sizeDiscovery.sizeFieldBlock;
    const normalizedValue = normalizeText(value);
    const adapters = getAdapters();

    if (!normalizedValue) {
      return {
        status: "needs_review",
        reason: "payload missing",
        diagnostics: {
          rawValue: value,
          adaptedUsed: false,
          adaptedTarget: null,
          listboxFound: false,
          visibleOptionsSample: "none",
          exactMatchFound: false,
        },
      };
    }

    openCustomSelectControl(sizeControl);
    await wait(160);

    const listboxInfo = findSizeListbox(sizeControl, sizeFieldBlock, sizeConfig);
    if (!listboxInfo.element) {
      return {
        status: "needs_review",
        reason: "size listbox not found",
        diagnostics: {
          rawValue: value,
          adaptedUsed: false,
          adaptedTarget: null,
          listboxFound: false,
          visibleOptionsSample: "none",
          exactMatchFound: false,
        },
      };
    }

    const options = findVisibleSizeOptions(listboxInfo.element, sizeConfig);
    let matchingOptions = options.filter((option) => normalizeText(option.label) === normalizedValue);
    let adaptedTarget = null;
    let adaptedUsed = false;

    if (!matchingOptions.length) {
      const adapted = adapters.adaptValueForAction
        ? adapters.adaptValueForAction(sizeAction, value)
        : { adaptedValue: null, wasAdapted: false };
      adaptedTarget = adapted.adaptedValue;
      adaptedUsed = adapted.wasAdapted;
      if (adaptedTarget) {
        const normalizedAdaptedTarget = normalizeText(adaptedTarget);
        matchingOptions = options.filter(
          (option) => normalizeText(option.label) === normalizedAdaptedTarget
        );
      }
    }

    if (matchingOptions.length !== 1) {
      return {
        status: "needs_review",
        reason: matchingOptions.length > 1 ? "multiple exact size matches" : "no exact size match",
        diagnostics: {
          rawValue: value,
          adaptedUsed,
          adaptedTarget,
          listboxFound: true,
          visibleOptionsSample: buildSizeOptionsSample(options, 6),
          exactMatchFound: matchingOptions.length > 0,
        },
      };
    }

    clickElement(matchingOptions[0].clickTarget);
    await wait(140);

    const confirmedValue = readSizeSelectionValue(sizeControl, sizeHiddenInput);
    const normalizedTargetValue = normalizeText(
      matchingOptions[0]?.label || adaptedTarget || value
    );
    const isConfirmed = normalizeText(confirmedValue) === normalizedTargetValue;
    if (!isConfirmed) {
      return {
        status: "needs_review",
        reason: "size selection not confirmed",
        diagnostics: {
          rawValue: value,
          adaptedUsed,
          adaptedTarget,
          listboxFound: true,
          visibleOptionsSample: buildSizeOptionsSample(options, 6),
          exactMatchFound: true,
        },
      };
    }

    return {
      status: "filled",
      diagnostics: {
        rawValue: value,
        adaptedUsed,
        adaptedTarget,
        listboxFound: true,
        visibleOptionsSample: buildSizeOptionsSample(options, 6),
        exactMatchFound: true,
      },
    };
  }

  function findVisibleSpecificsContainer(selectors) {
    const selectorsToUse = selectors.length
      ? selectors
      : [
          '[data-testid*="specific"]',
          '[data-testid*="item-specific"]',
          '[aria-label*="specific"]',
          'section[class*="specific"]',
          'div[class*="specific"]',
        ];

    const candidates = [];
    const seen = new Set();
    for (const selector of selectorsToUse) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        if (!isVisible(element)) continue;
        if (seen.has(element)) continue;
        seen.add(element);
        candidates.push(element);
      }
    }

    for (const candidate of candidates) {
      const text = normalizeText(candidate.innerText || candidate.textContent || "");
      if (text.includes("size")) {
        return candidate;
      }
    }

    return candidates[0] ?? null;
  }

  function findSizeFieldBlock(specificsContainer, sizeConfig) {
    const hiddenInput = findSizeHiddenInput(specificsContainer, sizeConfig);
    if (hiddenInput) {
      const hiddenBlock = hiddenInput.closest("div, section, fieldset");
      if (hiddenBlock instanceof Element) return hiddenBlock;
    }

    const labels = Array.from(specificsContainer.querySelectorAll("label"));
    const sizeLabel = labels.find((label) => {
      const text = normalizeText(label.innerText || label.textContent || "");
      return text === "size" || (text.startsWith("size ") && !text.includes("type"));
    });

    if (sizeLabel) {
      const labelBlock = sizeLabel.closest("div, section, fieldset");
      if (labelBlock instanceof Element) return labelBlock;
    }

    const blocks = Array.from(specificsContainer.querySelectorAll("div, section, fieldset"));
    return (
      blocks.find((block) => {
        if (!(block instanceof Element)) return false;
        const text = normalizeText(block.innerText || block.textContent || "");
        if (!text.includes("size") || text.includes("size type")) return false;
        return !!block.querySelector(".react-select__control");
      }) ?? null
    );
  }

  function findSizeHiddenInput(root, sizeConfig) {
    if (!(root instanceof Element)) return null;
    const includes = (sizeConfig?.sizeHiddenInputNameIncludes ?? ["_size"]).map((term) =>
      normalizeText(term)
    );
    const inputs = Array.from(root.querySelectorAll("input[name]"));
    return (
      inputs.find((input) => {
        if (!(input instanceof HTMLInputElement)) return false;
        const name = normalizeText(input.name || "");
        if (!name) return false;
        if (name.includes("size type") || name.includes("_size_type")) return false;
        return includes.some((term) => name.includes(term));
      }) ?? null
    );
  }

  function findSizeReactSelectControl(sizeFieldBlock, sizeConfig) {
    if (!(sizeFieldBlock instanceof Element)) return null;
    const selectors = sizeConfig?.reactSelectControlSelectors ?? [".react-select__control"];
    for (const selector of selectors) {
      const control = sizeFieldBlock.querySelector(selector);
      if (control instanceof Element && isVisible(control)) {
        return control;
      }
    }
    return null;
  }

  function findSizeListbox(sizeControl, sizeFieldBlock, sizeConfig) {
    const textInput = sizeControl.querySelector("input[aria-controls], input[aria-owns]");
    const controlledId =
      textInput?.getAttribute("aria-controls") || textInput?.getAttribute("aria-owns") || "";
    if (controlledId) {
      const controlledElement = document.getElementById(controlledId);
      if (controlledElement instanceof Element && isVisible(controlledElement)) {
        return { element: controlledElement, source: "aria-controls" };
      }
    }

    const selectors = sizeConfig?.reactSelectMenuSelectors ?? [
      ".react-select__menu [role='listbox']",
      ".react-select__menu",
      "[id$='-listbox']",
    ];

    const inField = findFirstVisibleBySelectors(sizeFieldBlock, selectors);
    if (inField) return { element: inField, source: "field-scope" };

    const inDocument = findAllVisibleBySelectors(document, selectors);
    if (inDocument.length === 1) {
      return { element: inDocument[0], source: "document-single" };
    }

    return { element: null, source: "none" };
  }

  function findVisibleSizeOptions(listbox, sizeConfig) {
    if (!(listbox instanceof Element)) return [];
    const selectors = sizeConfig?.reactSelectOptionSelectors ?? ["[role='option']", ".react-select__option"];
    const candidates = [];
    const seen = new Set();
    for (const selector of selectors) {
      const elements = Array.from(listbox.querySelectorAll(selector));
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        if (!isVisible(element)) continue;
        const clickTarget = element.closest("[role='option'], .react-select__option") ?? element;
        if (seen.has(clickTarget)) continue;
        seen.add(clickTarget);
        const label = cleanCategoryStage(
          (clickTarget.innerText || clickTarget.textContent || "").trim()
        );
        if (!label) continue;
        candidates.push({ clickTarget, label });
      }
    }
    return candidates;
  }

  function readSizeSelectionValue(sizeControl, sizeHiddenInput) {
    if (sizeHiddenInput instanceof HTMLInputElement && sizeHiddenInput.value) {
      return sizeHiddenInput.value;
    }

    const singleValue = sizeControl.querySelector(".react-select__single-value");
    if (singleValue instanceof Element) {
      const text = cleanCategoryStage(singleValue.innerText || singleValue.textContent || "");
      if (text) return text;
    }

    return cleanCategoryStage(sizeControl.innerText || sizeControl.textContent || "");
  }

  function buildSizeOptionsSample(options, maxItems) {
    if (!options.length) return "none";
    const values = [];
    for (let index = 0; index < options.length && values.length < maxItems; index += 1) {
      values.push(`"${options[index].label}"`);
    }
    return values.join(", ");
  }

  function findFirstVisibleBySelectors(root, selectors) {
    if (!(root instanceof Element) && root !== document) return null;
    const visible = findAllVisibleBySelectors(root, selectors);
    return visible[0] ?? null;
  }

  function findAllVisibleBySelectors(root, selectors) {
    const visible = [];
    const seen = new Set();
    for (const selector of selectors) {
      const elements = Array.from(root.querySelectorAll(selector));
      for (const element of elements) {
        if (!(element instanceof Element)) continue;
        if (!isVisible(element)) continue;
        if (seen.has(element)) continue;
        seen.add(element);
        visible.push(element);
      }
    }
    return visible;
  }

  function clearStepResultsFromLists(stepLabel, lists) {
    for (const list of lists) {
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const entry = String(list[index] ?? "");
        if (entry === stepLabel || entry.startsWith(`${stepLabel} (`)) {
          list.splice(index, 1);
        }
      }
    }
  }

  function renderLastRunResults(input) {
    const { filled, needsReview, skippedForSafety } = input;
    const lastRunEl = document.getElementById("lpu-vendoo-last-run");
    if (!lastRunEl) return;

    const lines = [];
    lines.push(`Last run: ${new Date().toLocaleString()}`);
    lines.push(filled.length ? `Filled: ${filled.join(", ")}` : "Filled: none");
    lines.push(
      needsReview.length
        ? `Needs review: ${needsReview.join(", ")}`
        : "Needs review: none"
    );
    lines.push(
      skippedForSafety.length
        ? `Skipped for safety: ${skippedForSafety.join(", ")}`
        : "Skipped for safety: none"
    );

    lastRunEl.textContent = lines.join("\n");
  }

  function extractSafeBaseColor(value) {
    const normalized = normalizeText(value);
    if (!normalized) return null;

    if (normalized.includes("multicolor") || normalized.includes("multi color")) {
      return null;
    }

    if (normalized.includes("navy")) {
      return null;
    }

    const allowedBaseColors = [
      "black",
      "blue",
      "brown",
      "gray",
      "green",
      "orange",
      "pink",
      "purple",
      "red",
      "white",
      "yellow",
      "beige",
      "tan",
      "ivory",
      "cream",
      "gold",
      "silver",
    ];

    const matchedColors = allowedBaseColors.filter((color) =>
      normalized.split(" ").includes(color)
    );

    if (matchedColors.length !== 1) {
      return null;
    }

    return matchedColors[0];
  }

  function tryTypedEntry(control, value) {
    if (!control.matches('input[type="text"], input:not([type])')) {
      return false;
    }

    const metadata = normalizeText(
      [
        control.getAttribute("placeholder"),
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        control.getAttribute("data-testid"),
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (!metadata.includes("write your own") && !metadata.includes("select or write your own")) {
      return false;
    }

    setElementValue(control, value);
    control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    control.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    return true;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clickElement(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;

    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }

    return el.getClientRects().length > 0;
  }

  function getActionModel() {
    return window.LPU_VENDOO_ACTION_MODEL ?? {
      createFieldAction(input) {
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
      },
      createRunState() {
        return {
          filled: [],
          needsReview: [],
          skippedForSafety: [],
          stepOutcomes: {},
          diagnosticsByField: {},
        };
      },
      applyActionResult(runState, action, result) {
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
      },
    };
  }

  function getFieldDefinitions() {
    return window.LPU_VENDOO_FIELD_DEFINITIONS ?? {
      normalizeCategoryPath(value) {
        return String(value ?? "").trim().toLowerCase();
      },
      isJewelryProofSlice(input) {
        const categoryPath = this.normalizeCategoryPath(input.categoryPath);
        if (categoryPath.includes("jewelry")) return true;

        return [input.material, input.styleType, input.signedMaker].some((value) =>
          String(value ?? "").trim().length > 0
        );
      },
      addFieldIfPresent(fields, input) {
        const value = String(input.payloadValue ?? "").trim();
        if (!value) return;
        fields.push({ ...input, payloadValue: value });
      },
      buildEbayApparelFieldDefinitions(payload, selectors, valuePickers) {
        return [
          {
            marketplace: "ebay",
            key: "title",
            label: "eBay title",
            payloadValue: valuePickers.pickEbayTitle(payload),
            selectorConfig: selectors.title,
          },
          {
            marketplace: "ebay",
            key: "description",
            label: "eBay description",
            payloadValue: payload?.marketplaces?.ebay?.description ?? "",
            selectorConfig: selectors.description,
          },
          {
            marketplace: "ebay",
            key: "category",
            label: "eBay category",
            payloadValue: valuePickers.pickEbayCategoryPath(payload),
            selectorConfig: selectors.category,
          },
          {
            marketplace: "ebay",
            key: "brand",
            label: "eBay brand",
            payloadValue: valuePickers.pickEbayBrand(payload),
            selectorConfig: selectors.brand,
          },
          {
            marketplace: "ebay",
            key: "size",
            label: "eBay size",
            payloadValue: valuePickers.pickEbaySize(payload),
            selectorConfig: selectors.size,
            valuePolicy: {
              allowValueAdaptation: true,
              valueAdaptationType: "alpha_apparel_size",
            },
          },
          {
            marketplace: "ebay",
            key: "color",
            label: "eBay color",
            payloadValue: valuePickers.pickEbayColor(payload),
            selectorConfig: selectors.color,
          },
        ];
      },
      buildEbayJewelryFieldDefinitions(payload, selectors, valuePickers) {
        const fields = [
          {
            marketplace: "ebay",
            key: "title",
            label: "eBay title",
            payloadValue: valuePickers.pickEbayTitle(payload),
            selectorConfig: selectors.title,
          },
          {
            marketplace: "ebay",
            key: "description",
            label: "eBay description",
            payloadValue: payload?.marketplaces?.ebay?.description ?? "",
            selectorConfig: selectors.description,
          },
          {
            marketplace: "ebay",
            key: "category",
            label: "eBay category",
            payloadValue: valuePickers.pickEbayCategoryPath(payload),
            selectorConfig: selectors.category,
          },
        ];

        this.addFieldIfPresent(fields, {
          marketplace: "ebay",
          key: "signedMaker",
          label: "eBay signed/maker",
          payloadValue: valuePickers.pickEbaySignedMaker(payload),
          selectorConfig: selectors.signedMaker ?? selectors.brand,
        });

        this.addFieldIfPresent(fields, {
          marketplace: "ebay",
          key: "color",
          label: "eBay color",
          payloadValue: valuePickers.pickEbayColor(payload),
          selectorConfig: selectors.color,
        });

        this.addFieldIfPresent(fields, {
          marketplace: "ebay",
          key: "material",
          label: "eBay material",
          payloadValue: valuePickers.pickEbayMaterial(payload),
          selectorConfig: selectors.material ?? selectors.color,
        });

        this.addFieldIfPresent(fields, {
          marketplace: "ebay",
          key: "styleType",
          label: "eBay style/type",
          payloadValue: valuePickers.pickEbayStyleType(payload),
          selectorConfig: selectors.styleType ?? selectors.color,
        });

        return fields;
      },
      buildEbayFieldDefinitions(payload, selectors, valuePickers) {
        const categoryPath = valuePickers.pickEbayCategoryPath(payload);
        const signedMaker = valuePickers.pickEbaySignedMaker(payload);
        const material = valuePickers.pickEbayMaterial(payload);
        const styleType = valuePickers.pickEbayStyleType(payload);

        if (
          this.isJewelryProofSlice({
            categoryPath,
            signedMaker,
            material,
            styleType,
          })
        ) {
          return this.buildEbayJewelryFieldDefinitions(payload, selectors, valuePickers);
        }

        return this.buildEbayApparelFieldDefinitions(payload, selectors, valuePickers);
      },
    };
  }

  function getAdapters() {
    return window.LPU_VENDOO_ADAPTERS ?? {
      async runVendooFieldAction(action, context) {
        const rawValue = typeof action.payloadValue === "string" ? action.payloadValue.trim() : "";
        if (!rawValue) {
          return { status: "needs_review", reason: "payload missing" };
        }

        const adapterType =
          action.adapterType ?? action.selectorConfig?.adapterType ?? action.controlType;

        if (adapterType === "textarea") {
          const field = context.resolveField(action);
          if (!field) return { status: "needs_review", reason: "field not found" };
          if (context.isUsed(field)) {
            return { status: "skipped_for_safety", reason: "collision prevention" };
          }
          if (!field.matches('textarea, [contenteditable="true"]')) {
            return { status: "skipped_for_safety", reason: "unexpected control type" };
          }
          context.setValue(field, rawValue);
          context.markUsed(field);
          return { status: "filled" };
        }

        if (adapterType === "text" || adapterType === "text_input") {
          const field = context.resolveField(action);
          if (!field) return { status: "needs_review", reason: "field not found" };
          if (context.isUsed(field)) {
            return { status: "skipped_for_safety", reason: "collision prevention" };
          }
          if (!field.matches("input")) {
            return { status: "skipped_for_safety", reason: "unexpected control type" };
          }
          context.setValue(field, rawValue);
          context.markUsed(field);
          return { status: "filled" };
        }

        if (adapterType === "modal_picker") {
          const field = context.resolveField(action);
          if (!field) return { status: "needs_review", reason: "field not found" };
          if (context.isUsed(field)) {
            return { status: "skipped_for_safety", reason: "collision prevention" };
          }
          return context.fillModalPicker(action, field, rawValue);
        }

        const field = context.resolveField(action);
        if (!field) return { status: "needs_review", reason: "field not found" };
        if (context.isUsed(field)) {
          return { status: "skipped_for_safety", reason: "collision prevention" };
        }

        const valueResult = context.normalizeCustomSelectValue(action, rawValue);
        if (!valueResult.value) {
          return { status: "needs_review", reason: valueResult.reason || "invalid value" };
        }

        return context.fillReactSelect(action, field, valueResult.value);
      },
      adaptValueForAction(action, rawValue) {
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
            wasAdapted:
              !!adapted &&
              normalizeText(adapted) !== normalizeText(typeof rawValue === "string" ? rawValue : ""),
          };
        }

        return { adaptedValue: null, wasAdapted: false };
      },
    };
  }

  function adaptAlphaApparelSize(rawValue) {
    const normalizedRaw = typeof rawValue === "string" ? rawValue.trim() : "";
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

  function getSelectorMap() {
    return window.LPU_VENDOO_SELECTORS ?? {
      ebay: {
        title: {
          controlType: "text",
          adapterType: "text_input",
          labelStrategies: [
            {
              labelTerms: ["ebay title", "title"],
              elementSelector: 'input[type="text"], input:not([type])',
              metadataIncludes: ["title"],
              metadataExcludes: ["category", "brand", "size", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'input[type="text"], input:not([type])',
              metadataIncludes: ["title"],
              metadataExcludes: ["category", "brand", "size", "color", "colour"],
            },
          ],
        },
        description: {
          controlType: "textarea",
          adapterType: "textarea",
          labelStrategies: [
            {
              labelTerms: ["ebay description", "description"],
              elementSelector: "textarea",
              metadataIncludes: ["description"],
              metadataExcludes: ["title", "category"],
            },
            {
              labelTerms: ["ebay description", "description", "details"],
              elementSelector: '[contenteditable="true"]',
              metadataIncludes: ["description", "details"],
              metadataExcludes: ["title", "category"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: "textarea",
              metadataIncludes: ["description", "details"],
              metadataExcludes: ["title", "category"],
            },
            {
              elementSelector: '[contenteditable="true"]',
              metadataIncludes: ["description", "details"],
              metadataExcludes: ["title", "category"],
            },
          ],
        },
        category: {
          controlType: "custom_select",
          adapterType: "modal_picker",
          allowTypedEntry: false,
          stageOneAliases: {
            "Clothing, Shoes & Accessories": [
              "Clothing, Shoes and Accessories",
              "Clothing Shoes & Accessories",
              "Clothing Shoes and Accessories",
            ],
          },
          pickerContainerSelectors: [
            '[aria-label*="Category Selector"]',
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[data-radix-dialog-content]',
            ".modal",
          ],
          searchInputSelectors: [
            'input[type="search"]',
            'input[aria-label*="search"]',
            'input[placeholder*="search"]',
            'input[placeholder*="Search"]',
          ],
          selectedStateSelectors: [
            '[aria-selected="true"]',
            '[data-state="checked"]',
            '[data-selected="true"]',
          ],
          optionSelectors: [
            'div[data-testid="category-option-dropdown"][role="option"]',
            'div[data-testid="category-option-dropdown"]',
            '[role="listbox"] [role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["ebay category", "category"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["category"],
              metadataExcludes: ["title", "brand", "size", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["category"],
              metadataExcludes: ["title", "brand", "size", "color", "colour"],
            },
          ],
        },
        brand: {
          controlType: "custom_select",
          adapterType: "react_select",
          allowTypedEntry: true,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["brand"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["brand"],
              metadataExcludes: ["title", "category", "size", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["brand"],
              metadataExcludes: ["title", "category", "size", "color", "colour"],
            },
          ],
        },
        signedMaker: {
          controlType: "custom_select",
          adapterType: "react_select",
          allowTypedEntry: true,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["signed", "maker", "designer", "brand"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["signed", "maker", "designer", "brand"],
              metadataExcludes: ["title", "category", "size", "color", "colour", "material", "style", "type"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["signed", "maker", "designer", "brand"],
              metadataExcludes: ["title", "category", "size", "color", "colour", "material", "style", "type"],
            },
          ],
        },
        size: {
          controlType: "custom_select",
          adapterType: "react_select",
          allowTypedEntry: false,
          allowValueAdaptation: true,
          valueAdaptationType: "alpha_apparel_size",
          postCategorySpecificsContainerSelectors: [
            '[data-testid*="specific"]',
            '[data-testid*="item-specific"]',
            '[aria-label*="specific"]',
            'section[class*="specific"]',
            'div[class*="specific"]',
          ],
          reactSelectControlSelectors: [".react-select__control"],
          reactSelectMenuSelectors: [
            ".react-select__menu [role='listbox']",
            ".react-select__menu",
            "[id$='-listbox']",
          ],
          reactSelectOptionSelectors: ["[role='option']", ".react-select__option"],
          sizeHiddenInputNameIncludes: ["_size"],
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["size"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["size"],
              metadataExcludes: ["title", "category", "brand", "color", "colour"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["size"],
              metadataExcludes: ["title", "category", "brand", "color", "colour"],
            },
          ],
        },
        color: {
          controlType: "custom_select",
          adapterType: "react_select",
          allowTypedEntry: false,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["color", "colour"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["color", "colour"],
              metadataExcludes: ["title", "category", "brand", "size"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["color", "colour"],
              metadataExcludes: ["title", "category", "brand", "size"],
            },
          ],
        },
        material: {
          controlType: "custom_select",
          adapterType: "react_select",
          allowTypedEntry: false,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["material"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["material"],
              metadataExcludes: ["title", "category", "size", "brand", "color", "colour", "style", "type"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["material"],
              metadataExcludes: ["title", "category", "size", "brand", "color", "colour", "style", "type"],
            },
          ],
        },
        styleType: {
          controlType: "custom_select",
          adapterType: "react_select",
          allowTypedEntry: false,
          optionSelectors: [
            '[role="option"]',
            '[role="listbox"] [role="button"]',
            '[role="listbox"] button',
            '[data-radix-select-content] [data-radix-collection-item]',
            '[data-radix-popper-content-wrapper] [data-radix-collection-item]',
            '.select__option',
            '.option',
            'li[role="option"]',
          ],
          labelStrategies: [
            {
              labelTerms: ["style", "type"],
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["style", "type"],
              metadataExcludes: ["title", "category", "size", "brand", "color", "colour", "material"],
            },
          ],
          fallbackStrategies: [
            {
              elementSelector: 'button, [role="combobox"], input[type="text"], input:not([type])',
              metadataIncludes: ["style", "type"],
              metadataExcludes: ["title", "category", "size", "brand", "color", "colour", "material"],
            },
          ],
        },
      },
    };
  }

  function pickEbayTitle(payload) {
    const title = payload?.marketplaces?.ebay?.title ?? "";
    if (typeof title === "string" && title.trim()) {
      return title.trim();
    }

    const titleA = payload?.marketplaces?.ebay?.titleA ?? "";
    if (typeof titleA === "string" && titleA.trim()) {
      return titleA.trim();
    }

    return "";
  }

  function pickEbayCategory(payload) {
    const category = payload?.marketplaces?.ebay?.category ?? "";
    return typeof category === "string" ? category.trim() : "";
  }

  function pickEbayCanonicalCategoryPath(payload) {
    const canonicalPath = payload?.marketplaces?.ebay?.canonicalVendooCategoryPath ?? "";
    return typeof canonicalPath === "string" ? canonicalPath.trim() : "";
  }

  function pickEbayCategoryPath(payload) {
    return pickEbayCanonicalCategoryPath(payload) || pickEbayCategory(payload);
  }

  function pickEbayBrand(payload) {
    const brand =
      payload?.marketplaces?.ebay?.itemSpecifics?.brand ??
      payload?.marketplaces?.ebay?.brand ??
      "";
    return typeof brand === "string" ? brand.trim() : "";
  }

  function pickEbaySignedMaker(payload) {
    const signedMaker =
      payload?.marketplaces?.ebay?.itemSpecifics?.signedMaker ??
      payload?.marketplaces?.ebay?.itemSpecifics?.maker ??
      payload?.marketplaces?.ebay?.itemSpecifics?.designer ??
      payload?.marketplaces?.ebay?.itemSpecifics?.brand ??
      payload?.marketplaces?.ebay?.signedMaker ??
      payload?.marketplaces?.ebay?.maker ??
      "";
    return typeof signedMaker === "string" ? signedMaker.trim() : "";
  }

  function pickEbaySize(payload) {
    const size =
      payload?.marketplaces?.ebay?.itemSpecifics?.size ??
      payload?.marketplaces?.ebay?.size ??
      "";
    return typeof size === "string" ? size.trim() : "";
  }

  function pickEbayColor(payload) {
    const color =
      payload?.marketplaces?.ebay?.itemSpecifics?.color ??
      payload?.marketplaces?.ebay?.itemSpecifics?.colour ??
      payload?.marketplaces?.ebay?.color ??
      "";

    return typeof color === "string" ? color.trim() : "";
  }

  function pickEbayMaterial(payload) {
    const material =
      payload?.marketplaces?.ebay?.itemSpecifics?.material ??
      payload?.marketplaces?.ebay?.material ??
      "";
    return typeof material === "string" ? material.trim() : "";
  }

  function pickEbayStyleType(payload) {
    const styleType =
      payload?.marketplaces?.ebay?.itemSpecifics?.styleType ??
      payload?.marketplaces?.ebay?.itemSpecifics?.style ??
      payload?.marketplaces?.ebay?.itemSpecifics?.type ??
      payload?.marketplaces?.ebay?.styleType ??
      "";
    return typeof styleType === "string" ? styleType.trim() : "";
  }

  function findElementBySelectorMap(fieldConfig, root) {
    const labelStrategies = fieldConfig?.labelStrategies ?? [];
    for (const strategy of labelStrategies) {
      const found = findByLabelStrategy(strategy, root);
      if (found) return found;
    }

    const fallbackStrategies = fieldConfig?.fallbackStrategies ?? [];
    for (const strategy of fallbackStrategies) {
      const found = findByFallbackStrategy(strategy, root);
      if (found) return found;
    }

    return null;
  }

  function getStoredPayload() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_PAYLOAD" }, (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError || !response?.ok) {
          resolve(null);
          return;
        }

        resolve(response.record ?? null);
      });
    });
  }

  function findByLabelStrategy(strategy, root) {
    const terms = (strategy?.labelTerms ?? []).map(normalizeText);
    if (!terms.length) return null;

    const searchRoot = root instanceof Element ? root : document;
    const labels = Array.from(searchRoot.querySelectorAll("label"));
    for (const label of labels) {
      const labelText = normalizeText(label.textContent);
      if (!terms.some((term) => labelText.includes(term))) continue;

      const candidates = collectLabelCandidates(label, strategy.elementSelector, searchRoot);
      const matched = candidates.find((el) => matchesStrategy(el, strategy));
      if (matched) return matched;
    }

    return null;
  }

  function collectLabelCandidates(label, elementSelector, root) {
    const selector = elementSelector || "input, textarea, [contenteditable='true'], button";
    const seen = new Set();
    const candidates = [];

    function addCandidate(el) {
      if (!el || !(el instanceof Element) || seen.has(el)) return;
      seen.add(el);
      candidates.push(el);
    }

    const forId = label.getAttribute("for");
    if (forId) {
      const linked = document.getElementById(forId);
      if (linked?.matches(selector) && (!root || root.contains(linked))) {
        addCandidate(linked);
      }
    }

    label.querySelectorAll(selector).forEach(addCandidate);

    const parent = label.parentElement;
    if (parent) {
      parent.querySelectorAll(selector).forEach(addCandidate);
    }

    const container = label.closest("div, section, form");
    if (container) {
      container.querySelectorAll(selector).forEach(addCandidate);
    }

    return candidates;
  }

  function findByFallbackStrategy(strategy, root) {
    const selector = strategy?.elementSelector;
    if (!selector) return null;

    const searchRoot = root instanceof Element ? root : document;
    const elements = Array.from(searchRoot.querySelectorAll(selector));
    return elements.find((el) => matchesStrategy(el, strategy)) || null;
  }

  function matchesStrategy(el, strategy) {
    const includes = strategy?.metadataIncludes ?? [];
    const excludes = strategy?.metadataExcludes ?? [];

    const metadata = normalizeText(
      [
        el.getAttribute("name"),
        el.getAttribute("id"),
        el.getAttribute("placeholder"),
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.getAttribute("title"),
        el.getAttribute("role"),
        el.className,
      ]
        .filter(Boolean)
        .join(" ")
    );

    if (includes.length && !includes.some((term) => metadata.includes(normalizeText(term)))) {
      return false;
    }

    if (excludes.some((term) => metadata.includes(normalizeText(term)))) {
      return false;
    }

    return true;
  }

  function setElementValue(el, value) {
    el.focus();

    if (el.matches('[contenteditable="true"]')) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }

    const prototype =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(el, value);

    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function normalizeText(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }
})();
