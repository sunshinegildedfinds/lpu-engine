(() => {
  if (window.__LPU_VENDOO_PAGE_BRIDGE__) return;
  window.__LPU_VENDOO_PAGE_BRIDGE__ = true;

  const PANEL_ID = "lpu-vendoo-panel";
  const TRANSIENT_PHOTO_KEY = "__LPU_VENDOO_TRANSIENT_PHOTO_PAYLOAD__";
  let lastPoshmarkStageOpenState = {
    formReadyDetected: false,
    activeDetected: false,
    savedAt: 0,
  };
  let lastPoshmarkCategoryInput = {
    sourcePath: "",
    rawValue: "",
    normalizedValue: "",
  };
  let lastEtsyCategoryInput = {
    sourcePath: "",
    rawValue: "",
    normalizedValue: "",
  };

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

    if (!canUseChromeRuntimeMessaging()) {
      reportEl.textContent = "Clear failed: extension messaging unavailable.";
      return;
    }

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

    const receivedResolvedPrice =
      typeof payload?.resolvedPrice === "string" ? payload.resolvedPrice : "";
    const receivedConditionRaw =
      typeof payload?.marketplaces?.ebay?.itemSpecifics?.condition === "string"
        ? payload.marketplaces.ebay.itemSpecifics.condition.trim()
        : typeof payload?.marketplaces?.ebay?.itemSpecifics?.itemCondition === "string"
          ? payload.marketplaces.ebay.itemSpecifics.itemCondition.trim()
        : typeof payload?.marketplaces?.ebay?.condition === "string"
          ? payload.marketplaces.ebay.condition.trim()
          : typeof payload?.marketplaces?.ebay?.itemCondition === "string"
            ? payload.marketplaces.ebay.itemCondition.trim()
          : "";
    console.debug("[Vendoo][ReceivedPayload]", {
      hasResolvedPrice: Boolean(receivedResolvedPrice),
      resolvedPrice: receivedResolvedPrice,
      hasPricing: Boolean(payload?.pricing && typeof payload.pricing === "object"),
      topLevelPayloadKeys:
        payload && typeof payload === "object" ? Object.keys(payload) : [],
    });
    console.debug("[Vendoo][VendooBaseTagsReceive]", {
      hasVendooBaseTags:
        Array.isArray(payload?.vendooBaseTags) && payload.vendooBaseTags.length > 0,
      vendooBaseTags: Array.isArray(payload?.vendooBaseTags) ? payload.vendooBaseTags : [],
      topLevelPayloadKeys:
        payload && typeof payload === "object" ? Object.keys(payload) : [],
    });
    const depopBlock = payload?.depop ?? payload?.marketplaces?.depop;
    const depopDescription =
      typeof depopBlock?.description === "string" ? depopBlock.description.trim() : "";
    const depopHashtags =
      typeof depopBlock?.hashtags === "string" ? depopBlock.hashtags.trim() : "";
    const depopSize = typeof depopBlock?.size === "string" ? depopBlock.size.trim() : "";
    const depopBrand = typeof depopBlock?.brand === "string" ? depopBlock.brand.trim() : "";
    const depopStyle = typeof depopBlock?.style === "string" ? depopBlock.style.trim() : "";
    console.debug("[Vendoo][DepopPayload]", {
      hasDepopBlock: Boolean(depopBlock && typeof depopBlock === "object"),
      depopTopLevelKeys: depopBlock && typeof depopBlock === "object" ? Object.keys(depopBlock) : [],
      descriptionLike: {
        path: depopDescription ? "payload.depop.description|payload.marketplaces.depop.description" : "",
        present: Boolean(depopDescription),
      },
      hashtagsLike: {
        path: depopHashtags ? "payload.depop.hashtags|payload.marketplaces.depop.hashtags" : "",
        present: Boolean(depopHashtags),
      },
      sizeLike: {
        path: depopSize ? "payload.depop.size|payload.marketplaces.depop.size" : "",
        value: depopSize,
      },
      brandLike: {
        path: depopBrand ? "payload.depop.brand|payload.marketplaces.depop.brand" : "",
        value: depopBrand,
      },
      styleLike: {
        path: depopStyle ? "payload.depop.style|payload.marketplaces.depop.style" : "",
        value: depopStyle,
      },
    });
    const poshmarkBlock = payload?.poshmark ?? payload?.marketplaces?.poshmark;
    const poshmarkTitle =
      typeof poshmarkBlock?.title === "string" ? poshmarkBlock.title.trim() : "";
    const poshmarkDescription =
      typeof poshmarkBlock?.description === "string" ? poshmarkBlock.description.trim() : "";
    const poshmarkStyleTags = Array.isArray(poshmarkBlock?.styleTags)
      ? poshmarkBlock.styleTags.filter((value) => typeof value === "string" && value.trim())
      : [];
    const poshmarkCategoryGuidance = resolvePoshmarkCategoryGuidance(payload);
    lastPoshmarkCategoryInput = {
      sourcePath: poshmarkCategoryGuidance.path,
      rawValue: poshmarkCategoryGuidance.value,
      normalizedValue: poshmarkCategoryGuidance.value
        ? normalizeText(poshmarkCategoryGuidance.value)
        : "",
    };
    console.debug("[Vendoo][PoshmarkPayload]", {
      hasPoshmarkBlock: Boolean(poshmarkBlock && typeof poshmarkBlock === "object"),
      poshmarkTopLevelKeys:
        poshmarkBlock && typeof poshmarkBlock === "object" ? Object.keys(poshmarkBlock) : [],
      titleLike: {
        path: poshmarkTitle ? "payload.poshmark.title|payload.marketplaces.poshmark.title" : "",
        present: Boolean(poshmarkTitle),
      },
      descriptionLike: {
        path:
          poshmarkDescription
            ? "payload.poshmark.description|payload.marketplaces.poshmark.description"
            : "",
        present: Boolean(poshmarkDescription),
      },
      styleTagsLike: {
        path:
          poshmarkStyleTags.length
            ? "payload.poshmark.styleTags|payload.marketplaces.poshmark.styleTags"
            : "",
        present: poshmarkStyleTags.length > 0,
      },
      categoryLike: {
        path: poshmarkCategoryGuidance.path,
        present: Boolean(poshmarkCategoryGuidance.value),
      },
    });
    console.debug("[Vendoo][PoshmarkCategoryInput]", {
      sourcePath: lastPoshmarkCategoryInput.sourcePath,
      rawValue: lastPoshmarkCategoryInput.rawValue,
      normalizedValue: lastPoshmarkCategoryInput.normalizedValue,
    });
    const etsyBlock = payload?.etsy ?? payload?.marketplaces?.etsy;
    const etsyTitle = typeof etsyBlock?.title === "string" ? etsyBlock.title.trim() : "";
    const etsyDescription =
      typeof etsyBlock?.description === "string" ? etsyBlock.description.trim() : "";
    const etsyCategoryPath =
      typeof etsyBlock?.categoryPath === "string" ? etsyBlock.categoryPath.trim() : "";
    const etsyMaterials =
      typeof etsyBlock?.materials === "string" ? etsyBlock.materials.trim() : "";
    const etsyTheme = typeof etsyBlock?.theme === "string" ? etsyBlock.theme.trim() : "";
    const etsyOccasion =
      typeof etsyBlock?.occasion === "string" ? etsyBlock.occasion.trim() : "";
    const etsyGemstone =
      typeof etsyBlock?.gemstone === "string" ? etsyBlock.gemstone.trim() : "";
    const etsyAge = typeof etsyBlock?.age === "string" ? etsyBlock.age.trim() : "";
    lastEtsyCategoryInput = {
      sourcePath: etsyCategoryPath
        ? (typeof payload?.etsy?.categoryPath === "string"
            ? "payload.etsy.categoryPath"
            : "payload.marketplaces.etsy.categoryPath")
        : "",
      rawValue: etsyCategoryPath,
      normalizedValue: etsyCategoryPath ? normalizeText(etsyCategoryPath) : "",
    };
    const etsyTags = Array.isArray(etsyBlock?.tags)
      ? etsyBlock.tags.filter((value) => typeof value === "string" && value.trim())
      : [];
    console.debug("[Vendoo][EtsyPayload]", {
      hasEtsyBlock: Boolean(etsyBlock && typeof etsyBlock === "object"),
      etsyTopLevelKeys: etsyBlock && typeof etsyBlock === "object" ? Object.keys(etsyBlock) : [],
      titleLike: {
        path: etsyTitle ? "payload.etsy.title|payload.marketplaces.etsy.title" : "",
        present: Boolean(etsyTitle),
      },
      descriptionLike: {
        path: etsyDescription
          ? "payload.etsy.description|payload.marketplaces.etsy.description"
          : "",
        present: Boolean(etsyDescription),
      },
      tagsLike: {
        path: etsyTags.length ? "payload.etsy.tags|payload.marketplaces.etsy.tags" : "",
        present: etsyTags.length > 0,
      },
      categoryLike: {
        path: etsyCategoryPath
          ? "payload.etsy.categoryPath|payload.marketplaces.etsy.categoryPath"
          : "",
        present: Boolean(etsyCategoryPath),
      },
      materialsLike: {
        path: etsyMaterials ? "payload.etsy.materials|payload.marketplaces.etsy.materials" : "",
        present: Boolean(etsyMaterials),
      },
      themeLike: {
        path: etsyTheme ? "payload.etsy.theme|payload.marketplaces.etsy.theme" : "",
        present: Boolean(etsyTheme),
      },
      occasionLike: {
        path: etsyOccasion ? "payload.etsy.occasion|payload.marketplaces.etsy.occasion" : "",
        present: Boolean(etsyOccasion),
      },
      gemstoneLike: {
        path: etsyGemstone ? "payload.etsy.gemstone|payload.marketplaces.etsy.gemstone" : "",
        present: Boolean(etsyGemstone),
      },
      ageLike: {
        path: etsyAge ? "payload.etsy.age|payload.marketplaces.etsy.age" : "",
        present: Boolean(etsyAge),
      },
    });
    console.debug("[Vendoo][ConditionPayload]", {
      hasConditionLikeValue: Boolean(receivedConditionRaw),
      conditionPath:
        typeof payload?.marketplaces?.ebay?.itemSpecifics?.condition === "string"
          ? "payload.marketplaces.ebay.itemSpecifics.condition"
          : typeof payload?.marketplaces?.ebay?.itemSpecifics?.itemCondition === "string"
            ? "payload.marketplaces.ebay.itemSpecifics.itemCondition"
          : typeof payload?.marketplaces?.ebay?.condition === "string"
            ? "payload.marketplaces.ebay.condition"
            : typeof payload?.marketplaces?.ebay?.itemCondition === "string"
              ? "payload.marketplaces.ebay.itemCondition"
            : "",
      rawValue: receivedConditionRaw,
      normalizedValue: receivedConditionRaw ? normalizeText(receivedConditionRaw) : "",
    });
    const receivedUsSizeRaw =
      typeof payload?.marketplaces?.ebay?.itemSpecifics?.size === "string"
        ? payload.marketplaces.ebay.itemSpecifics.size.trim()
        : typeof payload?.marketplaces?.ebay?.size === "string"
          ? payload.marketplaces.ebay.size.trim()
          : "";
    console.debug("[Vendoo][BaseUSSizePayload]", {
      hasSizeLikeValue: Boolean(receivedUsSizeRaw),
      sizePath:
        typeof payload?.marketplaces?.ebay?.itemSpecifics?.size === "string"
          ? "payload.marketplaces.ebay.itemSpecifics.size"
          : typeof payload?.marketplaces?.ebay?.size === "string"
            ? "payload.marketplaces.ebay.size"
            : "",
      rawValue: receivedUsSizeRaw,
      normalizedValue: receivedUsSizeRaw ? normalizeText(receivedUsSizeRaw) : "",
    });

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
    const marketplaceOrderDiagnostics = {
      baseCompleted: false,
      ebayStarted: false,
      ebayCompleted: false,
      depopStarted: false,
      depopBlockedReason: "",
    };
    const photoStageDiagnostics = await runPhotoUploadStage(payload);
    const baseStageDiagnostics = await runBaseGeneralVendooStage({
      fillSteps,
      adapters,
      actionModel,
      runState,
      usedElements,
      payload,
      selectors,
    });
    marketplaceOrderDiagnostics.baseCompleted = Boolean(
      baseStageDiagnostics.baseStageCompletedBeforeMarketplaceSwitch
    );
    const baseConditionDiagnostics = await fillBaseConditionIfPresent({
      payload,
      usedElements,
      selectors,
    });
    runState.diagnosticsByField.baseCondition = baseConditionDiagnostics;
    if (baseConditionDiagnostics.status === "filled") {
      runState.filled.push("Condition");
    } else if (baseConditionDiagnostics.status === "needs_review") {
      runState.needsReview.push(`Condition (${baseConditionDiagnostics.reason})`);
    } else if (baseConditionDiagnostics.status === "skipped_for_safety") {
      runState.skippedForSafety.push(`Condition (${baseConditionDiagnostics.reason})`);
    }
    const marketplaceStageDiagnostics = await runMarketplaceActivationStage({
      targetMarketplace: "ebay",
      selectors,
      preMarketplaceBaseStageCompleted: baseStageDiagnostics.baseStageCompleted,
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

    const listingPriceDiagnostics = await fillResolvedListingPriceIfPresent({
      payload,
      usedElements,
    });
    runState.diagnosticsByField.listingPrice = listingPriceDiagnostics;
    if (listingPriceDiagnostics.status === "filled") {
      runState.filled.push("Listing Price");
    } else if (listingPriceDiagnostics.status === "needs_review") {
      runState.needsReview.push(`Listing Price (${listingPriceDiagnostics.reason})`);
    } else if (listingPriceDiagnostics.status === "skipped_for_safety") {
      runState.skippedForSafety.push(`Listing Price (${listingPriceDiagnostics.reason})`);
    }

    if (!marketplaceStageDiagnostics.handoffToMarketplaceFill) {
      marketplaceOrderDiagnostics.depopBlockedReason = "ebay_stage_not_ready";
      console.debug("[Vendoo][MarketplaceOrder]", marketplaceOrderDiagnostics);
      runState.needsReview.push(
        `Marketplace stage (${marketplaceStageDiagnostics.marketplaceReadyReason || marketplaceStageDiagnostics.marketplaceActivationReason || "marketplace not ready"})`
      );
      reportEl.textContent = "Fill run completed.";
      renderLastRunResults({
        filled: runState.filled,
        needsReview: runState.needsReview,
        skippedForSafety: runState.skippedForSafety,
        photoStageDiagnostics,
        listingPriceDiagnostics,
        baseStageDiagnostics,
        marketplaceStageDiagnostics,
      });
      await refreshPanel();
      return;
    }
    marketplaceOrderDiagnostics.ebayStarted = true;

    for (const step of fillSteps) {
      if (
        isBaseGeneralFieldKey(step.key) &&
        runState.stepOutcomes[step.key] === "filled"
      ) {
        continue;
      }
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
            marketplaceHint: typeof action.marketplace === "string" ? action.marketplace : "",
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
    marketplaceOrderDiagnostics.ebayCompleted = true;

    if (marketplaceOrderDiagnostics.ebayStarted && marketplaceOrderDiagnostics.ebayCompleted) {
      marketplaceOrderDiagnostics.depopStarted = true;
      await ensureDepopStageOpenForDepopFill();
      await ensureDepopOptionalFieldsOpenForDepopFill();
      await fillDepopSizeIfPresent({
        payload,
        usedElements,
      });
      await fillDepopDescriptionIfPresent({
        payload,
        usedElements,
      });
      await fillDepopTagsIfPresent({
        payload,
        usedElements,
      });
      await ensurePoshmarkStageOpenForPoshmarkFill();
      await fillPoshmarkAdjustedPriceIfPresent({
        payload,
        usedElements,
      });
      await ensureEtsyStageOpenForEtsyFill(payload);
      await ensureEtsyOptionalFieldsOpenForEtsyFill();
      await runMarketplaceSpecificsPass({
        marketplace: "etsy",
        payload,
        root: resolveMarketplaceSpecificsRoot("etsy"),
        usedElements,
        selectors,
      });
      await fillEtsyTitleAndDescriptionIfPresent({
        payload,
        usedElements,
      });
      await fillEtsyAdjustedPriceIfPresent({
        payload,
        usedElements,
      });
      await fillEtsyTagsIfPresent({
        payload,
        usedElements,
      });
    } else {
      marketplaceOrderDiagnostics.depopBlockedReason = "ebay_stage_not_completed";
    }
    console.debug("[Vendoo][MarketplaceOrder]", marketplaceOrderDiagnostics);

    reportEl.textContent = "Fill run completed.";
    renderLastRunResults({
      filled: runState.filled,
      needsReview: runState.needsReview,
      skippedForSafety: runState.skippedForSafety,
      photoStageDiagnostics,
      listingPriceDiagnostics,
      baseStageDiagnostics,
      marketplaceStageDiagnostics,
    });
    await refreshPanel();
  }

  async function fillResolvedListingPriceIfPresent(input) {
    const { payload, usedElements } = input;
    const resolvedPriceRaw =
      typeof payload?.resolvedPrice === "string" ? payload.resolvedPrice.trim() : "";
    const baseDiagnostic = {
      fieldLabel: "Listing Price",
      payloadKey: "resolvedPrice",
      controlFamily: "text_input",
      status: "skipped_for_safety",
      reason: "",
      expectedValue: resolvedPriceRaw || "",
      actualValue: "",
    };

    try {
      if (!resolvedPriceRaw) {
        const result = {
          ...baseDiagnostic,
          status: "skipped_for_safety",
          reason: "resolvedPrice missing",
        };
        console.debug("[Vendoo][ListingPrice]", result);
        return result;
      }

      if (!isValidResolvedPrice(resolvedPriceRaw)) {
        const result = {
          ...baseDiagnostic,
          status: "skipped_for_safety",
          reason: "resolvedPrice invalid",
        };
        console.debug("[Vendoo][ListingPrice]", result);
        return result;
      }

      const discovery = await findListingPriceInputWithFallback();
      console.debug("[Vendoo][ListingPriceDiscovery]", {
        exactSelectorMatchCount: discovery.exactSelectorMatchCount,
        usedFallback: discovery.usedFallback,
        fallbackFound: discovery.fallbackFound,
      });
      const inputField = discovery.inputField;
      if (!(inputField instanceof HTMLInputElement)) {
        const ebayPriceResult = await tryFillEbayBuyItNowPriceIfApplicable({
          resolvedPriceRaw,
          usedElements,
        });
        if (ebayPriceResult) {
          return ebayPriceResult;
        }
        logListingPriceDomSnapshot();
        logListingPriceGlobalSearch();
        const result = {
          ...baseDiagnostic,
          status: "needs_review",
          reason: "Listing Price field not found",
        };
        console.debug("[Vendoo][ListingPrice]", result);
        return result;
      }

      if (usedElements.has(inputField)) {
        const result = {
          ...baseDiagnostic,
          status: "skipped_for_safety",
          reason: "collision prevention",
        };
        console.debug("[Vendoo][ListingPrice]", result);
        return result;
      }

      const verifyResult = await fillAndVerifyPriceInput(inputField, resolvedPriceRaw);
      if (!verifyResult.ok) {
        const result = {
          ...baseDiagnostic,
          status: "needs_review",
          reason: `verification failed (expected "${resolvedPriceRaw}", got "${verifyResult.actualValue || ""}")`,
          actualValue: verifyResult.actualValue || "",
        };
        console.debug("[Vendoo][ListingPrice]", result);
        return result;
      }

      usedElements.add(inputField);
      const result = {
        ...baseDiagnostic,
        status: "filled",
        reason: "value persisted after blur",
        actualValue: verifyResult.actualValue || "",
      };
      console.debug("[Vendoo][ListingPrice]", result);
      return result;
    } catch (error) {
      const result = {
        ...baseDiagnostic,
        status: "needs_review",
        reason: error instanceof Error ? error.message : "runtime error",
      };
      console.debug("[Vendoo][ListingPrice]", result);
      return result;
    }
  }

  async function fillBaseConditionIfPresent(input) {
    const { payload, usedElements, selectors } = input;
    const rawCondition = pickEbayCondition(payload);
    const diagnostic = {
      fieldLabel: "Condition",
      payloadKey: "condition",
      controlFamily: "single_select_combobox",
      status: "skipped_for_safety",
      reason: "",
      expectedValue: rawCondition || "",
      actualValue: "",
    };

    if (!rawCondition) {
      const result = {
        ...diagnostic,
        status: "skipped_for_safety",
        reason: "condition missing",
      };
      console.debug("[Vendoo][BaseCondition]", result);
      return result;
    }

    const control = findBaseConditionControl();
    if (!(control instanceof Element)) {
      const result = {
        ...diagnostic,
        status: "skipped_for_safety",
        reason: "base condition field not found",
      };
      console.debug("[Vendoo][BaseCondition]", result);
      return result;
    }

    if (usedElements.has(control)) {
      const result = {
        ...diagnostic,
        status: "skipped_for_safety",
        reason: "collision prevention",
      };
      console.debug("[Vendoo][BaseCondition]", result);
      return result;
    }

    const payloadValues = buildNormalizedPayloadValues(rawCondition);
    const target = payloadValues.values[0] ?? "";
    if (!target) {
      const result = {
        ...diagnostic,
        status: "needs_review",
        reason: "condition missing after normalization",
      };
      console.debug("[Vendoo][BaseCondition]", result);
      return result;
    }

    const optionSelectors = selectors?.color?.optionSelectors ?? [
      '[role="option"]',
      '[data-radix-collection-item]',
      '.react-select__option',
      'li[role="option"]',
    ];

    const selectResult = await selectComboboxValueByNormalizedMatch({
      control,
      optionSelectors,
      target,
      fieldLabel: "Condition",
      payloadRaw: rawCondition,
      payloadCanonical: payloadValues.canonicalValue,
      valueMode: payloadValues.multiValue ? "multi-value" : "single-value",
    });

    if (selectResult.status !== "filled") {
      const result = {
        ...diagnostic,
        status: selectResult.status === "needs_review" ? "needs_review" : "skipped_for_safety",
        reason: selectResult.reason || "condition fill failed",
      };
      console.debug("[Vendoo][BaseCondition]", result);
      return result;
    }

    const expectedConditionValue =
      typeof selectResult.resolvedOption === "string" && selectResult.resolvedOption.trim()
        ? selectResult.resolvedOption.trim()
        : rawCondition;

    const verification = await verifyDynamicFillResult(
      {
        label: "Condition",
        normalizedLabel: "condition",
        control,
        controlType: "combobox",
        controlFamily: "single_select_combobox",
        allowedOptions: [],
      },
      expectedConditionValue,
      {
        status: "filled",
        controlFamily: "single_select_combobox",
      }
    );

    if (!verification.passed) {
      const result = {
        ...diagnostic,
        status: "needs_review",
        reason: verification.reason || "verification failed",
        expectedValue: expectedConditionValue,
        actualValue:
          verification.actualRenderedText ||
          verification.actualTriggerText ||
          verification.actualVisibleInputValue ||
          verification.actualBackingInputValue ||
          "",
      };
      console.debug("[Vendoo][BaseCondition]", result);
      return result;
    }

    usedElements.add(control);
    const result = {
      ...diagnostic,
      status: "filled",
      reason: "value persisted after selection",
      expectedValue: expectedConditionValue,
      actualValue:
        verification.actualRenderedText ||
        verification.actualTriggerText ||
        verification.actualVisibleInputValue ||
        verification.actualBackingInputValue ||
        "",
    };
    console.debug("[Vendoo][BaseCondition]", result);
    return result;
  }

  async function fillDepopSizeIfPresent(input) {
    const { payload, usedElements } = input;
    const payloadValueRaw =
      typeof payload?.depop?.size === "string"
        ? payload.depop.size.trim()
        : typeof payload?.marketplaces?.depop?.size === "string"
          ? payload.marketplaces.depop.size.trim()
          : "";
    const diagnostic = {
      payloadValue: payloadValueRaw,
      attemptedValue: "",
      selectedValue: "",
      status: "skipped_for_safety",
      reason: "",
    };

    if (!payloadValueRaw) {
      diagnostic.reason = "depop.size missing";
      console.debug("[Vendoo][DepopSize]", diagnostic);
      return diagnostic;
    }

    const depopSizeInput = findDepopSizeInput();
    if (!(depopSizeInput instanceof HTMLInputElement)) {
      diagnostic.reason = "Depop Size field not found";
      console.debug("[Vendoo][DepopSize]", diagnostic);
      return diagnostic;
    }

    const control =
      depopSizeInput.closest(".react-select__control, [role='combobox']") ?? depopSizeInput;
    if (!(control instanceof Element) || !isVisible(control)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "Depop Size control not found";
      console.debug("[Vendoo][DepopSize]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(control)) {
      diagnostic.reason = "collision prevention";
      console.debug("[Vendoo][DepopSize]", diagnostic);
      return diagnostic;
    }

    diagnostic.attemptedValue = payloadValueRaw;
    const selectResult = await selectComboboxValueByNormalizedMatch({
      control,
      optionSelectors: ['[role="option"]', '[data-radix-collection-item]', '.react-select__option', 'li[role="option"]'],
      target: payloadValueRaw,
      fieldLabel: "Depop Size",
      payloadRaw: payloadValueRaw,
      payloadCanonical: payloadValueRaw,
      valueMode: "single-value",
    });

    if (selectResult.status !== "filled") {
      diagnostic.status = "needs_review";
      diagnostic.reason = selectResult.reason || "Depop Size select failed";
      console.debug("[Vendoo][DepopSize]", diagnostic);
      return diagnostic;
    }

    await wait(120);
    const verification = await verifyDynamicFillResult(
      {
        label: "Depop Size",
        normalizedLabel: "depop size",
        control,
        controlType: "combobox",
        controlFamily: "single_select_combobox",
        allowedOptions: [],
      },
      payloadValueRaw,
      {
        status: "filled",
        controlFamily: "single_select_combobox",
      }
    );

    diagnostic.selectedValue =
      verification.actualRenderedText ||
      verification.actualTriggerText ||
      verification.actualVisibleInputValue ||
      verification.actualBackingInputValue ||
      "";

    if (!verification.passed) {
      diagnostic.status = "needs_review";
      diagnostic.reason = verification.reason || "verification failed";
      console.debug("[Vendoo][DepopSize]", diagnostic);
      return diagnostic;
    }

    usedElements.add(control);
    diagnostic.status = "filled";
    diagnostic.reason = "value persisted after selection";
    console.debug("[Vendoo][DepopSize]", diagnostic);
    return diagnostic;
  }

  async function fillDepopDescriptionIfPresent(input) {
    const { payload, usedElements } = input;
    const depopDescription =
      typeof payload?.depop?.description === "string"
        ? payload.depop.description.trim()
        : "";
    const diagnostic = {
      payloadSource: depopDescription ? "payload.depop.description" : "",
      attemptedValuePresent: Boolean(depopDescription),
      status: "skipped_for_safety",
      reason: "",
    };

    const depopStageGate = evaluateDepopStageGate();
    console.debug("[Vendoo][DepopStageGate]", depopStageGate);
    if (!depopStageGate.stageDetected) {
      diagnostic.reason = "not depop stage";
      console.debug("[Vendoo][DepopDescription]", diagnostic);
      return diagnostic;
    }

    if (!depopDescription) {
      diagnostic.reason = "depop.description missing";
      console.debug("[Vendoo][DepopDescription]", diagnostic);
      return diagnostic;
    }

    const field = findDepopDescriptionField();
    if (!(field instanceof Element)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "Depop Description field not found";
      console.debug("[Vendoo][DepopDescription]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(field)) {
      diagnostic.reason = "collision prevention";
      console.debug("[Vendoo][DepopDescription]", diagnostic);
      return diagnostic;
    }

    setElementValue(field, depopDescription);
    field.dispatchEvent(new Event("blur", { bubbles: true }));
    await wait(120);
    const actual =
      field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement
        ? String(field.value || "")
        : cleanCategoryStage(field.textContent || "");
    if (normalizeOptionValue(actual) !== normalizeOptionValue(depopDescription)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "verification failed";
      console.debug("[Vendoo][DepopDescription]", diagnostic);
      return diagnostic;
    }

    usedElements.add(field);
    diagnostic.status = "filled";
    diagnostic.reason = "value persisted after set";
    console.debug("[Vendoo][DepopDescription]", diagnostic);
    return diagnostic;
  }

  async function ensureDepopStageOpenForDepopFill() {
    const diagnostics = {
      clickAttempted: false,
      activeDetected: false,
      formReadyDetected: false,
      reason: "",
    };

    const depopTab = findMarketplaceTab("depop");
    if (!(depopTab instanceof Element)) {
      diagnostics.reason = "depop tab not found";
      console.debug("[Vendoo][DepopStageOpen]", diagnostics);
      return diagnostics;
    }

    diagnostics.activeDetected = isDepopTabSpecificallyActive(depopTab);

    if (!diagnostics.activeDetected) {
      clickElement(depopTab);
      diagnostics.clickAttempted = true;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(140);
      }

      diagnostics.activeDetected = isDepopTabSpecificallyActive(depopTab);
      diagnostics.formReadyDetected = isDepopFormReadyInDom();

      if (diagnostics.activeDetected && diagnostics.formReadyDetected) {
        diagnostics.reason = "depop stage active and form ready";
        console.debug("[Vendoo][DepopStageOpen]", diagnostics);
        return diagnostics;
      }
    }

    diagnostics.reason = diagnostics.activeDetected
      ? "depop active but form not ready"
      : "depop stage not active";
    console.debug("[Vendoo][DepopStageOpen]", diagnostics);
    return diagnostics;
  }

  async function ensureDepopOptionalFieldsOpenForDepopFill() {
    const diagnostics = {
      buttonVisible: false,
      clickAttempted: false,
      expandDetected: false,
      reason: "",
    };

    const button = findDepopShowOptionalFieldsButton();
    diagnostics.buttonVisible = button instanceof Element;

    if (!(button instanceof Element)) {
      diagnostics.reason = "button not visible";
      console.debug("[Vendoo][DepopOptionalFields]", diagnostics);
      return diagnostics;
    }

    const disabled =
      (button instanceof HTMLButtonElement && button.disabled) ||
      button.getAttribute("aria-disabled") === "true";
    if (disabled) {
      diagnostics.reason = "button disabled";
      console.debug("[Vendoo][DepopOptionalFields]", diagnostics);
      return diagnostics;
    }

    const baselineOptionalCount = countVisibleDepopOptionalControls();
    if (
      isDepopOptionalFieldsExpanded(button, {
        baselineCount: baselineOptionalCount,
        currentCount: baselineOptionalCount,
        requireCountIncrease: false,
      })
    ) {
      diagnostics.expandDetected = true;
      diagnostics.reason = "already expanded";
      console.debug("[Vendoo][DepopOptionalFields]", diagnostics);
      return diagnostics;
    }

    clickElement(button);
    diagnostics.clickAttempted = true;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(140);
      const latestButton = findDepopShowOptionalFieldsButton();
      const currentOptionalCount = countVisibleDepopOptionalControls();
      if (
        isDepopOptionalFieldsExpanded(latestButton, {
          baselineCount: baselineOptionalCount,
          currentCount: currentOptionalCount,
          requireCountIncrease: true,
        })
      ) {
        diagnostics.expandDetected = true;
        diagnostics.reason = "expanded after click";
        console.debug("[Vendoo][DepopOptionalFields]", diagnostics);
        return diagnostics;
      }
    }

    diagnostics.reason = "clicked but expansion not detected";
    console.debug("[Vendoo][DepopOptionalFields]", diagnostics);
    return diagnostics;
  }

  async function ensureEtsyOptionalFieldsOpenForEtsyFill() {
    const diagnostics = {
      buttonVisible: false,
      clickAttempted: false,
      expandDetected: false,
      reason: "",
    };

    const button = findEtsyShowOptionalFieldsButton();
    diagnostics.buttonVisible = button instanceof Element;

    if (!(button instanceof Element)) {
      diagnostics.reason = "button not visible";
      console.debug("[Vendoo][EtsyOptionalFields]", diagnostics);
      return diagnostics;
    }

    const disabled =
      (button instanceof HTMLButtonElement && button.disabled) ||
      button.getAttribute("aria-disabled") === "true";
    if (disabled) {
      diagnostics.reason = "button disabled";
      console.debug("[Vendoo][EtsyOptionalFields]", diagnostics);
      return diagnostics;
    }

    const baselineOptionalCount = countVisibleEtsyOptionalControls();
    if (
      isEtsyOptionalFieldsExpanded(button, {
        baselineCount: baselineOptionalCount,
        currentCount: baselineOptionalCount,
        requireCountIncrease: false,
      })
    ) {
      diagnostics.expandDetected = true;
      diagnostics.reason = "already expanded";
      console.debug("[Vendoo][EtsyOptionalFields]", diagnostics);
      return diagnostics;
    }

    clickElement(button);
    diagnostics.clickAttempted = true;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(140);
      const latestButton = findEtsyShowOptionalFieldsButton();
      const currentOptionalCount = countVisibleEtsyOptionalControls();
      if (
        isEtsyOptionalFieldsExpanded(latestButton, {
          baselineCount: baselineOptionalCount,
          currentCount: currentOptionalCount,
          requireCountIncrease: true,
        })
      ) {
        diagnostics.expandDetected = true;
        diagnostics.reason = "expanded after click";
        console.debug("[Vendoo][EtsyOptionalFields]", diagnostics);
        return diagnostics;
      }
    }

    diagnostics.reason = "clicked but expansion not detected";
    console.debug("[Vendoo][EtsyOptionalFields]", diagnostics);
    return diagnostics;
  }

  function findDepopShowOptionalFieldsButton() {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    return (
      candidates.find((candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (!isVisible(candidate)) return false;
        const text = normalizeText(candidate.textContent || "");
        if (!text.includes("show optional fields")) return false;
        const scopeText = normalizeText(
          [
            candidate.closest("section, form, div")?.textContent || "",
            window.location.href,
          ].join(" ")
        );
        return scopeText.includes("depop");
      }) ?? null
    );
  }

  function findEtsyShowOptionalFieldsButton() {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    return (
      candidates.find((candidate) => {
        if (!(candidate instanceof Element)) return false;
        if (!isVisible(candidate)) return false;
        const text = normalizeText(candidate.textContent || "");
        if (!text.includes("show optional fields")) return false;
        const scopeText = normalizeText(
          [
            candidate.closest("section, form, div")?.textContent || "",
            window.location.href,
          ].join(" ")
        );
        return scopeText.includes("etsy");
      }) ?? null
    );
  }

  function isDepopOptionalFieldsExpanded(button, options = {}) {
    const baselineCount = Number(options.baselineCount ?? 0) || 0;
    const currentCount = Number(options.currentCount ?? 0) || 0;
    const requireCountIncrease = Boolean(options.requireCountIncrease);
    if (!(button instanceof Element)) return true;
    if (!button.isConnected || !isVisible(button)) return true;
    const text = normalizeText(button.textContent || "");
    if (text.includes("hide optional fields")) return true;
    const expanded = normalizeText(button.getAttribute("aria-expanded") || "");
    if (expanded === "true") return true;
    if (requireCountIncrease && currentCount > baselineCount) return true;
    return false;
  }

  function isEtsyOptionalFieldsExpanded(button, options = {}) {
    const baselineCount = Number(options.baselineCount ?? 0) || 0;
    const currentCount = Number(options.currentCount ?? 0) || 0;
    const requireCountIncrease = Boolean(options.requireCountIncrease);
    if (!(button instanceof Element)) return true;
    if (!button.isConnected || !isVisible(button)) return true;
    const text = normalizeText(button.textContent || "");
    if (text.includes("hide optional fields")) return true;
    const expanded = normalizeText(button.getAttribute("aria-expanded") || "");
    if (expanded === "true") return true;
    if (requireCountIncrease && currentCount > baselineCount) return true;
    return false;
  }

  function countVisibleDepopOptionalControls() {
    const selectors = [
      'input[name*="listings.depop.overrides.brand"]',
      'input[id*="listings.depop.overrides.brand"]',
      'input[name*="listings.depop.overrides.style"]',
      'input[id*="listings.depop.overrides.style"]',
      'input[name*="listings.depop.overrides.material"]',
      'input[id*="listings.depop.overrides.material"]',
      'input[name*="listings.depop.overrides.color"]',
      'input[id*="listings.depop.overrides.color"]',
    ];
    let count = 0;
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        (node) => node instanceof Element && isVisible(node)
      );
      count += matches.length;
    }
    return count;
  }

  function countVisibleEtsyOptionalControls() {
    const selectors = [
      '[name^="listings.etsy.marketplaceSpecifics."]',
      '[id^="listings.etsy.marketplaceSpecifics."]',
      '[name^="listings.etsy.overrides."]',
      '[id^="listings.etsy.overrides."]',
    ];
    let count = 0;
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        (node) => node instanceof Element && isVisible(node)
      );
      count += matches.length;
    }
    return count;
  }

  function resolveMarketplaceSpecificsRoot(marketplace) {
    const normalized = normalizeText(String(marketplace || ""));
    if (normalized !== "etsy") return null;

    const anchors = [
      ...Array.from(document.querySelectorAll('[name^="listings.etsy.marketplaceSpecifics."]')),
      ...Array.from(document.querySelectorAll('[id^="listings.etsy.marketplaceSpecifics."]')),
      ...Array.from(
        document.querySelectorAll('[data-testid^="listings.etsy.marketplaceSpecifics."]')
      ),
    ].filter((node) => node instanceof Element && isVisible(node));

    if (!anchors.length) {
      return null;
    }

    const primaryAnchor = anchors[0];
    let current =
      primaryAnchor.closest("section, form, [data-testid], [role='region'], fieldset, div") ??
      primaryAnchor;
    let bestRoot = current;
    while (current instanceof Element && current.parentElement instanceof Element) {
      const containsVisibleAnchors = anchors.filter((anchor) => current.contains(anchor)).length;
      if (containsVisibleAnchors >= 2) {
        bestRoot = current;
      }
      current = current.parentElement;
      if (current.matches("body, html")) break;
    }

    return bestRoot instanceof Element ? bestRoot : null;
  }

  function resolveMarketplacePayloadBlock(marketplace, payload) {
    const normalized = normalizeText(String(marketplace || ""));
    if (!normalized) return null;
    const topLevel = payload?.[normalized];
    if (topLevel && typeof topLevel === "object") return topLevel;
    const nested = payload?.marketplaces?.[normalized];
    if (nested && typeof nested === "object") return nested;
    return null;
  }

  function buildMarketplaceSpecificCandidates(marketplace, payloadBlock) {
    const normalizedMarketplace = normalizeText(String(marketplace || ""));
    if (!(payloadBlock && typeof payloadBlock === "object")) {
      return { candidates: [], candidateKeys: [] };
    }

    const excludedTopLevel = new Set([
      "title",
      "description",
      "tags",
      "hashtags",
      "optionalBrandHashtags",
      "category",
      "categoryPath",
      "listing",
    ]);
    const seen = new Set();
    const candidates = [];

    function addCandidate(rawKey, rawPath, rawValue) {
      const stringValue = typeof rawValue === "string" ? rawValue.trim() : "";
      if (!stringValue) return;
      const normalizedValue = normalizeOptionValue(stringValue);
      if (!normalizedValue) return;
      if (normalizedValue === "not applicable") return;
      const canonicalKey = toCanonicalPayloadKey(rawKey);
      const dedupeKey = normalizeText(`${canonicalKey}:${normalizedValue}`);
      if (!dedupeKey || seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      const synonyms = DYNAMIC_FIELD_SYNONYMS[canonicalKey] ?? [];
      const keyTerms = Array.from(
        new Set([
          ...buildKeyTermsFromKey(rawKey),
          ...buildKeyTermsFromKey(canonicalKey),
          ...buildKeyTermsFromKey(rawPath),
        ])
      );
      const matchTerms = Array.from(new Set([...synonyms, ...keyTerms].map(normalizeText)));
      candidates.push({
        key: canonicalKey,
        canonicalKey,
        value: stringValue,
        matchTerms,
      });
    }

    function visit(node, pathParts = []) {
      if (typeof node === "string") {
        const rawPath = pathParts.join(".");
        const rawKey = pathParts[pathParts.length - 1] || rawPath;
        if (!rawKey) return;
        if (pathParts.length === 1 && excludedTopLevel.has(rawKey)) return;
        addCandidate(rawKey, rawPath, node);
        return;
      }
      if (Array.isArray(node)) {
        const stringValues = node
          .filter((value) => typeof value === "string")
          .map((value) => String(value).trim())
          .filter(Boolean);
        if (!stringValues.length) return;
        const rawPath = pathParts.join(".");
        const rawKey = pathParts[pathParts.length - 1] || rawPath;
        if (!rawKey) return;
        if (pathParts.length === 1 && excludedTopLevel.has(rawKey)) return;
        addCandidate(rawKey, rawPath, stringValues.join("; "));
        return;
      }
      if (!(node && typeof node === "object")) return;
      for (const [key, value] of Object.entries(node)) {
        visit(value, [...pathParts, key]);
      }
    }

    visit(payloadBlock, []);
    const candidateKeys = Array.from(new Set(candidates.map((candidate) => candidate.key)));
    if (normalizedMarketplace === "etsy") {
      return { candidates, candidateKeys };
    }
    return { candidates: [], candidateKeys: [] };
  }

  async function runMarketplaceSpecificsPass(input) {
    const { marketplace, payload, root, usedElements, selectors } = input;
    const diagnostics = {
      marketplace: String(marketplace || ""),
      candidateKeys: [],
      discoveredFieldLabels: [],
      attemptedFields: [],
      filledFields: [],
      skippedFields: [],
    };
    const etsyBatchDiagnostics = {
      attemptedFields: [],
      selectedValues: {},
      verifiedFields: [],
      failedFields: [],
      reason: "",
    };

    const payloadBlock = resolveMarketplacePayloadBlock(marketplace, payload);
    const { candidates, candidateKeys } = buildMarketplaceSpecificCandidates(
      marketplace,
      payloadBlock
    );
    diagnostics.candidateKeys = candidateKeys;

    let specificsRoot = root instanceof Element && isVisible(root) ? root : null;
    if (!(specificsRoot instanceof Element)) {
      specificsRoot = resolveMarketplaceSpecificsRoot(marketplace);
    }
    if (!(specificsRoot instanceof Element) || !isVisible(specificsRoot)) {
      console.debug("[Vendoo][MarketplaceSpecificsRoot]", {
        marketplace: diagnostics.marketplace,
        rootFound: false,
        visibleFieldCount: 0,
        reason: "specifics root not found",
      });
      diagnostics.skippedFields.push("specifics root not found");
      console.debug("[Vendoo][MarketplaceSpecificsPass]", diagnostics);
      return diagnostics;
    }

    let visibleRegistry = discoverVisibleFieldRegistry(specificsRoot);
    if (!visibleRegistry.length) {
      const refreshedRoot = resolveMarketplaceSpecificsRoot(marketplace);
      if (refreshedRoot instanceof Element && refreshedRoot !== specificsRoot) {
        specificsRoot = refreshedRoot;
        visibleRegistry = discoverVisibleFieldRegistry(specificsRoot);
      }
    }
    console.debug("[Vendoo][MarketplaceSpecificsRoot]", {
      marketplace: diagnostics.marketplace,
      rootFound: true,
      visibleFieldCount: visibleRegistry.length,
      reason: visibleRegistry.length ? "live etsy specifics root resolved" : "no visible fields in root",
    });
    diagnostics.discoveredFieldLabels = visibleRegistry.map((field) => field.label);
    if (!visibleRegistry.length) {
      diagnostics.skippedFields.push("no visible fields discovered");
      console.debug("[Vendoo][MarketplaceSpecificsPass]", diagnostics);
      return diagnostics;
    }

    if (!candidates.length) {
      diagnostics.skippedFields.push("no candidate payload values");
      console.debug("[Vendoo][MarketplaceSpecificsPass]", diagnostics);
      return diagnostics;
    }

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
      if (matches.length !== 1) {
        diagnostics.skippedFields.push(
          `${field.label}: ${matches.length > 1 ? "ambiguous_payload_match" : "no_payload_match"}`
        );
        continue;
      }

      const candidate = matches[0];
      diagnostics.attemptedFields.push(field.label);
      if (normalizeText(diagnostics.marketplace) === "etsy" && isTrackedEtsySpecificField(field)) {
        etsyBatchDiagnostics.attemptedFields.push(field.label);
        etsyBatchDiagnostics.selectedValues[field.label] = candidate.value;
      }
      if (usedElements.has(field.control)) {
        diagnostics.skippedFields.push(`${field.label}: collision_prevention`);
        if (normalizeText(diagnostics.marketplace) === "etsy" && isTrackedEtsySpecificField(field)) {
          etsyBatchDiagnostics.failedFields.push(`${field.label}: collision_prevention`);
        }
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

      if (result.status === "filled") {
        usedElements.add(field.control);
        diagnostics.filledFields.push(field.label);
        if (normalizeText(diagnostics.marketplace) === "etsy" && isTrackedEtsySpecificField(field)) {
          etsyBatchDiagnostics.verifiedFields.push(field.label);
        }
      } else {
        diagnostics.skippedFields.push(`${field.label}: ${result.reason || result.status}`);
        if (normalizeText(diagnostics.marketplace) === "etsy" && isTrackedEtsySpecificField(field)) {
          etsyBatchDiagnostics.failedFields.push(
            `${field.label}: ${result.reason || result.status}`
          );
        }
      }
    }

    if (normalizeText(diagnostics.marketplace) === "etsy") {
      etsyBatchDiagnostics.reason = etsyBatchDiagnostics.failedFields.length
        ? "partial_or_failed_verification"
        : etsyBatchDiagnostics.verifiedFields.length
          ? "verified"
          : "no_tracked_fields_attempted";
      console.debug("[Vendoo][EtsySpecificsBatch]", etsyBatchDiagnostics);
    }
    console.debug("[Vendoo][MarketplaceSpecificsPass]", diagnostics);
    return diagnostics;
  }

  function isTrackedEtsySpecificField(field) {
    const normalizedLabel = normalizeText(field?.normalizedLabel ?? field?.label ?? "");
    return (
      normalizedLabel === "materials" ||
      normalizedLabel === "gemstone" ||
      normalizedLabel === "theme" ||
      normalizedLabel === "age"
    );
  }

  function isDepopTabSpecificallyActive(tabElement) {
    if (!(tabElement instanceof Element)) return false;
    const tabText = normalizeText(
      [
        tabElement.textContent || "",
        tabElement.getAttribute("aria-label") || "",
        tabElement.getAttribute("title") || "",
        tabElement.getAttribute("data-testid") || "",
        tabElement.getAttribute("name") || "",
      ].join(" ")
    );
    if (!tabText.includes("depop")) return false;

    const selectedAttr = normalizeText(tabElement.getAttribute("aria-selected") || "");
    const dataState = normalizeText(tabElement.getAttribute("data-state") || "");
    const ariaCurrent = normalizeText(tabElement.getAttribute("aria-current") || "");
    const className = normalizeText(
      typeof tabElement.className === "string" ? tabElement.className : ""
    );

    return (
      selectedAttr === "true" ||
      dataState === "active" ||
      ariaCurrent === "true" ||
      ariaCurrent === "page" ||
      className.includes("active") ||
      className.includes("selected")
    );
  }

  async function fillDepopTagsIfPresent(input) {
    const { payload, usedElements } = input;
    const hashtags = typeof payload?.depop?.hashtags === "string" ? payload.depop.hashtags : "";
    const optionalBrandHashtags =
      typeof payload?.depop?.optionalBrandHashtags === "string"
        ? payload.depop.optionalBrandHashtags
        : "";
    const payloadTags = parseDepopTagsFromPayload(hashtags, optionalBrandHashtags);
    const diagnostic = {
      payloadTags,
      attemptedTags: [],
      insertedTags: [],
      skippedTags: [],
      status: "skipped_for_safety",
      reason: "",
    };

    const depopStageGate = evaluateDepopStageGate();
    console.debug("[Vendoo][DepopStageGate]", depopStageGate);
    if (!depopStageGate.stageDetected) {
      diagnostic.reason = "not depop stage";
      console.debug("[Vendoo][DepopTags]", diagnostic);
      return diagnostic;
    }

    if (!payloadTags.length) {
      diagnostic.reason = "depop.hashtags missing";
      console.debug("[Vendoo][DepopTags]", diagnostic);
      return diagnostic;
    }

    const control = findDepopTagsControl();
    if (!(control instanceof Element)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "Depop Tags field not found";
      diagnostic.skippedTags = [...payloadTags];
      console.debug("[Vendoo][DepopTags]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(control)) {
      diagnostic.reason = "collision prevention";
      diagnostic.skippedTags = [...payloadTags];
      console.debug("[Vendoo][DepopTags]", diagnostic);
      return diagnostic;
    }

    const tagLimit = 5;
    const tagsToAttempt = payloadTags.slice(0, tagLimit);
    for (const tag of tagsToAttempt) {
      diagnostic.attemptedTags.push(tag);
      if (isBaseTagPresent(control, tag)) {
        diagnostic.skippedTags.push(`${tag} (already present)`);
        continue;
      }
      const committed = tryCommitChipToken(control, tag);
      if (!committed) {
        diagnostic.skippedTags.push(`${tag} (token commit failed)`);
        continue;
      }
      await wait(100);
      if (isBaseTagPresent(control, tag)) {
        diagnostic.insertedTags.push(tag);
      } else {
        diagnostic.skippedTags.push(`${tag} (verification failed)`);
      }
    }

    if (diagnostic.insertedTags.length === tagsToAttempt.length) {
      diagnostic.status = "filled";
      diagnostic.reason = "all tags inserted";
      usedElements.add(control);
      console.debug("[Vendoo][DepopTags]", diagnostic);
      return diagnostic;
    }

    if (diagnostic.insertedTags.length > 0) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "partial tag insert";
      usedElements.add(control);
      console.debug("[Vendoo][DepopTags]", diagnostic);
      return diagnostic;
    }

    diagnostic.status = "needs_review";
    diagnostic.reason = "no tags inserted";
    console.debug("[Vendoo][DepopTags]", diagnostic);
    return diagnostic;
  }

  function parseDepopTagsFromPayload(hashtagsRaw, optionalBrandHashtagsRaw) {
    const seen = new Set();
    const tags = [];

    function pushTag(raw) {
      const cleaned = String(raw ?? "").trim().replace(/^#+/, "");
      if (!cleaned) return;
      if (seen.has(cleaned)) return;
      seen.add(cleaned);
      tags.push(cleaned);
    }

    function parseTagString(raw, allowLoose) {
      if (typeof raw !== "string" || !raw.trim()) return;
      const hashtagMatches = raw.match(/#[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? [];
      if (hashtagMatches.length) {
        for (const match of hashtagMatches) {
          pushTag(match);
        }
        return;
      }

      const split = raw
        .split(/[\n,;]+/)
        .map((part) => part.trim())
        .filter(Boolean);
      for (const part of split) {
        if (!allowLoose) continue;
        if (/\s/.test(part)) continue;
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(part)) continue;
        pushTag(part);
      }
    }

    parseTagString(hashtagsRaw, true);
    parseTagString(optionalBrandHashtagsRaw, false);
    return tags;
  }

  function findDepopDescriptionField() {
    const exactSelectors = [
      'textarea#listings\\.depop\\.description',
      'textarea[name="listings.depop.description"]',
      'textarea[data-testid="listings.depop.description"]',
      'textarea#listings\\.depop\\.marketplaceSpecifics\\.description',
      'textarea[name="listings.depop.marketplaceSpecifics.description"]',
    ];
    for (const selector of exactSelectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof Element && isVisible(candidate)) return candidate;
    }

    const scopedCandidates = Array.from(
      document.querySelectorAll("textarea, [contenteditable='true'], input:not([type='hidden'])")
    ).filter((candidate) => {
      if (!(candidate instanceof Element)) return false;
      if (!isVisible(candidate)) return false;
      const metadata = normalizeText(
        [
          candidate.getAttribute("id") || "",
          candidate.getAttribute("name") || "",
          candidate.getAttribute("data-testid") || "",
          candidate.getAttribute("aria-label") || "",
          candidate.getAttribute("placeholder") || "",
        ].join(" ")
      );
      return metadata.includes("listings.depop") && metadata.includes("description");
    });
    return scopedCandidates[0] ?? null;
  }

  function findDepopTagsControl() {
    const exactSelectors = [
      'input#listings\\.depop\\.hashtags',
      'input[name="listings.depop.hashtags"]',
      'input[data-testid="listings.depop.hashtags"]',
      'input#listings\\.depop\\.tags',
      'input[name="listings.depop.tags"]',
      'input[data-testid="listings.depop.tags"]',
    ];

    for (const selector of exactSelectors) {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement) || !isVisible(input)) continue;
      const control =
        input.closest(".react-select__control, [role='combobox']") ?? input.closest("div");
      if (control instanceof Element && isVisible(control)) return control;
      return input;
    }

    const candidateInputs = Array.from(document.querySelectorAll("input:not([type='hidden'])")).filter(
      (candidate) => {
        if (!(candidate instanceof HTMLInputElement)) return false;
        if (!isVisible(candidate)) return false;
        const metadata = normalizeText(
          [
            candidate.id || "",
            candidate.name || "",
            candidate.getAttribute("data-testid") || "",
            candidate.getAttribute("aria-label") || "",
            candidate.getAttribute("placeholder") || "",
          ].join(" ")
        );
        return (
          metadata.includes("listings.depop") &&
          (metadata.includes("tag") || metadata.includes("hashtag"))
        );
      }
    );
    const first = candidateInputs[0];
    if (!(first instanceof HTMLInputElement)) return null;
    const control =
      first.closest(".react-select__control, [role='combobox']") ?? first.closest("div");
    return control instanceof Element ? control : first;
  }

  function findDepopSizeInput() {
    const selectors = [
      'input#listings\\.depop\\.categorySpecifics\\.womenswear_dresses_size',
      'input[id="listings.depop.categorySpecifics.womenswear_dresses_size"]',
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLInputElement && isVisible(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function findBaseConditionControl() {
    const selectors = [
      'input[name="generalDetails.condition"]',
      'input#generalDetails\\.condition',
      'input[aria-label="Condition"]',
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLInputElement)) continue;
        if (!isVisible(candidate)) continue;
        if (!isBaseConditionInput(candidate)) continue;
        const comboboxControl = candidate.closest(".react-select__control");
        if (comboboxControl instanceof Element && isVisible(comboboxControl)) {
          return comboboxControl;
        }
        return candidate;
      }
    }

    return null;
  }

  function isBaseConditionInput(input) {
    if (!(input instanceof HTMLInputElement)) return false;
    const name = normalizeText(input.name || "");
    const id = normalizeText(input.id || "");
    const testId = normalizeText(input.getAttribute("data-testid") || "");
    const aria = normalizeText(input.getAttribute("aria-label") || "");
    const signature = [name, id, testId].join(" ");
    if (signature.includes("generaldetails.condition")) return true;
    if (aria === "condition" && !signature.includes("listings.ebay")) return true;
    return false;
  }

  function isBaseConditionControl(control) {
    if (!(control instanceof Element)) return false;
    const directInput =
      control instanceof HTMLInputElement
        ? control
        : control.querySelector("input");
    if (directInput instanceof HTMLInputElement && isBaseConditionInput(directInput)) {
      return true;
    }
    const nestedMatch = control.querySelector(
      'input[name="generalDetails.condition"], input#generalDetails\\.condition, input[data-testid="generalDetails.condition"]'
    );
    return nestedMatch instanceof HTMLInputElement;
  }

  function findListingPriceInput() {
    const selectors = [
      'input[data-testid="generalDetails.price"]',
      'input#generalDetails\\.price',
      'input[name="generalDetails.price"]',
    ];

    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLInputElement && isVisible(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  async function tryFillEbayBuyItNowPriceIfApplicable(input) {
    const { resolvedPriceRaw, usedElements } = input;
    if (!isEbayMarketplacePage()) {
      return null;
    }

    const diagnostic = {
      fieldLabel: "eBay Buy It Now Price",
      payloadKey: "resolvedPrice",
      controlFamily: "text_input",
      status: "needs_review",
      reason: "",
      expectedValue: resolvedPriceRaw || "",
      actualValue: "",
    };

    const inputField = findEbayBuyItNowPriceInput();
    if (!(inputField instanceof HTMLInputElement)) {
      const result = {
        ...diagnostic,
        status: "needs_review",
        reason: "eBay Buy It Now price field not found",
      };
      console.debug("[Vendoo][EbayPrice]", result);
      return result;
    }

    if (usedElements.has(inputField)) {
      const result = {
        ...diagnostic,
        status: "skipped_for_safety",
        reason: "collision prevention",
      };
      console.debug("[Vendoo][EbayPrice]", result);
      return result;
    }

    const verifyResult = await fillAndVerifyPriceInput(inputField, resolvedPriceRaw);
    if (!verifyResult.ok) {
      const result = {
        ...diagnostic,
        status: "needs_review",
        reason: `verification failed (expected "${resolvedPriceRaw}", got "${verifyResult.actualValue || ""}")`,
        actualValue: verifyResult.actualValue || "",
      };
      console.debug("[Vendoo][EbayPrice]", result);
      return result;
    }

    usedElements.add(inputField);
    const result = {
      ...diagnostic,
      status: "filled",
      reason: "value persisted after blur",
      actualValue: verifyResult.actualValue || "",
    };
    console.debug("[Vendoo][EbayPrice]", result);
    return result;
  }

  function findEbayBuyItNowPriceInput() {
    const selectors = [
      'input[name="listings.ebay.marketplaceSpecifics.pricingFormatDetails.fixedPrice.buyItNowPrice"]',
      'input#listings\\.ebay\\.marketplaceSpecifics\\.pricingFormatDetails\\.fixedPrice\\.buyItNowPrice',
      'input[data-testid="listings.ebay.marketplaceSpecifics.pricingFormatDetails.fixedPrice.buyItNowPrice"]',
    ];

    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLInputElement && isVisible(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function isEbayMarketplacePage() {
    try {
      const url = new URL(window.location.href);
      return normalizeText(url.searchParams.get("marketplace") || "") === "ebay";
    } catch {
      return normalizeText(window.location.href).includes("marketplace=ebay");
    }
  }

  function evaluateDepopStageGate() {
    const depopStageSelectors = [
      'textarea[name="listings.depop.overrides.description"]',
      'input[id="listings.depop.categorySpecifics.womenswear_dresses_size"]',
      'textarea#listings\\.depop\\.overrides\\.description',
      'input#listings\\.depop\\.categorySpecifics\\.womenswear_dresses_size',
    ];
    const matchedSelector = depopStageSelectors.find((selector) => {
      const node = document.querySelector(selector);
      return node instanceof Element;
    });
    const stageDetected = Boolean(matchedSelector);
    return {
      stageDetected,
      evidenceUsed: matchedSelector || "none",
      reason: stageDetected ? "depop stage evidence confirmed" : "depop stage evidence missing",
    };
  }

  async function ensurePoshmarkStageOpenForPoshmarkFill() {
    const diagnostics = {
      clickAttempted: false,
      activeDetected: false,
      formReadyDetected: false,
      reason: "",
    };

    const poshmarkTab = findMarketplaceTab("poshmark");
    if (!(poshmarkTab instanceof Element)) {
      diagnostics.reason = "poshmark tab not found";
      console.debug("[Vendoo][PoshmarkStageOpen]", diagnostics);
      const gate = evaluatePoshmarkStageGate();
      console.debug("[Vendoo][PoshmarkStageGate]", gate);
      return diagnostics;
    }

    diagnostics.activeDetected = isPoshmarkTabSpecificallyActive(poshmarkTab);
    if (!diagnostics.activeDetected) {
      clickElement(poshmarkTab);
      diagnostics.clickAttempted = true;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(140);
      }
      const currentPoshmarkTab = findMarketplaceTab("poshmark");
      diagnostics.activeDetected = isPoshmarkTabSpecificallyActive(currentPoshmarkTab);
      diagnostics.formReadyDetected = isPoshmarkFormReadyInDom();
      if (diagnostics.activeDetected && diagnostics.formReadyDetected) {
        diagnostics.reason = "poshmark stage active and form ready";
        lastPoshmarkStageOpenState = {
          formReadyDetected: true,
          activeDetected: true,
          savedAt: Date.now(),
        };
        console.debug("[Vendoo][PoshmarkStageOpen]", diagnostics);
        const gate = evaluatePoshmarkStageGate();
        console.debug("[Vendoo][PoshmarkStageGate]", gate);
        return diagnostics;
      }
    }

    diagnostics.reason = diagnostics.activeDetected
      ? "poshmark active but form not ready"
      : "poshmark stage not active";
    lastPoshmarkStageOpenState = {
      formReadyDetected: diagnostics.formReadyDetected,
      activeDetected: diagnostics.activeDetected,
      savedAt: Date.now(),
    };
    console.debug("[Vendoo][PoshmarkStageOpen]", diagnostics);
    const gate = evaluatePoshmarkStageGate();
    console.debug("[Vendoo][PoshmarkStageGate]", gate);
    return diagnostics;
  }

  async function ensureEtsyStageOpenForEtsyFill(payload) {
    const diagnostics = {
      clickAttempted: false,
      activeDetected: false,
      formReadyDetected: false,
      reason: "",
    };

    const etsyBlock = payload?.etsy ?? payload?.marketplaces?.etsy;
    if (!(etsyBlock && typeof etsyBlock === "object")) {
      diagnostics.reason = "etsy payload missing";
      console.debug("[Vendoo][EtsyStageOpen]", diagnostics);
      const gate = evaluateEtsyStageGate();
      console.debug("[Vendoo][EtsyStageGate]", gate);
      return diagnostics;
    }

    const etsyTab = findMarketplaceTab("etsy");
    if (!(etsyTab instanceof Element)) {
      diagnostics.reason = "etsy tab not found";
      console.debug("[Vendoo][EtsyStageOpen]", diagnostics);
      const gate = evaluateEtsyStageGate();
      console.debug("[Vendoo][EtsyStageGate]", gate);
      return diagnostics;
    }

    diagnostics.activeDetected = isEtsyTabSpecificallyActive(etsyTab);
    if (!diagnostics.activeDetected) {
      clickElement(etsyTab);
      diagnostics.clickAttempted = true;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await wait(140);
      }
      const currentEtsyTab = findMarketplaceTab("etsy");
      diagnostics.activeDetected = isEtsyTabSpecificallyActive(currentEtsyTab);
      diagnostics.formReadyDetected = isEtsyFormReadyInDom();
      if (diagnostics.activeDetected && diagnostics.formReadyDetected) {
        diagnostics.reason = "etsy stage active and form ready";
        console.debug("[Vendoo][EtsyStageOpen]", diagnostics);
        const gate = evaluateEtsyStageGate();
        console.debug("[Vendoo][EtsyStageGate]", gate);
        return diagnostics;
      }
    }

    diagnostics.reason = diagnostics.activeDetected
      ? "etsy active but form not ready"
      : "etsy stage not active";
    console.debug("[Vendoo][EtsyStageOpen]", diagnostics);
    const gate = evaluateEtsyStageGate();
    console.debug("[Vendoo][EtsyStageGate]", gate);
    return diagnostics;
  }

  function evaluatePoshmarkStageGate() {
    const selectors = [
      'textarea[name="listings.poshmark.description"]',
      'textarea#listings\\.poshmark\\.description',
      'input[name="listings.poshmark.title"]',
      'input#listings\\.poshmark\\.title',
    ];
    const matchedSelector = selectors.find((selector) => {
      const node = document.querySelector(selector);
      return node instanceof Element;
    });
    const poshmarkTab = findMarketplaceTab("poshmark");
    const activeEvidence = detectPoshmarkActiveEvidence(poshmarkTab);
    const tabActive = activeEvidence.active;
    const formReadyDomEvidence = isPoshmarkFormReadyInDom();
    const recentOpenPathFormReady =
      Boolean(lastPoshmarkStageOpenState?.formReadyDetected) &&
      Date.now() - Number(lastPoshmarkStageOpenState?.savedAt || 0) < 20000;
    const stageDetected =
      Boolean(matchedSelector) ||
      formReadyDomEvidence ||
      recentOpenPathFormReady ||
      tabActive;
    return {
      stageDetected,
      evidenceUsed:
        matchedSelector ||
        (formReadyDomEvidence ? "poshmark_form_ready_dom" : "") ||
        (recentOpenPathFormReady ? "poshmark_open_path_form_ready" : "") ||
        (tabActive ? activeEvidence.evidence : "none"),
      reason: stageDetected ? "poshmark stage evidence confirmed" : "poshmark stage evidence missing",
    };
  }

  function evaluateEtsyStageGate() {
    const selectors = [
      'input[name="listings.etsy.title"]',
      'input#listings\\.etsy\\.title',
      'textarea[name="listings.etsy.description"]',
      'textarea#listings\\.etsy\\.description',
      '[name^="listings.etsy."]',
      '[id^="listings.etsy."]',
    ];
    const matchedSelector = selectors.find((selector) => {
      const node = document.querySelector(selector);
      return node instanceof Element && isVisible(node);
    });
    const etsyTab = findMarketplaceTab("etsy");
    const tabActive = isEtsyTabSpecificallyActive(etsyTab);
    const stageDetected = Boolean(matchedSelector) || tabActive;
    return {
      stageDetected,
      evidenceUsed: matchedSelector || (tabActive ? "etsy_tab_active" : "none"),
      reason: stageDetected ? "etsy stage evidence confirmed" : "etsy stage evidence missing",
    };
  }

  function isPoshmarkFormReadyInDom() {
    const selectors = [
      'textarea[name="listings.poshmark.overrides.description"]',
      'textarea#listings\\.poshmark\\.overrides\\.description',
      'textarea[name="listings.poshmark.description"]',
      'textarea#listings\\.poshmark\\.description',
      'input[name="listings.poshmark.title"]',
      'input#listings\\.poshmark\\.title',
    ];
    return selectors.some((selector) => {
      const node = document.querySelector(selector);
      return node instanceof Element && isVisible(node);
    });
  }

  function isPoshmarkTabSpecificallyActive(tabElement) {
    return detectPoshmarkActiveEvidence(tabElement).active;
  }

  function isEtsyTabSpecificallyActive(tabElement) {
    if (!(tabElement instanceof Element)) return false;
    const tabText = normalizeText(
      [
        tabElement.textContent || "",
        tabElement.getAttribute("aria-label") || "",
        tabElement.getAttribute("title") || "",
        tabElement.getAttribute("data-testid") || "",
        tabElement.getAttribute("name") || "",
      ].join(" ")
    );
    if (!tabText.includes("etsy")) return false;

    const selectedAttr = normalizeText(tabElement.getAttribute("aria-selected") || "");
    const dataState = normalizeText(tabElement.getAttribute("data-state") || "");
    const ariaCurrent = normalizeText(tabElement.getAttribute("aria-current") || "");
    const className = normalizeText(
      typeof tabElement.className === "string" ? tabElement.className : ""
    );

    return (
      selectedAttr === "true" ||
      dataState === "active" ||
      ariaCurrent === "true" ||
      ariaCurrent === "page" ||
      className.includes("active") ||
      className.includes("selected")
    );
  }

  function detectPoshmarkActiveEvidence(tabElement) {
    function isElementPoshmarkActive(element) {
      if (!(element instanceof Element)) return false;
      if (!isVisible(element)) return false;
      const text = normalizeText(
        [
          element.textContent || "",
          element.getAttribute("aria-label") || "",
          element.getAttribute("title") || "",
          element.getAttribute("data-testid") || "",
          element.getAttribute("name") || "",
          element.getAttribute("href") || "",
        ].join(" ")
      );
      if (!text.includes("poshmark")) return false;
      const selectedAttr = normalizeText(element.getAttribute("aria-selected") || "");
      const dataState = normalizeText(element.getAttribute("data-state") || "");
      const ariaCurrent = normalizeText(element.getAttribute("aria-current") || "");
      const className = normalizeText(
        typeof element.className === "string" ? element.className : ""
      );
      return (
        selectedAttr === "true" ||
        dataState === "active" ||
        ariaCurrent === "true" ||
        ariaCurrent === "page" ||
        className.includes("active") ||
        className.includes("selected")
      );
    }

    if (isElementPoshmarkActive(tabElement)) {
      return { active: true, evidence: "poshmark_tab_element_active" };
    }

    const candidates = Array.from(
      document.querySelectorAll("button, [role='tab'], [role='button'], a, [data-testid], li, div, span")
    );
    const activeRow = candidates.find((candidate) => isElementPoshmarkActive(candidate));
    if (activeRow) {
      return { active: true, evidence: "poshmark_active_row_detected" };
    }

    return { active: false, evidence: "none" };
  }

  function isDepopFormReadyInDom() {
    const selectors = [
      'textarea[name="listings.depop.overrides.description"]',
      'input[id="listings.depop.categorySpecifics.womenswear_dresses_size"]',
      'textarea#listings\\.depop\\.overrides\\.description',
      'input#listings\\.depop\\.categorySpecifics\\.womenswear_dresses_size',
    ];
    return selectors.some((selector) => {
      const node = document.querySelector(selector);
      return node instanceof Element && isVisible(node);
    });
  }

  function isEtsyFormReadyInDom() {
    const selectors = [
      'input[name="listings.etsy.title"]',
      'input#listings\\.etsy\\.title',
      'textarea[name="listings.etsy.description"]',
      'textarea#listings\\.etsy\\.description',
      '[name^="listings.etsy."]',
      '[id^="listings.etsy."]',
    ];
    return selectors.some((selector) => {
      const node = document.querySelector(selector);
      return node instanceof Element && isVisible(node);
    });
  }

  async function fillEtsyTagsIfPresent(input) {
    const { payload, usedElements } = input;
    const etsyBlock = payload?.etsy ?? payload?.marketplaces?.etsy;
    const payloadTagsRaw = Array.isArray(etsyBlock?.tags)
      ? etsyBlock.tags.filter((value) => typeof value === "string")
      : [];
    const payloadTags = dedupeTagValues(payloadTagsRaw);
    const diagnostic = {
      existingTagsBeforeClear: [],
      clearedTags: [],
      payloadTags,
      attemptedTags: [],
      insertedTags: [],
      skippedTags: [],
      finalTagsVisible: [],
      status: "skipped_for_safety",
      reason: "",
    };

    const etsyGate = evaluateEtsyStageGate();
    if (!etsyGate.stageDetected) {
      diagnostic.reason = "not etsy stage";
      diagnostic.finalTagsVisible = [];
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    if (!payloadTags.length) {
      diagnostic.reason = "etsy.tags missing";
      diagnostic.finalTagsVisible = [];
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    const control = findEtsyTagsControl();
    if (!(control instanceof Element)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "Etsy Tags field not found";
      diagnostic.skippedTags = [...payloadTags];
      diagnostic.finalTagsVisible = [];
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(control)) {
      diagnostic.reason = "collision prevention";
      diagnostic.skippedTags = [...payloadTags];
      diagnostic.finalTagsVisible = getChipTextsFromControl(control);
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    diagnostic.existingTagsBeforeClear = getChipTextsFromControl(control);
    diagnostic.clearedTags = await clearAllChipsFromControl(control);

    const tagLimit = 13;
    const tagsToAttempt = payloadTags.slice(0, tagLimit);
    for (const tag of tagsToAttempt) {
      diagnostic.attemptedTags.push(tag);
      if (isBaseTagPresent(control, tag)) {
        diagnostic.skippedTags.push(`${tag} (already present)`);
        continue;
      }

      const committed = tryCommitChipToken(control, tag);
      if (!committed) {
        diagnostic.skippedTags.push(`${tag} (token commit failed)`);
        continue;
      }
      await wait(100);
      if (isBaseTagPresent(control, tag)) {
        diagnostic.insertedTags.push(tag);
      } else {
        diagnostic.skippedTags.push(`${tag} (verification failed)`);
      }
    }

    const finalTags = getChipTextsFromControl(control);
    diagnostic.finalTagsVisible = finalTags;
    const normalizedFinal = new Set(finalTags.map((tag) => normalizeText(tag)));
    const normalizedPayload = new Set(tagsToAttempt.map((tag) => normalizeText(tag)));
    const oldTagsRemaining = diagnostic.existingTagsBeforeClear.filter((tag) => {
      const normalized = normalizeText(tag);
      return normalized && !normalizedPayload.has(normalized) && normalizedFinal.has(normalized);
    });

    if (oldTagsRemaining.length > 0) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "inherited tags remain after override";
      usedElements.add(control);
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    if (diagnostic.insertedTags.length === tagsToAttempt.length) {
      diagnostic.status = "filled";
      diagnostic.reason = "all etsy tags inserted";
      usedElements.add(control);
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    if (diagnostic.insertedTags.length > 0) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "partial etsy tags insert";
      usedElements.add(control);
      console.debug("[Vendoo][EtsyTags]", diagnostic);
      return diagnostic;
    }

    diagnostic.status = "needs_review";
    diagnostic.reason = "no etsy tags inserted";
    console.debug("[Vendoo][EtsyTags]", diagnostic);
    return diagnostic;
  }

  async function fillEtsyAdjustedPriceIfPresent(input) {
    const { payload, usedElements } = input;
    let sourcePathTried = "";
    const payloadValue = (() => {
      const topLevel = payload?.etsy?.adjustedPrice;
      if (typeof topLevel === "string" && topLevel.trim()) {
        sourcePathTried = "payload.etsy.adjustedPrice";
        return topLevel.trim();
      }
      const nested = payload?.marketplaces?.etsy?.adjustedPrice;
      if (typeof nested === "string" && nested.trim()) {
        sourcePathTried = "payload.marketplaces.etsy.adjustedPrice";
        return nested.trim();
      }
      sourcePathTried = "payload.etsy.adjustedPrice|payload.marketplaces.etsy.adjustedPrice";
      return "";
    })();
    console.debug("[Vendoo][EtsyAdjustedPriceRead]", {
      hasAdjustedPrice: Boolean(payloadValue),
      adjustedPriceValue: payloadValue,
      sourcePathTried,
    });
    const field = findEtsyAdjustedPriceField();
    const diagnostic = {
      payloadValue,
      attemptedValue: "",
      finalValue: field instanceof HTMLInputElement ? String(field.value || "") : "",
      status: "skipped_for_safety",
      reason: "",
    };

    if (!payloadValue) {
      diagnostic.reason = "adjustedPrice missing";
      console.debug("[Vendoo][EtsyAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    if (!(field instanceof HTMLInputElement) || !isVisible(field)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "price field not found";
      console.debug("[Vendoo][EtsyAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(field)) {
      diagnostic.reason = "collision prevention";
      console.debug("[Vendoo][EtsyAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    diagnostic.attemptedValue = payloadValue;
    await setPoshmarkAdjustedPricePreservingDecimal(field, payloadValue);
    await wait(140);
    diagnostic.finalValue = String(field.value || "").trim();

    if (diagnostic.finalValue !== payloadValue) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "verification failed";
      console.debug("[Vendoo][EtsyAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    usedElements.add(field);
    diagnostic.status = "filled";
    diagnostic.reason = "value persisted after blur";
    console.debug("[Vendoo][EtsyAdjustedPrice]", diagnostic);
    return diagnostic;
  }

  function findEtsyAdjustedPriceField() {
    const selectors = [
      'input#listings\\.etsy\\.overrides\\.price',
      'input[id="listings.etsy.overrides.price"]',
      'input[name="listings.etsy.overrides.price"]',
      'input[data-testid="listings.etsy.overrides.price"]',
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLInputElement && isVisible(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  async function fillPoshmarkAdjustedPriceIfPresent(input) {
    const { payload, usedElements } = input;
    let sourcePathTried = "";
    const payloadValue = (() => {
      const topLevel = payload?.poshmark?.adjustedPrice;
      if (typeof topLevel === "string" && topLevel.trim()) {
        sourcePathTried = "payload.poshmark.adjustedPrice";
        return topLevel.trim();
      }
      const nested = payload?.marketplaces?.poshmark?.adjustedPrice;
      if (typeof nested === "string" && nested.trim()) {
        sourcePathTried = "payload.marketplaces.poshmark.adjustedPrice";
        return nested.trim();
      }
      sourcePathTried =
        "payload.poshmark.adjustedPrice|payload.marketplaces.poshmark.adjustedPrice";
      return "";
    })();
    console.debug("[Vendoo][PoshmarkAdjustedPriceRead]", {
      hasAdjustedPrice: Boolean(payloadValue),
      adjustedPriceValue: payloadValue,
      sourcePathTried,
    });
    const field = findPoshmarkAdjustedPriceField();
    const diagnostic = {
      payloadValue,
      attemptedValue: "",
      finalValue: field instanceof HTMLInputElement ? String(field.value || "") : "",
      status: "skipped_for_safety",
      reason: "",
    };

    if (!payloadValue) {
      diagnostic.reason = "adjustedPrice missing";
      console.debug("[Vendoo][PoshmarkAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    if (!(field instanceof HTMLInputElement) || !isVisible(field)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "price field not found";
      console.debug("[Vendoo][PoshmarkAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(field)) {
      diagnostic.reason = "collision prevention";
      console.debug("[Vendoo][PoshmarkAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    diagnostic.attemptedValue = payloadValue;
    await setPoshmarkAdjustedPricePreservingDecimal(field, payloadValue);
    await wait(140);
    diagnostic.finalValue = String(field.value || "").trim();

    if (diagnostic.finalValue !== payloadValue) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "verification failed";
      console.debug("[Vendoo][PoshmarkAdjustedPrice]", diagnostic);
      return diagnostic;
    }

    usedElements.add(field);
    diagnostic.status = "filled";
    diagnostic.reason = "value persisted after blur";
    console.debug("[Vendoo][PoshmarkAdjustedPrice]", diagnostic);
    return diagnostic;
  }

  async function setPoshmarkAdjustedPricePreservingDecimal(field, value) {
    if (!(field instanceof HTMLInputElement)) return;
    const target = String(value ?? "").trim();
    if (!target) return;
    const trace = {
      beforeSet: String(field.value || "").trim(),
      afterNativeSetter: "",
      afterInputEvent: "",
      afterChangeEvent: "",
      afterBlur: "",
      afterSettle: "",
    };
    let firstMutationCheckpoint = "";

    function setNativeValue(nextValue) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      descriptor?.set?.call(field, nextValue);
    }

    // Poshmark listing price must preserve decimal punctuation exactly (e.g. 201.25).
    // Use a direct native setter flow for this field only.
    field.focus();
    setNativeValue(target);
    trace.afterNativeSetter = String(field.value || "").trim();

    // Dispatch events one-by-one and patch only the first mutating checkpoint for this field.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    trace.afterInputEvent = String(field.value || "").trim();
    if (!firstMutationCheckpoint && trace.afterInputEvent !== target) {
      firstMutationCheckpoint = "afterInputEvent";
      setNativeValue(target);
      trace.afterInputEvent = String(field.value || "").trim();
    }

    field.dispatchEvent(new Event("change", { bubbles: true }));
    trace.afterChangeEvent = String(field.value || "").trim();
    if (!firstMutationCheckpoint && trace.afterChangeEvent !== target) {
      firstMutationCheckpoint = "afterChangeEvent";
      setNativeValue(target);
      trace.afterChangeEvent = String(field.value || "").trim();
    }

    field.dispatchEvent(new Event("blur", { bubbles: true }));
    trace.afterBlur = String(field.value || "").trim();
    if (!firstMutationCheckpoint && trace.afterBlur !== target) {
      firstMutationCheckpoint = "afterBlur";
      setNativeValue(target);
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("blur", { bubbles: true }));
      trace.afterBlur = String(field.value || "").trim();
    }

    await wait(80);
    trace.afterSettle = String(field.value || "").trim();
    console.debug("[Vendoo][PoshmarkAdjustedPriceTrace]", trace);

    const current = String(field.value || "").trim();
    if (current === target) return;

    // Preserve exact decimal if the field was rewritten after settle.
    if (current === target.replace(/\./g, "") || firstMutationCheckpoint) {
      setNativeValue(target);
      field.dispatchEvent(new Event("change", { bubbles: true }));
      field.dispatchEvent(new Event("blur", { bubbles: true }));
    }
  }

  function findPoshmarkAdjustedPriceField() {
    const selectors = [
      'input#listings\\.poshmark\\.overrides\\.price',
      'input[id="listings.poshmark.overrides.price"]',
      'input[name="listings.poshmark.overrides.price"]',
      'input[data-testid="listings.poshmark.overrides.price"]',
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLInputElement && isVisible(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function findEtsyTagsControl() {
    const exactSelectors = [
      'input#listings\\.etsy\\.marketplaceSpecifics\\.tags',
      'input[id="listings.etsy.marketplaceSpecifics.tags"]',
      'input[name="listings.etsy.marketplaceSpecifics.tags"]',
      'input[data-testid="listings.etsy.marketplaceSpecifics.tags"]',
    ];
    for (const selector of exactSelectors) {
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement) || !isVisible(input)) continue;
      const control =
        input.closest(".react-select__control, [role='combobox']") ?? input.closest("div");
      if (control instanceof Element && isVisible(control)) return control;
      return input;
    }
    return null;
  }

  function getChipTextsFromControl(control) {
    if (!(control instanceof Element)) return [];
    const scope = resolveEtsyTagsScope(control);
    const chipNodes = Array.from(
      scope.querySelectorAll(
        ".react-select__multi-value__label, .react-select__multi-value, [class*='chip'], [class*='token']"
      )
    ).filter((node) => node instanceof Element && isVisible(node));
    const tags = [];
    const seen = new Set();
    for (const node of chipNodes) {
      const text = cleanCategoryStage(node.textContent || "");
      const normalized = normalizeText(text);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      tags.push(text);
    }
    return tags;
  }

  async function clearAllChipsFromControl(control) {
    if (!(control instanceof Element)) return [];
    const removed = [];
    const scope = resolveEtsyTagsScope(control);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const removeButtons = Array.from(
        scope.querySelectorAll(
          ".react-select__multi-value__remove, .react-select__multi-value [aria-label*='remove'], .react-select__multi-value [aria-label*='Remove'], .react-select__multi-value [class*='remove']"
        )
      ).filter((node) => node instanceof Element && isVisible(node));
      if (!removeButtons.length) {
        const input = scope.querySelector(
          'input#listings\\.etsy\\.marketplaceSpecifics\\.tags, input[id="listings.etsy.marketplaceSpecifics.tags"], input[name="listings.etsy.marketplaceSpecifics.tags"], input[data-testid="listings.etsy.marketplaceSpecifics.tags"], input[type="text"], input:not([type])'
        );
        if (input instanceof HTMLInputElement && isVisible(input)) {
          input.focus();
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keyup", { key: "Backspace", bubbles: true }));
          await wait(60);
          const remaining = getChipTextsFromControl(control);
          if (!remaining.length) break;
          continue;
        }
        break;
      }
      const button = removeButtons[0];
      const container = button.closest(".react-select__multi-value, [class*='chip'], [class*='token']");
      const text = cleanCategoryStage(container?.textContent || "");
      clickElement(button);
      if (text) removed.push(text);
      await wait(60);
    }
    return dedupeTagValues(removed);
  }

  async function fillEtsyTitleAndDescriptionIfPresent(input) {
    const { payload, usedElements } = input;
    const etsyBlock = payload?.etsy ?? payload?.marketplaces?.etsy;
    const payloadTitle =
      typeof etsyBlock?.title === "string" ? etsyBlock.title.trim() : "";
    const payloadDescription =
      typeof etsyBlock?.description === "string" ? etsyBlock.description.trim() : "";
    const etsyGate = evaluateEtsyStageGate();

    await fillEtsyTitleIfPresent({
      payloadTitle,
      usedElements,
      isEtsyStage: etsyGate.stageDetected,
    });
    await fillEtsyDescriptionIfPresent({
      payloadDescription,
      usedElements,
      isEtsyStage: etsyGate.stageDetected,
    });
  }

  async function fillEtsyTitleIfPresent(input) {
    const { payloadTitle, usedElements, isEtsyStage } = input;
    const field = findEtsyTitleField();
    const existingValue =
      field instanceof HTMLInputElement ? String(field.value || "") : "";
    const diagnostic = {
      existingValue,
      payloadValuePresent: Boolean(payloadTitle),
      finalValue: existingValue,
      status: "skipped_for_safety",
      reason: "",
    };

    if (!isEtsyStage) {
      diagnostic.reason = "not etsy stage";
      console.debug("[Vendoo][EtsyTitle]", diagnostic);
      return diagnostic;
    }

    if (!payloadTitle) {
      diagnostic.reason = "etsy.title missing";
      console.debug("[Vendoo][EtsyTitle]", diagnostic);
      return diagnostic;
    }

    if (!(field instanceof HTMLInputElement) || !isVisible(field)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "Etsy Title field not found";
      console.debug("[Vendoo][EtsyTitle]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(field)) {
      diagnostic.reason = "collision prevention";
      console.debug("[Vendoo][EtsyTitle]", diagnostic);
      return diagnostic;
    }

    setElementValue(field, "");
    await wait(50);
    setElementValue(field, payloadTitle);
    field.dispatchEvent(new Event("blur", { bubbles: true }));
    await wait(120);

    const finalValue = String(field.value || "");
    diagnostic.finalValue = finalValue;
    if (finalValue.trim() !== payloadTitle) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "verification failed";
      console.debug("[Vendoo][EtsyTitle]", diagnostic);
      return diagnostic;
    }

    usedElements.add(field);
    diagnostic.status = "filled";
    diagnostic.reason = "value replaced";
    console.debug("[Vendoo][EtsyTitle]", diagnostic);
    return diagnostic;
  }

  async function fillEtsyDescriptionIfPresent(input) {
    const { payloadDescription, usedElements, isEtsyStage } = input;
    const field = findEtsyDescriptionField();
    const existingValue =
      field instanceof HTMLTextAreaElement ? String(field.value || "") : "";
    const diagnostic = {
      existingValuePresent: Boolean(existingValue.trim()),
      payloadValuePresent: Boolean(payloadDescription),
      finalValuePresent: Boolean(existingValue.trim()),
      status: "skipped_for_safety",
      reason: "",
    };

    if (!isEtsyStage) {
      diagnostic.reason = "not etsy stage";
      console.debug("[Vendoo][EtsyDescription]", diagnostic);
      return diagnostic;
    }

    if (!payloadDescription) {
      diagnostic.reason = "etsy.description missing";
      console.debug("[Vendoo][EtsyDescription]", diagnostic);
      return diagnostic;
    }

    if (!(field instanceof HTMLTextAreaElement) || !isVisible(field)) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "Etsy Description field not found";
      console.debug("[Vendoo][EtsyDescription]", diagnostic);
      return diagnostic;
    }

    if (usedElements.has(field)) {
      diagnostic.reason = "collision prevention";
      console.debug("[Vendoo][EtsyDescription]", diagnostic);
      return diagnostic;
    }

    setElementValue(field, "");
    await wait(50);
    setElementValue(field, payloadDescription);
    field.dispatchEvent(new Event("blur", { bubbles: true }));
    await wait(120);

    const finalValue = String(field.value || "");
    diagnostic.finalValuePresent = Boolean(finalValue.trim());
    if (finalValue.trim() !== payloadDescription) {
      diagnostic.status = "needs_review";
      diagnostic.reason = "verification failed";
      console.debug("[Vendoo][EtsyDescription]", diagnostic);
      return diagnostic;
    }

    usedElements.add(field);
    diagnostic.status = "filled";
    diagnostic.reason = "value replaced";
    console.debug("[Vendoo][EtsyDescription]", diagnostic);
    return diagnostic;
  }

  function findEtsyTitleField() {
    const selectors = [
      'input#listings\\.etsy\\.overrides\\.title',
      'input[id="listings.etsy.overrides.title"]',
      'input[name="listings.etsy.overrides.title"]',
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLInputElement && isVisible(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function findEtsyDescriptionField() {
    const selectors = [
      'textarea#listings\\.etsy\\.overrides\\.description',
      'textarea[id="listings.etsy.overrides.description"]',
      'textarea[name="listings.etsy.overrides.description"]',
    ];
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate instanceof HTMLTextAreaElement && isVisible(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function resolveEtsyTagsScope(control) {
    if (!(control instanceof Element)) return document.body;
    const etsyInput =
      control.matches(
        'input#listings\\.etsy\\.marketplaceSpecifics\\.tags, input[id="listings.etsy.marketplaceSpecifics.tags"], input[name="listings.etsy.marketplaceSpecifics.tags"], input[data-testid="listings.etsy.marketplaceSpecifics.tags"]'
      )
        ? control
        : control.querySelector(
            'input#listings\\.etsy\\.marketplaceSpecifics\\.tags, input[id="listings.etsy.marketplaceSpecifics.tags"], input[name="listings.etsy.marketplaceSpecifics.tags"], input[data-testid="listings.etsy.marketplaceSpecifics.tags"]'
          );
    const fieldRoot =
      (etsyInput instanceof Element
        ? etsyInput.closest(".react-select__control")?.closest("div, section, form")
        : null) ??
      control.closest(".react-select__control")?.closest("div, section, form") ??
      control.closest("section, form, div") ??
      control;
    return fieldRoot instanceof Element ? fieldRoot : control;
  }

  function dedupeTagValues(values) {
    const seen = new Set();
    const deduped = [];
    for (const value of values) {
      const cleaned = cleanCategoryStage(String(value ?? ""));
      const normalized = normalizeText(cleaned);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(cleaned);
    }
    return deduped;
  }

  async function fillAndVerifyPriceInput(inputField, value) {
    setElementValue(inputField, value);
    inputField.dispatchEvent(new Event("blur", { bubbles: true }));
    await wait(160);

    const persistedValue = normalizePriceForCompare(inputField.value);
    const expectedValue = normalizePriceForCompare(value);
    if (!persistedValue || persistedValue !== expectedValue) {
      return {
        ok: false,
        actualValue: inputField.value || "",
      };
    }

    return {
      ok: true,
      actualValue: inputField.value || "",
    };
  }

  async function findListingPriceInputWithFallback() {
    const selectors = [
      'input[data-testid="generalDetails.price"]',
      'input#generalDetails\\.price',
      'input[name="generalDetails.price"]',
    ];
    const matched = new Set();
    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (node instanceof HTMLInputElement) matched.add(node);
      }
    }

    let inputField = findListingPriceInput();
    if (inputField) {
      return {
        inputField,
        exactSelectorMatchCount: matched.size,
        usedFallback: false,
        fallbackFound: false,
      };
    }

    await wait(180);
    inputField = findListingPriceInput();
    if (inputField) {
      return {
        inputField,
        exactSelectorMatchCount: matched.size,
        usedFallback: false,
        fallbackFound: false,
      };
    }

    const fallbackInput = findListingPriceInputFromLabel();
    return {
      inputField: fallbackInput,
      exactSelectorMatchCount: matched.size,
      usedFallback: true,
      fallbackFound: fallbackInput instanceof HTMLInputElement,
    };
  }

  function findListingPriceInputFromLabel() {
    const labels = Array.from(
      document.querySelectorAll("label, div, span, p")
    ).filter((node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return false;
      return normalizeText(node.innerText || node.textContent || "") === "listing price";
    });

    for (const labelNode of labels) {
      if (!(labelNode instanceof HTMLElement)) continue;
      if (labelNode instanceof HTMLLabelElement && labelNode.htmlFor) {
        const linked = document.getElementById(labelNode.htmlFor);
        if (linked instanceof HTMLInputElement && isVisible(linked)) {
          return linked;
        }
      }

      let ancestor = labelNode;
      for (let depth = 0; depth < 6 && ancestor; depth += 1) {
        const visibleInputs = Array.from(
          ancestor.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')
        ).filter((node) => node instanceof HTMLInputElement && isVisible(node));
        if (visibleInputs.length === 1) {
          return visibleInputs[0];
        }
        ancestor = ancestor.parentElement;
      }
    }

    return null;
  }

  function logListingPriceDomSnapshot() {
    const textNodes = Array.from(
      document.querySelectorAll("label, div, span, p, legend, h1, h2, h3, h4")
    ).filter((node) => node instanceof HTMLElement && isVisible(node));

    const listingPriceTextNodes = textNodes.filter(
      (node) => normalizeText(node.innerText || node.textContent || "") === "listing price"
    );
    const priceTextNodes = textNodes.filter((node) => {
      const text = normalizeText(node.innerText || node.textContent || "");
      return text === "price" || text.includes("listing price");
    });

    const anchor =
      listingPriceTextNodes[0] instanceof HTMLElement
        ? listingPriceTextNodes[0]
        : priceTextNodes[0] instanceof HTMLElement
          ? priceTextNodes[0]
          : null;
    const section = resolveListingPriceSection(anchor);
    const nearbyLabels = section
      ? collectNearbyPriceLabels(section)
      : [];
    const inputLikeElements = section
      ? collectNearbyPriceInputs(section)
      : [];

    console.debug("[Vendoo][ListingPriceDOM]", {
      hasPriceText: priceTextNodes.length > 0,
      hasListingPriceText: listingPriceTextNodes.length > 0,
      nearbyLabels,
      inputLikeElements,
      inputLikeCount: inputLikeElements.length,
    });
  }

  function logListingPriceGlobalSearch() {
    const selector = [
      '[id*="price" i]',
      '[name*="price" i]',
      '[data-testid*="price" i]',
      '[aria-label*="price" i]',
      '[placeholder*="price" i]',
    ].join(", ");

    const matches = Array.from(document.querySelectorAll(selector));
    const entries = matches.slice(0, 40).map((node) => {
      const element = node instanceof HTMLElement ? node : null;
      return {
        tagName: element ? element.tagName.toLowerCase() : "",
        type: node instanceof HTMLInputElement ? node.type || "" : "",
        id: element?.getAttribute("id") || "",
        name: element?.getAttribute("name") || "",
        dataTestid: element?.getAttribute("data-testid") || "",
        ariaLabel: element?.getAttribute("aria-label") || "",
        placeholder: element?.getAttribute("placeholder") || "",
      };
    });

    const allElements = document.querySelectorAll("*");
    let shadowHostCount = 0;
    for (const element of allElements) {
      if (element instanceof HTMLElement && element.shadowRoot) {
        shadowHostCount += 1;
      }
    }

    const exactPriceInput = document.querySelector('input[name="generalDetails.price"]');

    console.debug("[Vendoo][ListingPriceGlobalSearch]", {
      locationHref: window.location.href,
      iframeCount: document.querySelectorAll("iframe").length,
      shadowHostCount,
      exactGeneralDetailsPriceMatchInCurrentRoot: Boolean(exactPriceInput),
      totalMatches: matches.length,
      matches: entries,
    });
  }

  function resolveListingPriceSection(anchor) {
    if (!(anchor instanceof HTMLElement)) return null;
    let current = anchor;
    for (let depth = 0; depth < 7 && current; depth += 1) {
      const count = current.querySelectorAll(
        "input, select, textarea, [contenteditable='true'], [contenteditable='']"
      ).length;
      if (count > 0) return current;
      current = current.parentElement;
    }
    return anchor.parentElement;
  }

  function collectNearbyPriceLabels(section) {
    const seen = new Set();
    const labels = [];
    const nodes = section.querySelectorAll("label, span, div, p, legend");
    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
      const text = normalizeText(node.innerText || node.textContent || "");
      if (!text || seen.has(text)) continue;
      seen.add(text);
      labels.push(text);
      if (labels.length >= 12) break;
    }
    return labels;
  }

  function collectNearbyPriceInputs(section) {
    const entries = [];
    const nodes = section.querySelectorAll(
      "input, select, textarea, [contenteditable='true'], [contenteditable='']"
    );
    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
      entries.push({
        tagName: node.tagName.toLowerCase(),
        type: node instanceof HTMLInputElement ? node.type || "" : "",
        name: node.getAttribute("name") || "",
        id: node.getAttribute("id") || "",
        dataTestid: node.getAttribute("data-testid") || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        placeholder: node.getAttribute("placeholder") || "",
      });
      if (entries.length >= 12) break;
    }
    return entries;
  }

  function isValidResolvedPrice(value) {
    return /^[$]?\d{1,6}([.,]\d{1,2})?$/.test(String(value ?? "").trim());
  }

  function normalizePriceForCompare(value) {
    return String(value ?? "")
      .replace(/[$,\s]/g, "")
      .replace(/^0+(\d)/, "$1")
      .trim();
  }

  async function runBaseGeneralVendooStage(input) {
    const { fillSteps, adapters, actionModel, runState, usedElements, payload, selectors } = input;
    const targeted = buildBaseStageTargetSteps({
      fillSteps,
      payload,
      selectors,
      actionModel,
    });
    const diagnostics = {
      baseStageAttempted: targeted.length > 0,
      baseStageFieldsTargeted: targeted.map((step) => step.label),
      baseStageFieldsFilled: [],
      baseStageFieldsNeedsReview: [],
      baseStageFieldsSkipped: [],
      baseStageCompleted: false,
      baseStageCompletedBeforeMarketplaceSwitch: false,
      baseStageReason: "",
      baseStageTargetSelectionReason:
        "explicit shared/base keys targeted before marketplace switch",
      baseStageCategoryExecutionPath:
        pickEbayCategory(payload) && pickEbayCategory(payload) !== pickEbayCategoryPath(payload)
          ? "base_simple_category_then_downstream_path"
          : "base_category_path",
      baseStageBrandExecutionPath:
        pickEbayBrand(payload)
          ? "brand_payload_to_brand_selector"
          : "brand_missing_or_fallback",
      baseCategoryStageIndexReached: 0,
      baseCategoryStagesExpected: 0,
      baseCategoryWantedAtFailure: "",
      baseCategoryVisibleCandidatesAtFailure: "none",
      baseCategoryPickerResolved: false,
      baseCategoryDropdownOpened: false,
      baseCategoryOptionSurfaceResolved: false,
      baseCategoryOptionSurfaceType: "none",
      baseCategoryRawCandidatesCount: 0,
      baseCategoryVisibleCandidatesCount: 0,
      baseCategoryClickableRowsCount: 0,
      baseCategoryOptionSurfaceChecks: "none",
      baseCategoryBreadcrumbMode: false,
      baseCategorySelectionVerified: false,
      baseCategorySelectionReason: "",
      baseStageError: "",
    };

    if (!targeted.length) {
      diagnostics.baseStageCompleted = true;
      diagnostics.baseStageCompletedBeforeMarketplaceSwitch = true;
      diagnostics.baseStageReason = "no base fields targeted";
      console.debug("[LPU Vendoo] Base stage diagnostics", diagnostics);
      return diagnostics;
    }

    try {
      for (const step of targeted) {
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
              marketplaceHint: typeof action.marketplace === "string" ? action.marketplace : "",
            });

            if (result.status === "filled") {
              usedElements.add(control);
            }

            return result;
          },
        });

        actionModel.applyActionResult(runState, step, result);
        if (step.key === "category") {
          const categoryDiagnostics =
            result?.diagnostics && typeof result.diagnostics === "object"
              ? result.diagnostics
              : {};
          diagnostics.baseCategoryStageIndexReached =
            Number(categoryDiagnostics.stageIndexReached ?? 0) || 0;
          diagnostics.baseCategoryStagesExpected =
            Number(categoryDiagnostics.stagesExpected ?? 0) || 0;
          diagnostics.baseCategoryWantedAtFailure = String(
            categoryDiagnostics.wantedAtFailure ?? ""
          );
          diagnostics.baseCategoryVisibleCandidatesAtFailure = String(
            categoryDiagnostics.visibleCandidatesAtFailure ?? "none"
          );
          diagnostics.baseCategoryPickerResolved = Boolean(
            categoryDiagnostics.pickerResolved
          );
          diagnostics.baseCategoryDropdownOpened = Boolean(
            categoryDiagnostics.dropdownOpened
          );
          diagnostics.baseCategoryOptionSurfaceResolved = Boolean(
            categoryDiagnostics.optionSurfaceResolved
          );
          diagnostics.baseCategoryOptionSurfaceType = String(
            categoryDiagnostics.optionSurfaceType ?? "none"
          );
          diagnostics.baseCategoryRawCandidatesCount =
            Number(categoryDiagnostics.rawCandidatesCount ?? 0) || 0;
          diagnostics.baseCategoryVisibleCandidatesCount =
            Number(categoryDiagnostics.visibleCandidatesCount ?? 0) || 0;
          diagnostics.baseCategoryClickableRowsCount =
            Number(categoryDiagnostics.clickableRowsCount ?? 0) || 0;
          diagnostics.baseCategoryOptionSurfaceChecks = String(
            categoryDiagnostics.optionSurfaceChecks ?? "none"
          );
          diagnostics.baseCategoryBreadcrumbMode = Boolean(
            categoryDiagnostics.breadcrumbMode
          );
          diagnostics.baseCategorySelectionVerified = Boolean(
            categoryDiagnostics.selectionVerified
          );
          diagnostics.baseCategorySelectionReason = String(
            categoryDiagnostics.selectionReason ?? result.reason ?? ""
          );
        }
        if (result.status === "filled") {
          diagnostics.baseStageFieldsFilled.push(step.label);
        } else if (result.status === "needs_review") {
          diagnostics.baseStageFieldsNeedsReview.push(
            `${step.label}${result.reason ? ` (${result.reason})` : ""}`
          );
        } else {
          diagnostics.baseStageFieldsSkipped.push(
            `${step.label}${result.reason ? ` (${result.reason})` : ""}`
          );
        }
      }

      await runBaseCategoryDependentRerun({
        categoryPersisted: diagnostics.baseCategorySelectionVerified,
        payload,
        selectors,
        usedElements,
      });

      const baseTagsDiagnostics = await fillBaseTagsIfPresent({
        payload,
        usedElements,
      });
      if (baseTagsDiagnostics.status === "filled") {
        runState.filled.push("Base tags");
      } else if (baseTagsDiagnostics.status === "needs_review") {
        runState.needsReview.push(`Base tags (${baseTagsDiagnostics.reason})`);
      } else if (baseTagsDiagnostics.status === "skipped_for_safety") {
        runState.skippedForSafety.push(`Base tags (${baseTagsDiagnostics.reason})`);
      }

      diagnostics.baseStageCompleted = true;
      diagnostics.baseStageCompletedBeforeMarketplaceSwitch = true;
      diagnostics.baseStageReason = "base stage attempted before marketplace switch";
      console.debug("[LPU Vendoo] Base stage diagnostics", diagnostics);
      return diagnostics;
    } catch (error) {
      diagnostics.baseStageCompleted = false;
      diagnostics.baseStageCompletedBeforeMarketplaceSwitch = false;
      diagnostics.baseStageReason = "base stage runtime error";
      diagnostics.baseStageError = error instanceof Error ? error.message : "unknown error";
      console.debug("[LPU Vendoo] Base stage diagnostics", diagnostics);
      return diagnostics;
    }
  }

  function isBaseGeneralFieldKey(key) {
    return ["title", "description", "brand", "color", "category"].includes(String(key));
  }

  async function fillBaseTagsIfPresent(input) {
    const { payload, usedElements } = input;
    const payloadTags = pickVendooBaseTags(payload);
    console.debug("[Vendoo][BaseTagsPayloadRead]", {
      hasVendooBaseTags:
        Array.isArray(payload?.vendooBaseTags) && payload.vendooBaseTags.length > 0,
      vendooBaseTags: Array.isArray(payload?.vendooBaseTags) ? payload.vendooBaseTags : [],
      payloadTagsDerived: payloadTags,
    });
    const diagnostics = {
      payloadTags,
      attemptedTags: [],
      insertedTags: [],
      skippedTags: [],
      reason: "",
      status: "skipped_for_safety",
    };

    if (!payloadTags.length) {
      diagnostics.reason = "vendooBaseTags missing";
      console.debug("[Vendoo][BaseTags]", diagnostics);
      return diagnostics;
    }

    const control = findBaseTagsControl();
    if (!(control instanceof Element)) {
      diagnostics.status = "needs_review";
      diagnostics.reason = "base tags field not found";
      diagnostics.skippedTags = [...payloadTags];
      console.debug("[Vendoo][BaseTags]", diagnostics);
      return diagnostics;
    }

    if (usedElements.has(control)) {
      diagnostics.reason = "collision prevention";
      diagnostics.skippedTags = [...payloadTags];
      console.debug("[Vendoo][BaseTags]", diagnostics);
      return diagnostics;
    }

    for (const tag of payloadTags) {
      diagnostics.attemptedTags.push(tag);
      if (isBaseTagPresent(control, tag)) {
        diagnostics.skippedTags.push(`${tag} (already present)`);
        continue;
      }

      const committed = tryCommitChipToken(control, tag);
      if (!committed) {
        diagnostics.skippedTags.push(`${tag} (token commit failed)`);
        continue;
      }

      await wait(100);
      if (isBaseTagPresent(control, tag)) {
        diagnostics.insertedTags.push(tag);
      } else {
        diagnostics.skippedTags.push(`${tag} (verification failed)`);
      }
    }

    if (diagnostics.insertedTags.length === payloadTags.length) {
      diagnostics.status = "filled";
      diagnostics.reason = "all tags inserted";
      usedElements.add(control);
      console.debug("[Vendoo][BaseTags]", diagnostics);
      return diagnostics;
    }

    if (diagnostics.insertedTags.length > 0) {
      diagnostics.status = "needs_review";
      diagnostics.reason = "partial tag insert";
      usedElements.add(control);
      console.debug("[Vendoo][BaseTags]", diagnostics);
      return diagnostics;
    }

    diagnostics.status = "needs_review";
    diagnostics.reason = "no tags inserted";
    console.debug("[Vendoo][BaseTags]", diagnostics);
    return diagnostics;
  }

  function pickVendooBaseTags(payload) {
    const raw = payload?.vendooBaseTags;
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const normalized = [];
    for (const value of raw) {
      if (typeof value !== "string") continue;
      const cleaned = value.trim().replace(/^#+/, "");
      if (!cleaned || seen.has(cleaned)) continue;
      seen.add(cleaned);
      normalized.push(cleaned);
    }
    return normalized;
  }

  function findBaseTagsControl() {
    const selectors = [
      'input[data-testid="generalDetails.tags"]',
      'input#generalDetails\\.tags',
      'input[name="generalDetails.tags"]',
    ];

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector));
      for (const candidate of candidates) {
        if (!(candidate instanceof HTMLInputElement)) continue;
        if (!isVisible(candidate)) continue;
        const control =
          candidate.closest(".react-select__control, [role='combobox']") ??
          candidate.closest("div");
        if (control instanceof Element && isVisible(control)) {
          return control;
        }
        return candidate;
      }
    }

    return null;
  }

  function isBaseTagPresent(control, tag) {
    if (!(control instanceof Element)) return false;
    const expected = normalizeOptionValue(tag);
    if (!expected) return false;
    const scope =
      control.closest("div, section, fieldset, form") ?? control.parentElement ?? control;
    if (!(scope instanceof Element)) return false;

    const tagNodes = Array.from(
      scope.querySelectorAll(
        ".react-select__multi-value__label, .react-select__multi-value, [class*='chip'], [class*='token']"
      )
    );
    for (const node of tagNodes) {
      if (!(node instanceof Element) || !isVisible(node)) continue;
      const value = normalizeOptionValue(cleanCategoryStage(node.textContent || ""));
      if (value === expected) return true;
    }
    return false;
  }

  function buildBaseStageTargetSteps(input) {
    const { fillSteps, payload, selectors, actionModel } = input;
    const byKey = new Map(fillSteps.map((step) => [String(step.key), step]));
    const baseCategoryValue = pickEbayCategoryPath(payload);
    const definitions = [
      {
        key: "title",
        label: "eBay title",
        payloadValue: pickEbayTitle(payload),
        selectorConfig: selectors?.title,
      },
      {
        key: "description",
        label: "eBay description",
        payloadValue: payload?.marketplaces?.ebay?.description ?? "",
        selectorConfig: selectors?.description,
      },
      {
        key: "brand",
        label: "eBay brand",
        payloadValue: pickEbayBrand(payload),
        selectorConfig: selectors?.brand,
      },
      {
        key: "color",
        label: "eBay color",
        payloadValue: pickEbayColor(payload),
        selectorConfig: selectors?.color,
      },
      {
        key: "category",
        label: "eBay category",
        payloadValue: baseCategoryValue,
        selectorConfig: selectors?.category,
      },
    ];

    const targets = [];
    for (const definition of definitions) {
      const existing = byKey.get(definition.key);
      if (existing) {
        if (definition.key === "category") {
          targets.push({
            ...existing,
            payloadValue: definition.payloadValue,
            value: definition.payloadValue,
          });
        } else {
          targets.push(existing);
        }
        continue;
      }

      const action = actionModel.createFieldAction(definition);
      targets.push({
        ...action,
        value: action.payloadValue,
      });
    }

    return targets;
  }

  async function runBaseCategoryDependentRerun(input) {
    const { categoryPersisted, payload, selectors, usedElements } = input;
    const rerunDiagnostics = {
      categoryPersisted: Boolean(categoryPersisted),
      rerunTriggered: false,
      rerunFieldsDiscovered: [],
      rerunFieldsFilled: [],
      rerunFieldsSkipped: [],
      usedDirectFieldDiscovery: false,
    };

    if (!categoryPersisted) {
      console.debug("[Vendoo][BaseCategoryRerun]", rerunDiagnostics);
      return rerunDiagnostics;
    }

    const targetLabels = new Set(["us size", "size type"]);
    const specificsSelectors = selectors?.size?.postCategorySpecificsContainerSelectors ?? [];
    const specificsRoot = await waitForSpecificsContainer(specificsSelectors);

    let rerunFields = [];
    if (specificsRoot) {
      const discovered = discoverVisibleFieldRegistry(specificsRoot);
      rerunFields = discovered.filter((field) => targetLabels.has(field.normalizedLabel));
    } else {
      rerunDiagnostics.usedDirectFieldDiscovery = true;
      const directFields = discoverBaseCategoryRerunFieldsDirect(targetLabels);
      rerunFields = directFields;
    }

    rerunDiagnostics.rerunFieldsDiscovered = rerunFields.map((field) => field.label);
    rerunDiagnostics.rerunTriggered = true;

    if (!rerunFields.length) {
      if (!specificsRoot) {
        rerunDiagnostics.rerunFieldsSkipped.push("specifics container not found");
      }
      console.debug("[Vendoo][BaseCategoryRerun]", rerunDiagnostics);
      return rerunDiagnostics;
    }

    const { candidates } = buildDynamicPayloadCandidates(payload);
    if (!candidates.length) {
      rerunDiagnostics.rerunFieldsSkipped.push("no payload values");
      console.debug("[Vendoo][BaseCategoryRerun]", rerunDiagnostics);
      return rerunDiagnostics;
    }

    for (const field of rerunFields) {
      const initialMatches = candidates.filter((candidate) =>
        isDynamicLabelMatch(field.normalizedLabel, candidate.matchTerms)
      );
      const resolved = resolveFinalMatchesByPrecedence(
        field.normalizedLabel,
        initialMatches,
        candidates
      );
      const matches = resolved.matches;
      if (field.normalizedLabel === "us size") {
        console.debug("[Vendoo][BaseUSSizeRouting]", {
          discoveredLabel: field.label,
          candidatePayloadKeysConsidered: initialMatches.map((candidate) => candidate.key),
          matchedKeysBeforeResolution: initialMatches.map((candidate) => candidate.key),
          matchedKeysAfterResolution: matches.map((candidate) => candidate.key),
          reasonWhenNoMatch: matches.length === 0 ? "no_payload_match" : "",
        });
      }
      if (matches.length !== 1) {
        rerunDiagnostics.rerunFieldsSkipped.push(
          `${field.label}: ${matches.length > 1 ? "ambiguous payload match" : "no payload match"}`
        );
        continue;
      }

      if (usedElements.has(field.control)) {
        rerunDiagnostics.rerunFieldsSkipped.push(`${field.label}: collision prevention`);
        continue;
      }

      const candidate = matches[0];
      let result = await fillDynamicFieldValue(field, candidate.value, selectors);
      const verification = await verifyDynamicFillResult(field, candidate.value, result);
      if (result.status === "filled" && !verification.passed) {
        result = {
          ...result,
          status: "needs_review",
          reason: verification.reason || "post-fill verification failed",
        };
      }

      if (result.status === "filled") {
        usedElements.add(field.control);
        rerunDiagnostics.rerunFieldsFilled.push(field.label);
      } else {
        rerunDiagnostics.rerunFieldsSkipped.push(
          `${field.label}: ${result.reason || result.status}`
        );
      }
    }

    console.debug("[Vendoo][BaseCategoryRerun]", rerunDiagnostics);
    return rerunDiagnostics;
  }

  function discoverBaseCategoryRerunFieldsDirect(targetLabels) {
    const fields = [];
    const seenControls = new Set();
    const labels = Array.from(document.querySelectorAll("label"));
    const root = document.documentElement;
    for (const labelEl of labels) {
      if (!(labelEl instanceof Element)) continue;
      if (!isVisible(labelEl)) continue;
      const label = cleanCategoryStage(labelEl.textContent || "");
      const normalizedLabel = normalizeText(label);
      if (!targetLabels.has(normalizedLabel)) continue;
      const control = findControlForVisibleLabel(labelEl, root);
      if (!(control instanceof Element)) continue;
      if (!isVisible(control)) continue;
      if (seenControls.has(control)) continue;
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

  async function runMarketplaceActivationStage(input) {
    const { targetMarketplace, selectors, preMarketplaceBaseStageCompleted } = input;
    const diagnostics = {
      marketplaceStageAttempted: true,
      targetMarketplace,
      preMarketplaceBaseStageCompleted: Boolean(preMarketplaceBaseStageCompleted),
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
        marketplaceHint: typeof step.marketplace === "string" ? step.marketplace : "",
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
    const { value, control, fieldConfig, marketplaceHint } = input;
    const stages = splitCategoryStages(value);
    const inferredMarketplace = isEtsyCategoryControl(control)
      ? "etsy"
      : evaluatePoshmarkStageGate().stageDetected
        ? "poshmark"
        : "ebay";
    const requestedMarketplace =
      typeof marketplaceHint === "string" ? marketplaceHint.trim().toLowerCase() : "";
    const categoryMarketplace =
      requestedMarketplace === "ebay" ||
      requestedMarketplace === "etsy" ||
      requestedMarketplace === "poshmark"
        ? requestedMarketplace
        : inferredMarketplace;
    console.debug("[Vendoo][CategorySegments]", {
      marketplace: categoryMarketplace,
      sourcePathUsed: "input.value",
      rawPath: String(value ?? ""),
      stageSegments: stages,
    });
    if (!stages.length) {
      return {
        status: "needs_review",
        reason: "no category stages found",
        diagnostics: {
          stageIndexReached: 0,
          stagesExpected: 0,
          wantedAtFailure: "",
          visibleCandidatesAtFailure: "none",
          pickerResolved: false,
          breadcrumbMode: false,
          selectionVerified: false,
          selectionReason: "no category stages found",
        },
      };
    }

    openCustomSelectControl(control);
    await wait(150);

    const entryPickerInfo = findVisibleCategoryPicker(fieldConfig.pickerContainerSelectors ?? []);
    const entryOptionContext = entryPickerInfo?.element
      ? discoverCategoryOptionEntries({
          optionSelectors: fieldConfig.optionSelectors ?? [],
          pickerScope: resolveCategoryOptionScope(
            entryPickerInfo.element,
            fieldConfig.optionSelectors ?? []
          ),
          pickerElement: entryPickerInfo.element,
          control,
        })
      : null;
    const entryVisibleRowsSample =
      buildVisibleOptionsPreview(entryOptionContext?.optionDiscovery?.entries ?? [], 8) || "none";
    const entryPoshmarkStageDetected = evaluatePoshmarkStageGate().stageDetected;
    const entryPickerLooksPoshmark = isLikelyPoshmarkCategoryPicker(
      entryOptionContext?.optionDiscovery?.entries ?? []
    );
    const entryCategoryGuidancePresent = Boolean(
      String(lastPoshmarkCategoryInput.rawValue || "").trim()
    );
    const entryMarketplaceHint =
      Boolean(entryPickerInfo?.element) &&
      (entryPickerLooksPoshmark || entryPoshmarkStageDetected || entryCategoryGuidancePresent)
        ? "poshmark"
        : "generic";
    console.debug("[Vendoo][CategoryEntry]", {
      marketplace: categoryMarketplace,
      canonicalPathPresent: Boolean(String(value ?? "").trim()),
      canonicalPathValue: String(value ?? ""),
      pickerOpen: Boolean(entryPickerInfo?.element),
      reason: "entered_tryFillCategoryByStages",
    });
    console.debug("[Vendoo][CategoryPathEntry]", {
      marketplaceHint: entryMarketplaceHint,
      pickerOpen: Boolean(entryPickerInfo?.element),
      visibleRowsSample: entryVisibleRowsSample,
    });

    const payloadCategoryGuidance = String(lastPoshmarkCategoryInput.rawValue || "").trim();
    const payloadEtsyCategoryGuidance = String(lastEtsyCategoryInput.rawValue || "").trim();
    const poshmarkCategoryDiagnostics = {
      payloadCategory: payloadCategoryGuidance,
      visibleRowsSample: "none",
      clicksAttempted: [],
      finalSelectedValue: "",
      committed: false,
      reason: "",
    };
    const etsyCategoryDiagnostics = {
      payloadCategory: payloadEtsyCategoryGuidance,
      visibleRowsSample: "none",
      clicksAttempted: [],
      finalSelectedValue: "",
      committed: false,
      reason: "",
    };
    let poshmarkTraversalEnabled = false;
    let etsyTraversalEnabled = false;
    let traversalStages = stages;
    const initialPickerInfo = entryPickerInfo;
    if (initialPickerInfo?.element) {
      const initialOptionContext =
        entryOptionContext ??
        discoverCategoryOptionEntries({
          optionSelectors: fieldConfig.optionSelectors ?? [],
          pickerScope: resolveCategoryOptionScope(
            initialPickerInfo.element,
            fieldConfig.optionSelectors ?? []
          ),
          pickerElement: initialPickerInfo.element,
          control,
        });
      if (
        !isEtsyCategoryControl(control) &&
        !evaluatePoshmarkStageGate().stageDetected &&
        !evaluateEtsyStageGate().stageDetected
      ) {
        const canonicalPath = cleanCategoryStage(value);
        let stageSegments = splitCategoryStages(canonicalPath);
        let reason = "canonical_path_segments";
        const visibleNormalized = new Set(
          initialOptionContext.optionDiscovery.entries
            .map((entry) => normalizeText(cleanCategoryStage(getOptionTextFromEntry(entry))))
            .filter(Boolean)
        );
        const initialWantedNormalized = normalizeText(stageSegments[0] ?? "");
        const stageOneAliasMap = fieldConfig?.stageOneAliases ?? {};
        if (
          stageSegments.length >= 2 &&
          initialWantedNormalized &&
          !visibleNormalized.has(initialWantedNormalized)
        ) {
          const visibleRoots = Object.keys(stageOneAliasMap).filter((rootLabel) =>
            visibleNormalized.has(normalizeText(rootLabel))
          );
          if (visibleRoots.length === 1) {
            const rootLabel = visibleRoots[0];
            const normalizedRoot = normalizeText(rootLabel);
            if (normalizedRoot && initialWantedNormalized !== normalizedRoot) {
              stageSegments = [rootLabel, ...stageSegments];
              reason = "prepended_visible_root_segment";
            }
          }
        }
        if (stageSegments.length) {
          traversalStages = stageSegments;
        }
        console.debug("[Vendoo][EbayCategoryInit]", {
          canonicalPath,
          confirmedPrefix: "",
          stageSegments,
          initialWanted: stageSegments[0] ?? "",
          reason,
        });
      }
      poshmarkCategoryDiagnostics.visibleRowsSample =
        buildVisibleOptionsPreview(initialOptionContext.optionDiscovery.entries, 8) || "none";

      const pickerOpen = Boolean(initialPickerInfo?.element);
      const poshmarkTab = findMarketplaceTab("poshmark");
      const poshmarkTabActive = isPoshmarkTabSpecificallyActive(poshmarkTab);
      const poshmarkStageDetected = evaluatePoshmarkStageGate().stageDetected;
      const pickerLooksPoshmark = isLikelyPoshmarkCategoryPicker(
        initialOptionContext.optionDiscovery.entries
      );
      const categoryGuidancePresent = Boolean(payloadCategoryGuidance);
      const marketplaceHint =
        pickerOpen && (pickerLooksPoshmark || poshmarkStageDetected || categoryGuidancePresent)
          ? "poshmark"
          : "generic";
      const willEnterPoshmarkBranch =
        categoryMarketplace === "poshmark" &&
        marketplaceHint === "poshmark" &&
        pickerOpen &&
        categoryGuidancePresent;
      console.debug("[Vendoo][PoshmarkCategoryBranchCheck]", {
        marketplaceHint,
        pickerOpen,
        poshmarkTabActive,
        poshmarkStageDetected,
        pickerLooksPoshmark,
        categoryGuidancePresent,
        willEnterPoshmarkBranch,
      });
      if (willEnterPoshmarkBranch) {
        console.debug("[Vendoo][PoshmarkCategoryBranch]", {
          entered: true,
          payloadCategoryGuidancePresent: categoryGuidancePresent,
          visibleRowsSample: poshmarkCategoryDiagnostics.visibleRowsSample,
        });
        if (!payloadCategoryGuidance) {
          poshmarkCategoryDiagnostics.reason = "payload category guidance missing";
          logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
          return {
            status: "needs_review",
            reason: "payload category guidance missing",
            diagnostics: {
              stageIndexReached: 0,
              stagesExpected: 0,
              wantedAtFailure: "",
              visibleCandidatesAtFailure: poshmarkCategoryDiagnostics.visibleRowsSample,
              pickerResolved: true,
              dropdownOpened: true,
              optionSurfaceResolved: true,
              optionSurfaceType: "picker_scope",
              optionSurfaceChecks: "poshmark_picker_scope",
              rawCandidatesCount: initialOptionContext.optionDiscovery.rawCount,
              visibleCandidatesCount: initialOptionContext.optionDiscovery.visibleCount,
              clickableRowsCount: initialOptionContext.optionDiscovery.visibleCount,
              breadcrumbMode: false,
              selectionVerified: false,
              selectionReason: "payload category guidance missing",
            },
          };
        }

        const derivedStages = derivePoshmarkCategoryStages(
          payloadCategoryGuidance,
          initialOptionContext.optionDiscovery.entries
        );
        if (!derivedStages.length) {
          poshmarkCategoryDiagnostics.reason =
            "payload category guidance could not be mapped to visible taxonomy";
          logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
          return {
            status: "needs_review",
            reason: "payload category guidance could not be mapped to visible taxonomy",
            diagnostics: {
              stageIndexReached: 0,
              stagesExpected: 0,
              wantedAtFailure: payloadCategoryGuidance,
              visibleCandidatesAtFailure: poshmarkCategoryDiagnostics.visibleRowsSample,
              pickerResolved: true,
              dropdownOpened: true,
              optionSurfaceResolved: true,
              optionSurfaceType: "picker_scope",
              optionSurfaceChecks: "poshmark_picker_scope",
              rawCandidatesCount: initialOptionContext.optionDiscovery.rawCount,
              visibleCandidatesCount: initialOptionContext.optionDiscovery.visibleCount,
              clickableRowsCount: initialOptionContext.optionDiscovery.visibleCount,
              breadcrumbMode: false,
              selectionVerified: false,
              selectionReason:
                "payload category guidance could not be mapped to visible taxonomy",
            },
          };
        }

        traversalStages = derivedStages;
        poshmarkTraversalEnabled = true;
        logPoshmarkCategoryDiagnostics({
          ...poshmarkCategoryDiagnostics,
          reason: "live poshmark category path detected",
        });
      } else if (
        categoryMarketplace === "etsy" &&
        isEtsyCategoryControl(control) &&
        Boolean(initialPickerInfo?.element) &&
        Boolean(payloadEtsyCategoryGuidance) &&
        evaluateEtsyStageGate().stageDetected
      ) {
        etsyTraversalEnabled = true;
        traversalStages = splitCategoryStages(payloadEtsyCategoryGuidance);
        etsyCategoryDiagnostics.visibleRowsSample =
          buildVisibleOptionsPreview(initialOptionContext.optionDiscovery.entries, 8) || "none";
        if (!traversalStages.length) {
          etsyCategoryDiagnostics.reason = "payload category guidance missing";
          logEtsyCategoryDiagnostics(etsyCategoryDiagnostics);
          return {
            status: "needs_review",
            reason: "payload category guidance missing",
            diagnostics: {
              stageIndexReached: 0,
              stagesExpected: 0,
              wantedAtFailure: payloadEtsyCategoryGuidance,
              visibleCandidatesAtFailure: etsyCategoryDiagnostics.visibleRowsSample,
              pickerResolved: true,
              dropdownOpened: true,
              optionSurfaceResolved: true,
              optionSurfaceType: "picker_scope",
              optionSurfaceChecks: "etsy_picker_scope",
              rawCandidatesCount: initialOptionContext.optionDiscovery.rawCount,
              visibleCandidatesCount: initialOptionContext.optionDiscovery.visibleCount,
              clickableRowsCount: initialOptionContext.optionDiscovery.visibleCount,
              breadcrumbMode: false,
              selectionVerified: false,
              selectionReason: "payload category guidance missing",
            },
          };
        }
      } else {
        console.debug("[Vendoo][CategoryFallbackBranch]", {
          marketplaceHint,
          reason: "poshmark category branch not entered",
        });
        console.debug("[Vendoo][CategoryFallbackPath]", {
          marketplace: categoryMarketplace,
          reason: "poshmark category branch not entered",
        });
      }
    } else {
      console.debug("[Vendoo][CategoryFallbackBranch]", {
        marketplaceHint: "generic",
        reason: "picker not found at entry",
      });
      console.debug("[Vendoo][CategoryFallbackPath]", {
        marketplace: categoryMarketplace,
        reason: "picker not found at entry",
      });
    }
    console.debug("[Vendoo][EbayCategoryLiveBranch]", {
      entered:
        categoryMarketplace === "ebay" && !poshmarkTraversalEnabled && !etsyTraversalEnabled,
      canonicalPathValue: String(value ?? ""),
      stageSegments: traversalStages,
      initialWanted: traversalStages[0] ?? "",
      reason:
        !poshmarkTraversalEnabled && !etsyTraversalEnabled
          ? "default_category_traversal_branch"
          : "non_ebay_category_branch",
    });

    let stageOneChosenDebug = "";
    const confirmedStages = [];
    let lastVisibleSample = "";
    let optionSurfaceResolved = false;
    let optionSurfaceType = "none";
    let optionSurfaceChecks = "";
    let dropdownOpened = true;
    for (let index = 0; index < traversalStages.length; index += 1) {
      const stageLabel = traversalStages[index];
      const stageLabelsToTry = getStageLabelsForMatch(stageLabel, index, fieldConfig);
      const pickerInfo = findVisibleCategoryPicker(fieldConfig.pickerContainerSelectors ?? []);
      if (!pickerInfo?.element) {
        if (poshmarkTraversalEnabled) {
          poshmarkCategoryDiagnostics.reason = `stopped at stage ${index + 1}: picker not found`;
          logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
        }
        return {
          status: "needs_review",
          reason: `stopped at stage ${index + 1}: picker not found`,
        };
      }

      const pickerScope = resolveCategoryOptionScope(
        pickerInfo.element,
        fieldConfig.optionSelectors ?? []
      );

      let optionContext = discoverCategoryOptionEntries({
        optionSelectors: fieldConfig.optionSelectors ?? [],
        pickerScope,
        pickerElement: pickerInfo.element,
        control,
      });
      let optionDiscovery = optionContext.optionDiscovery;
      optionSurfaceResolved = optionContext.optionSurfaceResolved;
      optionSurfaceType = optionContext.optionSurfaceType;
      optionSurfaceChecks = optionContext.optionSurfaceChecks;
      let optionEntries = optionDiscovery.entries;
      if (etsyTraversalEnabled) {
        const etsyScoped = discoverEtsyCategoryOptionEntries({
          pickerElement: pickerInfo.element,
          control,
          optionSelectors: fieldConfig.optionSelectors ?? [],
        });
        optionDiscovery = etsyScoped.optionDiscovery;
        optionSurfaceResolved = etsyScoped.optionSurfaceResolved;
        optionSurfaceType = etsyScoped.optionSurfaceType;
        optionSurfaceChecks = etsyScoped.optionSurfaceChecks;
        optionEntries = optionDiscovery.entries;
      }
      let effectiveStageLabelsToTry = stageLabelsToTry;
      if (poshmarkTraversalEnabled) {
        effectiveStageLabelsToTry = resolvePoshmarkStageLabelsForLiveStep({
          stageLabel,
          stageLabelsToTry,
          optionEntries,
          stageIndex: index,
          stagesExpected: traversalStages.length,
        });
      }
      if (index === 0) {
        console.debug("[Vendoo][CategoryInitialWanted]", {
          marketplace: categoryMarketplace,
          confirmedPrefix: confirmedStages.join(" > "),
          stageIndex: index,
          initialWanted: effectiveStageLabelsToTry[0] ?? stageLabel,
          reason: "first_stage_effective_target",
        });
      }
      if (
        !poshmarkTraversalEnabled &&
        !etsyTraversalEnabled &&
        index === 0 &&
        confirmedStages.length === 0 &&
        optionDiscovery.scopeMode === "category_modal_scope"
      ) {
        const currentWantedNormalized = normalizeText(effectiveStageLabelsToTry[0] ?? stageLabel);
        const visibleNormalized = new Set(
          optionEntries
            .map((entry) => normalizeText(cleanCategoryStage(getOptionTextFromEntry(entry))))
            .filter(Boolean)
        );
        if (!visibleNormalized.has(currentWantedNormalized)) {
          const stageOneAliasMap = fieldConfig?.stageOneAliases ?? {};
          const visibleStageOneRoots = Object.keys(stageOneAliasMap).filter((rootLabel) =>
            visibleNormalized.has(normalizeText(rootLabel))
          );
          if (visibleStageOneRoots.length === 1) {
            const rootStageLabel = visibleStageOneRoots[0];
            const rootAliases = stageOneAliasMap[rootStageLabel] ?? [];
            effectiveStageLabelsToTry = [rootStageLabel, ...rootAliases].filter(Boolean);
          }
        }
      }
      let poshmarkStage1Diagnostic = null;
      let poshmarkStage1Resolution = null;
      if (poshmarkTraversalEnabled && index === 0) {
        const wantedStage = effectiveStageLabelsToTry[0] ?? stageLabel;
        await wait(180);
        optionContext = discoverCategoryOptionEntries({
          optionSelectors: fieldConfig.optionSelectors ?? [],
          pickerScope,
          pickerElement: pickerInfo.element,
          control,
        });
        optionDiscovery = optionContext.optionDiscovery;
        optionSurfaceResolved = optionContext.optionSurfaceResolved;
        optionSurfaceType = optionContext.optionSurfaceType;
        optionSurfaceChecks = optionContext.optionSurfaceChecks;
        optionEntries = optionDiscovery.entries;
        poshmarkStage1Resolution = resolvePoshmarkStage1Candidate({
          pickerElement: pickerInfo.element,
          control,
          wantedStage,
        });
        poshmarkStage1Diagnostic = {
          wanted: wantedStage,
          rawCandidateCount: poshmarkStage1Resolution.rawCandidateCount,
          filteredCandidateCount: poshmarkStage1Resolution.filteredCandidateCount,
          visibleRowsSample: poshmarkStage1Resolution.visibleRowsSample,
          matchedRowText: "",
          clickDispatched: false,
          reason: "",
        };
      }
      let stageMatchResult = findCategoryStageMatches({
        optionEntries,
        stageLabelsToTry: effectiveStageLabelsToTry,
        stageIndex: index,
        confirmedStages,
        pickerElement: pickerInfo.element,
        optionSelectors: fieldConfig.optionSelectors ?? [],
      });
      optionEntries = stageMatchResult.candidateEntries;
      let matches = stageMatchResult.matches;
      if (etsyTraversalEnabled) {
        matches = findEtsyStageMatches(optionEntries, effectiveStageLabelsToTry[0] ?? stageLabel);
      }
      if (
        poshmarkTraversalEnabled &&
        index === 0 &&
        poshmarkStage1Resolution?.matchedEntry &&
        matches.length !== 1
      ) {
        matches = [poshmarkStage1Resolution.matchedEntry];
      }
      if (poshmarkTraversalEnabled && index === 0 && matches.length !== 1) {
        const wantedStage = effectiveStageLabelsToTry[0] ?? stageLabel;
        const poshmarkStageOneMatches = findPoshmarkVisibleStageMatches(
          optionEntries,
          wantedStage
        );
        if (poshmarkStageOneMatches.length === 1) {
          matches = poshmarkStageOneMatches;
        }
      }

      if (matches.length !== 1 && !etsyTraversalEnabled) {
        const searchInput = findPickerSearchInput(
          pickerScope ?? pickerInfo.element,
          fieldConfig.searchInputSelectors ?? []
        );

        if (searchInput) {
          setElementValue(searchInput, effectiveStageLabelsToTry[0] ?? stageLabel);
          await wait(140);
          optionContext = discoverCategoryOptionEntries({
            optionSelectors: fieldConfig.optionSelectors ?? [],
            pickerScope,
            pickerElement: pickerInfo.element,
            control,
          });
          optionDiscovery = optionContext.optionDiscovery;
          optionSurfaceResolved = optionContext.optionSurfaceResolved;
          optionSurfaceType = optionContext.optionSurfaceType;
          optionSurfaceChecks = optionContext.optionSurfaceChecks;
          optionEntries = optionDiscovery.entries;
          stageMatchResult = findCategoryStageMatches({
            optionEntries,
            stageLabelsToTry: effectiveStageLabelsToTry,
            stageIndex: index,
            confirmedStages,
            pickerElement: pickerInfo.element,
            optionSelectors: fieldConfig.optionSelectors ?? [],
          });
          optionEntries = stageMatchResult.candidateEntries;
          matches = stageMatchResult.matches;
          if (etsyTraversalEnabled) {
            matches = findEtsyStageMatches(
              optionEntries,
              effectiveStageLabelsToTry[0] ?? stageLabel
            );
          }
          if (
            poshmarkTraversalEnabled &&
            index === 0 &&
            poshmarkStage1Resolution?.matchedEntry &&
            matches.length !== 1
          ) {
            matches = [poshmarkStage1Resolution.matchedEntry];
          }
          if (poshmarkTraversalEnabled && index === 0 && matches.length !== 1) {
            const wantedStage = effectiveStageLabelsToTry[0] ?? stageLabel;
            const poshmarkStageOneMatches = findPoshmarkVisibleStageMatches(
              optionEntries,
              wantedStage
            );
            if (poshmarkStageOneMatches.length === 1) {
              matches = poshmarkStageOneMatches;
            }
          }
        }
      }

      if (etsyTraversalEnabled && matches.length !== 1 && index === traversalStages.length - 1) {
        const closest = findClosestEtsyFinalStageMatch(
          optionEntries,
          effectiveStageLabelsToTry[0] ?? stageLabel
        );
        if (closest) {
          matches = [closest];
        }
      }

      if (matches.length !== 1) {
        const wanted = effectiveStageLabelsToTry[0] ?? stageLabel;
        if (poshmarkStage1Diagnostic) {
          poshmarkStage1Diagnostic.reason =
            poshmarkStage1Resolution?.reason || "no_unique_stage1_match";
          console.debug("[Vendoo][PoshmarkCategoryStage1]", poshmarkStage1Diagnostic);
        }
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

        if (poshmarkTraversalEnabled) {
          poshmarkCategoryDiagnostics.reason = withChosen;
          poshmarkCategoryDiagnostics.visibleRowsSample =
            filteredVisibleSample || visiblePreview || "none";
          poshmarkCategoryDiagnostics.finalSelectedValue = getControlSummaryText(control);
          logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
        }
        if (etsyTraversalEnabled) {
          etsyCategoryDiagnostics.reason = withChosen;
          etsyCategoryDiagnostics.visibleRowsSample =
            buildVisibleOptionsPreview(optionEntries, 8) || "none";
          etsyCategoryDiagnostics.finalSelectedValue = getControlSummaryText(control);
          etsyCategoryDiagnostics.committed = false;
          logEtsyCategoryDiagnostics(etsyCategoryDiagnostics);
        }

        console.debug("[LPU Vendoo] Category stage diagnostics", {
          stageIndex: index + 1,
          wanted,
          aliasesTried: effectiveStageLabelsToTry,
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
          diagnostics: {
            stageIndexReached: index,
            stagesExpected: traversalStages.length,
            wantedAtFailure: wanted,
            visibleCandidatesAtFailure: visiblePreview || "none",
            pickerResolved: !!pickerInfo?.element,
            dropdownOpened,
            optionSurfaceResolved,
            optionSurfaceType,
            optionSurfaceChecks,
            rawCandidatesCount: optionDiscovery.rawCount,
            visibleCandidatesCount: optionDiscovery.visibleCount,
            clickableRowsCount: stageMatchResult.clickableRowCount ?? 0,
            breadcrumbMode: !!stageMatchResult.breadcrumbMode,
            selectionVerified: false,
            selectionReason: withChosen,
          },
        };
      }

      if (index === 0) {
        stageOneChosenDebug = describeOptionEntry(matches[0]);
      }

      clickElement(matches[0].clickTarget);
      if (poshmarkStage1Diagnostic) {
        poshmarkStage1Diagnostic.matchedRowText = cleanCategoryStage(
          getOptionTextFromEntry(matches[0])
        );
        poshmarkStage1Diagnostic.clickDispatched = true;
        poshmarkStage1Diagnostic.reason = "click_dispatched";
        console.debug("[Vendoo][PoshmarkCategoryStage1]", poshmarkStage1Diagnostic);
      }
      if (poshmarkTraversalEnabled) {
        poshmarkCategoryDiagnostics.clicksAttempted.push(
          cleanCategoryStage(getOptionTextFromEntry(matches[0])) || stageLabel
        );
      }
      if (etsyTraversalEnabled) {
        etsyCategoryDiagnostics.clicksAttempted.push(
          cleanCategoryStage(getOptionTextFromEntry(matches[0])) || stageLabel
        );
        etsyCategoryDiagnostics.visibleRowsSample =
          buildVisibleOptionsPreview(optionEntries, 8) || "none";
      }
      confirmedStages.push(stageLabel);
      const waitResult = await waitForCategoryStageTransition({
        pickerElement: pickerInfo.element,
        optionSelectors: fieldConfig.optionSelectors ?? [],
        previousVisibleSample: lastVisibleSample || optionDiscovery.visibleSample || "",
        expectedNextStage: traversalStages[index + 1] ?? "",
      });
      lastVisibleSample = waitResult.visibleSample || lastVisibleSample;
      if (!waitResult.changed) {
        await wait(120);
      }
    }

    const completionConfirmed = isCategoryCompletionConfirmed({
      control,
      fullPath:
        poshmarkTraversalEnabled || etsyTraversalEnabled
          ? traversalStages.join(" > ")
          : value,
      fieldConfig,
    });
    let poshmarkCommitted = completionConfirmed;
    let etsyCommitted = completionConfirmed;

    if (poshmarkTraversalEnabled && !poshmarkCommitted) {
      const commitResult = await finalizePoshmarkCategoryCommit({
        control,
        fieldConfig,
        finalStageLabel: traversalStages[traversalStages.length - 1] ?? "",
        fullPath: traversalStages.join(" > "),
      });
      poshmarkCommitted = commitResult.committed;
      poshmarkCategoryDiagnostics.finalSelectedValue = commitResult.finalSelectedValue;
      if (!commitResult.committed) {
        poshmarkCategoryDiagnostics.reason = commitResult.reason;
        poshmarkCategoryDiagnostics.committed = false;
        logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
      }
    }
    if (etsyTraversalEnabled && !etsyCommitted) {
      const commitResult = await finalizeEtsyCategoryCommit({
        control,
        fieldConfig,
        finalStageLabel: traversalStages[traversalStages.length - 1] ?? "",
        fullPath: traversalStages.join(" > "),
      });
      etsyCommitted = commitResult.committed;
      etsyCategoryDiagnostics.finalSelectedValue = commitResult.finalSelectedValue;
      if (!commitResult.committed) {
        etsyCategoryDiagnostics.reason = commitResult.reason;
        etsyCategoryDiagnostics.committed = false;
        logEtsyCategoryDiagnostics(etsyCategoryDiagnostics);
      }
    }

    if (!poshmarkCommitted || !etsyCommitted) {
      if (poshmarkTraversalEnabled) {
        poshmarkCategoryDiagnostics.reason =
          poshmarkCategoryDiagnostics.reason || "completion not confirmed";
        poshmarkCategoryDiagnostics.finalSelectedValue = getControlSummaryText(control);
        poshmarkCategoryDiagnostics.committed = false;
        logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
      }
      if (etsyTraversalEnabled) {
        etsyCategoryDiagnostics.reason =
          etsyCategoryDiagnostics.reason || "completion not confirmed";
        etsyCategoryDiagnostics.finalSelectedValue = getControlSummaryText(control);
        etsyCategoryDiagnostics.committed = false;
        logEtsyCategoryDiagnostics(etsyCategoryDiagnostics);
      }
      return {
        status: "needs_review",
        reason: "completion not confirmed",
        diagnostics: {
          stageIndexReached: traversalStages.length,
          stagesExpected: traversalStages.length,
          wantedAtFailure: traversalStages[traversalStages.length - 1] ?? "",
          visibleCandidatesAtFailure: lastVisibleSample || "none",
          pickerResolved: true,
          dropdownOpened,
          optionSurfaceResolved,
          optionSurfaceType,
          optionSurfaceChecks,
          rawCandidatesCount: 0,
          visibleCandidatesCount: 0,
          clickableRowsCount: 0,
          breadcrumbMode: true,
          selectionVerified: false,
          selectionReason: "completion not confirmed",
        },
      };
    }

    if (poshmarkTraversalEnabled) {
      poshmarkCategoryDiagnostics.finalSelectedValue = getControlSummaryText(control);
      poshmarkCategoryDiagnostics.reason = "selection completed";
      poshmarkCategoryDiagnostics.committed = true;
      logPoshmarkCategoryDiagnostics(poshmarkCategoryDiagnostics);
    }
    if (etsyTraversalEnabled) {
      etsyCategoryDiagnostics.finalSelectedValue = getControlSummaryText(control);
      etsyCategoryDiagnostics.reason = "selection completed";
      etsyCategoryDiagnostics.committed = true;
      logEtsyCategoryDiagnostics(etsyCategoryDiagnostics);
    }

    return {
      status: "filled",
      diagnostics: {
        stageIndexReached: traversalStages.length,
        stagesExpected: traversalStages.length,
        wantedAtFailure: "",
        visibleCandidatesAtFailure: "none",
        pickerResolved: true,
        dropdownOpened,
        optionSurfaceResolved,
        optionSurfaceType,
        optionSurfaceChecks,
        rawCandidatesCount: 0,
        visibleCandidatesCount: 0,
        clickableRowsCount: 0,
        breadcrumbMode: true,
        selectionVerified: true,
        selectionReason: "category completion confirmed",
      },
    };
  }

  function logPoshmarkCategoryDiagnostics(diagnostics) {
    console.debug("[Vendoo][PoshmarkCategory]", {
      payloadCategory: String(diagnostics?.payloadCategory || ""),
      clicksAttempted: Array.isArray(diagnostics?.clicksAttempted)
        ? diagnostics.clicksAttempted
        : [],
      visibleRowsSample: String(diagnostics?.visibleRowsSample || "none"),
      finalSelectedValue: String(diagnostics?.finalSelectedValue || ""),
      committed: Boolean(diagnostics?.committed),
      reason: String(diagnostics?.reason || ""),
    });
  }

  function logEtsyCategoryDiagnostics(diagnostics) {
    console.debug("[Vendoo][EtsyCategory]", {
      payloadCategory: String(diagnostics?.payloadCategory || ""),
      clicksAttempted: Array.isArray(diagnostics?.clicksAttempted)
        ? diagnostics.clicksAttempted
        : [],
      visibleRowsSample: String(diagnostics?.visibleRowsSample || "none"),
      finalSelectedValue: String(diagnostics?.finalSelectedValue || ""),
      committed: Boolean(diagnostics?.committed),
      reason: String(diagnostics?.reason || ""),
    });
  }

  function isEtsyCategoryControl(control) {
    if (!(control instanceof Element)) return false;
    if (
      control.matches(
        '#categoryV2, [id="categoryV2"], [role="category-input"], [name="categoryV2"]'
      )
    ) {
      return true;
    }
    const exactInput = control.querySelector?.(
      '#categoryV2, [id="categoryV2"], [role="category-input"], [name="categoryV2"]'
    );
    return exactInput instanceof Element;
  }

  function discoverEtsyCategoryOptionEntries(input) {
    const { pickerElement, control, optionSelectors } = input;
    const panel =
      resolveEtsyCategoryPickerPanel(pickerElement, control) ?? pickerElement ?? document;
    const optionDiscovery = findVisibleOptionEntries(
      optionSelectors,
      panel,
      "etsy_picker_scope"
    );
    return {
      optionDiscovery,
      optionSurfaceResolved: true,
      optionSurfaceType: "etsy_picker_scope",
      optionSurfaceChecks: "etsy_picker_scope",
    };
  }

  function resolveEtsyCategoryPickerPanel(pickerElement, control) {
    function panelFromControls(node) {
      if (!(node instanceof Element)) return null;
      const controlsId = String(node.getAttribute("aria-controls") || "").trim();
      if (!controlsId) return null;
      const panel = document.getElementById(controlsId);
      if (!(panel instanceof Element) || !isVisible(panel)) return null;
      return panel;
    }

    const fromControl = panelFromControls(control);
    if (fromControl) return fromControl;
    const fromActive = panelFromControls(document.activeElement);
    if (fromActive) return fromActive;
    if (pickerElement instanceof Element && isVisible(pickerElement)) return pickerElement;
    return null;
  }

  function findEtsyStageMatches(optionEntries, wantedStage) {
    const normalizedWanted = normalizeText(cleanCategoryStage(wantedStage));
    if (!normalizedWanted) return [];
    return optionEntries.filter((entry) =>
      getOptionTextCandidates(entry).some(
        (candidate) => normalizeText(cleanCategoryStage(candidate)) === normalizedWanted
      )
    );
  }

  function findClosestEtsyFinalStageMatch(optionEntries, wantedStage) {
    const normalizedWanted = normalizeText(cleanCategoryStage(wantedStage));
    const wantedTokens = new Set((normalizedWanted.match(/[a-z0-9]+/g) || []).filter(Boolean));
    if (!wantedTokens.size) return null;

    let bestEntry = null;
    let bestScore = 0;
    for (const entry of optionEntries) {
      const rowText = cleanCategoryStage(getOptionTextFromEntry(entry));
      const normalizedRow = normalizeText(rowText);
      if (!normalizedRow) continue;
      const rowTokens = new Set((normalizedRow.match(/[a-z0-9]+/g) || []).filter(Boolean));
      if (!rowTokens.size) continue;

      let overlap = 0;
      for (const token of wantedTokens) {
        if (rowTokens.has(token)) overlap += 1;
      }
      if (!overlap) continue;

      const score = overlap / Math.max(wantedTokens.size, 1);
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  async function finalizeEtsyCategoryCommit(input) {
    const { control, fieldConfig, finalStageLabel, fullPath } = input;

    function buildSummary() {
      return cleanCategoryStage(getControlSummaryText(control));
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const confirmed = isCategoryCompletionConfirmed({
        control,
        fullPath: fullPath || finalStageLabel,
        fieldConfig,
      });
      if (confirmed) {
        return {
          committed: true,
          finalSelectedValue: buildSummary(),
          reason: "category completion confirmed",
        };
      }

      control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      control.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      await wait(140);
    }

    return {
      committed: false,
      finalSelectedValue: buildSummary(),
      reason: "completion not confirmed",
    };
  }

  function isLikelyPoshmarkCategoryPicker(optionEntries) {
    const poshTopLevel = new Set([
      "electronics",
      "home",
      "kids",
      "men",
      "pets",
      "women",
    ]);
    const labels = optionEntries
      .map((entry) => normalizeText(getOptionTextFromEntry(entry)))
      .filter(Boolean);
    if (!labels.length) return false;
    return labels.some((label) => poshTopLevel.has(label));
  }

  function derivePoshmarkCategoryStages(pathValue, optionEntries) {
    const poshTopLevelMap = {
      women: "Women",
      men: "Men",
      kids: "Kids",
      home: "Home",
      electronics: "Electronics",
      pets: "Pets",
    };
    const availableTopLevel = new Set(
      optionEntries
        .map((entry) => normalizeText(getOptionTextFromEntry(entry)))
        .filter(Boolean)
    );
    const rawStages = splitCategoryStages(String(pathValue ?? ""));
    const normalizedPath = normalizeText(String(pathValue ?? ""));
    const derived = [];
    let topLevelAdded = false;

    function resolveTopLevelFromText(text) {
      const normalized = normalizeText(text);
      for (const [key, display] of Object.entries(poshTopLevelMap)) {
        if (!normalized.includes(key)) continue;
        return { key, display };
      }
      return null;
    }

    function maybeAddTopLevelFromText(text) {
      const resolved = resolveTopLevelFromText(text);
      if (!resolved) return false;
      const visibleTopLevelMatch = Array.from(availableTopLevel).find(
        (candidate) =>
          candidate === resolved.key ||
          candidate.includes(resolved.key) ||
          resolved.key.includes(candidate)
      );
      if (!visibleTopLevelMatch && availableTopLevel.size > 0) {
        return false;
      }
      if (!topLevelAdded) {
        derived.push(resolved.display);
        topLevelAdded = true;
      }
      return true;
    }

    for (const stage of rawStages) {
      const normalizedStage = normalizeText(stage);
      if (!normalizedStage) continue;
      if (
        normalizedStage.includes("clothing shoes accessories") ||
        normalizedStage.includes("clothing, shoes & accessories")
      ) {
        continue;
      }
      if (maybeAddTopLevelFromText(normalizedStage)) {
        continue;
      }
      if (!topLevelAdded && maybeAddTopLevelFromText(normalizedPath)) {
        continue;
      }
      if (derived.length === 0) {
        const fallbackTop = resolveTopLevelFromText(normalizedPath);
        if (fallbackTop) {
          derived.push(fallbackTop.display);
          topLevelAdded = true;
        } else {
          continue;
        }
      }
      if (normalizeText(derived[derived.length - 1]) === normalizedStage) continue;
      derived.push(stage);
    }

    if (!topLevelAdded) {
      const fallbackTop = resolveTopLevelFromText(normalizedPath);
      if (fallbackTop) {
        derived.push(fallbackTop.display);
        topLevelAdded = true;
      }
    }

    return derived.filter(Boolean);
  }

  function resolvePoshmarkStageLabelsForLiveStep(input) {
    const { stageLabel, stageLabelsToTry, optionEntries, stageIndex, stagesExpected } = input;
    const baseLabels = Array.isArray(stageLabelsToTry) ? stageLabelsToTry.filter(Boolean) : [];
    if (!baseLabels.length) return [stageLabel].filter(Boolean);

    const isFinalStage = stageIndex >= stagesExpected - 1;
    if (!isFinalStage) return baseLabels;

    const raw = String(stageLabel ?? "").trim();
    if (!raw) return baseLabels;

    const tokenParts = raw
      .split(/[>,]/)
      .map((part) => cleanCategoryStage(part))
      .filter(Boolean);
    if (tokenParts.length <= 1) return baseLabels;

    const normalizedTokens = tokenParts
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .filter((token) => token.length >= 3);
    if (!normalizedTokens.length) return baseLabels;

    let bestLabel = "";
    let bestScore = 0;
    for (const entry of optionEntries) {
      const rowLabel = cleanCategoryStage(getOptionTextFromEntry(entry));
      const normalizedRowLabel = normalizeText(rowLabel);
      if (!normalizedRowLabel) continue;

      let score = 0;
      for (const token of normalizedTokens) {
        if (normalizedRowLabel === token) score += 3;
        else if (normalizedRowLabel.includes(token) || token.includes(normalizedRowLabel)) score += 2;
      }
      if (!score) continue;
      if (score > bestScore) {
        bestScore = score;
        bestLabel = rowLabel;
      }
    }

    if (!bestLabel) return baseLabels;
    return Array.from(new Set([bestLabel, ...baseLabels]));
  }

  function normalizePoshmarkStageText(value) {
    const cleaned = cleanCategoryStage(String(value ?? ""))
      .replace(/[>›»]/g, " ")
      .replace(/["'`“”‘’]/g, "")
      .replace(/[^\w\s/&-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!cleaned) return "";

    const iconNoise = new Set([
      "chevron",
      "arrow",
      "right",
      "left",
      "up",
      "down",
      "expand",
      "collapse",
    ]);
    const tokens = cleaned
      .split(" ")
      .filter((token) => token && !iconNoise.has(token));
    const deduped = [];
    for (const token of tokens) {
      if (deduped.length && deduped[deduped.length - 1] === token) continue;
      deduped.push(token);
    }
    return deduped.join(" ").trim();
  }

  function findPoshmarkVisibleStageMatches(optionEntries, wantedStage) {
    const normalizedWanted = normalizePoshmarkStageText(wantedStage);
    if (!normalizedWanted) return [];
    return optionEntries.filter((entry) =>
      getOptionTextCandidates(entry).some(
        (candidate) => normalizePoshmarkStageText(candidate) === normalizedWanted
      )
    );
  }

  function resolvePoshmarkStage1Candidate(input) {
    const { pickerElement, control, wantedStage } = input;
    const rowSelector = 'div[data-testid="category-option-dropdown"][role="option"]';
    if (!(pickerElement instanceof Element)) {
      return {
        matchedEntry: null,
        rawCandidateCount: 0,
        filteredCandidateCount: 0,
        visibleRowsSample: "none",
        reason: "picker_missing",
      };
    }

    const activePanel = resolveActivePoshmarkPickerPanel({
      pickerElement,
      control,
      rowSelector,
    });
    const rawRows = Array.from(activePanel.querySelectorAll(rowSelector)).filter(
      (row) => row instanceof Element
    );
    const visibleRows = rawRows.filter((row) => isVisible(row));
    const wantedNormalized = normalizePoshmarkStageText(wantedStage);
    const filteredRows = visibleRows.filter((row) => {
      const label = normalizePoshmarkStageText(getCategoryOptionRowLabel(row));
      if (!label) return false;
      if (label.includes("search")) return false;
      return true;
    });

    const exactRows = filteredRows.filter(
      (row) => normalizePoshmarkStageText(getCategoryOptionRowLabel(row)) === wantedNormalized
    );
    const dedupedExactRows = [];
    const seenKey = new Set();
    for (const row of exactRows) {
      const text = normalizePoshmarkStageText(getCategoryOptionRowLabel(row));
      const key = `${text}|${row}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      dedupedExactRows.push(row);
    }

    let matchedRow = null;
    if (dedupedExactRows.length === 1) {
      matchedRow = dedupedExactRows[0];
    } else if (dedupedExactRows.length > 1) {
      matchedRow =
        dedupedExactRows.find(
          (row) =>
            cleanCategoryStage(getCategoryOptionRowLabel(row)) === cleanCategoryStage(wantedStage)
        ) ?? null;
    }

    const matchedEntry = matchedRow
      ? {
          element: matchedRow,
          selector: rowSelector,
          clickTarget: matchedRow,
        }
      : null;

    return {
      matchedEntry,
      rawCandidateCount: visibleRows.length,
      filteredCandidateCount: filteredRows.length,
      visibleRowsSample:
        filteredRows
          .slice(0, 8)
          .map((row) => `"${cleanCategoryStage(getCategoryOptionRowLabel(row))}"`)
          .join(", ") || "none",
      reason: matchedEntry ? "stage1_match_found" : "no_unique_stage1_match",
    };
  }

  function resolveActivePoshmarkPickerPanel(input) {
    const { pickerElement, control, rowSelector } = input;
    const topLevelHints = new Set(["electronics", "home", "kids", "men", "pets", "women"]);

    function panelFromControls(node) {
      if (!(node instanceof Element)) return null;
      const controlsId = String(node.getAttribute("aria-controls") || "").trim();
      if (!controlsId) return null;
      const panel = document.getElementById(controlsId);
      if (!(panel instanceof Element)) return null;
      if (!isVisible(panel)) return null;
      if (!panel.querySelector(rowSelector)) return null;
      return panel;
    }

    const directPanel = panelFromControls(control) || panelFromControls(document.activeElement);
    if (directPanel) return directPanel;

    const candidatePanels = [];
    const panelSelectors = [
      '[role="listbox"]',
      '[data-radix-select-viewport]',
      '[data-radix-select-content]',
      '[data-radix-popper-content-wrapper]',
      '[aria-label*="Category Selector"]',
    ];

    const searchRoots = [pickerElement, document];
    const seenPanels = new Set();
    for (const root of searchRoots) {
      if (!(root instanceof Element) && root !== document) continue;
      for (const selector of panelSelectors) {
        const nodes = Array.from(root.querySelectorAll(selector)).filter(
          (node) => node instanceof Element && isVisible(node)
        );
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          if (seenPanels.has(node)) continue;
          seenPanels.add(node);
          const rows = Array.from(node.querySelectorAll(rowSelector)).filter(
            (row) => row instanceof Element && isVisible(row)
          );
          if (!rows.length) continue;
          const labels = rows
            .map((row) => normalizePoshmarkStageText(getCategoryOptionRowLabel(row)))
            .filter(Boolean);
          const hintMatches = labels.filter((label) => topLevelHints.has(label)).length;
          candidatePanels.push({
            panel: node,
            rows,
            hintMatches,
          });
        }
      }
    }

    if (!candidatePanels.length) return pickerElement;

    candidatePanels.sort((a, b) => {
      if (b.hintMatches !== a.hintMatches) return b.hintMatches - a.hintMatches;
      return a.rows.length - b.rows.length;
    });

    return candidatePanels[0].panel;
  }

  async function finalizePoshmarkCategoryCommit(input) {
    const { control, fieldConfig, finalStageLabel, fullPath } = input;
    const normalizedFinalStage = normalizeText(finalStageLabel || "");

    function buildSummary() {
      return cleanCategoryStage(getControlSummaryText(control));
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const confirmed = isCategoryCompletionConfirmed({
        control,
        fullPath: fullPath || finalStageLabel,
        fieldConfig,
      });
      if (confirmed) {
        return {
          committed: true,
          finalSelectedValue: buildSummary(),
          reason: "category completion confirmed",
        };
      }

      const pickerInfo = findVisibleCategoryPicker(fieldConfig?.pickerContainerSelectors ?? []);
      if (!pickerInfo?.element) {
        await wait(120);
        continue;
      }

      const pickerScope = resolveCategoryOptionScope(
        pickerInfo.element,
        fieldConfig?.optionSelectors ?? []
      );
      const optionContext = discoverCategoryOptionEntries({
        optionSelectors: fieldConfig?.optionSelectors ?? [],
        pickerScope,
        pickerElement: pickerInfo.element,
        control,
      });
      const finalEntry = optionContext.optionDiscovery.entries.find((entry) =>
        getOptionTextCandidates(entry).some(
          (candidate) => normalizeText(candidate) === normalizedFinalStage
        )
      );
      if (finalEntry) {
        clickElement(finalEntry.clickTarget);
        await wait(140);
        continue;
      }

      if (attempt === 1) {
        control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        control.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        await wait(140);
      }
    }

    return {
      committed: false,
      finalSelectedValue: buildSummary(),
      reason: "completion not confirmed",
    };
  }

  function resolvePoshmarkCategoryGuidance(payload) {
    const candidates = [
      {
        path: "payload.poshmark.categoryPath",
        value: payload?.poshmark?.categoryPath,
      },
      {
        path: "payload.marketplaces.poshmark.categoryPath",
        value: payload?.marketplaces?.poshmark?.categoryPath,
      },
      {
        path: "payload.poshmark.category",
        value: payload?.poshmark?.category,
      },
      {
        path: "payload.marketplaces.poshmark.category",
        value: payload?.marketplaces?.poshmark?.category,
      },
    ];

    for (const candidate of candidates) {
      if (typeof candidate.value !== "string") continue;
      const trimmed = candidate.value.trim();
      if (!trimmed) continue;
      return { path: candidate.path, value: trimmed };
    }

    return { path: "", value: "" };
  }

  function discoverCategoryOptionEntries(input) {
    const { optionSelectors, pickerScope, pickerElement, control } = input;
    const checks = [];

    function evaluateSurface(surface, scopeMode, checkLabel) {
      if (!(surface instanceof Element) && surface !== document) {
        return null;
      }
      const discovery = findVisibleOptionEntries(optionSelectors, surface, scopeMode);
      checks.push(
        `${checkLabel}:raw=${discovery.rawCount},visible=${discovery.visibleCount},scope=${discovery.scopeMode}`
      );
      return discovery;
    }

    const scoped = evaluateSurface(
      pickerScope,
      "category_modal_scope",
      "picker_scope"
    );
    if (scoped && scoped.rawCount > 0) {
      return {
        optionDiscovery: scoped,
        optionSurfaceResolved: true,
        optionSurfaceType: "picker_scope",
        optionSurfaceChecks: checks.join(" | "),
      };
    }

    const portalSurfaces = [];
    const controlAriaControls = control?.getAttribute?.("aria-controls") || "";
    if (controlAriaControls) {
      const controlledSurface = document.getElementById(controlAriaControls);
      if (controlledSurface instanceof Element && isVisible(controlledSurface)) {
        portalSurfaces.push({ element: controlledSurface, type: "control_aria_controls" });
      }
    }

    const globalSurfaceSelectors = [
      '[role="listbox"]',
      '[data-radix-select-content]',
      '[data-radix-popper-content-wrapper]',
      '[class*="menu"]',
      '[class*="popover"]',
      '[class*="dropdown"]',
    ];
    for (const selector of globalSurfaceSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(
        (candidate) => candidate instanceof Element && isVisible(candidate)
      );
      for (const candidate of candidates) {
        portalSurfaces.push({ element: candidate, type: `global:${selector}` });
      }
    }

    let bestPortal = null;
    for (const surface of portalSurfaces) {
      const discovery = evaluateSurface(
        surface.element,
        "category_portal_scope",
        surface.type
      );
      if (!discovery || discovery.rawCount === 0) continue;
      if (!bestPortal || discovery.visibleCount > bestPortal.discovery.visibleCount) {
        bestPortal = { discovery, type: surface.type };
      }
    }
    if (bestPortal) {
      return {
        optionDiscovery: bestPortal.discovery,
        optionSurfaceResolved: true,
        optionSurfaceType: bestPortal.type,
        optionSurfaceChecks: checks.join(" | "),
      };
    }

    const documentScope = evaluateSurface(
      document,
      "category_document_scope",
      "document_scope"
    );
    if (documentScope && documentScope.rawCount > 0) {
      return {
        optionDiscovery: documentScope,
        optionSurfaceResolved: true,
        optionSurfaceType: "document_scope",
        optionSurfaceChecks: checks.join(" | "),
      };
    }

    return {
      optionDiscovery:
        scoped ??
        findVisibleOptionEntries(optionSelectors, pickerElement ?? document, "category_modal_scope"),
      optionSurfaceResolved: false,
      optionSurfaceType: "none",
      optionSurfaceChecks: checks.join(" | ") || "none",
    };
  }

  async function waitForCategoryStageTransition(input) {
    const { pickerElement, optionSelectors, previousVisibleSample, expectedNextStage } = input;
    const previousNormalized = normalizeText(previousVisibleSample || "");
    const expectedNormalized = normalizeText(expectedNextStage || "");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(120);
      const scope = resolveCategoryOptionScope(pickerElement, optionSelectors);
      const optionDiscovery = findVisibleOptionEntries(
        optionSelectors,
        scope,
        "category_modal_scope"
      );
      const visibleSample = optionDiscovery.visibleSample || "";
      const visibleNormalized = normalizeText(visibleSample);
      const changed = !!visibleNormalized && visibleNormalized !== previousNormalized;
      const includesExpected = expectedNormalized
        ? visibleNormalized.includes(expectedNormalized)
        : changed;

      if (includesExpected || changed) {
        return {
          changed: true,
          visibleSample,
        };
      }
    }

    return {
      changed: false,
      visibleSample: previousVisibleSample || "",
    };
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
    condition: ["condition", "item condition"],
  };

  const DYNAMIC_FIELD_SYNONYMS = {
    ...CANONICAL_LPU_FIELD_SCHEMA,
    ussize: ["us size", "size", "ussize"],
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
    console.debug("[Vendoo][EbayOptionalFields]", {
      buttonVisible: Boolean(revealStatus.buttonFound),
      clickAttempted: Boolean(revealStatus.clicked),
      expandDetected: Boolean(revealStatus.expandedDetected),
      reason: String(revealStatus.reason || ""),
    });
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
    const PAUSE_EBAY_CONDITION_SKIP = true;

    for (const field of visibleRegistry) {
      if (
        !PAUSE_EBAY_CONDITION_SKIP &&
        field.normalizedLabel === "condition" &&
        !isBaseConditionControl(field.control)
      ) {
        console.debug("[Vendoo][EbayConditionSkip]", {
          status: "skipped_for_safety",
          reason: "non-base condition field skipped",
        });
        unattemptedFieldReasons.push({
          label: field.label,
          controlFamily: field.controlFamily,
          reason: "ebay_condition_stage_skipped",
        });
        continue;
      }
      const initialMatches = candidates.filter((candidate) =>
        isDynamicLabelMatch(field.normalizedLabel, candidate.matchTerms)
      );
      const resolved = resolveFinalMatchesByPrecedence(
        field.normalizedLabel,
        initialMatches,
        candidates
      );
      const matches = resolved.matches;
      if (field.normalizedLabel === "condition") {
        console.debug("[Vendoo][ConditionRouting]", {
          discoveredLabel: field.label,
          candidatePayloadKeysConsidered: initialMatches.map((candidate) => candidate.key),
          matchedKeysBeforeResolution: initialMatches.map((candidate) => candidate.key),
          matchedKeysAfterResolution: matches.map((candidate) => candidate.key),
          reasonWhenNoMatch: matches.length === 0 ? "no_payload_match" : "",
        });
      }
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
    let showOptional = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
      showOptional = buttons.find((button) => {
        if (!(button instanceof Element)) return false;
        if (!isVisible(button)) return false;
        const text = normalizeText(button.textContent || "");
        return text.includes("show optional fields") || text === "show optional";
      });
      if (showOptional) break;
      if (attempt < 5) {
        await wait(120);
      }
    }

    if (!showOptional) {
      return {
        buttonFound: false,
        clicked: false,
        expandedDetected: false,
        reason: "button not found",
      };
    }

    if (
      (showOptional instanceof HTMLButtonElement && showOptional.disabled) ||
      showOptional.getAttribute("aria-disabled") === "true"
    ) {
      return {
        buttonFound: true,
        clicked: false,
        expandedDetected: false,
        reason: "button disabled",
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

  function isOptionalFieldsExpanded(button) {
    if (!(button instanceof Element)) return false;

    const ariaExpanded = button.getAttribute("aria-expanded");
    if (ariaExpanded === "true") return true;

    const buttonText = normalizeText(button.textContent || "");
    if (buttonText.includes("hide optional fields")) return true;
    if (!button.isConnected || !isVisible(button)) return true;
    return false;
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

    for (const key of ["department", "jewelryDepartment", "condition"]) {
      addCandidateEntry(key, ebay?.[key]);
    }
    addCandidateEntry("condition", ebay?.itemCondition);

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

    // Base shared "US Size" must resolve to payload key "size".
    if (normalizedFieldLabel === "us size") {
      aliasKeys.add(normalizePayloadKey("size"));
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
      let resolvedEtsyTarget = "";
      if (
        valueMode === "single-value" &&
        isEtsySpecificsField(field) &&
        isTrackedEtsyResolutionField(field) &&
        evaluateEtsyStageGate().stageDetected
      ) {
        const etsyResolution = await resolveEtsySpecificOptionValue({
          field,
          payloadValue: String(value ?? "").trim(),
          optionSelectors,
        });
        if (etsyResolution.logged) {
          console.debug("[Vendoo][EtsyValueResolution]", etsyResolution.diagnostic);
        }
        if (!etsyResolution.selectedResolution) {
          entryDiagnostics.finalStatusByField = "skipped_for_safety";
          entryDiagnostics.executionRouteSelected = "etsy_value_resolution_no_safe_match";
          entryDiagnostics.executionRouteReasons.push("etsy_specifics_no_safe_option_match");
          return {
            status: "skipped_for_safety",
            reason: `no safe etsy option match (${etsyResolution.reason || "unresolved"})`,
            controlFamily: route.controlFamily,
            adapterSelected: route.adapterSelected,
            entryDiagnostics,
          };
        }
        resolvedEtsyTarget = etsyResolution.selectedResolution;
      }
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

      const targetsToAttempt = resolvedEtsyTarget
        ? [resolvedEtsyTarget]
        : payloadValues.values;
      for (const target of targetsToAttempt) {
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
          console.debug("[Vendoo][OptionResolutionOrder]", {
            fieldLabel: field.label,
            rawPayloadValue: String(value ?? "").trim(),
            availableOptionsFound: Boolean(selectResult.availableOptionsFound),
            comparisonCandidates: Array.isArray(selectResult.comparisonCandidates)
              ? selectResult.comparisonCandidates
              : [],
            optionMatchAttempted: true,
            selectedOptions: selectResult.resolvedOption ? [selectResult.resolvedOption] : [],
            matchStrategy: selectResult.matchStrategy || "",
            matchedCandidate: selectResult.matchedCandidate || "",
            rawCustomFallbackUsed: false,
            fallbackReason: "",
          });
          continue;
        }

        if (entryAnalysis.entryCapability === "single_entry_custom") {
          entryDiagnostics.customCommitAttempted = true;
          const committed = tryCommitChipToken(field.control, target);
          entryDiagnostics.customCommitAccepted = committed;
          entryDiagnostics.finalStatusByToken[target] = committed
            ? "filled_custom_commit"
            : "rejected";
          console.debug("[Vendoo][OptionResolutionOrder]", {
            fieldLabel: field.label,
            rawPayloadValue: String(value ?? "").trim(),
            availableOptionsFound: Boolean(selectResult.availableOptionsFound),
            comparisonCandidates: Array.isArray(selectResult.comparisonCandidates)
              ? selectResult.comparisonCandidates
              : [],
            optionMatchAttempted: true,
            selectedOptions: [],
            matchStrategy: selectResult.matchStrategy || "",
            matchedCandidate: selectResult.matchedCandidate || "",
            rawCustomFallbackUsed: true,
            fallbackReason: committed
              ? `custom_fallback_used_after_option_result:${selectResult.reason || "no_safe_option_match"}`
              : `custom_fallback_failed_after_option_result:${selectResult.reason || "no_safe_option_match"}`,
          });
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
            console.debug("[Vendoo][OptionResolutionOrder]", {
              fieldLabel: field.label,
              rawPayloadValue: String(value ?? "").trim(),
              availableOptionsFound: Boolean(selectResult.availableOptionsFound),
              comparisonCandidates: Array.isArray(selectResult.comparisonCandidates)
                ? selectResult.comparisonCandidates
                : [],
              optionMatchAttempted: true,
              selectedOptions: selectResult.resolvedOption ? [selectResult.resolvedOption] : [],
              matchStrategy: selectResult.matchStrategy || "",
              matchedCandidate: selectResult.matchedCandidate || "",
              rawCustomFallbackUsed: false,
              fallbackReason: "",
            });
          }
          if (!accepted) {
            console.debug("[Vendoo][OptionResolutionOrder]", {
              fieldLabel: field.label,
              rawPayloadValue: String(value ?? "").trim(),
              availableOptionsFound: Boolean(selectResult.availableOptionsFound),
              comparisonCandidates: Array.isArray(selectResult.comparisonCandidates)
                ? selectResult.comparisonCandidates
                : [],
              optionMatchAttempted: true,
              selectedOptions: [],
              matchStrategy: selectResult.matchStrategy || "",
              matchedCandidate: selectResult.matchedCandidate || "",
              rawCustomFallbackUsed: false,
              fallbackReason: `option_match_not_selected:${selectResult.reason || "no_safe_option_match"}`,
            });
          }
        }

        if (!accepted) {
          chipDiagnostics.customCommitAttempted = true;
          accepted = tryCommitChipToken(field.control, token);
          if (accepted) {
            chipDiagnostics.customCommitAccepted = true;
          }
          console.debug("[Vendoo][OptionResolutionOrder]", {
            fieldLabel: field.label,
            rawPayloadValue: String(value ?? "").trim(),
            availableOptionsFound: false,
            comparisonCandidates: [],
            optionMatchAttempted: chipDiagnostics.optionMatchAttempted,
            selectedOptions: [],
            rawCustomFallbackUsed: true,
            fallbackReason: accepted
              ? "custom_fallback_used_after_option_path"
              : "custom_fallback_failed_after_option_path",
          });
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
      if (isEtsySpecificsField(field)) {
        const etsyReadback = readEtsySpecificsVerification(field, expectedNormalizedValue);
        if (etsyReadback.passed) {
          return {
            status: "verified",
            passed: true,
            reason: "",
            expectedRawValue,
            expectedNormalizedValue,
            matchedVerificationSource: etsyReadback.matchedSource,
            actualRenderedText: etsyReadback.matchedValue,
          };
        }
      }
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

  function isEtsySpecificsField(field) {
    const control = field?.control;
    const normalizedLabel = normalizeText(field?.normalizedLabel ?? field?.label ?? "");
    const labelTracked = isTrackedEtsySpecificField(field);
    if (labelTracked) return true;
    if (!(control instanceof Element)) return false;
    const metadata = normalizeText(
      [
        control.getAttribute("id") || "",
        control.getAttribute("name") || "",
        control.getAttribute("data-testid") || "",
        control.getAttribute("aria-label") || "",
      ].join(" ")
    );
    return (
      metadata.includes("listings etsy marketplacespecifics") ||
      metadata.includes("listings.etsy.marketplacespecifics") ||
      normalizedLabel.includes("materials") ||
      normalizedLabel.includes("gemstone") ||
      normalizedLabel.includes("theme") ||
      normalizedLabel.includes("age")
    );
  }

  function readEtsySpecificsVerification(field, expectedNormalizedValue) {
    const candidates = [];
    const seen = new Set();
    function add(raw) {
      const normalized = normalizeOptionValue(raw);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push({ normalized, raw: cleanCategoryStage(String(raw || "")) });
    }

    const control = field?.control;
    if (!(control instanceof Element)) {
      return { passed: false, matchedSource: "", matchedValue: "" };
    }

    add(control.textContent || "");
    add(control.getAttribute("value") || "");
    add(control.getAttribute("aria-label") || "");
    add(control.getAttribute("title") || "");

    const controlScope =
      control.closest("div, section, fieldset, form") ?? control.parentElement ?? control;
    if (controlScope instanceof Element) {
      const renderedNodes = Array.from(
        controlScope.querySelectorAll(
          ".react-select__single-value, [class*='single-value'], [class*='singleValue'], .react-select__multi-value__label"
        )
      ).filter((node) => node instanceof Element && isVisible(node));
      for (const node of renderedNodes) {
        add(node.textContent || "");
      }

      const inputs = Array.from(
        controlScope.querySelectorAll(
          'input[value], input[type="hidden"][value], input[name*="listings.etsy.marketplaceSpecifics"], input[id*="listings.etsy.marketplaceSpecifics"]'
        )
      ).slice(0, 16);
      for (const input of inputs) {
        if (!(input instanceof HTMLInputElement)) continue;
        add(input.value);
        add(input.getAttribute("value") || "");
      }
    }

    const expected = normalizeOptionValue(expectedNormalizedValue);
    const matched = candidates.find((candidate) => candidate.normalized === expected);
    return {
      passed: Boolean(expected && matched),
      matchedSource: matched ? "etsy_specifics_scope_readback" : "",
      matchedValue: matched?.raw || "",
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
    const comparisonCandidates = buildComboboxComparisonCandidates(target);

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
            availableOptionsFound: false,
            selectedOptions: [],
            optionMatchAttempted: true,
            comparisonCandidates,
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
      const normalizedComparisonCandidates =
        comparisonCandidates.length > 0 ? comparisonCandidates : [normalizedPayloadValue];
      let matchStrategy = "exact_normalized";
      let matchedCandidate = normalizedPayloadValue;
      let matches = findExactComboboxMatches(normalizedEntries, normalizedComparisonCandidates);
      if (!matches.length) {
        const tokenBoundaryMatch = findTokenBoundaryComboboxMatches(
          normalizedEntries,
          normalizedComparisonCandidates
        );
        matches = tokenBoundaryMatch.matches;
        if (matches.length) {
          matchStrategy = "token_boundary_option_in_candidate";
          matchedCandidate = tokenBoundaryMatch.matchedCandidate;
        }
      }
      let conditionResolution = null;
      const isConditionField = normalizeText(fieldLabel) === "condition";
      if (!matches.length && isConditionField) {
        conditionResolution = resolveConditionOptionMatch({
          rawValue: payloadRaw,
          normalizedPayloadValue,
          availableOptions: normalizedOptions,
          normalizedEntries,
        });
        if (conditionResolution?.match) {
          matches = [conditionResolution.match];
        }
      }
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
      if (isConditionField) {
        console.debug("[Vendoo][ConditionResolution]", {
          rawValue: payloadRaw,
          normalizedPayloadValue,
          availableOptions: normalizedOptions,
          resolvedOption:
            conditionResolution?.resolvedOption ||
            getResolvedOptionFromMatch(matches[0]) ||
            "",
          resolutionReason: conditionResolution?.resolutionReason || "exact_normalized_match",
        });
      }

      if (!matches.length) {
        return {
          status: "needs_review",
          reason:
            `options rendered but no normalized match (${optionDiscovery.scopeMode}; active: ${
              optionDiscovery.activeControlIdentified ? "yes" : "no"
            }; mode: ${valueMode}; canonical: "${payloadCanonical}")`,
          availableOptionsFound: true,
          selectedOptions: [],
          optionMatchAttempted: true,
          comparisonCandidates,
          matchStrategy,
          matchedCandidate,
        };
      }

      if (matches.length > 1) {
        return {
          status: "needs_review",
          reason: "multiple normalized combobox options",
          availableOptionsFound: true,
          selectedOptions: [],
          optionMatchAttempted: true,
          comparisonCandidates,
          matchStrategy,
          matchedCandidate,
        };
      }

      clickElement(matches[0].entry.clickTarget);
      await wait(110);
      const resolvedOptionLabel =
        conditionResolution?.resolvedOption ||
        getResolvedOptionLabelFromMatch(matches[0]) ||
        target;
      return {
        status: "filled",
        resolvedOption: resolvedOptionLabel,
        availableOptionsFound: true,
        selectedOptions: [resolvedOptionLabel],
        optionMatchAttempted: true,
        comparisonCandidates,
        matchStrategy,
        matchedCandidate,
      };
    }

    return {
      status: "needs_review",
      reason: "control opened but options could not be harvested",
      availableOptionsFound: false,
      selectedOptions: [],
      optionMatchAttempted: true,
      comparisonCandidates,
      matchStrategy: "none",
      matchedCandidate: "",
    };
  }

  function buildComboboxComparisonCandidates(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return [];

    const candidates = [];
    const seen = new Set();
    function add(candidateRaw) {
      const normalized = normalizeOptionValue(candidateRaw);
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(normalized);
    }

    add(raw);
    add(cleanComboboxComparisonText(raw));
    add(stripStandaloneEvidenceStatusEdgeTokens(raw));
    add(stripStandaloneEvidenceStatusEdgeTokens(cleanComboboxComparisonText(raw)));

    // Comparison-only cleanup: strip parenthetical/brace notes without mutating payload.
    add(raw.replace(/\([^)]*\)/g, " "));
    add(raw.replace(/\[[^\]]*\]/g, " "));
    add(cleanComboboxComparisonText(raw.replace(/\([^)]*\)/g, " ")));
    add(cleanComboboxComparisonText(raw.replace(/\[[^\]]*\]/g, " ")));
    add(stripStandaloneEvidenceStatusEdgeTokens(raw.replace(/\([^)]*\)/g, " ")));
    add(stripStandaloneEvidenceStatusEdgeTokens(raw.replace(/\[[^\]]*\]/g, " ")));
    add(
      stripStandaloneEvidenceStatusEdgeTokens(
        cleanComboboxComparisonText(raw.replace(/\([^)]*\)/g, " "))
      )
    );
    add(
      stripStandaloneEvidenceStatusEdgeTokens(
        cleanComboboxComparisonText(raw.replace(/\[[^\]]*\]/g, " "))
      )
    );

    // Comparison-only tokenization for delimiter-separated values.
    const parts = raw
      .split(/[;|,/]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      add(part);
      add(cleanComboboxComparisonText(part));
      add(stripStandaloneEvidenceStatusEdgeTokens(part));
      add(stripStandaloneEvidenceStatusEdgeTokens(cleanComboboxComparisonText(part)));
      add(part.replace(/\([^)]*\)/g, " "));
      add(part.replace(/\[[^\]]*\]/g, " "));
      add(cleanComboboxComparisonText(part.replace(/\([^)]*\)/g, " ")));
      add(cleanComboboxComparisonText(part.replace(/\[[^\]]*\]/g, " ")));
      add(stripStandaloneEvidenceStatusEdgeTokens(part.replace(/\([^)]*\)/g, " ")));
      add(stripStandaloneEvidenceStatusEdgeTokens(part.replace(/\[[^\]]*\]/g, " ")));
      add(
        stripStandaloneEvidenceStatusEdgeTokens(
          cleanComboboxComparisonText(part.replace(/\([^)]*\)/g, " "))
        )
      );
      add(
        stripStandaloneEvidenceStatusEdgeTokens(
          cleanComboboxComparisonText(part.replace(/\[[^\]]*\]/g, " "))
        )
      );
    }

    return candidates;
  }

  function findExactComboboxMatches(normalizedEntries, normalizedComparisonCandidates) {
    return normalizedEntries.filter((candidate) =>
      candidate.values.some((value) =>
        normalizedComparisonCandidates.includes(normalizeOptionValue(value))
      )
    );
  }

  function findTokenBoundaryComboboxMatches(normalizedEntries, normalizedComparisonCandidates) {
    const bucket = [];
    for (const candidate of normalizedEntries) {
      for (const optionValue of candidate.values) {
        const normalizedOption = normalizeOptionValue(optionValue);
        if (!isSafeTokenBoundaryOption(normalizedOption)) continue;
        for (const normalizedCandidate of normalizedComparisonCandidates) {
          if (!containsTokenBoundaryPhrase(normalizedCandidate, normalizedOption)) continue;
          bucket.push({ candidate, normalizedOption, normalizedCandidate });
        }
      }
    }

    if (!bucket.length) {
      return { matches: [], matchedCandidate: "" };
    }

    bucket.sort((a, b) => {
      const byOptionLength = b.normalizedOption.length - a.normalizedOption.length;
      if (byOptionLength !== 0) return byOptionLength;
      return b.normalizedCandidate.length - a.normalizedCandidate.length;
    });

    const bestOption = bucket[0].normalizedOption;
    const bestCandidate = bucket[0].normalizedCandidate;
    const bestMatches = bucket
      .filter(
        (entry) =>
          entry.normalizedOption === bestOption &&
          entry.normalizedCandidate === bestCandidate
      )
      .map((entry) => entry.candidate);

    const deduped = Array.from(new Set(bestMatches));
    return { matches: deduped, matchedCandidate: bestCandidate };
  }

  function isSafeTokenBoundaryOption(normalizedOption) {
    if (!normalizedOption) return false;
    if (normalizedOption.length < 3) return false;
    const tokens = normalizedOption.split(/\s+/).filter(Boolean);
    if (!tokens.length) return false;
    if (tokens.some((token) => token.length < 2)) return false;
    return true;
  }

  function containsTokenBoundaryPhrase(normalizedCandidate, normalizedOption) {
    if (!normalizedCandidate || !normalizedOption) return false;
    const escaped = normalizedOption.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
    return pattern.test(normalizedCandidate);
  }

  function cleanComboboxComparisonText(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    let cleaned = raw
      .replace(/\([^)]*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const fragmentSplit = /\s(?:[-–—:;|]|\b(?:with|including|includes)\b)\s/gi;
    const fragments = cleaned
      .split(fragmentSplit)
      .map((part) => part.trim())
      .filter(Boolean);
    if (fragments.length <= 1) return cleaned;

    const explanatoryPattern =
      /\b(?:confidence|inference|inferred|evidence|source|sourced|supported|observed|observation|notes?|note|confirmed|confirmation|approx(?:imate|\\.)?|approximation)\b/i;

    const kept = [];
    for (const fragment of fragments) {
      if (!fragment) continue;
      if (explanatoryPattern.test(fragment)) continue;
      kept.push(fragment);
    }

    if (!kept.length) return cleaned;
    return kept.join(" ").replace(/\s+/g, " ").trim();
  }

  function stripStandaloneEvidenceStatusEdgeTokens(value) {
    const normalized = normalizeOptionValue(value);
    if (!normalized) return "";

    const removableTokens = new Set([
      "inferred",
      "inference",
      "confirmed",
      "confirmation",
      "observed",
      "observation",
      "approximate",
      "approx",
      "supported",
      "evidence",
      "source",
      "sourced",
      "note",
      "notes",
    ]);

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (!tokens.length) return normalized;

    let start = 0;
    let end = tokens.length - 1;
    while (start <= end && removableTokens.has(tokens[start])) {
      start += 1;
    }
    while (end >= start && removableTokens.has(tokens[end])) {
      end -= 1;
    }

    if (start === 0 && end === tokens.length - 1) {
      return normalized;
    }

    return tokens.slice(start, end + 1).join(" ").trim();
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

  function isTrackedEtsyResolutionField(field) {
    const normalizedLabel = normalizeText(field?.normalizedLabel ?? field?.label ?? "");
    return (
      normalizedLabel === "materials" ||
      normalizedLabel === "gemstone" ||
      normalizedLabel === "theme" ||
      normalizedLabel === "age" ||
      normalizedLabel === "occasion"
    );
  }

  function tokenizeEtsyResolutionInput(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return [];
    const parts = raw
      .split(/\r?\n|;|,|\/|\||\band\b/gi)
      .map((part) => cleanCategoryStage(part))
      .filter(Boolean);
    const tokens = [];
    const seen = new Set();
    for (const part of parts) {
      const normalized = normalizeOptionValue(part);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      tokens.push(part);
    }
    return tokens.length ? tokens : [raw];
  }

  async function resolveEtsySpecificOptionValue(input) {
    const { field, payloadValue, optionSelectors } = input;
    const diagnostic = {
      fieldLabel: String(field?.label || ""),
      payloadValue: String(payloadValue || ""),
      visibleOptionsSample: [],
      resolvedOptionCandidates: [],
      selectedResolution: "",
      reason: "",
    };

    const control = field?.control;
    if (!(control instanceof Element)) {
      diagnostic.reason = "control_missing";
      return { selectedResolution: "", reason: diagnostic.reason, diagnostic, logged: true };
    }

    openCustomSelectControl(control);
    await wait(120);
    const optionDiscovery = findVisibleComboboxOptionEntries(control, optionSelectors);
    const visibleOptions = getUniqueComboboxOptionTexts(optionDiscovery.entries, 16);
    diagnostic.visibleOptionsSample = visibleOptions.slice(0, 8);
    if (!visibleOptions.length) {
      diagnostic.reason = "no_visible_options";
      return { selectedResolution: "", reason: diagnostic.reason, diagnostic, logged: true };
    }

    const normalizedOptions = visibleOptions.map((option) => ({
      raw: option,
      normalized: normalizeOptionValue(option),
    }));
    const payloadTokens = tokenizeEtsyResolutionInput(payloadValue);
    const normalizedPayload = normalizeOptionValue(payloadValue);

    const exact = normalizedOptions.find((option) => option.normalized === normalizedPayload);
    if (exact) {
      diagnostic.resolvedOptionCandidates = [exact.raw];
      diagnostic.selectedResolution = exact.raw;
      diagnostic.reason = "exact_visible_match";
      return {
        selectedResolution: exact.raw,
        reason: diagnostic.reason,
        diagnostic,
        logged: true,
      };
    }

    const scored = [];
    const seen = new Set();
    for (const option of normalizedOptions) {
      let score = 0;
      for (const tokenRaw of payloadTokens) {
        const token = normalizeOptionValue(tokenRaw);
        if (!token) continue;
        if (option.normalized === token) score += 100;
        else if (option.normalized.includes(token) || token.includes(option.normalized)) score += 20;
        const tokenWords = token.match(/[a-z0-9]+/g) || [];
        const optionWords = option.normalized.match(/[a-z0-9]+/g) || [];
        const overlap = tokenWords.filter((word) => optionWords.includes(word)).length;
        score += overlap * 3;
      }
      if (score <= 0) continue;
      const key = `${option.normalized}:${option.raw}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scored.push({ raw: option.raw, score });
    }

    scored.sort((a, b) => b.score - a.score);
    diagnostic.resolvedOptionCandidates = scored.slice(0, 5).map((entry) => entry.raw);
    if (!scored.length) {
      diagnostic.reason = "no_safe_option_match";
      return { selectedResolution: "", reason: diagnostic.reason, diagnostic, logged: true };
    }

    diagnostic.selectedResolution = scored[0].raw;
    diagnostic.reason = "closest_normalized_match";
    return {
      selectedResolution: scored[0].raw,
      reason: diagnostic.reason,
      diagnostic,
      logged: true,
    };
  }

  function resolveConditionOptionMatch(input) {
    const { rawValue, normalizedPayloadValue, availableOptions, normalizedEntries } = input;
    const normalizedRaw = normalizeOptionValue(rawValue);
    const normalized = normalizedPayloadValue || normalizedRaw;
    const options = Array.isArray(availableOptions) ? availableOptions : [];

    const has = (phrases) =>
      phrases.some((phrase) => normalized.includes(normalizeOptionValue(phrase)));

    let targetOption = "";
    let resolutionReason = "";

    if (
      has(["new with tags", "nwt"]) ||
      (has(["new"]) && has(["with tags", "tag"]))
    ) {
      targetOption = "new with tags";
      resolutionReason = "new_with_tags_cues";
    } else if (
      has(["new without tags", "nwot"]) ||
      (has(["new"]) && has(["without tags", "no tags"]))
    ) {
      targetOption = "new without tags";
      resolutionReason = "new_without_tags_cues";
    } else if (
      has(["new with imperfections"]) ||
      (has(["new"]) && has(["imperfection", "defect", "blemish"]))
    ) {
      targetOption = "new with imperfections";
      resolutionReason = "new_with_imperfections_cues";
    } else if (
      has(["used", "pre owned", "preowned", "worn", "wear", "condition"]) &&
      has(["excellent", "barely used", "minimal signs", "like new"])
    ) {
      targetOption = "pre owned excellent";
      resolutionReason = "pre_owned_excellent_cues";
    } else if (
      has(["used", "pre owned", "preowned", "worn", "wear", "condition"]) &&
      has(["good", "minor wear", "no major flaws", "light wear", "normal wear"])
    ) {
      targetOption = "pre owned good";
      resolutionReason = "pre_owned_good_cues";
    } else if (
      has(["used", "pre owned", "preowned", "worn", "wear", "condition"]) &&
      has(["fair", "visible wear", "heavier wear", "heavy wear", "major flaw", "significant wear", "flaws"])
    ) {
      targetOption = "pre owned fair";
      resolutionReason = "pre_owned_fair_cues";
    }

    if (!targetOption) {
      return {
        match: null,
        resolvedOption: "",
        resolutionReason: "no_condition_bucket_match",
      };
    }

    if (!options.includes(targetOption)) {
      return {
        match: null,
        resolvedOption: targetOption,
        resolutionReason: "bucket_resolved_option_not_available",
      };
    }

    const matchingEntries = normalizedEntries.filter((candidate) =>
      candidate.values.some((value) => normalizeOptionValue(value) === targetOption)
    );
    if (matchingEntries.length !== 1) {
      return {
        match: null,
        resolvedOption: targetOption,
        resolutionReason:
          matchingEntries.length > 1
            ? "bucket_option_ambiguous"
            : "bucket_option_entry_not_found",
      };
    }

    return {
      match: matchingEntries[0],
      resolvedOption: targetOption,
      resolutionReason,
    };
  }

  function getResolvedOptionFromMatch(match) {
    if (!match || !Array.isArray(match.values) || !match.values.length) return "";
    return match.values[0] || "";
  }

  function getResolvedOptionLabelFromMatch(match) {
    if (!match) return "";
    const entryLabel = cleanCategoryStage(getOptionTextFromEntry(match.entry));
    if (entryLabel) return entryLabel;
    return getResolvedOptionFromMatch(match);
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
      listingPriceDiagnostics,
      baseStageDiagnostics,
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
    if (listingPriceDiagnostics) {
      lines.push(
        `Listing Price: ${listingPriceDiagnostics.status}; ` +
          `reason: ${listingPriceDiagnostics.reason || "none"}; ` +
          `expected: ${listingPriceDiagnostics.expectedValue || "none"}; ` +
          `actual: ${listingPriceDiagnostics.actualValue || "none"}`
      );
    }
    if (baseStageDiagnostics) {
      lines.push(
        `Base stage: ${baseStageDiagnostics.baseStageCompleted ? "completed" : "incomplete"}; ` +
          `targeted: ${baseStageDiagnostics.baseStageFieldsTargeted.length}; ` +
          `filled: ${baseStageDiagnostics.baseStageFieldsFilled.length}; ` +
          `needs review: ${baseStageDiagnostics.baseStageFieldsNeedsReview.length}; ` +
          `skipped: ${baseStageDiagnostics.baseStageFieldsSkipped.length}; ` +
          `before switch: ${baseStageDiagnostics.baseStageCompletedBeforeMarketplaceSwitch ? "true" : "false"}`
      );
    }
    if (marketplaceStageDiagnostics) {
      lines.push(
        `Marketplace stage: ${marketplaceStageDiagnostics.marketplaceStageStatus}; ` +
          `target: ${marketplaceStageDiagnostics.targetMarketplace}; ` +
          `pre-base complete: ${marketplaceStageDiagnostics.preMarketplaceBaseStageCompleted ? "true" : "false"}; ` +
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
      if (!canUseChromeRuntimeMessaging()) {
        resolve({ photos: [], source: "extension_channel_missing" });
        return;
      }
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
    const canonicalPath = pickEbayCanonicalCategoryPath(payload);
    if (canonicalPath) return canonicalPath;
    return deriveCanonicalCategoryPathFromCategory(pickEbayCategory(payload));
  }

  function deriveCanonicalCategoryPathFromCategory(value) {
    const cleaned = typeof value === "string" ? value.trim() : "";
    if (!cleaned) return "";
    const normalized = cleaned
      .split(">")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" > ");
    if (!normalized) return "";
    const segmentCount = normalized.split(">").filter(Boolean).length;
    return segmentCount >= 3 ? normalized : "";
  }

  function pickEbayBrand(payload) {
    const brand =
      payload?.marketplaces?.ebay?.itemSpecifics?.brand ??
      payload?.marketplaces?.ebay?.brand ??
      "";
    return typeof brand === "string" ? brand.trim() : "";
  }

  function pickEbayCondition(payload) {
    const condition =
      payload?.marketplaces?.ebay?.itemSpecifics?.condition ??
      payload?.marketplaces?.ebay?.itemSpecifics?.itemCondition ??
      payload?.marketplaces?.ebay?.condition ??
      payload?.marketplaces?.ebay?.itemCondition ??
      "";
    return typeof condition === "string" ? condition.trim() : "";
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
      if (!canUseChromeRuntimeMessaging()) {
        resolve(null);
        return;
      }
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

  function canUseChromeRuntimeMessaging() {
    return (
      typeof chrome !== "undefined" &&
      !!chrome &&
      !!chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }
})();
