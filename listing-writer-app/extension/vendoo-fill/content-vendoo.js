(() => {
  if (window.__LPU_VENDOO_PAGE_BRIDGE__) return;
  window.__LPU_VENDOO_PAGE_BRIDGE__ = true;

  const PANEL_ID = "lpu-vendoo-panel";
  const TRANSIENT_PHOTO_KEY = "__LPU_VENDOO_TRANSIENT_PHOTO_PAYLOAD__";

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
    const photos = pickPayloadPhotos(record.payload);
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
      <div><strong>Photos:</strong> ${photos.length ? `${photos.length} ready` : "missing"}</div>
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
    const photoStageDiagnostics = await runPhotoUploadStage(payload);
    const marketplaceStageDiagnostics = await runMarketplaceActivationStage({
      targetMarketplace: "ebay",
      selectors,
    });

    if (photoStageDiagnostics.photoStageStatus === "uploaded_verified") {
      runState.filled.push("Vendoo photos");
    } else if (photoStageDiagnostics.photoStageStatus === "skipped_no_photos") {
      runState.skippedForSafety.push("Vendoo photos (no photos in payload)");
    } else {
      runState.needsReview.push(
        `Vendoo photos (${photoStageDiagnostics.uploadVerificationReason})`
      );
    }

    if (!marketplaceStageDiagnostics.handoffToMarketplaceFill) {
      runState.needsReview.push(
        `Marketplace stage (${marketplaceStageDiagnostics.marketplaceReadyReason || marketplaceStageDiagnostics.marketplaceActivationReason || "marketplace not ready"})`
      );
      reportEl.textContent = "Fill run completed.";
      renderLastRunResults({
        filled: runState.filled,
        needsReview: runState.needsReview,
        skippedForSafety: runState.skippedForSafety,
        photoStageDiagnostics,
        marketplaceStageDiagnostics,
      });
      await refreshPanel();
      return;
    }

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
      photoStageDiagnostics,
      marketplaceStageDiagnostics,
    });
    await refreshPanel();
  }

  async function runMarketplaceActivationStage(input) {
    const { targetMarketplace, selectors } = input;
    const diagnostics = {
      marketplaceStageAttempted: true,
      targetMarketplace,
      marketplaceTabFound: false,
      marketplaceActivationAttempted: false,
      marketplaceActivationMethod: "none",
      marketplaceActivationPassed: false,
      marketplaceActivationReason: "",
      marketplaceReadyCheckAttempted: false,
      marketplaceReadyPassed: false,
      marketplaceReadyReason: "",
      marketplaceReadyEvidence: {},
      handoffToMarketplaceFill: false,
      marketplaceStageStatus: "attempted",
      marketplaceStageError: "",
    };

    try {
      const tab = findMarketplaceTab(targetMarketplace);
      diagnostics.marketplaceTabFound = tab instanceof Element;
      if (!(tab instanceof Element)) {
        diagnostics.marketplaceStageStatus = "needs_review";
        diagnostics.marketplaceActivationReason = "marketplace tab not found";
        diagnostics.marketplaceReadyReason = "marketplace tab not found";
        console.debug("[LPU Vendoo] Marketplace stage diagnostics", diagnostics);
        return diagnostics;
      }

      diagnostics.marketplaceActivationAttempted = true;
      clickElement(tab);
      diagnostics.marketplaceActivationMethod = "tab_click";

      const activationState = readMarketplaceActivationState(tab, targetMarketplace);
      diagnostics.marketplaceActivationPassed = activationState.active;
      diagnostics.marketplaceActivationReason = activationState.reason;
      diagnostics.marketplaceStageStatus = activationState.active ? "activated" : "attempted";

      diagnostics.marketplaceReadyCheckAttempted = true;
      const readiness = await waitForMarketplaceReady({
        targetMarketplace,
        selectors,
        tabElement: tab,
      });
      diagnostics.marketplaceReadyPassed = readiness.passed;
      diagnostics.marketplaceReadyReason = readiness.reason;
      diagnostics.marketplaceReadyEvidence = readiness.evidence;

      if (!readiness.passed) {
        diagnostics.marketplaceStageStatus = "needs_review";
        console.debug("[LPU Vendoo] Marketplace stage diagnostics", diagnostics);
        return diagnostics;
      }

      diagnostics.handoffToMarketplaceFill = true;
      diagnostics.marketplaceStageStatus = "handed_off";
      console.debug("[LPU Vendoo] Marketplace stage diagnostics", diagnostics);
      return diagnostics;
    } catch (error) {
      diagnostics.marketplaceStageStatus = "failed";
      diagnostics.marketplaceStageError = error instanceof Error ? error.message : "unknown error";
      diagnostics.marketplaceReadyReason = "marketplace stage runtime error";
      console.debug("[LPU Vendoo] Marketplace stage diagnostics", diagnostics);
      return diagnostics;
    }
  }

  async function runPhotoUploadStage(payload) {
    const photoResolution = await resolvePhotoPayloadForRun(payload);
    const photos = photoResolution.photos;
    const diagnostics = {
      photosPresentInPayload: photos.length > 0,
      expectedPhotoCount: photos.length,
      photoPayloadNames: photos.map((photo) => photo.name || "(unnamed)").slice(0, 20),
      transientPhotoPayloadPresent: photoResolution.transientPhotoPayloadPresent,
      transientPhotoPayloadSource: photoResolution.transientPhotoPayloadSource,
      transientPhotoCountResolved: photoResolution.transientPhotoCountResolved,
      persistedPhotoMetadataOnly: photoResolution.persistedPhotoMetadataOnly,
      photoPayloadStrippedForStorage: photoResolution.photoPayloadStrippedForStorage,
      photoCount: photoResolution.photoCount,
      storedPayloadByteEstimate: photoResolution.storedPayloadByteEstimate,
      storageSavePassed: null,
      storageSaveError: "",
      uploadSurfaceDetected: false,
      uploadSurfaceType: "none",
      fileInputFound: false,
      associatedFileInputResolved: false,
      dropzoneNodeFound: false,
      uploadAttempted: false,
      uploadMethodUsed: "none",
      uploadFallbackAttempted: false,
      uploadFallbackReason: "",
      uploadedPhotoCountObserved: 0,
      uploadVerificationPassed: false,
      uploadVerificationReason: "",
      photoStageStatus: "skipped_no_photos",
      photoStageError: "",
    };
    try {
      if (!photos.length) {
        diagnostics.uploadVerificationReason = "no photos in payload";
        console.debug("[LPU Vendoo] Photo stage diagnostics", diagnostics);
        return diagnostics;
      }

      diagnostics.photoStageStatus = "attempted";
      const uploadSurface = findVendooUploadSurface();
      diagnostics.uploadSurfaceDetected = uploadSurface.detected;
      diagnostics.uploadSurfaceType = uploadSurface.type;
      diagnostics.fileInputFound = uploadSurface.fileInput instanceof HTMLInputElement;
      diagnostics.dropzoneNodeFound = uploadSurface.dropzoneNode instanceof Element;

      const files = buildFilesFromPhotoPayload(photos);
      if (!files.length) {
        diagnostics.photoStageStatus = "failed";
        diagnostics.uploadVerificationReason = "no valid photo files from payload";
        diagnostics.photoStageError = "payload photos could not be converted to File objects";
        console.debug("[LPU Vendoo] Photo stage diagnostics", diagnostics);
        return diagnostics;
      }

      const initialObservedCount = countUploadedPhotoEvidence(uploadSurface.scope);
      let activeFileInput =
        uploadSurface.fileInput instanceof HTMLInputElement ? uploadSurface.fileInput : null;

      try {
        if (activeFileInput) {
          assignFilesToInput(activeFileInput, files);
          diagnostics.uploadAttempted = true;
          diagnostics.uploadMethodUsed = "file_input";
        } else {
          diagnostics.uploadFallbackAttempted = true;
          const associatedFileInput = resolveAssociatedUploadFileInput(uploadSurface);
          if (associatedFileInput) {
            activeFileInput = associatedFileInput;
            diagnostics.associatedFileInputResolved = true;
            diagnostics.uploadFallbackReason = "associated file input resolved";
            assignFilesToInput(activeFileInput, files);
            diagnostics.uploadAttempted = true;
            diagnostics.uploadMethodUsed = "associated_hidden_input";
          } else if (uploadSurface.dropzoneNode instanceof Element) {
            const dropResult = dispatchDropzoneUpload(uploadSurface.dropzoneNode, files);
            diagnostics.uploadAttempted = dropResult.attempted;
            diagnostics.uploadMethodUsed = dropResult.attempted
              ? "dropzone_datatransfer"
              : "none";
            diagnostics.uploadFallbackReason = dropResult.reason;
          } else {
            diagnostics.uploadFallbackReason = "no associated file input or dropzone node";
          }
        }
      } catch (error) {
        diagnostics.photoStageStatus = "failed";
        diagnostics.uploadVerificationReason = "upload assignment failed";
        diagnostics.photoStageError =
          error instanceof Error ? error.message : "unknown upload assignment error";
        console.debug("[LPU Vendoo] Photo stage diagnostics", diagnostics);
        return diagnostics;
      }

      if (!diagnostics.uploadAttempted) {
        diagnostics.photoStageStatus = "needs_review";
        diagnostics.uploadVerificationReason = "file input not found";
        if (!diagnostics.uploadFallbackReason) {
          diagnostics.uploadFallbackReason = "no usable upload fallback";
        }
        console.debug("[LPU Vendoo] Photo stage diagnostics", diagnostics);
        return diagnostics;
      }

      const verification = await verifyPhotoUpload({
        scope: uploadSurface.scope,
        fileInput: activeFileInput,
        expectedCount: files.length,
        initialObservedCount,
      });

      diagnostics.uploadedPhotoCountObserved = verification.uploadedPhotoCountObserved;
      diagnostics.uploadVerificationPassed = verification.passed;
      diagnostics.uploadVerificationReason = verification.reason;
      diagnostics.photoStageStatus = verification.passed ? "uploaded_verified" : "needs_review";
      console.debug("[LPU Vendoo] Photo stage diagnostics", diagnostics);
      return diagnostics;
    } catch (error) {
      diagnostics.photoStageStatus = "failed";
      diagnostics.uploadVerificationReason = "unexpected photo stage error";
      diagnostics.photoStageError = error instanceof Error ? error.message : "unknown error";
      console.debug("[LPU Vendoo] Photo stage diagnostics", diagnostics);
      return diagnostics;
    }
  }

  function findMarketplaceTab(targetMarketplace) {
    const target = normalizeText(targetMarketplace);
    const candidates = Array.from(
      document.querySelectorAll("button, [role='tab'], [role='button'], [aria-controls], [data-testid]")
    ).filter((element) => element instanceof Element && isVisible(element));

    const scored = candidates
      .map((element) => {
        const text = normalizeText(
          [
            element.textContent || "",
            element.getAttribute("aria-label") || "",
            element.getAttribute("title") || "",
            element.getAttribute("data-testid") || "",
            element.getAttribute("name") || "",
          ].join(" ")
        );
        if (!text) return null;
        let score = 0;
        if (text === target) score += 6;
        if (text.includes(target)) score += 4;
        if (text.includes("marketplace")) score += 2;
        if (element.matches("[role='tab']")) score += 2;
        return { element, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.score > 0 ? scored[0].element : null;
  }

  function readMarketplaceActivationState(tabElement, targetMarketplace) {
    if (!(tabElement instanceof Element)) {
      return { active: false, reason: "tab missing" };
    }

    const selectedAttr = normalizeText(tabElement.getAttribute("aria-selected") || "");
    const dataState = normalizeText(tabElement.getAttribute("data-state") || "");
    const className = normalizeText(
      typeof tabElement.className === "string" ? tabElement.className : ""
    );
    const tabText = normalizeText(tabElement.textContent || "");
    const target = normalizeText(targetMarketplace);
    const active =
      selectedAttr === "true" ||
      dataState === "active" ||
      className.includes("active") ||
      className.includes("selected");
    if (active) return { active: true, reason: "tab state indicates active" };
    if (tabText.includes(target)) {
      return { active: true, reason: "target tab clicked; active state not explicit" };
    }
    return { active: false, reason: "tab active state not confirmed" };
  }

  async function waitForMarketplaceReady(input) {
    const { targetMarketplace, selectors, tabElement } = input;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (attempt > 0) {
        await wait(160);
      }

      const evidence = getMarketplaceReadyEvidence({
        targetMarketplace,
        selectors,
        tabElement,
      });
      if (evidence.ready) {
        return {
          passed: true,
          reason: "marketplace form ready",
          evidence,
        };
      }
    }

    return {
      passed: false,
      reason: "marketplace readiness not confirmed",
      evidence: getMarketplaceReadyEvidence({
        targetMarketplace,
        selectors,
        tabElement,
      }),
    };
  }

  function getMarketplaceReadyEvidence(input) {
    const { targetMarketplace, selectors, tabElement } = input;
    const activationState = readMarketplaceActivationState(tabElement, targetMarketplace);
    const loadingVisible = isMarketplaceLoadingVisible();
    const categoryReady = !!findElementBySelectorMap(selectors?.category);
    const titleReady = !!findElementBySelectorMap(selectors?.title);
    const descriptionReady = !!findElementBySelectorMap(selectors?.description);
    const ready = !loadingVisible && activationState.active && (categoryReady || titleReady || descriptionReady);

    return {
      tabActive: activationState.active,
      tabActiveReason: activationState.reason,
      categoryFieldVisible: categoryReady,
      titleFieldVisible: titleReady,
      descriptionFieldVisible: descriptionReady,
      loadingVisible,
      ready,
    };
  }

  function isMarketplaceLoadingVisible() {
    const loadingNode = document.querySelector(
      '[aria-busy="true"], [data-loading="true"], [class*="loading"], [class*="spinner"], [role="progressbar"]'
    );
    return loadingNode instanceof Element && isVisible(loadingNode);
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

  const CANONICAL_LPU_FIELD_SCHEMA = {
    brand: ["brand", "maker"],
    color: ["color", "colour"],
    size: ["size"],
    department: ["department"],
    jewelrydepartment: ["jewelry department"],
    material: ["material", "materials", "metal", "base material", "base metal"],
    mainstone: ["main stone"],
    vintage: ["vintage"],
    signed: ["signed", "signed/maker", "signed maker", "maker", "designer"],
    signedmaker: ["signed", "signed maker", "signed/maker", "designer", "maker"],
    occasion: ["occasion"],
    theme: ["theme", "style theme"],
    closure: ["closure"],
    shape: ["shape"],
    style: ["style", "type", "style type", "style/theme", "style theme"],
    type: ["type", "style", "style type", "style/theme"],
    styletype: ["style", "type", "style type", "style/theme", "style theme", "theme"],
    features: ["features", "feature"],
    accents: ["accents", "accent"],
    pattern: ["pattern"],
    fabrictype: ["fabric type", "fabric"],
    fit: ["fit"],
    sizetype: ["size type"],
    setincludes: ["set includes", "includes", "included"],
    basemetal: ["base metal"],
    mainstonecolor: ["main stone color"],
    mainstonecreation: ["main stone creation"],
    countryregionofmanufacture: [
      "country/region of manufacture",
      "country of manufacture",
      "region of manufacture",
    ],
    dresslength: ["dress length"],
    neckline: ["neckline"],
    sleevelength: ["sleeve length"],
    sleevetype: ["sleeve type"],
    handmade: ["handmade", "hand made"],
  };

  const DYNAMIC_FIELD_SYNONYMS = {
    ...CANONICAL_LPU_FIELD_SCHEMA,
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
      canonicalPayloadKeysAvailable,
      excludedPayloadKeys,
      exclusionReasonByKey,
    } = buildDynamicPayloadCandidates(payload);
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

      let result = await fillDynamicFieldValue(field, candidate.value, selectors);
      const verification = await verifyDynamicFillResult(field, candidate.value, result);
      if (result.status === "filled" && !verification.passed) {
        result = {
          ...result,
          status: "needs_review",
          reason: verification.reason || "post-fill verification failed",
        };
      }
      adapterAttemptedByField.push({
        label: field.label,
        payloadKey: candidate.key,
        canonicalPayloadKey: candidate.canonicalKey,
        controlFamily: result.controlFamily ?? field.controlFamily,
        adapterSelected: result.adapterSelected ?? "unknown",
        status: result.status,
        reason: result.reason ?? "",
        verification,
        chipDiagnostics: result.chipDiagnostics ?? null,
        entryDiagnostics: result.entryDiagnostics ?? null,
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
      canonicalPayloadKeysAvailable,
      excludedPayloadKeys,
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

  function buildDynamicPayloadCandidates(payload) {
    const ebay = payload?.marketplaces?.ebay ?? {};
    const specifics = ebay?.itemSpecifics ?? {};
    const candidates = [];
    const excludedPayloadKeys = [];
    const seenKeys = new Set();
    const exclusionReasonByKey = {};
    const canonicalPayloadKeysAvailable = [];

    function addCandidateEntry(key, value) {
      const rawKey = String(key);
      const canonicalKey = toCanonicalPayloadKey(rawKey);
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
      const dedupeKey = canonicalKey;
      if (!dedupeKey) return;
      if (seenKeys.has(dedupeKey)) {
        excludedPayloadKeys.push(rawKey);
        exclusionReasonByKey[rawKey] = "duplicate_key";
        return;
      }
      seenKeys.add(dedupeKey);
      canonicalPayloadKeysAvailable.push(canonicalKey);

      const synonyms = DYNAMIC_FIELD_SYNONYMS[canonicalKey] ?? [];
      const keyTerms = Array.from(
        new Set([...buildKeyTermsFromKey(rawKey), ...buildKeyTermsFromKey(canonicalKey)])
      );
      const matchTerms = Array.from(new Set([...synonyms, ...keyTerms].map(normalizeText)));
      candidates.push({
        key: canonicalKey,
        canonicalKey,
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
      canonicalPayloadKeysAvailable: Array.from(new Set(canonicalPayloadKeysAvailable)),
      excludedPayloadKeys: Array.from(new Set(excludedPayloadKeys)),
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

  function toCanonicalPayloadKey(rawKey) {
    const normalizedRaw = normalizePayloadKey(rawKey);
    if (!normalizedRaw) return "";
    if (Object.prototype.hasOwnProperty.call(CANONICAL_LPU_FIELD_SCHEMA, normalizedRaw)) {
      return normalizedRaw;
    }

    for (const [canonicalKey, aliases] of Object.entries(CANONICAL_LPU_FIELD_SCHEMA)) {
      if (!Array.isArray(aliases)) continue;
      for (const alias of aliases) {
        if (normalizePayloadKey(alias) === normalizedRaw) {
          return canonicalKey;
        }
      }
    }

    return normalizedRaw;
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
    if (isLikelyMultiValueControl(control)) return "multi_value_chip";
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
    const entryAnalysis = analyzeDynamicEntryCapability(field);
    const payloadValues = buildNormalizedPayloadValues(value);
    const entryDiagnostics = {
      fieldScopeResolved: entryAnalysis.fieldScopeResolved,
      fieldScopeHelperTexts: entryAnalysis.fieldScopeHelperTexts,
      fieldScopeChipEvidenceFound: entryAnalysis.fieldScopeChipEvidenceFound,
      entryCapability: entryAnalysis.entryCapability,
      entryCapabilityResolutionPath: entryAnalysis.entryCapabilityResolutionPath,
      entryCapabilityResolutionReasons: entryAnalysis.entryCapabilityResolutionReasons,
      contradictoryLockEvidence: entryAnalysis.contradictoryLockEvidence,
      multiEntryEvidenceReasons: entryAnalysis.multiEntryEvidenceReasons,
      originalPayloadValue: String(value ?? "").trim(),
      parsedValueMode: payloadValues.multiValue ? "multi-value" : "single-value",
      parsedTokens: payloadValues.values,
      executionRouteSelected: "unresolved",
      executionRouteReasons: [],
      blockedBySingleValueGuard: false,
      blockReason: "",
      customCommitAttempted: false,
      customCommitAccepted: false,
      optionMatchAttempted: false,
      optionMatchAccepted: false,
      finalStatusByToken: {},
      finalStatusByField: "needs_review",
      controlFamily: route.controlFamily,
    };

    if (!value || !value.trim()) {
      entryDiagnostics.finalStatusByField = "needs_review";
      entryDiagnostics.executionRouteSelected = "payload_missing";
      entryDiagnostics.executionRouteReasons.push("payload_blank");
      return {
        status: "needs_review",
        reason: "payload missing",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics,
      };
    }

    if (route.controlFamily === "text_input" || route.controlFamily === "textarea") {
      setElementValue(field.control, value);
      entryDiagnostics.finalStatusByField = "filled";
      entryDiagnostics.executionRouteSelected = "text_set_value";
      entryDiagnostics.executionRouteReasons.push("text_or_textarea_control_family");
      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics,
      };
    }

    if (
      route.controlFamily === "single_select_combobox" &&
      field.controlType === "select" &&
      field.control instanceof HTMLSelectElement
    ) {
      if (!payloadValues.values.length) {
        entryDiagnostics.finalStatusByField = "needs_review";
        entryDiagnostics.executionRouteSelected = "select_payload_missing";
        entryDiagnostics.executionRouteReasons.push("normalized_payload_empty");
        return {
          status: "needs_review",
          reason: "payload missing after normalization",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
          entryDiagnostics,
        };
      }
      if (payloadValues.multiValue) {
        entryDiagnostics.finalStatusByField = "skipped_for_safety";
        entryDiagnostics.executionRouteSelected = "single_select_blocked";
        entryDiagnostics.executionRouteReasons.push("native_select_single_value");
        entryDiagnostics.blockedBySingleValueGuard = true;
        entryDiagnostics.blockReason = "multi-value payload for single-value select";
        return {
          status: "skipped_for_safety",
          reason: "multi-value payload for single-value select",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
          entryDiagnostics,
        };
      }
      const normalizedValue = payloadValues.values[0];
      const exactOptions = Array.from(field.control.options).filter((option) => {
        const optionText = cleanCategoryStage(option.textContent || option.value || "");
        return normalizeOptionValue(optionText) === normalizedValue;
      });

      if (exactOptions.length !== 1) {
        entryDiagnostics.optionMatchAttempted = true;
        entryDiagnostics.optionMatchAccepted = false;
        entryDiagnostics.finalStatusByField = "needs_review";
        entryDiagnostics.executionRouteSelected = "select_exact_option_match";
        entryDiagnostics.executionRouteReasons.push("exact_select_option_not_unique");
        return {
          status: "needs_review",
          reason: exactOptions.length > 1 ? "multiple exact select options" : "no exact select option",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
          entryDiagnostics,
        };
      }

      entryDiagnostics.optionMatchAttempted = true;
      entryDiagnostics.optionMatchAccepted = true;
      entryDiagnostics.executionRouteSelected = "select_exact_option_match";
      entryDiagnostics.executionRouteReasons.push("exact_select_option_committed");
      field.control.value = exactOptions[0].value;
      field.control.dispatchEvent(new Event("change", { bubbles: true }));
      field.control.dispatchEvent(new Event("blur", { bubbles: true }));
      entryDiagnostics.finalStatusByField = "filled";
      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics,
      };
    }

    if (
      route.controlFamily === "multi_value_chip" ||
      entryAnalysis.entryCapability === "multi_entry_custom"
    ) {
      entryDiagnostics.executionRouteSelected = "multi_value_chip_tokens";
      entryDiagnostics.executionRouteReasons.push("multi_entry_capability_or_family");
      const optionSelectors = selectors?.color?.optionSelectors ?? [
        '[role="option"]',
        '[data-radix-collection-item]',
        '.react-select__option',
        'li[role="option"]',
      ];
      return fillMultiValueChipField(field, value, optionSelectors, route, entryDiagnostics);
    }

    if (route.controlFamily === "single_select_combobox") {
      const optionSelectors = selectors?.color?.optionSelectors ?? [
        '[role="option"]',
        '[data-radix-collection-item]',
        '.react-select__option',
        'li[role="option"]',
      ];

      if (!payloadValues.values.length) {
        entryDiagnostics.finalStatusByField = "needs_review";
        entryDiagnostics.executionRouteSelected = "combobox_payload_missing";
        entryDiagnostics.executionRouteReasons.push("normalized_payload_empty");
        return {
          status: "needs_review",
          reason: "payload missing after normalization",
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
          entryDiagnostics,
        };
      }
      const valueMode = payloadValues.multiValue ? "multi-value" : "single-value";
      if (payloadValues.multiValue) {
        const hasContradictoryLockEvidence =
          Array.isArray(entryAnalysis.contradictoryLockEvidence) &&
          entryAnalysis.contradictoryLockEvidence.length > 0;
        if (
          entryAnalysis.entryCapability === "multi_entry_custom" ||
          (entryAnalysis.entryCapability === "single_entry_custom" && !hasContradictoryLockEvidence)
        ) {
          entryDiagnostics.executionRouteSelected = "custom_entry_multi_token_handoff";
          entryDiagnostics.executionRouteReasons.push(
            `entry_capability:${entryAnalysis.entryCapability}`
          );
          if (hasContradictoryLockEvidence) {
            entryDiagnostics.executionRouteReasons.push("contradictory_lock_evidence_present");
          }
          return fillMultiValueChipField(field, value, optionSelectors, route, entryDiagnostics);
        }
        entryDiagnostics.executionRouteSelected = "single_select_guard_block";
        entryDiagnostics.executionRouteReasons.push(`entry_capability:${entryAnalysis.entryCapability}`);
        entryDiagnostics.blockedBySingleValueGuard = true;
        entryDiagnostics.blockReason =
          hasContradictoryLockEvidence && entryAnalysis.contradictoryLockEvidence.length
            ? `contradictory evidence: ${entryAnalysis.contradictoryLockEvidence.join(", ")}`
            : `${valueMode} payload for single-value control`;
        entryDiagnostics.finalStatusByField = "skipped_for_safety";
        return {
          status: "skipped_for_safety",
          reason: `${valueMode} payload for single-value control (raw: "${String(
            value
          ).trim()}"; canonical: "${payloadValues.canonicalValue}")`,
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
          entryDiagnostics,
        };
      }

      for (const target of payloadValues.values) {
        entryDiagnostics.optionMatchAttempted = true;
        entryDiagnostics.executionRouteSelected = "combobox_option_match_then_custom";
        entryDiagnostics.executionRouteReasons.push("single_token_combobox_attempt");
        const selectResult = await selectComboboxValueByNormalizedMatch({
          control: field.control,
          optionSelectors,
          target,
          fieldLabel: field.label,
          payloadRaw: String(value ?? "").trim(),
          payloadCanonical: payloadValues.canonicalValue,
          valueMode,
        });

        if (selectResult.status === "filled") {
          entryDiagnostics.optionMatchAccepted = true;
          entryDiagnostics.finalStatusByToken[target] = "filled_option_match";
          continue;
        }

        if (entryAnalysis.entryCapability === "single_entry_custom") {
          entryDiagnostics.customCommitAttempted = true;
          const committed = tryCommitChipToken(field.control, target);
          entryDiagnostics.customCommitAccepted = committed;
          entryDiagnostics.finalStatusByToken[target] = committed
            ? "filled_custom_commit"
            : "rejected";
          if (committed) {
            continue;
          }
        }

        entryDiagnostics.finalStatusByField = selectResult.status;
        entryDiagnostics.blockedBySingleValueGuard = false;
        return {
          ...selectResult,
          controlFamily: route.controlFamily,
          adapterSelected: route.adapterSelected,
          entryDiagnostics,
        };
      }

      entryDiagnostics.finalStatusByField = "filled";
      entryDiagnostics.executionRouteSelected = "combobox_single_token_filled";
      entryDiagnostics.executionRouteReasons.push("token_fill_completed");
      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics,
      };
    }

    entryDiagnostics.finalStatusByField = "skipped_for_safety";
    entryDiagnostics.executionRouteSelected = "unsupported_control_family";
    entryDiagnostics.executionRouteReasons.push(`control_family:${route.controlFamily}`);
    return {
      status: "skipped_for_safety",
      reason: `unsupported control family (${route.controlFamily})`,
      controlFamily: route.controlFamily,
      adapterSelected: route.adapterSelected,
      entryDiagnostics,
    };
  }

  async function fillMultiValueChipField(field, value, optionSelectors, route, entryDiagnostics) {
    const payloadValues = buildNormalizedPayloadValues(value);
    const parsedTokens = payloadValues.values;
    const chipDiagnostics = ensureChipDiagnosticsShape(
      entryDiagnostics ?? {
      originalPayloadValue: String(value ?? "").trim(),
      parsedValueMode: payloadValues.multiValue ? "multi-value" : "single-value",
      parsedTokens,
      controlFamily: route.controlFamily,
      chipAttemptedTokens: [],
      chipAcceptedTokens: [],
      chipRejectedTokens: [],
      finalStatusByToken: {},
      finalStatusByField: "needs_review",
      customCommitAttempted: false,
      customCommitAccepted: false,
      optionMatchAttempted: false,
      optionMatchAccepted: false,
      }
    );
    chipDiagnostics.parsedValueMode = payloadValues.multiValue ? "multi-value" : "single-value";
    chipDiagnostics.parsedTokens = parsedTokens;
    chipDiagnostics.controlFamily = route.controlFamily;

    if (!parsedTokens.length) {
      chipDiagnostics.finalStatusByField = "needs_review";
      return {
        status: "needs_review",
        reason: "payload missing after normalization",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        chipDiagnostics,
      };
    }

    try {
      for (const token of parsedTokens) {
        chipDiagnostics.chipAttemptedTokens.push(token);
        let accepted = false;

        if (field.controlType === "combobox") {
          chipDiagnostics.optionMatchAttempted = true;
          const selectResult = await selectComboboxValueByNormalizedMatch({
            control: field.control,
            optionSelectors,
            target: token,
            fieldLabel: field.label,
            payloadRaw: String(value ?? "").trim(),
            payloadCanonical: payloadValues.canonicalValue,
            valueMode: payloadValues.multiValue ? "multi-value" : "single-value",
          });
          accepted = selectResult.status === "filled";
          if (accepted) {
            chipDiagnostics.optionMatchAccepted = true;
          }
        }

        if (!accepted) {
          chipDiagnostics.customCommitAttempted = true;
          accepted = tryCommitChipToken(field.control, token);
          if (accepted) {
            chipDiagnostics.customCommitAccepted = true;
          }
        }

        if (accepted) {
          chipDiagnostics.chipAcceptedTokens.push(token);
          chipDiagnostics.finalStatusByToken[token] = "filled";
          await wait(80);
        } else {
          chipDiagnostics.chipRejectedTokens.push(token);
          chipDiagnostics.finalStatusByToken[token] = "rejected";
        }
      }
    } catch (error) {
      chipDiagnostics.finalStatusByField = "needs_review";
      return {
        status: "needs_review",
        reason: `token entry runtime error: ${error instanceof Error ? error.message : "unknown error"}`,
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics: chipDiagnostics,
        chipDiagnostics,
      };
    }

    if (chipDiagnostics.chipAcceptedTokens.length === parsedTokens.length) {
      chipDiagnostics.finalStatusByField = "filled";
      return {
        status: "filled",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics: chipDiagnostics,
        chipDiagnostics,
      };
    }

    if (chipDiagnostics.chipAcceptedTokens.length > 0) {
      chipDiagnostics.finalStatusByField = "needs_review";
      return {
        status: "needs_review",
        reason: "partial multi-value entry",
        controlFamily: route.controlFamily,
        adapterSelected: route.adapterSelected,
        entryDiagnostics: chipDiagnostics,
        chipDiagnostics,
      };
    }

    chipDiagnostics.finalStatusByField = "skipped_for_safety";
    return {
      status: "skipped_for_safety",
      reason: "no safe entry method exists for multi-value control",
      controlFamily: route.controlFamily,
      adapterSelected: route.adapterSelected,
      entryDiagnostics: chipDiagnostics,
      chipDiagnostics,
    };
  }

  function ensureChipDiagnosticsShape(input) {
    const base = input && typeof input === "object" ? input : {};
    return {
      originalPayloadValue: String(base.originalPayloadValue ?? "").trim(),
      parsedValueMode: String(base.parsedValueMode ?? "single-value"),
      parsedTokens: Array.isArray(base.parsedTokens) ? base.parsedTokens : [],
      controlFamily: String(base.controlFamily ?? "multi_value_chip"),
      chipAttemptedTokens: Array.isArray(base.chipAttemptedTokens) ? base.chipAttemptedTokens : [],
      chipAcceptedTokens: Array.isArray(base.chipAcceptedTokens) ? base.chipAcceptedTokens : [],
      chipRejectedTokens: Array.isArray(base.chipRejectedTokens) ? base.chipRejectedTokens : [],
      finalStatusByToken:
        base.finalStatusByToken && typeof base.finalStatusByToken === "object"
          ? base.finalStatusByToken
          : {},
      finalStatusByField: String(base.finalStatusByField ?? "needs_review"),
      customCommitAttempted: Boolean(base.customCommitAttempted),
      customCommitAccepted: Boolean(base.customCommitAccepted),
      optionMatchAttempted: Boolean(base.optionMatchAttempted),
      optionMatchAccepted: Boolean(base.optionMatchAccepted),
      executionRouteSelected: String(base.executionRouteSelected ?? ""),
      executionRouteReasons: Array.isArray(base.executionRouteReasons)
        ? base.executionRouteReasons
        : [],
      blockedBySingleValueGuard: Boolean(base.blockedBySingleValueGuard),
      blockReason: String(base.blockReason ?? ""),
      entryCapability: String(base.entryCapability ?? ""),
      entryCapabilityResolutionPath: String(base.entryCapabilityResolutionPath ?? ""),
      entryCapabilityResolutionReasons: Array.isArray(base.entryCapabilityResolutionReasons)
        ? base.entryCapabilityResolutionReasons
        : [],
      contradictoryLockEvidence: Array.isArray(base.contradictoryLockEvidence)
        ? base.contradictoryLockEvidence
        : [],
      multiEntryEvidenceReasons: Array.isArray(base.multiEntryEvidenceReasons)
        ? base.multiEntryEvidenceReasons
        : [],
      fieldScopeResolved: Boolean(base.fieldScopeResolved),
      fieldScopeHelperTexts: Array.isArray(base.fieldScopeHelperTexts) ? base.fieldScopeHelperTexts : [],
      fieldScopeChipEvidenceFound: Boolean(base.fieldScopeChipEvidenceFound),
    };
  }

  function tryCommitChipToken(control, token) {
    if (!(control instanceof Element)) return false;

    const tokenInput =
      (control.matches("input:not([type='hidden'])") ? control : null) ||
      control.querySelector("input:not([type='hidden'])");
    if (!(tokenInput instanceof HTMLInputElement) || !isVisible(tokenInput)) {
      return false;
    }

    setElementValue(tokenInput, token);
    tokenInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    tokenInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    tokenInput.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function analyzeDynamicEntryCapability(field) {
    const control = field?.control instanceof Element ? field.control : null;
    const scope = control?.closest("div, section, fieldset, form") ?? control;
    const helperTexts = collectFieldScopeHelperTexts(scope);
    const normalizedHelper = helperTexts.map((text) => normalizeText(text));
    const reasons = [];

    const chipEvidenceFound = isLikelyMultiValueControl(control);
    if (chipEvidenceFound) reasons.push("chip_or_multi_ui_evidence");
    if (normalizedHelper.some((text) => text.includes("add up to"))) {
      reasons.push("helper_add_up_to");
    }
    if (
      normalizedHelper.some(
        (text) =>
          text.includes("add ") ||
          text.includes("enter ") ||
          text.includes("type ") ||
          text.includes("custom")
      )
    ) {
      reasons.push("helper_custom_entry_language");
    }

    const hasEditableInput =
      control instanceof Element &&
      (control.matches("input:not([type='hidden'])") ||
        !!control.querySelector("input:not([type='hidden'])"));
    if (hasEditableInput) {
      reasons.push("editable_input_present");
    }

    const contradictoryLockEvidence = [];
    if (control instanceof HTMLSelectElement) {
      contradictoryLockEvidence.push("native_select_option_locked");
    }
    if (
      control instanceof Element &&
      control.matches("input:not([type='hidden'])") &&
      ((control instanceof HTMLInputElement && control.readOnly) || control.getAttribute("readonly"))
    ) {
      contradictoryLockEvidence.push("input_readonly");
    }
    if (
      control instanceof Element &&
      control.matches("input:not([type='hidden'])") &&
      ((control instanceof HTMLInputElement && control.disabled) || control.getAttribute("disabled"))
    ) {
      contradictoryLockEvidence.push("input_disabled");
    }

    let entryCapability = "locked_option_only";
    let entryCapabilityResolutionPath = "default_locked";
    const entryCapabilityResolutionReasons = [];
    const hasMultiEntryHints =
      chipEvidenceFound || normalizedHelper.some((text) => text.includes("add up to"));
    const hasSingleEntryHints =
      hasEditableInput ||
      normalizedHelper.some(
        (text) =>
          text.includes("add ") ||
          text.includes("enter ") ||
          text.includes("type ") ||
          text.includes("custom")
      );
    const hasContradictoryLockEvidence = contradictoryLockEvidence.length > 0;

    if (hasMultiEntryHints && !hasContradictoryLockEvidence) {
      entryCapability = "multi_entry_custom";
      entryCapabilityResolutionPath = "multi_entry_evidence";
      entryCapabilityResolutionReasons.push(...reasons);
    } else if (hasSingleEntryHints && !hasContradictoryLockEvidence) {
      entryCapability = "single_entry_custom";
      entryCapabilityResolutionPath = hasEditableInput
        ? "editable_input_upgrade"
        : "single_entry_hint_upgrade";
      entryCapabilityResolutionReasons.push(...reasons);
    } else if (hasContradictoryLockEvidence) {
      entryCapability = "locked_option_only";
      entryCapabilityResolutionPath = "contradictory_lock_evidence";
      entryCapabilityResolutionReasons.push(...contradictoryLockEvidence);
    } else if (!control) {
      entryCapability = "unknown";
      entryCapabilityResolutionPath = "no_control";
      entryCapabilityResolutionReasons.push("control_missing");
    }

    return {
      fieldScopeResolved: scope instanceof Element,
      fieldScopeHelperTexts: helperTexts.slice(0, 8),
      fieldScopeChipEvidenceFound: chipEvidenceFound,
      entryCapability,
      entryCapabilityResolutionPath,
      entryCapabilityResolutionReasons,
      contradictoryLockEvidence,
      multiEntryEvidenceReasons: reasons,
    };
  }

  function collectFieldScopeHelperTexts(scope) {
    if (!(scope instanceof Element)) return [];
    const selectors = "small, p, span, div, label";
    const texts = [];
    const seen = new Set();
    for (const node of Array.from(scope.querySelectorAll(selectors)).slice(0, 60)) {
      if (!(node instanceof Element)) continue;
      if (!isVisible(node)) continue;
      const text = cleanCategoryStage(node.textContent || "");
      const normalized = normalizeText(text);
      if (!normalized || normalized.length < 4 || seen.has(normalized)) continue;
      if (normalized.length > 120) continue;
      seen.add(normalized);
      texts.push(text);
      if (texts.length >= 12) break;
    }
    return texts;
  }

  async function verifyDynamicFillResult(field, value, result) {
    const expectedRawValue = String(value ?? "").trim();
    const normalizedPayloadValues = buildNormalizedPayloadValues(value).values;
    const expectedNormalizedValue = normalizedPayloadValues[0] ?? "";

    if (result.status !== "filled") {
      return {
        status: "not_applicable",
        passed: true,
        reason: "",
        expectedRawValue,
        expectedNormalizedValue,
      };
    }

    if (!expectedNormalizedValue) {
      return {
        status: "failed",
        passed: false,
        reason: "verification missing expected value",
        expectedRawValue,
        expectedNormalizedValue,
      };
    }

    if (result.controlFamily === "single_select_combobox") {
      let lastReadback = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) {
          await wait(90);
        }

        const readback = readSingleSelectComboboxVerification(field);
        lastReadback = readback;
        const sourceOrder = [
          "actualRenderedText",
          "actualTriggerText",
          "actualVisibleInputValue",
          "actualBackingInputValue",
          "selectedOptionText",
          "selectedOptionValue",
          "activeDescendantText",
          "activeDescendantValue",
        ];
        let matchedVerificationSource = "";
        for (const source of sourceOrder) {
          const normalized = normalizeOptionValue(readback[source]);
          if (normalized && normalized === expectedNormalizedValue) {
            matchedVerificationSource = source;
            break;
          }
        }

        if (matchedVerificationSource) {
          return {
            status: "verified",
            passed: true,
            reason: "",
            expectedRawValue,
            expectedNormalizedValue,
            actualRenderedText: readback.actualRenderedText,
            actualRenderedTextRaw: readback.actualRenderedTextRaw,
            actualRenderedTextNormalized: readback.actualRenderedTextNormalized,
            renderedTextCandidates: readback.renderedTextCandidates,
            renderedTextChosenFrom: readback.renderedTextChosenFrom,
            renderedTextExtractionMode: readback.renderedTextExtractionMode,
            actualTriggerText: readback.actualTriggerText,
            actualVisibleInputValue: readback.actualVisibleInputValue,
            actualBackingInputValue: readback.actualBackingInputValue,
            selectedOptionText: readback.selectedOptionText,
            selectedOptionValue: readback.selectedOptionValue,
            activeDescendantText: readback.activeDescendantText,
            activeDescendantValue: readback.activeDescendantValue,
            readbackMethodsTried: readback.readbackMethodsTried,
            matchedVerificationSource,
            verificationFieldResolved: readback.verificationFieldResolved,
            verificationControlResolved: readback.verificationControlResolved,
            verificationControlState: readback.verificationControlState,
            renderedTextNodeFound: readback.renderedTextNodeFound,
            triggerNodeFound: readback.triggerNodeFound,
            backingInputFound: readback.backingInputFound,
            visibleInputFound: readback.visibleInputFound,
            readbackSourceDetails: readback.readbackSourceDetails,
            finalFailedReason: "",
          };
        }
      }

      const readback = lastReadback ?? readSingleSelectComboboxVerification(field);
      return {
        status: "failed",
        passed: false,
        reason: "verification missing control value",
        expectedRawValue,
        expectedNormalizedValue,
        actualRenderedText: readback.actualRenderedText,
        actualRenderedTextRaw: readback.actualRenderedTextRaw,
        actualRenderedTextNormalized: readback.actualRenderedTextNormalized,
        renderedTextCandidates: readback.renderedTextCandidates,
        renderedTextChosenFrom: readback.renderedTextChosenFrom,
        renderedTextExtractionMode: readback.renderedTextExtractionMode,
        actualTriggerText: readback.actualTriggerText,
        actualVisibleInputValue: readback.actualVisibleInputValue,
        actualBackingInputValue: readback.actualBackingInputValue,
        selectedOptionText: readback.selectedOptionText,
        selectedOptionValue: readback.selectedOptionValue,
        activeDescendantText: readback.activeDescendantText,
        activeDescendantValue: readback.activeDescendantValue,
        readbackMethodsTried: readback.readbackMethodsTried,
        matchedVerificationSource: "",
        verificationFieldResolved: readback.verificationFieldResolved,
        verificationControlResolved: readback.verificationControlResolved,
        verificationControlState: readback.verificationControlState,
        renderedTextNodeFound: readback.renderedTextNodeFound,
        triggerNodeFound: readback.triggerNodeFound,
        backingInputFound: readback.backingInputFound,
        visibleInputFound: readback.visibleInputFound,
        readbackSourceDetails: readback.readbackSourceDetails,
        finalFailedReason: "no readback source matched expected normalized value",
      };
    }

    const actual = readDynamicControlNormalizedValues(field);
    const passed = actual.includes(expectedNormalizedValue);
    return {
      status: passed ? "verified" : "failed",
      passed,
      reason: passed ? "" : "control state does not reflect expected value",
      expectedRawValue,
      expectedNormalizedValue,
      finalFailedReason: passed ? "" : "normalized value not found in generic control readback",
    };
  }

  function readDynamicControlNormalizedValues(field) {
    const values = [];
    const seen = new Set();

    function add(raw) {
      const normalized = normalizeOptionValue(raw);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(normalized);
    }

    const control = field?.control;
    if (!(control instanceof Element)) return values;

    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
      add(control.value);
      add(control.getAttribute("value"));
    } else if (control instanceof HTMLSelectElement) {
      add(control.value);
      const selected = control.selectedOptions?.[0];
      if (selected) {
        add(selected.value);
        add(selected.textContent || "");
      }
    } else {
      add(control.getAttribute("value"));
      add(control.getAttribute("aria-valuetext"));
      add(control.textContent || "");
    }

    const verificationScope =
      control.closest("div, section, fieldset, form") ?? control.parentElement ?? control;
    if (verificationScope instanceof Element) {
      const hiddenInputs = Array.from(
        verificationScope.querySelectorAll("input[type='hidden'][value], input[type='text'][value]")
      ).slice(0, 8);
      for (const input of hiddenInputs) {
        if (!(input instanceof HTMLInputElement)) continue;
        add(input.value);
        add(input.getAttribute("value"));
      }
    }

    return values;
  }

  function readSingleSelectComboboxVerification(field) {
    const readbackMethodsTried = [];
    const sourceDetails = [];
    const resolved = resolveVerificationFieldContext(field);
    const control = resolved.control;
    const scope = resolved.scope;
    const verificationFieldResolved = resolved.fieldResolved;
    const verificationControlResolved = resolved.controlResolved;
    const verificationControlState = resolved.controlState;

    let actualRenderedText = "";
    let actualRenderedTextRaw = "";
    let actualRenderedTextNormalized = "";
    let renderedTextCandidates = [];
    let renderedTextChosenFrom = "";
    let renderedTextExtractionMode = "fallback";
    let actualTriggerText = "";
    let actualVisibleInputValue = "";
    let actualBackingInputValue = "";
    let selectedOptionText = "";
    let selectedOptionValue = "";
    let activeDescendantText = "";
    let activeDescendantValue = "";

    if (control instanceof Element) {
      readbackMethodsTried.push("rendered_control_text");
      const renderedExtraction = extractCollapsedControlRenderedText(control);
      actualRenderedText = renderedExtraction.text;
      actualRenderedTextRaw = renderedExtraction.raw;
      actualRenderedTextNormalized = normalizeOptionValue(renderedExtraction.text);
      renderedTextCandidates = renderedExtraction.candidates;
      renderedTextChosenFrom = renderedExtraction.chosenFrom;
      renderedTextExtractionMode = renderedExtraction.mode;
      sourceDetails.push({
        method: "rendered_control_text",
        nodeFound: Boolean(renderedExtraction.text),
        value: actualRenderedText,
      });

      readbackMethodsTried.push("trigger_button_text");
      const trigger =
        control.matches("button, [role='button']")
          ? control
          : control.querySelector("button, [role='button']");
      if (trigger instanceof Element) {
        actualTriggerText = cleanCategoryStage(trigger.innerText || trigger.textContent || "");
        sourceDetails.push({
          method: "trigger_button_text",
          nodeFound: true,
          value: actualTriggerText,
        });
      } else {
        sourceDetails.push({ method: "trigger_button_text", nodeFound: false, value: "" });
      }

      readbackMethodsTried.push("visible_input_value");
      const visibleInput = control.querySelector("input:not([type='hidden'])");
      if (visibleInput instanceof HTMLInputElement && isVisible(visibleInput)) {
        actualVisibleInputValue = cleanCategoryStage(visibleInput.value || "");
        sourceDetails.push({
          method: "visible_input_value",
          nodeFound: true,
          value: actualVisibleInputValue,
        });
      } else {
        sourceDetails.push({ method: "visible_input_value", nodeFound: false, value: "" });
      }

      readbackMethodsTried.push("active_descendant");
      const activeDescendantId =
        visibleInput instanceof HTMLInputElement
          ? visibleInput.getAttribute("aria-activedescendant")
          : null;
      if (activeDescendantId) {
        const activeDescendant = document.getElementById(activeDescendantId);
        if (activeDescendant instanceof Element) {
          activeDescendantText = cleanCategoryStage(
            activeDescendant.innerText || activeDescendant.textContent || ""
          );
          activeDescendantValue = cleanCategoryStage(
            activeDescendant.getAttribute("data-value") || activeDescendant.getAttribute("value") || ""
          );
          sourceDetails.push({
            method: "active_descendant",
            nodeFound: true,
            value: `${activeDescendantText} ${activeDescendantValue}`.trim(),
          });
        } else {
          sourceDetails.push({ method: "active_descendant", nodeFound: false, value: "" });
        }
      } else {
        sourceDetails.push({ method: "active_descendant", nodeFound: false, value: "" });
      }
    } else {
      sourceDetails.push({ method: "rendered_control_text", nodeFound: false, value: "" });
      sourceDetails.push({ method: "trigger_button_text", nodeFound: false, value: "" });
      sourceDetails.push({ method: "visible_input_value", nodeFound: false, value: "" });
      sourceDetails.push({ method: "active_descendant", nodeFound: false, value: "" });
    }

    if (scope instanceof Element) {
      readbackMethodsTried.push("backing_input_value");
      const backingInput = scope.querySelector("input[type='hidden'][value], input[value]");
      if (backingInput instanceof HTMLInputElement) {
        actualBackingInputValue = cleanCategoryStage(backingInput.value || "");
        sourceDetails.push({
          method: "backing_input_value",
          nodeFound: true,
          value: actualBackingInputValue,
        });
      } else {
        sourceDetails.push({ method: "backing_input_value", nodeFound: false, value: "" });
      }

      readbackMethodsTried.push("selected_option_text_value");
      const selectedOption = scope.querySelector(
        "[aria-selected='true'][role='option'], option:checked"
      );
      if (selectedOption instanceof Element) {
        selectedOptionText = cleanCategoryStage(
          selectedOption.innerText || selectedOption.textContent || ""
        );
        selectedOptionValue = cleanCategoryStage(
          selectedOption.getAttribute("data-value") ||
            selectedOption.getAttribute("value") ||
            ""
        );
        sourceDetails.push({
          method: "selected_option_text_value",
          nodeFound: true,
          value: `${selectedOptionText} ${selectedOptionValue}`.trim(),
        });
      } else {
        sourceDetails.push({ method: "selected_option_text_value", nodeFound: false, value: "" });
      }
    } else {
      sourceDetails.push({ method: "backing_input_value", nodeFound: false, value: "" });
      sourceDetails.push({ method: "selected_option_text_value", nodeFound: false, value: "" });
    }

    return {
      actualRenderedText,
      actualRenderedTextRaw,
      actualRenderedTextNormalized,
      renderedTextCandidates,
      renderedTextChosenFrom,
      renderedTextExtractionMode,
      actualTriggerText,
      actualVisibleInputValue,
      actualBackingInputValue,
      selectedOptionText,
      selectedOptionValue,
      activeDescendantText,
      activeDescendantValue,
      readbackMethodsTried,
      verificationFieldResolved,
      verificationControlResolved,
      verificationControlState,
      renderedTextNodeFound: Boolean(renderedTextChosenFrom),
      triggerNodeFound: sourceDetails.some(
        (detail) => detail.method === "trigger_button_text" && detail.nodeFound
      ),
      backingInputFound: sourceDetails.some(
        (detail) => detail.method === "backing_input_value" && detail.nodeFound
      ),
      visibleInputFound: sourceDetails.some(
        (detail) => detail.method === "visible_input_value" && detail.nodeFound
      ),
      readbackSourceDetails: sourceDetails,
    };
  }

  function extractCollapsedControlRenderedText(control) {
    const directRaw = String(control.innerText || control.textContent || "");
    const directText = cleanCategoryStage(directRaw);
    if (directText) {
      return {
        text: directText,
        raw: directRaw,
        normalized: normalizeOptionValue(directText),
        mode: "direct_node",
        chosenFrom: describeVerificationNode(control),
        candidates: [directText],
      };
    }

    const candidates = [];
    const seen = new Set();
    const nodes = [control, ...Array.from(control.querySelectorAll("*"))];

    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      if (!isVisible(node)) continue;
      if (node.matches("svg, path, use, img")) continue;
      if (node.getAttribute("aria-hidden") === "true") continue;

      const raw = String(node.innerText || node.textContent || "");
      const cleaned = cleanCategoryStage(raw);
      if (!cleaned) continue;
      if (/^[\s\-–—_•·|:()[\]{}.,/\\]+$/.test(cleaned)) continue;

      const normalized = normalizeOptionValue(cleaned);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      candidates.push({
        text: cleaned,
        raw,
        normalized,
        from: describeVerificationNode(node),
      });
    }

    if (candidates.length) {
      const chosen = candidates[0];
      return {
        text: chosen.text,
        raw: chosen.raw,
        normalized: chosen.normalized,
        mode: "descendant_scan",
        chosenFrom: chosen.from,
        candidates: candidates.map((candidate) => candidate.text).slice(0, 8),
      };
    }

    return {
      text: "",
      raw: "",
      normalized: "",
      mode: "fallback",
      chosenFrom: "",
      candidates: [],
    };
  }

  function describeVerificationNode(node) {
    if (!(node instanceof Element)) return "";
    const tag = node.tagName.toLowerCase();
    const testId = node.getAttribute("data-testid");
    if (testId) return `${tag}[data-testid="${testId}"]`;
    const role = node.getAttribute("role");
    if (role) return `${tag}[role="${role}"]`;
    const className = typeof node.className === "string" ? node.className.trim() : "";
    if (className) {
      const firstClass = className.split(/\s+/).filter(Boolean)[0];
      if (firstClass) return `${tag}.${firstClass}`;
    }
    return tag;
  }

  function resolveVerificationFieldContext(field) {
    const normalizedLabel = normalizeText(field?.normalizedLabel ?? field?.label ?? "");
    const allLabels = Array.from(document.querySelectorAll("label")).filter(
      (label) => label instanceof Element && isVisible(label)
    );
    const exactLabelMatch = allLabels.find(
      (label) => normalizeText(cleanCategoryStage(label.textContent || "")) === normalizedLabel
    );
    const labelEl = exactLabelMatch ?? null;

    const container =
      labelEl?.closest("div, section, fieldset, form") ??
      (field?.control instanceof Element
        ? field.control.closest("div, section, fieldset, form")
        : null) ??
      (field?.control instanceof Element ? field.control : null);

    let control = null;
    if (container instanceof Element) {
      const resolvedControl = findControlForVisibleLabel(labelEl ?? container, container);
      if (resolvedControl instanceof Element) {
        control = resolvedControl;
      }
    }
    if (!(control instanceof Element) && field?.control instanceof Element) {
      control = field.control;
    }

    let controlState = "unknown";
    if (control instanceof Element) {
      const expanded = control.getAttribute("aria-expanded");
      if (expanded === "true" || control.className.includes("menu-is-open")) {
        controlState = "open";
      } else if (expanded === "false" || control.className.includes("react-select__control")) {
        controlState = "collapsed";
      }
    }

    return {
      fieldResolved: labelEl instanceof Element,
      controlResolved: control instanceof Element,
      controlState,
      control,
      scope: container,
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
    if (!(control instanceof Element)) return false;
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

    const scope = control.closest("div, section, fieldset, form") ?? control.parentElement ?? control;
    const scopeText = normalizeText(scope?.textContent || "");
    if (scopeText.includes("add up to") || scopeText.includes("add up")) return true;
    if (scopeText.includes("add tag") || scopeText.includes("add value")) return true;

    const multiChip = control.querySelector(
      ".react-select__multi-value, [class*='multi-value'], [class*='chip']"
    );
    if (multiChip instanceof Element) return true;

    const scopeMultiChip =
      scope instanceof Element
        ? scope.querySelector(".react-select__multi-value, [class*='chip'], [class*='token']")
        : null;
    return scopeMultiChip instanceof Element;
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
    const {
      filled,
      needsReview,
      skippedForSafety,
      photoStageDiagnostics,
      marketplaceStageDiagnostics,
    } = input;
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
    if (photoStageDiagnostics) {
      lines.push(
        `Photo stage: ${photoStageDiagnostics.photoStageStatus}; ` +
          `expected: ${photoStageDiagnostics.expectedPhotoCount}; observed: ${photoStageDiagnostics.uploadedPhotoCountObserved}; ` +
          `reason: ${photoStageDiagnostics.uploadVerificationReason || "none"}`
      );
    }
    if (marketplaceStageDiagnostics) {
      lines.push(
        `Marketplace stage: ${marketplaceStageDiagnostics.marketplaceStageStatus}; ` +
          `target: ${marketplaceStageDiagnostics.targetMarketplace}; ` +
          `activation: ${marketplaceStageDiagnostics.marketplaceActivationPassed ? "passed" : "failed"}; ` +
          `ready: ${marketplaceStageDiagnostics.marketplaceReadyPassed ? "passed" : "failed"}; ` +
          `reason: ${marketplaceStageDiagnostics.marketplaceReadyReason || marketplaceStageDiagnostics.marketplaceActivationReason || "none"}`
      );
    }

    lastRunEl.textContent = lines.join("\n");
  }

  function pickPayloadPhotos(payload) {
    const raw = payload?.photos;
    if (!Array.isArray(raw)) return [];

    return raw
      .map((photo, index) => {
        if (!photo || typeof photo !== "object") return null;
        return {
          index:
            typeof photo.index === "number" && Number.isFinite(photo.index)
              ? photo.index
              : index,
          name: typeof photo.name === "string" ? photo.name.trim() : "",
          type: typeof photo.type === "string" ? photo.type.trim() : "",
          size:
            typeof photo.size === "number" && Number.isFinite(photo.size) && photo.size >= 0
              ? photo.size
              : 0,
          dataUrl: typeof photo.dataUrl === "string" ? photo.dataUrl.trim() : "",
        };
      })
      .filter(Boolean);
  }

  async function resolvePhotoPayloadForRun(payload) {
    const persistedPhotos = pickPayloadPhotos(payload);
    const persistedWithData = persistedPhotos.filter(
      (photo) => typeof photo.dataUrl === "string" && photo.dataUrl
    );
    const persistedMetadataOnly =
      persistedPhotos.length > 0 && persistedWithData.length === 0;

    let transientPhotos = [];
    let transientPhotoPayloadSource = "none";
    const transientStore = window[TRANSIENT_PHOTO_KEY];
    if (transientStore && typeof transientStore === "object" && Array.isArray(transientStore.photos)) {
      transientPhotos = transientStore.photos
        .map((photo, index) => {
          if (!photo || typeof photo !== "object") return null;
          const dataUrl =
            typeof photo.dataUrl === "string" ? photo.dataUrl.trim() : "";
          if (!dataUrl) return null;
          return {
            index:
              typeof photo.index === "number" && Number.isFinite(photo.index)
                ? photo.index
                : index,
            name: typeof photo.name === "string" ? photo.name.trim() : "",
            type: typeof photo.type === "string" ? photo.type.trim() : "",
            size:
              typeof photo.size === "number" &&
              Number.isFinite(photo.size) &&
              photo.size >= 0
                ? photo.size
                : 0,
            dataUrl,
          };
        })
        .filter(Boolean);
      transientPhotoPayloadSource = transientPhotos.length ? "window_memory" : "none";
    }

    if (!transientPhotos.length) {
      const extensionTransient = await getTransientPhotosFromExtension();
      transientPhotos = extensionTransient.photos;
      transientPhotoPayloadSource = extensionTransient.source;
    }

    const fallbackByIndex = new Map(transientPhotos.map((photo) => [photo.index, photo]));
    const fallbackByName = new Map(
      transientPhotos
        .filter((photo) => photo.name)
        .map((photo) => [normalizeText(photo.name), photo])
    );

    const merged = persistedPhotos
      .map((photo) => {
        if (photo.dataUrl) return photo;
        const byIndex = fallbackByIndex.get(photo.index);
        if (byIndex) return { ...photo, dataUrl: byIndex.dataUrl };
        const byName = photo.name ? fallbackByName.get(normalizeText(photo.name)) : null;
        if (byName) return { ...photo, dataUrl: byName.dataUrl };
        return null;
      })
      .filter(Boolean);

    const usablePhotos = persistedWithData.length
      ? persistedWithData
      : merged.length
        ? merged
        : transientPhotos;

    return {
      photos: usablePhotos,
      transientPhotoPayloadPresent: transientPhotos.length > 0,
      transientPhotoPayloadSource,
      transientPhotoCountResolved: transientPhotos.length,
      persistedPhotoMetadataOnly: persistedMetadataOnly,
      photoPayloadStrippedForStorage: persistedMetadataOnly,
      photoCount: persistedPhotos.length || transientPhotos.length,
      storedPayloadByteEstimate:
        typeof payload?.meta?.storedPayloadByteEstimate === "number"
          ? payload.meta.storedPayloadByteEstimate
          : -1,
    };
  }

  async function getTransientPhotosFromExtension() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_TRANSIENT_PHOTOS" }, (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError || !response?.ok) {
          resolve({ photos: [], source: "extension_channel_missing" });
          return;
        }

        const photos = Array.isArray(response?.record?.photos)
          ? response.record.photos
              .map((photo, index) => {
                if (!photo || typeof photo !== "object") return null;
                const dataUrl =
                  typeof photo.dataUrl === "string" ? photo.dataUrl.trim() : "";
                if (!dataUrl) return null;
                return {
                  index:
                    typeof photo.index === "number" && Number.isFinite(photo.index)
                      ? photo.index
                      : index,
                  name: typeof photo.name === "string" ? photo.name.trim() : "",
                  type: typeof photo.type === "string" ? photo.type.trim() : "",
                  size:
                    typeof photo.size === "number" &&
                    Number.isFinite(photo.size) &&
                    photo.size >= 0
                      ? photo.size
                      : 0,
                  dataUrl,
                };
              })
              .filter(Boolean)
          : [];

        resolve({
          photos,
          source: photos.length ? "extension_transient_store" : "extension_transient_empty",
        });
      });
    });
  }

  function findVendooUploadSurface() {
    const fileInputs = Array.from(document.querySelectorAll("input[type='file']")).filter(
      (input) => input instanceof HTMLInputElement && isVisible(input)
    );

    const bestFileInput = fileInputs
      .map((input) => {
        const scope = input.closest("section, form, fieldset, [role='region'], div") ?? document;
        const metadata = normalizeText(
          [
            input.getAttribute("accept"),
            input.getAttribute("name"),
            input.getAttribute("id"),
            input.getAttribute("aria-label"),
            scope instanceof Element ? scope.textContent || "" : "",
          ]
            .filter(Boolean)
            .join(" ")
        );
        let score = 0;
        if (metadata.includes("image")) score += 3;
        if (metadata.includes("photo")) score += 3;
        if (metadata.includes("upload")) score += 2;
        if (metadata.includes("media")) score += 1;
        return { input, score, scope };
      })
      .sort((a, b) => b.score - a.score)[0];

    if (bestFileInput) {
      return {
        detected: true,
        type: "file_input",
        fileInput: bestFileInput.input,
        scope: bestFileInput.scope,
        dropzoneNode: null,
      };
    }

    const uploadButton = Array.from(
      document.querySelectorAll("button, [role='button'], [aria-label]")
    ).find((element) => {
      if (!(element instanceof Element)) return false;
      if (!isVisible(element)) return false;
      const text = normalizeText(
        [
          element.textContent || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
        ].join(" ")
      );
      return text.includes("upload") && (text.includes("photo") || text.includes("image"));
    });

    if (uploadButton) {
      return {
        detected: true,
        type: "upload_button_no_input",
        fileInput: null,
        scope: uploadButton.closest("section, form, fieldset, [role='region'], div") ?? document,
        dropzoneNode: uploadButton,
      };
    }

    const dropzone = Array.from(
      document.querySelectorAll(
        "[data-testid*='drop'], [class*='dropzone'], [aria-label*='drop'], [aria-label*='upload']"
      )
    ).find((element) => element instanceof Element && isVisible(element));

    if (dropzone instanceof Element) {
      return {
        detected: true,
        type: "dropzone_no_input",
        fileInput: null,
        scope: dropzone,
        dropzoneNode: dropzone,
      };
    }

    return {
      detected: false,
      type: "none",
      fileInput: null,
      scope: document,
      dropzoneNode: null,
    };
  }

  function resolveAssociatedUploadFileInput(uploadSurface) {
    const localRoots = [];
    if (uploadSurface?.dropzoneNode instanceof Element) {
      localRoots.push(uploadSurface.dropzoneNode);
      if (uploadSurface.dropzoneNode.parentElement) {
        localRoots.push(uploadSurface.dropzoneNode.parentElement);
      }
    }
    if (uploadSurface?.scope instanceof Element) {
      localRoots.push(uploadSurface.scope);
      if (uploadSurface.scope.parentElement) {
        localRoots.push(uploadSurface.scope.parentElement);
      }
    }

    for (const root of localRoots) {
      const localInput = root.querySelector("input[type='file']");
      if (localInput instanceof HTMLInputElement) {
        return localInput;
      }
    }

    const globalInputs = Array.from(document.querySelectorAll("input[type='file']"));
    const scopedMetadata = normalizeText(
      [
        uploadSurface?.scope instanceof Element ? uploadSurface.scope.className : "",
        uploadSurface?.scope instanceof Element
          ? uploadSurface.scope.getAttribute("aria-label") || ""
          : "",
        uploadSurface?.dropzoneNode instanceof Element
          ? uploadSurface.dropzoneNode.className
          : "",
        uploadSurface?.dropzoneNode instanceof Element
          ? uploadSurface.dropzoneNode.getAttribute("aria-label") || ""
          : "",
      ].join(" ")
    );

    for (const input of globalInputs) {
      if (!(input instanceof HTMLInputElement)) continue;
      const metadata = normalizeText(
        [
          input.getAttribute("accept"),
          input.getAttribute("name"),
          input.getAttribute("id"),
          input.getAttribute("aria-label"),
          input.className,
        ]
          .filter(Boolean)
          .join(" ")
      );
      if (
        metadata.includes("image") ||
        metadata.includes("photo") ||
        metadata.includes("upload") ||
        (scopedMetadata && metadata && scopedMetadata.includes(metadata))
      ) {
        return input;
      }
    }

    return null;
  }

  function assignFilesToInput(fileInput, files) {
    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dispatchDropzoneUpload(dropzoneNode, files) {
    if (!(dropzoneNode instanceof Element)) {
      return { attempted: false, reason: "dropzone node missing" };
    }

    const transfer = new DataTransfer();
    for (const file of files) {
      transfer.items.add(file);
    }

    const eventTypes = ["dragenter", "dragover", "drop"];
    try {
      for (const type of eventTypes) {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        });
        dropzoneNode.dispatchEvent(event);
      }
      return { attempted: true, reason: "dropzone datatransfer dispatched" };
    } catch {
      try {
        for (const type of eventTypes) {
          const fallbackEvent = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(fallbackEvent, "dataTransfer", {
            value: transfer,
            enumerable: true,
          });
          dropzoneNode.dispatchEvent(fallbackEvent);
        }
        return { attempted: true, reason: "dropzone fallback events dispatched" };
      } catch {
        return { attempted: false, reason: "dropzone dispatch failed" };
      }
    }
  }

  function buildFilesFromPhotoPayload(photos) {
    const files = [];

    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      if (!photo?.dataUrl || typeof photo.dataUrl !== "string") continue;
      const built = buildFileFromDataUrl(photo, index);
      if (built) files.push(built);
    }

    return files;
  }

  function buildFileFromDataUrl(photo, index) {
    const dataUrl = String(photo.dataUrl ?? "");
    const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/);
    if (!match) return null;

    try {
      const mimeType = (photo.type || match[1] || "image/jpeg").trim();
      const base64 = match[2];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }

      const name = photo.name?.trim() || `photo-${index + 1}.${mimeType.split("/")[1] || "jpg"}`;
      return new File([bytes], name, { type: mimeType });
    } catch {
      return null;
    }
  }

  async function verifyPhotoUpload(input) {
    const { scope, fileInput, expectedCount, initialObservedCount } = input;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (attempt > 0) {
        await wait(180);
      }

      const currentObservedCount = countUploadedPhotoEvidence(scope);
      const acceptedCount = fileInput?.files?.length ?? 0;
      const uploadInProgress = hasUploadInProgress(scope);

      if (currentObservedCount >= Math.max(expectedCount, initialObservedCount + expectedCount)) {
        return {
          passed: true,
          reason: "visible photo previews observed",
          uploadedPhotoCountObserved: currentObservedCount,
        };
      }

      if (acceptedCount >= expectedCount && !uploadInProgress) {
        return {
          passed: true,
          reason: "file input accepted expected photo count",
          uploadedPhotoCountObserved: currentObservedCount || acceptedCount,
        };
      }
    }

    const finalObservedCount = countUploadedPhotoEvidence(scope);
    const finalAcceptedCount = fileInput?.files?.length ?? 0;
    return {
      passed: false,
      reason:
        finalAcceptedCount >= expectedCount
          ? "accepted files but upload verification not confirmed"
          : "input did not reflect expected photo count",
      uploadedPhotoCountObserved: finalObservedCount || finalAcceptedCount,
    };
  }

  function countUploadedPhotoEvidence(scope) {
    const root = scope instanceof Element ? scope : document;
    const selectors = [
      '[data-testid*="photo"] img',
      '[data-testid*="image"] img',
      '[class*="photo"] img',
      '[class*="image"] img',
      'img[src^="blob:"]',
      'img[src^="data:image/"]',
    ];
    const seen = new Set();
    let count = 0;

    for (const selector of selectors) {
      const images = Array.from(root.querySelectorAll(selector));
      for (const image of images) {
        if (!(image instanceof HTMLImageElement)) continue;
        if (!isVisible(image)) continue;
        if (seen.has(image)) continue;
        seen.add(image);
        const src = image.getAttribute("src") || "";
        if (!src) continue;
        count += 1;
      }
    }

    return count;
  }

  function hasUploadInProgress(scope) {
    const root = scope instanceof Element ? scope : document;
    const busy = root.querySelector(
      '[aria-busy="true"], [data-loading="true"], [class*="loading"], [class*="progress"]'
    );
    return busy instanceof Element && isVisible(busy);
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
