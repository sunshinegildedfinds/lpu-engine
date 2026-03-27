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
      });
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
          });
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

        const detail =
          `stopped at stage ${index + 1}: wanted "${wanted}"; ` +
          `prefix "${confirmedPrefix}"; breadcrumb mode: ${breadcrumbMode}; ` +
          `picker: ${pickerStatus} (${pickerSelector}); ` +
          `raw candidates: ${optionDiscovery.rawCount}; visible candidates: ${optionDiscovery.visibleCount}; ` +
          `raw sample: ${optionDiscovery.rawSample || "none"}; visible sample: ${optionDiscovery.visibleSample || "none"}; ` +
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

    return null;
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

    return null;
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

    const scope = root ?? document;
    const scopeMode = scopeModeOverride ?? (root ? "picker_scope" : "document_scope");
    for (const selector of selectors) {
      const candidates = Array.from(scope.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        const clickTarget = resolveOptionClickTarget(candidate);
        rawEntries.push({
          element: candidate,
          selector,
          clickTarget,
        });
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
    const { optionEntries, stageLabelsToTry, stageIndex, confirmedStages } = input;
    const confirmedPrefix = confirmedStages.join(" > ");

    if (stageIndex === 0) {
      return {
        matches: findMatchingOptionsForStage(optionEntries, stageLabelsToTry),
        breadcrumbMode: false,
        confirmedPrefix,
      };
    }

    const breadcrumbMode = isBreadcrumbResultMode(optionEntries, confirmedStages);
    if (!breadcrumbMode) {
      return {
        matches: findMatchingOptionsForStage(optionEntries, stageLabelsToTry),
        breadcrumbMode: false,
        confirmedPrefix,
      };
    }

    return {
      matches: findBreadcrumbStageMatches({
        optionEntries,
        stageLabelsToTry,
        confirmedStages,
      }),
      breadcrumbMode: true,
      confirmedPrefix,
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
    return [
      option.innerText,
      option.textContent,
      option.getAttribute("aria-label"),
      option.getAttribute("title"),
      option.getAttribute("data-value"),
      option.getAttribute("value"),
    ]
      .filter(Boolean)
      .join(" ");
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

    const firstChild = row.firstElementChild;
    if (firstChild instanceof Element) {
      const childText = cleanCategoryStage(firstChild.innerText || firstChild.textContent || "");
      if (childText) return childText;
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
      buildEbayFieldDefinitions(payload, selectors, valuePickers) {
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
