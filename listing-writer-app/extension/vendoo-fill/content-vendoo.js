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
    const fillSteps = [
      { key: "title", label: "eBay title", value: pickEbayTitle(payload), selectorConfig: selectors.title },
      {
        key: "description",
        label: "eBay description",
        value: payload?.marketplaces?.ebay?.description ?? "",
        selectorConfig: selectors.description,
      },
      {
        key: "category",
        label: "eBay category",
        value: pickEbayCategoryPath(payload),
        selectorConfig: selectors.category,
      },
      { key: "brand", label: "eBay brand", value: pickEbayBrand(payload), selectorConfig: selectors.brand },
      { key: "size", label: "eBay size", value: pickEbaySize(payload), selectorConfig: selectors.size },
      { key: "color", label: "eBay color", value: pickEbayColor(payload), selectorConfig: selectors.color },
    ];

    const filled = [];
    const needsReview = [];
    const skippedForSafety = [];
    const usedElements = new Set();
    const stepOutcomes = {};

    for (const step of fillSteps) {
      const rawValue = typeof step.value === "string" ? step.value.trim() : "";
      if (!rawValue) {
        needsReview.push(`${step.label} (payload missing)`);
        stepOutcomes[step.key] = "needs_review";
        continue;
      }

      const field = findElementBySelectorMap(step.selectorConfig);
      if (!field) {
        needsReview.push(step.label);
        stepOutcomes[step.key] = "needs_review";
        continue;
      }

      if (usedElements.has(field)) {
        skippedForSafety.push(`${step.label} (collision prevention)`);
        stepOutcomes[step.key] = "skipped_for_safety";
        continue;
      }

      if (step.selectorConfig?.controlType === "custom_select") {
        const valueResult = getCustomSelectAttemptValue(step.key, rawValue);
        if (!valueResult.value) {
          needsReview.push(`${step.label} (${valueResult.reason})`);
          stepOutcomes[step.key] = "needs_review";
          continue;
        }

        const customSelectResult = await tryFillCustomSelect({
          step,
          value: valueResult.value,
          control: field,
          usedElements,
        });

        if (customSelectResult.status === "filled") {
          filled.push(step.label);
          stepOutcomes[step.key] = "filled";
          continue;
        }

        if (customSelectResult.status === "needs_review") {
          needsReview.push(`${step.label} (${customSelectResult.reason})`);
          stepOutcomes[step.key] = "needs_review";
          continue;
        }

        skippedForSafety.push(`${step.label} (${customSelectResult.reason})`);
        stepOutcomes[step.key] = "skipped_for_safety";
        continue;
      }

      if (step.selectorConfig?.controlType === "text" && !field.matches("input")) {
        skippedForSafety.push(`${step.label} (unexpected control type)`);
        stepOutcomes[step.key] = "skipped_for_safety";
        continue;
      }

      if (
        step.selectorConfig?.controlType === "textarea" &&
        !field.matches('textarea, [contenteditable="true"]')
      ) {
        skippedForSafety.push(`${step.label} (unexpected control type)`);
        stepOutcomes[step.key] = "skipped_for_safety";
        continue;
      }

      setElementValue(field, rawValue);
      usedElements.add(field);
      filled.push(step.label);
      stepOutcomes[step.key] = "filled";
    }

    await retrySizeAfterCategorySuccess({
      fillSteps,
      stepOutcomes,
      usedElements,
      filled,
      needsReview,
      skippedForSafety,
    });

    const parts = [];
    if (filled.length) parts.push(`Filled: ${filled.join(", ")}`);
    if (needsReview.length) parts.push(`Needs review: ${needsReview.join(", ")}`);
    if (skippedForSafety.length) {
      parts.push(`Skipped for safety: ${skippedForSafety.join(", ")}`);
    }

    reportEl.textContent = "Fill run completed.";
    renderLastRunResults({
      filled,
      needsReview,
      skippedForSafety,
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
      return { status: "filled" };
    }

    if (matchingOptions.length > 1) {
      return { status: "needs_review", reason: "multiple matching options" };
    }

    if (fieldConfig.allowTypedEntry) {
      const typedEntry = tryTypedEntry(control, value);
      if (typedEntry) {
        usedElements.add(control);
        return { status: "filled" };
      }
    }

    return { status: "needs_review", reason: "no safe visible option match" };
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

    const breadcrumbMode = isBreadcrumbResultMode(optionEntries);
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

  function isBreadcrumbResultMode(optionEntries) {
    let breadcrumbLikeCount = 0;
    for (const entry of optionEntries) {
      const label = getOptionTextFromEntry(entry);
      if (cleanCategoryStage(label).includes(">")) {
        breadcrumbLikeCount += 1;
      }
      if (breadcrumbLikeCount >= 1) {
        return true;
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
        const breadcrumbStages = splitCategoryStages(candidate)
          .map((stage) => normalizeText(stage))
          .filter(Boolean);

        if (breadcrumbStages.length <= normalizedPrefix.length) return false;

        const prefixStart = findStageSequenceStart(breadcrumbStages, normalizedPrefix);
        if (prefixStart < 0) return false;

        const nextIndex = prefixStart + normalizedPrefix.length;
        if (nextIndex >= breadcrumbStages.length) return false;

        return normalizedWanted.includes(breadcrumbStages[nextIndex]);
      });
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

    const field = findElementBySelectorMap(sizeStep.selectorConfig);
    if (!field) {
      needsReview.push(`${sizeStep.label} (retry: field not found)`);
      stepOutcomes.size = "needs_review";
      return;
    }

    if (usedElements.has(field)) {
      skippedForSafety.push(`${sizeStep.label} (retry: collision prevention)`);
      stepOutcomes.size = "skipped_for_safety";
      return;
    }

    const customSelectResult = await tryFillCustomSelect({
      step: sizeStep,
      value: rawValue,
      control: field,
      usedElements,
    });

    if (customSelectResult.status === "filled") {
      filled.push(sizeStep.label);
      stepOutcomes.size = "filled";
      return;
    }

    if (customSelectResult.status === "needs_review") {
      needsReview.push(`${sizeStep.label} (retry: ${customSelectResult.reason})`);
      stepOutcomes.size = "needs_review";
      return;
    }

    skippedForSafety.push(`${sizeStep.label} (retry: ${customSelectResult.reason})`);
    stepOutcomes.size = "skipped_for_safety";
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

  function getSelectorMap() {
    return window.LPU_VENDOO_SELECTORS ?? {
      ebay: {
        title: {
          controlType: "text",
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

  function findElementBySelectorMap(fieldConfig) {
    const labelStrategies = fieldConfig?.labelStrategies ?? [];
    for (const strategy of labelStrategies) {
      const found = findByLabelStrategy(strategy);
      if (found) return found;
    }

    const fallbackStrategies = fieldConfig?.fallbackStrategies ?? [];
    for (const strategy of fallbackStrategies) {
      const found = findByFallbackStrategy(strategy);
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

  function findByLabelStrategy(strategy) {
    const terms = (strategy?.labelTerms ?? []).map(normalizeText);
    if (!terms.length) return null;

    const labels = Array.from(document.querySelectorAll("label"));
    for (const label of labels) {
      const labelText = normalizeText(label.textContent);
      if (!terms.some((term) => labelText.includes(term))) continue;

      const candidates = collectLabelCandidates(label, strategy.elementSelector);
      const matched = candidates.find((el) => matchesStrategy(el, strategy));
      if (matched) return matched;
    }

    return null;
  }

  function collectLabelCandidates(label, elementSelector) {
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
      if (linked?.matches(selector)) addCandidate(linked);
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

  function findByFallbackStrategy(strategy) {
    const selector = strategy?.elementSelector;
    if (!selector) return null;

    const elements = Array.from(document.querySelectorAll(selector));
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
