"use strict";

// Loaded by the small theme-extension bootstrap after Liquid renders the app block.

(function () {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
  const stampPreviewKinds = ["bag", "cup", "box"];
  const supportedInkColors = ["black", "blue", "green", "purple", "red", "white"];
  const inkColorHex = {
    black: "#111111",
    blue: "#1557D5",
    green: "#168A45",
    purple: "#7137A8",
    red: "#D5282F",
    white: "#FFFFFF"
  };
  const appProxyRoot = "/apps/line-art-upload/";
  const appProxyBase = appProxyRoot + "uploads/";
  // The live theme renders line-item properties containing "artwork" as image
  // thumbnails. Keep the generated line art under its own artwork property so
  // customers see both previews instead of a long signed URL.
  const lineArtPropertyName = "properties[StampMyMark line art artwork]";
  const legacyLineArtPropertyNames = [
    "properties[Printmivo line art]",
    "properties[StampMyMark line art]"
  ];
  const instantMockupAssetVersion = "2";
  const instantCanvasSize = 640;
  const instantArtworkSize = 512;
  const instantArtworkContentSize = Math.round((752 / 768) * instantArtworkSize);
  const instantMinimumArtworkContentSize = Math.round(
    instantArtworkContentSize * 0.58
  );
  const instantTargetInkArea =
    instantArtworkContentSize * instantArtworkContentSize * 0.5;
  const instantPlacementQuads = {
    permanent: {
      regular: {
        box: [[363, 388], [891, 388], [891, 916], [363, 916]],
        cup: [[426, 456], [828, 456], [810, 841], [444, 841]],
        bag: [[425, 525], [829, 525], [806, 895], [448, 895]]
      },
      white: {
        box: [[363, 350], [891, 350], [891, 878], [363, 878]],
        cup: [[426, 456], [828, 456], [810, 841], [444, 841]],
        bag: [[425, 525], [829, 525], [806, 895], [448, 895]]
      }
    },
    custom: {
      regular: {
        bag: [[367, 470], [887, 470], [887, 990], [367, 990]],
        cup: [[317, 320], [937, 320], [937, 940], [317, 940]],
        box: [[347, 395], [907, 395], [907, 955], [347, 955]]
      },
      white: {
        bag: [[367, 470], [887, 470], [887, 990], [367, 990]],
        cup: [[317, 320], [937, 320], [937, 940], [317, 940]],
        box: [[347, 395], [907, 395], [907, 955], [347, 955]]
      }
    }
  };
  const sessionKey = "smm_upload_session_id";
  const stickySyncFrames = new WeakMap();
  const fullPreviewPreloads = new Map();
  const instantMockupPreloads = new Map();
  const instantTransformCache = new Map();

  const find = (root, selector) => root.querySelector(selector);

  function getPreviewProfile(root) {
    return root.dataset.previewProfile === "custom" ? "custom" : "permanent";
  }

  function getSessionId() {
    let sessionId = window.sessionStorage.getItem(sessionKey);

    if (!sessionId) {
      const randomId =
        window.crypto && window.crypto.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now()) + Math.random().toString(16).slice(2);

      sessionId = `sess_${randomId}`.replace(/-/g, "");
      window.sessionStorage.setItem(sessionKey, sessionId);
    }

    return sessionId;
  }

  function getCartToken() {
    const match = document.cookie.match(/(?:^|; )cart=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getExtension(filename) {
    return (filename.split(".").pop() || "").toLowerCase();
  }

  function formatFileSize(bytes) {
    const mb = bytes / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
  }

  // Large phone photos and exported logos can spend more time uploading than
  // the preview needs. Keep up to 2048 px of detail, preserve PNG artwork
  // losslessly, and use a high-quality WebP for photo formats only when smaller.
  const imageOptimizationThreshold = 1024 * 1024;
  const maxPhotoEdge = 2048;
  const webpQuality = 0.94;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not prepare this photo."));
      };
      image.src = objectUrl;
    });
  }

  async function optimizeImageForUpload(file) {
    if (!allowedTypes.includes(file.type) || file.size <= imageOptimizationThreshold) {
      return file;
    }

    try {
      const image = await loadImage(file);
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const longestEdge = Math.max(sourceWidth, sourceHeight);

      if (!sourceWidth || !sourceHeight || !longestEdge) return file;

      const scale = Math.min(1, maxPhotoEdge / longestEdge);
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { alpha: true });

      if (!context) return file;

      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);

      const outputType = file.type === "image/png" ? "image/png" : "image/webp";
      const optimizedBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, outputType, webpQuality);
      });

      // Never trade a customer's original for a larger version.
      if (!optimizedBlob || optimizedBlob.size >= file.size) return file;

      const outputExtension = outputType === "image/png" ? ".png" : ".webp";
      return new File([optimizedBlob], file.name.replace(/\.[^.]+$/, outputExtension), {
        type: outputType,
        lastModified: file.lastModified,
      });
    } catch (_error) {
      return file;
    }
  }

  function setStatus(root, message, state) {
    const status = find(root, "[data-upload-status]");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("is-error", state === "error");
    status.classList.toggle("is-success", state === "success");
  }

  function schedulePermanentStickyBarSync(root, state, label) {
    if (!root.hasAttribute("data-stamp-upload")) return;

    const pendingFrame = stickySyncFrames.get(root);
    if (pendingFrame) window.cancelAnimationFrame(pendingFrame);

    const frame = window.requestAnimationFrame(() => {
      stickySyncFrames.delete(root);

      const stickyBar = document.querySelector("[data-printmivo-sticky-product-atc]");
      const stickyButton = stickyBar?.querySelector("[data-printmivo-sticky-product-trigger]");
      const stickyLabel = stickyBar?.querySelector(
        "[data-printmivo-sticky-product-button-label]"
      );
      const sourceButton = document.querySelector(
        '.m-product-form--main button[type="submit"][name="add"]'
      );

      if (!stickyButton || !stickyLabel) return;

      const uploadLabel =
        stickyButton.dataset.printmivoStickyProductUploadLabel || "Upload your logo";
      const addLabel =
        sourceButton?.querySelector(".m-add-to-cart--text")?.textContent?.trim() ||
        sourceButton?.textContent?.trim() ||
        "Add to cart";
      const hasUploadedLogo = Boolean(
        find(root, "[data-upload-id-property]")?.value
      );

      if (hasUploadedLogo && (state === "uploading" || state === "failed")) {
        stickyButton.disabled = Boolean(sourceButton?.disabled);
        stickyButton.classList.remove("printmivo-sticky-product-atc__button--upload");
        stickyButton.removeAttribute("aria-busy");
        stickyLabel.textContent = addLabel;
      } else if (state === "uploading") {
        stickyButton.disabled = true;
        stickyButton.classList.add("printmivo-sticky-product-atc__button--upload");
        stickyButton.setAttribute("aria-busy", "true");
        stickyLabel.textContent = label;
      } else if (state === "failed") {
        stickyButton.disabled = true;
        stickyButton.classList.add("printmivo-sticky-product-atc__button--upload");
        stickyButton.removeAttribute("aria-busy");
        stickyLabel.textContent = "Preview failed — change file";
      } else if (state === "uploaded") {
        stickyButton.disabled = Boolean(sourceButton?.disabled);
        stickyButton.classList.remove("printmivo-sticky-product-atc__button--upload");
        stickyButton.removeAttribute("aria-busy");
        stickyLabel.textContent = addLabel;
      } else {
        stickyButton.disabled = false;
        stickyButton.classList.add("printmivo-sticky-product-atc__button--upload");
        stickyButton.removeAttribute("aria-busy");
        stickyLabel.textContent = uploadLabel;
      }
    });

    stickySyncFrames.set(root, frame);
  }

  function setButton(button, state, label) {
    const labelElement = button.querySelector("[data-upload-button-label]");

    if (labelElement) {
      labelElement.textContent = label;
    } else {
      button.textContent = label;
    }
    button.dataset.uploadState = state;
    button.disabled = state === "uploading";

    if (state === "uploading") {
      button.setAttribute("aria-busy", "true");
    } else {
      button.removeAttribute("aria-busy");
    }

    const root = button.closest("[data-line-art-upload]");

    if (root && root.dataset.uploadState !== state) {
      root.dataset.uploadState = state;
      const uploadId = find(root, "[data-upload-id-property]")?.value || "";

      root.dispatchEvent(
        new CustomEvent("stampmymark:upload-state", {
          bubbles: true,
          detail: { state, uploadId }
        })
      );
    }

    if (root) {
      schedulePermanentStickyBarSync(root, state, label);
    }
  }

  function startSimulatedUploadProgress(button) {
    let progress = 0;
    let intervalId = null;

    function render() {
      setButton(button, "uploading", `Uploading ${progress}%`);
    }

    function advance() {
      const increment = progress < 30 ? 6 : progress < 60 ? 4 : progress < 80 ? 2 : 1;
      progress = Math.min(95, progress + increment);
      render();

      if (progress === 95 && intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    }

    render();
    intervalId = window.setInterval(advance, 250);

    return {
      async complete() {
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }

        const startingProgress = progress;
        const steps = 4;

        for (let step = 1; step <= steps; step += 1) {
          progress = Math.round(startingProgress + ((100 - startingProgress) * step) / steps);
          render();
          await new Promise((resolve) => window.setTimeout(resolve, 70));
        }
      },
      stop() {
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }
    };
  }

  function getProductForm(root) {
    const isAddToCartForm = (form) =>
      Boolean(
        form?.querySelector(
          "button[name='add'], input[name='add'], button[type='submit'][data-add-to-cart]"
        )
      );
    const closestForm = root.closest("form[action*='/cart/add']");

    if (isAddToCartForm(closestForm)) return closestForm;

    const productInfo = root.closest(
      ".m-product-info--wrapper, .product__info-container, [data-product-info]"
    );
    const nearbyForms = productInfo
      ? Array.from(productInfo.querySelectorAll("form[action*='/cart/add']"))
      : [];
    const allForms = Array.from(document.querySelectorAll("form[action*='/cart/add']"));

    return (
      nearbyForms.find(isAddToCartForm) ||
      allForms.find(isAddToCartForm) ||
      closestForm ||
      nearbyForms[0] ||
      allForms[0] ||
      null
    );
  }

  function getCartAddUrl() {
    const rootPath = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
    return `${rootPath.replace(/\/?$/, "/")}cart/add.js`;
  }

  function getCartUrl() {
    const rootPath = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
    return `${rootPath.replace(/\/?$/, "/")}cart`;
  }

  function getTextFieldValue(root, selector) {
    const field = find(root, selector);
    return field ? field.value.trim() : "";
  }

  function getTextFieldPayload(root) {
    return {
      textAbove: getTextFieldValue(root, "[data-upload-text-above]"),
      textBelow: getTextFieldValue(root, "[data-upload-text-below]"),
      designerNotes: getTextFieldValue(root, "[data-upload-designer-notes]")
    };
  }

  function updateCharacterCount(field) {
    const count = field.closest(".smm-upload__field")?.querySelector("[data-upload-character-count]");
    if (!count) return;
    const limit = Number(field.maxLength);
    count.textContent = `${field.value.length}/${Number.isFinite(limit) && limit > 0 ? limit : 0}`;
  }

  function setTextFieldsVisible(root, visible, clearValues) {
    const fields = find(root, "[data-upload-text-fields]");

    root.classList.toggle("smm-upload--uploaded", visible);

    if (!fields) return;

    fields.hidden = !visible;
    fields.setAttribute("aria-hidden", visible ? "false" : "true");

    Array.from(root.querySelectorAll("[data-upload-text-field]")).forEach((field) => {
      field.disabled = !visible;

      if (clearValues) {
        field.value = "";
      }

      updateCharacterCount(field);
    });
  }

  function getOptionControls(root, optionName) {
    const form = getProductForm(root);
    const normalizedOptionName = optionName
      .toString()
      .normalize("NFKC")
      .trim()
      .toLowerCase();
    return Array.from(
      document.querySelectorAll("input[name], select[name]")
    ).filter((input) => {
      if (form && input.form !== form && !form.contains(input)) return false;

      const inputName = input.name.normalize("NFKC").trim().toLowerCase();
      const bracketedName = inputName.match(/^options\[(.+)\]$/)?.[1]?.trim();

      return (
        bracketedName === normalizedOptionName ||
        inputName === normalizedOptionName ||
        inputName.startsWith(`${normalizedOptionName}-`)
      );
    });
  }

  function getSelectedOption(root, optionName) {
    const namedOptions = getOptionControls(root, optionName);
    const selectedOption = namedOptions.find(
      (input) => input.tagName === "SELECT" || input.checked
    );

    if (selectedOption && "value" in selectedOption) {
      return selectedOption.value;
    }

    return null;
  }

  function getSelectedSize(root) {
    return getSelectedOption(root, root.dataset.sizeOptionName || "Size");
  }

  function getSelectedInkColor(root) {
    const value = getSelectedOption(root, root.dataset.colorOptionName || "Ink color");
    return (value || "black").toString().trim().toLowerCase();
  }

  function syncPreviewInkControls(root, color) {
    const selectedColor = (color || getSelectedInkColor(root)).toLowerCase();
    const availableColors = new Set(
      getOptionControls(root, root.dataset.colorOptionName || "Ink color").map((control) =>
        String(control.value || "").trim().toLowerCase()
      )
    );

    root.querySelectorAll("[data-preview-ink-color]").forEach((button) => {
      const buttonColor = button.dataset.previewInkColor || "";
      button.setAttribute("aria-pressed", buttonColor === selectedColor ? "true" : "false");
      button.disabled = availableColors.size > 0 && !availableColors.has(buttonColor);
    });
  }

  function keepViewportAnchored(root, anchor, initialControls) {
    if (!anchor || !anchor.isConnected) return;

    const anchorTop = anchor.getBoundingClientRect().top;
    const startedAt = window.performance?.now?.() || Date.now();
    const shouldRestoreFocus = document.activeElement === anchor;
    let variantSettled = false;
    let stableFrames = 0;
    let cancelled = false;
    let animationFrame = null;
    let restoringViewport = false;

    const restoreViewport = () => {
      if (cancelled || restoringViewport || !anchor.isConnected) return false;

      const offset = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(offset) <= 0.5) return false;

      restoringViewport = true;
      window.scrollBy(0, offset);
      restoringViewport = false;
      stableFrames = 0;
      return true;
    };

    const handleFocusIn = (event) => {
      const currentControls = getOptionControls(
        root,
        root.dataset.colorOptionName || "Ink color"
      );
      if (!currentControls.includes(event.target)) return;

      restoreViewport();
      if (shouldRestoreFocus && document.activeElement !== anchor) {
        anchor.focus({ preventScroll: true });
        restoreViewport();
      }
    };

    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchmove", cancel);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("scroll", restoreViewport);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("variant:changed", markVariantSettled, true);
    };

    const markVariantSettled = () => {
      variantSettled = true;
      stableFrames = 0;
    };

    const restore = () => {
      if (cancelled || !anchor.isConnected) {
        cancel();
        return;
      }

      const elapsed = (window.performance?.now?.() || Date.now()) - startedAt;
      if (elapsed > 8000) {
        cancel();
        return;
      }

      const currentControls = getOptionControls(
        root,
        root.dataset.colorOptionName || "Ink color"
      );
      if (
        !variantSettled &&
        currentControls.some((control) => !initialControls.includes(control))
      ) {
        markVariantSettled();
      }

      const viewportMoved = restoreViewport();
      if (!viewportMoved && variantSettled) {
        stableFrames += 1;
      }

      if (
        shouldRestoreFocus &&
        currentControls.includes(document.activeElement) &&
        document.activeElement !== anchor
      ) {
        anchor.focus({ preventScroll: true });
        stableFrames = 0;
      }

      if (variantSettled && stableFrames >= 6) {
        cancel();
        return;
      }

      animationFrame = window.requestAnimationFrame(restore);
    };

    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchmove", cancel, { passive: true });
    window.addEventListener("keydown", cancel);
    window.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("scroll", restoreViewport, { passive: true });
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("variant:changed", markVariantSettled, true);
    animationFrame = window.requestAnimationFrame(restore);
  }

  function selectInkColor(root, color, anchor) {
    const controls = getOptionControls(root, root.dataset.colorOptionName || "Ink color");
    const normalizedColor = String(color || "").trim().toLowerCase();
    const control = controls.find(
      (candidate) => String(candidate.value || "").trim().toLowerCase() === normalizedColor
    );

    if (!control || control.disabled) return false;

    if (control.tagName === "SELECT") {
      if (String(control.value).trim().toLowerCase() === normalizedColor) return false;
      keepViewportAnchored(root, anchor, controls);
      control.value = Array.from(control.options).find(
        (option) => String(option.value).trim().toLowerCase() === normalizedColor
      )?.value || control.value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (control.checked) return false;
    keepViewportAnchored(root, anchor, controls);
    control.checked = true;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function getQuantity(form) {
    const quantityInput = form && form.querySelector("[name='quantity']");
    const quantity = quantityInput ? Number(quantityInput.value) : 1;
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function getVariantId(root, form) {
    const variantInput = form && form.querySelector("[name='id']");
    return variantInput && variantInput.value ? variantInput.value : root.dataset.variantId || null;
  }

  function setHiddenProperty(root, form, selector, name, value) {
    let input = find(root, selector);

    if (form && (!input || !form.contains(input))) {
      input = form.querySelector(`[name="${name}"]`);

      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        form.appendChild(input);
      }
    }

    if (input) {
      input.name = name;
      input.value = value || "";
      input.disabled = !value;
    }
  }

  function buildArtworkUploadUrl(root, uploadId, artworkUrl) {
    if (artworkUrl) return artworkUrl;
    return "";
  }

  function setLineItemProperties(root, form, uploadId, filename, artworkUrl, lineArtUrl) {
    setHiddenProperty(
      root,
      form,
      "[data-upload-id-property]",
      "properties[_stampmymark_upload_id]",
      uploadId
    );
    setHiddenProperty(
      root,
      form,
      "[data-upload-filename-property]",
      "properties[_stampmymark_original_filename]",
      filename
    );
    setHiddenProperty(
      root,
      form,
      "[data-upload-artwork-property]",
      "properties[StampMyMark artwork]",
      buildArtworkUploadUrl(root, uploadId, artworkUrl)
    );
    setHiddenProperty(
      root,
      form,
      "[data-upload-line-art-property]",
      lineArtPropertyName,
      lineArtUrl
    );
  }

  function setTextLineItemProperties(root, form) {
    const text = getTextFieldPayload(root);

    setHiddenProperty(
      root,
      form,
      "[data-upload-text-above-property]",
      "properties[Above]",
      text.textAbove
    );
    setHiddenProperty(
      root,
      form,
      "[data-upload-text-below-property]",
      "properties[Below]",
      text.textBelow
    );
    setHiddenProperty(
      root,
      form,
      "[data-upload-designer-notes-property]",
      "properties[Notes]",
      text.designerNotes
    );
  }

  function setFormDataValue(formData, name, value) {
    formData.delete(name);

    if (value) {
      formData.append(name, value);
    }
  }

  function setFormDataLineItemProperties(
    root,
    formData,
    uploadId,
    filename,
    artworkUrl,
    lineArtUrl
  ) {
    setFormDataValue(formData, "properties[_stampmymark_upload_id]", uploadId);
    setFormDataValue(formData, "properties[_stampmymark_original_filename]", filename);
    setFormDataValue(
      formData,
      "properties[StampMyMark artwork]",
      buildArtworkUploadUrl(root, uploadId, artworkUrl)
    );
    legacyLineArtPropertyNames.forEach((name) => formData.delete(name));
    setFormDataValue(formData, lineArtPropertyName, lineArtUrl);

    const text = getTextFieldPayload(root);
    setFormDataValue(formData, "properties[Above]", text.textAbove);
    setFormDataValue(formData, "properties[Below]", text.textBelow);
    setFormDataValue(formData, "properties[Notes]", text.designerNotes);
  }

  function syncLineItemProperties(root, form, uploadId, filename, artworkUrl, lineArtUrl) {
    setLineItemProperties(root, form, uploadId, filename, artworkUrl, lineArtUrl);
    setTextLineItemProperties(root, form);
  }

  function getCartPayload(root, form, sessionId, uploadId) {
    return {
      uploadId,
      sessionId,
      cartToken: getCartToken(),
      quantity: getQuantity(form),
      selectedSize: getSelectedSize(root),
      variantId: getVariantId(root, form),
      ...getTextFieldPayload(root)
    };
  }

  function sendCartUpdate(root, form, sessionId, uploadId) {
    const payload = getCartPayload(root, form, sessionId, uploadId);

    fetch(appProxyBase + "cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {
      // The order webhook can still link the upload when line-item properties are present.
    });
  }

  async function addToShopifyCart(
    root,
    form,
    sessionId,
    uploadId,
    filename,
    artworkUrl,
    lineArtUrl
  ) {
    if (!form) {
      throw new Error("Product form was not found. Please refresh the page and try again.");
    }

    syncLineItemProperties(root, form, uploadId, filename, artworkUrl, lineArtUrl);

    const formData = new FormData(form);
    setFormDataLineItemProperties(root, formData, uploadId, filename, artworkUrl, lineArtUrl);

    if (!formData.get("id")) {
      const variantId = getVariantId(root, form);

      if (variantId) {
        formData.set("id", variantId);
      }
    }

    if (!formData.get("quantity")) {
      formData.set("quantity", String(getQuantity(form)));
    }

    const response = await fetch(getCartAddUrl(), {
      method: "POST",
      headers: { Accept: "application/json" },
      body: formData
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.description || body.message || "Could not add this product to cart.");
    }

    await postJson("cart", getCartPayload(root, form, sessionId, uploadId));

    return body;
  }

  async function handleAddToCart(root, form, sessionId, state, event, button) {
    if (state.uploading && !state.uploadId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(root, "Please wait until the file finishes uploading.", "error");
      return;
    }

    if (root.dataset.required === "true" && !state.uploadId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(root, "Please upload a picture before adding this product to cart.", "error");
      return;
    }

    if (!state.uploadId) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.dataset.smmAdding === "true") return;

    const previousLabel = button.textContent;
    button.dataset.smmAdding = "true";
    button.disabled = true;

    if (button.tagName === "BUTTON") {
      button.textContent = "Adding...";
    }

    try {
      await addToShopifyCart(
        root,
        form,
        sessionId,
        state.uploadId,
        state.filename,
        state.artworkUrl,
        state.lineArtUrl
      );
      window.location.href = getCartUrl();
    } catch (error) {
      button.disabled = false;
      delete button.dataset.smmAdding;

      if (button.tagName === "BUTTON") {
        button.textContent = previousLabel;
      }

      setStatus(root, error.message || "Could not add this product to cart.", "error");
    }
  }

  function clearTextLineItemProperties(root, form) {
    setHiddenProperty(root, form, "[data-upload-text-above-property]", "properties[Above]", "");
    setHiddenProperty(root, form, "[data-upload-text-below-property]", "properties[Below]", "");
    setHiddenProperty(
      root,
      form,
      "[data-upload-designer-notes-property]",
      "properties[Notes]",
      ""
    );
  }

  function getSubmitButtons(form) {
    if (!form) return [];

    const buttons = Array.from(form.querySelectorAll("[type='submit'], button[name='add']"));

    if (form.id) {
      buttons.push(...Array.from(document.querySelectorAll(`[form="${form.id}"]`)));
    }

    return Array.from(new Set(buttons));
  }

  function getControlText(control) {
    if (!control) return "";

    return (
      control.getAttribute("aria-label") ||
      control.getAttribute("value") ||
      control.textContent ||
      ""
    ).trim();
  }

  function isAddToCartControl(control, form) {
    if (!control || !form) return false;

    const name = (control.getAttribute("name") || "").toLowerCase();
    const type = (control.getAttribute("type") || "").toLowerCase();
    const text = getControlText(control).toLowerCase();
    const looksLikeAddToCart =
      name === "add" ||
      control.hasAttribute("data-add-to-cart") ||
      text.includes("add to cart") ||
      (type === "submit" && !text.includes("checkout") && !text.includes("buy with"));

    if (!looksLikeAddToCart) return false;

    const formId = control.getAttribute("form");
    const isConnectedToForm =
      control.form === form ||
      (form.id && formId === form.id) ||
      form.contains(control);

    return isConnectedToForm || text.includes("add to cart");
  }

  function getClickedAddToCartControl(target, form) {
    if (!target || !target.closest) return null;

    const control = target.closest("button,input[type='submit'],input[type='button'],[role='button']");
    return isAddToCartControl(control, form) ? control : null;
  }

  function setAddToCartEnabled(form, enabled) {
    getSubmitButtons(form).forEach((button) => {
      if (enabled) {
        if (button.dataset.smmDisabled === "true") {
          button.disabled = false;
          delete button.dataset.smmDisabled;
        }
      } else if (!button.disabled) {
        button.disabled = true;
        button.dataset.smmDisabled = "true";
      }
    });

    if (!form) return;

    Array.from(
      form.querySelectorAll(".m-product-dynamic-checkout, .shopify-payment-button")
    ).forEach((checkout) => {
      if (enabled) {
        if (checkout.dataset.smmHidden === "true") {
          checkout.hidden = false;
          delete checkout.dataset.smmHidden;
        }
      } else if (!checkout.hidden) {
        checkout.hidden = true;
        checkout.dataset.smmHidden = "true";
      }
    });
  }

  async function postJson(path, payload, options = {}) {
    const response = await fetch(appProxyBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.ok === false) {
      throw new Error(
        (body.details && body.details.join && body.details.join(" ")) ||
          (body.errors && body.errors.join && body.errors.join(" ")) ||
          body.error ||
          "Upload request failed."
      );
    }

    return body;
  }

  const performanceNow = () =>
    window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : Date.now();

  const elapsedPerformanceMs = (startedAt) =>
    Math.max(0, Math.round(performanceNow() - startedAt));

  function reportPerformanceMetric({
    uploadId,
    sessionId,
    phase,
    outcome,
    startedAt,
    inkColor,
    mode,
    errorCode
  }) {
    if (!uploadId || !sessionId || !Number.isFinite(startedAt)) return;

    // Metrics are deliberately best-effort and never participate in the
    // customer flow. No artwork, filename, notes, or raw error is sent.
    fetch(appProxyBase + "performance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId,
        sessionId,
        phase,
        outcome,
        durationMs: elapsedPerformanceMs(startedAt),
        inkColor: inkColor || null,
        mode: mode || null,
        errorCode: errorCode || null
      }),
      keepalive: true
    }).catch(() => {
      // Performance reporting must never delay or break the uploader.
    });
  }

  async function getJson(path, options = {}) {
    const response = await fetch(appProxyBase + path, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: options.signal
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.ok === false) {
      throw new Error(
        (body.details && body.details.join && body.details.join(" ")) ||
          body.error ||
          "Line art request failed."
      );
    }

    return body;
  }

  const isAbortError = (error) => error && error.name === "AbortError";

  const wait = (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Request was replaced.", "AbortError"));
        return;
      }

      const timer = window.setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, milliseconds);
      const onAbort = () => {
        window.clearTimeout(timer);
        reject(new DOMException("Request was replaced.", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  async function pollLineArt(
    root,
    uploadId,
    sessionId,
    isCurrent = () => true,
    signal
  ) {
    const deadline = Date.now() + 3 * 60 * 1000;
    const path =
      `${encodeURIComponent(uploadId)}/line-art-status` +
      `?sessionId=${encodeURIComponent(sessionId)}`;

    while (Date.now() < deadline) {
      if (!isCurrent()) return null;
      const result = await getJson(path, { signal });
      if (!isCurrent()) return null;

      if (result.status === "completed" && result.previewUrl && result.lineArtUrl) {
        return result;
      }

      if (result.status === "failed") {
        throw new Error(result.error || root.dataset.lineArtFailed || "Line art generation failed.");
      }

      await wait(1250, signal);
    }

    throw new Error(
      root.dataset.lineArtTimeout || "Line-art generation is taking longer than expected."
    );
  }

  function setStampPreviewSummary(root, state, message) {
    const section = find(root, "[data-stamp-previews]");
    const summary = find(root, "[data-stamp-previews-summary]");
    const retry = find(root, "[data-stamp-previews-retry]");

    if (!section) return;
    section.hidden = false;
    section.dataset.state = state;
    if (summary) summary.textContent = message || "";
    if (retry) retry.hidden = state !== "failed";
  }

  function setStampPreviewProgress(root, percentage) {
    const progress = find(root, "[data-stamp-previews-progress]");
    const fill = find(root, "[data-stamp-previews-progress-fill]");
    const output = find(root, "[data-stamp-previews-percentage]");
    const value = Math.max(0, Math.min(100, Math.round(percentage)));

    if (progress) progress.setAttribute("aria-valuenow", String(value));
    if (fill) fill.style.transform = `scaleX(${value / 100})`;
    if (output) output.textContent = `${value}%`;
  }

  let activeStampPreviewTrigger = null;
  let activeStampPreviewCards = [];
  let activeStampPreviewIndex = -1;

  function closeStampPreviewLightbox() {
    const lightbox = document.querySelector("[data-stamp-preview-lightbox]");
    if (!lightbox || lightbox.hidden) return;

    lightbox.hidden = true;
    document.body.classList.remove("smm-preview-lightbox-open");

    const image = find(lightbox, "[data-stamp-preview-lightbox-image]");
    if (image) delete image.dataset.pendingFullPreviewUrl;
    if (activeStampPreviewTrigger) activeStampPreviewTrigger.focus();
    activeStampPreviewTrigger = null;
    activeStampPreviewCards = [];
    activeStampPreviewIndex = -1;
  }

  function showStampPreviewLightboxSlide(index, direction) {
    const lightbox = document.querySelector("[data-stamp-preview-lightbox]");
    if (!lightbox || activeStampPreviewCards.length === 0) return;

    const count = activeStampPreviewCards.length;
    activeStampPreviewIndex = ((index % count) + count) % count;

    const card = activeStampPreviewCards[activeStampPreviewIndex];
    const sourceImage = find(card, "[data-stamp-preview-image]");
    if (!sourceImage || !sourceImage.src) return;

    const image = find(lightbox, "[data-stamp-preview-lightbox-image]");
    const caption = find(lightbox, "[data-stamp-preview-lightbox-caption]");
    const counter = find(lightbox, "[data-stamp-preview-lightbox-counter]");
    const label = find(card, "figcaption")?.textContent?.trim() || "Stamp preview";

    lightbox.dataset.previewKind = card.dataset.stampPreviewCard || "";
    lightbox.dataset.inkColor = card.dataset.inkColor || "";

    image.classList.remove(
      "smm-preview-lightbox__image--next",
      "smm-preview-lightbox__image--previous"
    );
    void image.offsetWidth;
    if (direction) {
      image.classList.add(
        direction === "previous"
          ? "smm-preview-lightbox__image--previous"
          : "smm-preview-lightbox__image--next"
      );
    }

    const thumbnailUrl = sourceImage.currentSrc || sourceImage.src;
    const fullPreviewUrl = sourceImage.dataset.fullPreviewUrl || thumbnailUrl;
    image.dataset.pendingFullPreviewUrl = fullPreviewUrl;
    image.src = thumbnailUrl;
    image.alt = sourceImage.alt || label;
    caption.textContent = label;
    counter.textContent = `${activeStampPreviewIndex + 1} / ${count}`;

    if (fullPreviewUrl !== thumbnailUrl) {
      preloadFullStampPreview(fullPreviewUrl)
        .then(() => {
          if (
            lightbox.hidden ||
            image.dataset.pendingFullPreviewUrl !== fullPreviewUrl
          ) {
            return;
          }
          image.src = fullPreviewUrl;
        })
        .catch(() => {
          // Keep the already-visible thumbnail when the large preview is unavailable.
        });
    }

    lightbox
      .querySelectorAll("[data-stamp-preview-lightbox-navigation]")
      .forEach((button) => {
        button.hidden = count < 2;
      });
  }

  function moveStampPreviewLightbox(offset) {
    if (activeStampPreviewCards.length < 2) return;
    showStampPreviewLightboxSlide(
      activeStampPreviewIndex + offset,
      offset < 0 ? "previous" : "next"
    );
  }

  function getStampPreviewLightbox() {
    const existing = document.querySelector("[data-stamp-preview-lightbox]");
    if (existing) return existing;

    const lightbox = document.createElement("div");
    lightbox.className = "smm-preview-lightbox";
    lightbox.dataset.stampPreviewLightbox = "true";
    lightbox.hidden = true;

    const dialog = document.createElement("div");
    dialog.className = "smm-preview-lightbox__dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "smm-preview-lightbox-caption");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "smm-preview-lightbox__close";
    closeButton.setAttribute("aria-label", "Close fullscreen preview");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", closeStampPreviewLightbox);

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className =
      "smm-preview-lightbox__nav smm-preview-lightbox__nav--previous";
    previousButton.dataset.stampPreviewLightboxNavigation = "true";
    previousButton.setAttribute("aria-label", "Show previous stamp preview");
    previousButton.textContent = "‹";
    previousButton.addEventListener("click", () => moveStampPreviewLightbox(-1));

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className =
      "smm-preview-lightbox__nav smm-preview-lightbox__nav--next";
    nextButton.dataset.stampPreviewLightboxNavigation = "true";
    nextButton.setAttribute("aria-label", "Show next stamp preview");
    nextButton.textContent = "›";
    nextButton.addEventListener("click", () => moveStampPreviewLightbox(1));

    const image = document.createElement("img");
    image.className = "smm-preview-lightbox__image";
    image.dataset.stampPreviewLightboxImage = "true";
    image.draggable = false;

    let swipeStartX = null;
    let swipePointerId = null;
    image.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) return;
      swipeStartX = event.clientX;
      swipePointerId = event.pointerId;
      image.setPointerCapture?.(event.pointerId);
    });
    image.addEventListener("pointerup", (event) => {
      if (swipeStartX === null || event.pointerId !== swipePointerId) return;
      const distance = event.clientX - swipeStartX;
      swipeStartX = null;
      swipePointerId = null;
      if (Math.abs(distance) >= 50) {
        moveStampPreviewLightbox(distance > 0 ? -1 : 1);
      }
    });
    image.addEventListener("pointercancel", () => {
      swipeStartX = null;
      swipePointerId = null;
    });
    image.addEventListener("dragstart", (event) => event.preventDefault());

    const footer = document.createElement("div");
    footer.className = "smm-preview-lightbox__footer";

    const caption = document.createElement("p");
    caption.className = "smm-preview-lightbox__caption";
    caption.id = "smm-preview-lightbox-caption";
    caption.dataset.stampPreviewLightboxCaption = "true";

    const counter = document.createElement("span");
    counter.className = "smm-preview-lightbox__counter";
    counter.dataset.stampPreviewLightboxCounter = "true";
    counter.setAttribute("aria-live", "polite");

    dialog.appendChild(closeButton);
    dialog.appendChild(previousButton);
    dialog.appendChild(nextButton);
    dialog.appendChild(image);
    footer.appendChild(caption);
    footer.appendChild(counter);
    dialog.appendChild(footer);
    lightbox.appendChild(dialog);
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) closeStampPreviewLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !lightbox.hidden) {
        closeStampPreviewLightbox();
      } else if (event.key === "ArrowLeft" && !lightbox.hidden) {
        event.preventDefault();
        moveStampPreviewLightbox(-1);
      } else if (event.key === "ArrowRight" && !lightbox.hidden) {
        event.preventDefault();
        moveStampPreviewLightbox(1);
      }
    });
    document.body.appendChild(lightbox);

    return lightbox;
  }

  function openStampPreviewLightbox(card) {
    if (!card || card.dataset.state !== "ready") return;

    const sourceImage = find(card, "[data-stamp-preview-image]");
    if (!sourceImage || !sourceImage.src) return;

    const lightbox = getStampPreviewLightbox();
    activeStampPreviewTrigger = card;
    const root = card.closest("[data-line-art-upload]");
    activeStampPreviewCards = Array.from(
      (root || document).querySelectorAll("[data-stamp-preview-card]")
    ).filter((previewCard) => {
      const previewImage = find(previewCard, "[data-stamp-preview-image]");
      return previewCard.dataset.state === "ready" && Boolean(previewImage?.src);
    });
    activeStampPreviewIndex = activeStampPreviewCards.indexOf(card);
    if (activeStampPreviewIndex < 0) return;

    showStampPreviewLightboxSlide(activeStampPreviewIndex);
    lightbox.hidden = false;
    document.body.classList.add("smm-preview-lightbox-open");
    find(lightbox, ".smm-preview-lightbox__close")?.focus();
  }

  function enableStampPreviewLightbox(root) {
    root.querySelectorAll("[data-stamp-preview-card]").forEach((card) => {
      if (card.dataset.stampPreviewLightboxReady === "true") return;

      const label = find(card, "figcaption")?.textContent?.trim() || "Stamp preview";
      card.dataset.stampPreviewLightboxReady = "true";
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Open ${label} fullscreen`);
      card.setAttribute("aria-disabled", card.dataset.state === "ready" ? "false" : "true");
      card.tabIndex = card.dataset.state === "ready" ? 0 : -1;
      card.addEventListener("click", () => openStampPreviewLightbox(card));
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openStampPreviewLightbox(card);
      });
    });
  }

  function withPreviewVersion(url, version) {
    if (!url) return "";
    if (!version) return url;
    return `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
  }

  function setStampPreviewCardInteractive(card, interactive) {
    card.setAttribute("aria-disabled", interactive ? "false" : "true");
    card.tabIndex = interactive ? 0 : -1;
  }

  function preloadFullStampPreview(url) {
    if (!url) return Promise.resolve(null);

    const existing = fullPreviewPreloads.get(url);
    if (existing) return existing;

    const preload = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.onload = async () => {
        try {
          await image.decode?.();
        } catch (_error) {
          // A completed load is still safe to display if decode() is unavailable.
        }
        resolve(image);
      };
      image.onerror = reject;
      image.src = url;
    });

    fullPreviewPreloads.set(url, preload);
    preload.catch(() => fullPreviewPreloads.delete(url));
    return preload;
  }

  function scheduleFullStampPreviewPreload(url) {
    if (!url || fullPreviewPreloads.has(url)) return;

    const start = () => {
      preloadFullStampPreview(url).catch(() => {
        // The thumbnail remains usable if a background full-size preload fails.
      });
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(start, { timeout: 2500 });
    } else {
      window.setTimeout(start, 1200);
    }
  }

  function swapStampPreviewImage(card, image, previewUrl, fullPreviewUrl) {
    if (image.getAttribute("src") === previewUrl) {
      image.hidden = false;
      image.dataset.fullPreviewUrl = fullPreviewUrl;
      card.dataset.state = "ready";
      setStampPreviewCardInteractive(card, true);
      scheduleFullStampPreviewPreload(fullPreviewUrl);
      return;
    }

    image.dataset.pendingPreviewUrl = previewUrl;
    const loader = new Image();
    loader.decoding = "async";
    loader.onload = () => {
      if (image.dataset.pendingPreviewUrl !== previewUrl) return;

      image.src = previewUrl;
      image.dataset.fullPreviewUrl = fullPreviewUrl;
      image.hidden = false;
      delete image.dataset.pendingPreviewUrl;
      card.dataset.state = "ready";
      setStampPreviewCardInteractive(card, true);
      scheduleFullStampPreviewPreload(fullPreviewUrl);
      image.classList.remove("smm-upload__stamp-preview-image--reveal");
      void image.offsetWidth;
      image.classList.add("smm-upload__stamp-preview-image--reveal");
      window.setTimeout(
        () => image.classList.remove("smm-upload__stamp-preview-image--reveal"),
        300
      );
    };
    loader.onerror = () => {
      if (image.dataset.pendingPreviewUrl !== previewUrl) return;
      delete image.dataset.pendingPreviewUrl;
      if (!image.getAttribute("src")) {
        card.dataset.state = "failed";
        setStampPreviewCardInteractive(card, false);
      }
    };
    loader.src = previewUrl;
  }

  function setStampPreviewCard(root, kind, state, previewUrl, fullPreviewUrl, version) {
    const card = find(root, `[data-stamp-preview-card="${kind}"]`);
    if (!card) return;

    const image = find(card, "[data-stamp-preview-image]");
    const status = find(card, "[data-stamp-preview-state]");
    const labels = {
      waiting: "Waiting for line art",
      generating: kind === "line_art" ? "Drawing line art…" : `Creating ${kind}…`,
      updating: kind === "line_art" ? "Applying ink color…" : `Updating ${kind}…`,
      failed: "Preview failed"
    };

    card.dataset.state = state;
    card.dataset.inkColor = getSelectedInkColor(root);
    if ((state === "ready" && previewUrl) || state === "waiting" || state === "failed") {
      delete card.dataset.instantInkColor;
    }
    const hasExistingPreview = Boolean(image && image.getAttribute("src"));
    setStampPreviewCardInteractive(
      card,
      state === "ready" || (state === "updating" && hasExistingPreview)
    );
    if (status) status.textContent = labels[state] || "";

    if (image) {
      if (state === "ready" && previewUrl) {
        const cardPreviewUrl = withPreviewVersion(previewUrl, version);
        const cardFullPreviewUrl = withPreviewVersion(
          fullPreviewUrl || previewUrl,
          version
        );
        image.decoding = "async";
        card.dataset.state = hasExistingPreview ? "updating" : "generating";
        swapStampPreviewImage(card, image, cardPreviewUrl, cardFullPreviewUrl);
      } else if (state !== "updating" || !hasExistingPreview) {
        image.hidden = true;
        image.removeAttribute("src");
        delete image.dataset.fullPreviewUrl;
        delete image.dataset.pendingPreviewUrl;
      }
    }
  }

  function resetStampPreviews(root) {
    const section = find(root, "[data-stamp-previews]");
    if (section) {
      section.hidden = true;
      section.dataset.state = "waiting";
    }
    setStampPreviewProgress(root, 0);

    ["line_art", ...stampPreviewKinds].forEach((kind) => {
      setStampPreviewCard(root, kind, "waiting");
    });
  }

  function loadInstantMockup(profile, palette, kind) {
    const key = `${profile}:${palette}:${kind}:${instantMockupAssetVersion}`;
    const existing = instantMockupPreloads.get(key);
    if (existing) return existing;

    const preload = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.fetchPriority = "low";
      image.onload = async () => {
        try {
          await image.decode?.();
        } catch (_error) {
          // onload is sufficient when decode() is unavailable.
        }
        resolve(image);
      };
      image.onerror = reject;
      image.src =
        `${appProxyRoot}mockups/${palette}/${kind}` +
        `?profile=${encodeURIComponent(profile)}&v=${instantMockupAssetVersion}`;
    });

    instantMockupPreloads.set(key, preload);
    preload.catch(() => instantMockupPreloads.delete(key));
    return preload;
  }

  function scheduleInstantMockupPreload(root) {
    const profile = getPreviewProfile(root);
    const start = () => {
      ["regular", "white"].forEach((palette) => {
        stampPreviewKinds.forEach((kind) => {
          loadInstantMockup(profile, palette, kind).catch(() => {
            // Server previews remain the fallback if a static base cannot load.
          });
        });
      });
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(start, { timeout: 1800 });
    } else {
      window.setTimeout(start, 350);
    }
  }

  function loadInstantArtworkImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = async () => {
        try {
          await image.decode?.();
        } catch (_error) {
          // A loaded image can still be sampled when decode() is unavailable.
        }
        resolve(image);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  async function prepareInstantArtworkMask(url) {
    const image = await loadInstantArtworkImage(url);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = image.naturalWidth || image.width;
    sourceCanvas.height = image.naturalHeight || image.height;
    const sourceContext = sourceCanvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!sourceContext || !sourceCanvas.width || !sourceCanvas.height) {
      throw new Error("Line-art mask could not be prepared.");
    }

    sourceContext.drawImage(image, 0, 0);
    const sourcePixels = sourceContext.getImageData(
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height
    );
    let hasTransparency = false;
    for (let index = 3; index < sourcePixels.data.length; index += 4) {
      if (sourcePixels.data[index] < 250) {
        hasTransparency = true;
        break;
      }
    }

    if (!hasTransparency) {
      for (let index = 0; index < sourcePixels.data.length; index += 4) {
        const distanceFromWhite = Math.max(
          255 - sourcePixels.data[index],
          255 - sourcePixels.data[index + 1],
          255 - sourcePixels.data[index + 2]
        );
        sourcePixels.data[index + 3] = Math.max(
          0,
          Math.min(255, Math.round((distanceFromWhite - 6) * 1.35))
        );
      }
      sourceContext.putImageData(sourcePixels, 0, 0);
    }

    let minX = sourceCanvas.width;
    let minY = sourceCanvas.height;
    let maxX = -1;
    let maxY = -1;
    let alphaTotal = 0;
    for (let y = 0; y < sourceCanvas.height; y += 1) {
      for (let x = 0; x < sourceCanvas.width; x += 1) {
        const alpha = sourcePixels.data[(y * sourceCanvas.width + x) * 4 + 3];
        if (alpha <= 6) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        alphaTotal += alpha / 255;
      }
    }
    if (maxX < minX || maxY < minY) {
      throw new Error("Line-art mask is empty.");
    }

    const trimmedWidth = maxX - minX + 1;
    const trimmedHeight = maxY - minY + 1;
    const boundingArea = Math.max(1, trimmedWidth * trimmedHeight);
    const inkFillRatio = Math.max(0.04, alphaTotal / boundingArea);
    const aspectRatio = trimmedWidth / Math.max(1, trimmedHeight);
    const aspectSpan = Math.max(
      aspectRatio,
      1 / Math.max(aspectRatio, 0.01)
    );
    const desiredLongEdge = Math.sqrt(
      (instantTargetInkArea * aspectSpan) / inkFillRatio
    );
    const contentSize = Math.round(
      Math.max(
        instantMinimumArtworkContentSize,
        Math.min(instantArtworkContentSize, desiredLongEdge)
      )
    );
    const fitScale = Math.min(
      contentSize / trimmedWidth,
      contentSize / trimmedHeight
    );
    const renderedWidth = Math.max(1, Math.round(trimmedWidth * fitScale));
    const renderedHeight = Math.max(1, Math.round(trimmedHeight * fitScale));
    const destinationX = Math.floor((instantArtworkSize - renderedWidth) / 2);
    const destinationY = Math.floor((instantArtworkSize - renderedHeight) / 2);
    const preparedCanvas = document.createElement("canvas");
    preparedCanvas.width = instantArtworkSize;
    preparedCanvas.height = instantArtworkSize;
    const preparedContext = preparedCanvas.getContext("2d", {
      willReadFrequently: true
    });
    if (!preparedContext) {
      throw new Error("Line-art mask could not be normalized.");
    }
    preparedContext.imageSmoothingEnabled = true;
    preparedContext.imageSmoothingQuality = "high";
    preparedContext.drawImage(
      sourceCanvas,
      minX,
      minY,
      trimmedWidth,
      trimmedHeight,
      destinationX,
      destinationY,
      renderedWidth,
      renderedHeight
    );
    const preparedPixels = preparedContext.getImageData(
      0,
      0,
      instantArtworkSize,
      instantArtworkSize
    );
    const alpha = new Uint8ClampedArray(
      instantArtworkSize * instantArtworkSize
    );
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = preparedPixels.data[index * 4 + 3];
    }
    return { alpha, size: instantArtworkSize };
  }

  function solveInstantLinearSystem(matrix, values) {
    const size = values.length;
    const augmented = matrix.map((row, index) => [...row, values[index]]);

    for (let column = 0; column < size; column += 1) {
      let pivot = column;
      for (let row = column + 1; row < size; row += 1) {
        if (
          Math.abs(augmented[row][column]) >
          Math.abs(augmented[pivot][column])
        ) {
          pivot = row;
        }
      }
      if (Math.abs(augmented[pivot][column]) < 1e-10) return null;

      [augmented[column], augmented[pivot]] = [
        augmented[pivot],
        augmented[column]
      ];
      const divisor = augmented[column][column];
      for (let index = column; index <= size; index += 1) {
        augmented[column][index] /= divisor;
      }
      for (let row = 0; row < size; row += 1) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let index = column; index <= size; index += 1) {
          augmented[row][index] -= factor * augmented[column][index];
        }
      }
    }
    return augmented.map((row) => row[size]);
  }

  function getInstantTransform(profile, palette, kind) {
    const cacheKey = `${profile}:${palette}:${kind}`;
    const existing = instantTransformCache.get(cacheKey);
    if (existing) return existing;

    const scale = instantCanvasSize / 1254;
    const quad = instantPlacementQuads[profile][palette][kind].map(([x, y]) => ({
      x: x * scale,
      y: y * scale
    }));
    const targets = [
      { x: 0, y: 0 },
      { x: instantArtworkSize - 1, y: 0 },
      { x: instantArtworkSize - 1, y: instantArtworkSize - 1 },
      { x: 0, y: instantArtworkSize - 1 }
    ];
    const matrix = [];
    const values = [];
    quad.forEach((point, index) => {
      const target = targets[index];
      matrix.push([
        point.x,
        point.y,
        1,
        0,
        0,
        0,
        -target.x * point.x,
        -target.x * point.y
      ]);
      values.push(target.x);
      matrix.push([
        0,
        0,
        0,
        point.x,
        point.y,
        1,
        -target.y * point.x,
        -target.y * point.y
      ]);
      values.push(target.y);
    });
    const transform = solveInstantLinearSystem(matrix, values);
    if (!transform) return null;
    const prepared = { quad, transform };
    instantTransformCache.set(cacheKey, prepared);
    return prepared;
  }

  function sampleInstantMaskAlpha(mask, sourceX, sourceY) {
    const x0 = Math.floor(sourceX);
    const y0 = Math.floor(sourceY);
    const x1 = Math.min(mask.size - 1, x0 + 1);
    const y1 = Math.min(mask.size - 1, y0 + 1);
    const xWeight = sourceX - x0;
    const yWeight = sourceY - y0;
    return (
      mask.alpha[y0 * mask.size + x0] * (1 - xWeight) * (1 - yWeight) +
      mask.alpha[y0 * mask.size + x1] * xWeight * (1 - yWeight) +
      mask.alpha[y1 * mask.size + x0] * (1 - xWeight) * yWeight +
      mask.alpha[y1 * mask.size + x1] * xWeight * yWeight
    );
  }

  function renderInstantMockup(baseImage, mask, profile, palette, kind, color) {
    const prepared = getInstantTransform(profile, palette, kind);
    const hex = inkColorHex[color];
    if (!prepared || !hex) return null;

    const canvas = document.createElement("canvas");
    canvas.width = instantCanvasSize;
    canvas.height = instantCanvasSize;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(baseImage, 0, 0, instantCanvasSize, instantCanvasSize);

    const overlayCanvas = document.createElement("canvas");
    overlayCanvas.width = instantCanvasSize;
    overlayCanvas.height = instantCanvasSize;
    const overlayContext = overlayCanvas.getContext("2d");
    if (!overlayContext) return null;
    const overlay = overlayContext.createImageData(
      instantCanvasSize,
      instantCanvasSize
    );
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    const minX = Math.max(
      0,
      Math.floor(Math.min(...prepared.quad.map((point) => point.x)))
    );
    const maxX = Math.min(
      instantCanvasSize - 1,
      Math.ceil(Math.max(...prepared.quad.map((point) => point.x)))
    );
    const minY = Math.max(
      0,
      Math.floor(Math.min(...prepared.quad.map((point) => point.y)))
    );
    const maxY = Math.min(
      instantCanvasSize - 1,
      Math.ceil(Math.max(...prepared.quad.map((point) => point.y)))
    );
    const opacity = color === "white" ? 0.95 : 0.93;
    const transform = prepared.transform;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const denominator = transform[6] * x + transform[7] * y + 1;
        const sourceX =
          (transform[0] * x + transform[1] * y + transform[2]) /
          denominator;
        const sourceY =
          (transform[3] * x + transform[4] * y + transform[5]) /
          denominator;
        if (
          sourceX < 0 ||
          sourceX > mask.size - 1 ||
          sourceY < 0 ||
          sourceY > mask.size - 1
        ) {
          continue;
        }

        const alpha = sampleInstantMaskAlpha(mask, sourceX, sourceY);
        if (alpha <= 0) continue;
        const outputIndex = (y * instantCanvasSize + x) * 4;
        const fineVariation = ((x * 17 + y * 31) % 7) / 100;
        const broadVariation =
          ((Math.floor(x / 4) * 11 + Math.floor(y / 4) * 19) % 4) / 100;
        const materialVariation = Math.min(
          1,
          0.94 + fineVariation + broadVariation
        );
        const fiberFade = (x * 37 + y * 17) % 97 === 0 ? 0.9 : 1;
        overlay.data[outputIndex] = red;
        overlay.data[outputIndex + 1] = green;
        overlay.data[outputIndex + 2] = blue;
        overlay.data[outputIndex + 3] = Math.round(
          alpha * opacity * materialVariation * fiberFade
        );
      }
    }

    overlayContext.putImageData(overlay, 0, 0);
    context.globalCompositeOperation = color === "white" ? "source-over" : "multiply";
    context.drawImage(overlayCanvas, 0, 0);
    context.globalCompositeOperation = "source-over";
    return canvas.toDataURL("image/webp", 0.9);
  }

  function setInstantStampPreviewCard(root, kind, previewUrl, color) {
    const card = find(root, `[data-stamp-preview-card="${kind}"]`);
    if (!card || !previewUrl) return;
    const image = find(card, "[data-stamp-preview-image]");
    const status = find(card, "[data-stamp-preview-state]");
    if (!image) return;

    card.dataset.state = "ready";
    card.dataset.inkColor = color;
    card.dataset.instantInkColor = color;
    image.src = previewUrl;
    image.dataset.fullPreviewUrl = previewUrl;
    image.hidden = false;
    delete image.dataset.pendingPreviewUrl;
    if (status) status.textContent = "";
    setStampPreviewCardInteractive(card, true);
  }

  function keepInstantStampPreviewReady(root, kind, color) {
    const card = find(root, `[data-stamp-preview-card="${kind}"]`);
    const image = card && find(card, "[data-stamp-preview-image]");
    if (
      !card ||
      !image?.getAttribute("src") ||
      card.dataset.instantInkColor !== color
    ) {
      return false;
    }

    card.dataset.state = "ready";
    setStampPreviewCardInteractive(card, true);
    const status = find(card, "[data-stamp-preview-state]");
    if (status) status.textContent = "";
    return true;
  }

  async function renderInstantProductPreviews(root, state, color) {
    const renderId = state.instantPreviewRunId + 1;
    state.instantPreviewRunId = renderId;
    const mask =
      state.instantArtworkMask ||
      (state.instantArtworkPromise
        ? await state.instantArtworkPromise
        : null);
    if (!mask || renderId !== state.instantPreviewRunId) return false;

    const profile = getPreviewProfile(root);
    const palette = color === "white" ? "white" : "regular";
    const bases = await Promise.all(
      stampPreviewKinds.map((kind) =>
        loadInstantMockup(profile, palette, kind)
      )
    );
    if (
      renderId !== state.instantPreviewRunId ||
      getSelectedInkColor(root) !== color
    ) {
      return false;
    }

    const previews = stampPreviewKinds.map((kind, index) => ({
      kind,
      previewUrl: renderInstantMockup(
        bases[index],
        mask,
        profile,
        palette,
        kind,
        color
      )
    }));
    if (
      renderId !== state.instantPreviewRunId ||
      getSelectedInkColor(root) !== color
    ) {
      return false;
    }
    previews.forEach(({ kind, previewUrl }) => {
      setInstantStampPreviewCard(root, kind, previewUrl, color);
    });
    return true;
  }

  function recolorLineArtPreviewInstantly(image, color) {
    const hex = inkColorHex[color];
    if (!image?.complete || !image.naturalWidth || !hex) return false;

    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return false;

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const red = parseInt(hex.slice(1, 3), 16);
      const green = parseInt(hex.slice(3, 5), 16);
      const blue = parseInt(hex.slice(5, 7), 16);

      for (let index = 0; index < pixels.data.length; index += 4) {
        if (pixels.data[index + 3] === 0) continue;
        pixels.data[index] = red;
        pixels.data[index + 1] = green;
        pixels.data[index + 2] = blue;
      }

      context.putImageData(pixels, 0, 0);
      const instantUrl = canvas.toDataURL("image/webp", 0.92);
      image.src = instantUrl;
      image.dataset.fullPreviewUrl = instantUrl;
      return true;
    } catch (_error) {
      // The server variant will replace the image shortly if canvas access is unavailable.
      return false;
    }
  }

  function showInstantLineArtInk(root, color, fullPreviewUrl, version) {
    const card = find(root, '[data-stamp-preview-card="line_art"]');
    if (!card) return;

    const image = find(card, "[data-stamp-preview-image]");
    const status = find(card, "[data-stamp-preview-state]");
    card.dataset.inkColor = color || getSelectedInkColor(root);

    if (!image?.getAttribute("src")) return;

    recolorLineArtPreviewInstantly(image, card.dataset.inkColor);

    card.dataset.state = "ready";
    setStampPreviewCardInteractive(card, true);
    if (status) status.textContent = "";
    if (fullPreviewUrl) {
      const versionedFullPreviewUrl = withPreviewVersion(fullPreviewUrl, version);
      image.dataset.fullPreviewUrl = versionedFullPreviewUrl;
    }
  }

  function showLineArtGenerating(root, preserveExisting = false) {
    setStampPreviewSummary(
      root,
      "generating",
      preserveExisting
        ? root.dataset.stampPreviewsUpdatingColor || "Updating previews for your selected ink…"
        : root.dataset.stampPreviewsGeneratingLineArt || "Drawing your stamp line art…"
    );
    if (preserveExisting) {
      showInstantLineArtInk(root, getSelectedInkColor(root));
    } else {
      setStampPreviewCard(root, "line_art", "generating");
    }
    const selectedColor = getSelectedInkColor(root);
    stampPreviewKinds.forEach((kind) => {
      if (
        preserveExisting &&
        keepInstantStampPreviewReady(root, kind, selectedColor)
      ) {
        return;
      }
      setStampPreviewCard(root, kind, preserveExisting ? "updating" : "waiting");
    });
  }

  function scrollToStampPreviews(root) {
    const section = find(root, "[data-stamp-previews]");
    if (!section) return;

    const reduceMotion =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    window.requestAnimationFrame(() => {
      section.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start"
      });
    });
  }

  function showMockupsGenerating(
    root,
    lineArtPreviewUrl,
    lineArtFullPreviewUrl,
    lineArtPreviewVersion,
    preserveExisting = false
  ) {
    setStampPreviewSummary(
      root,
      "generating",
      root.dataset.stampPreviewsGeneratingMockups ||
        "Creating your clear cup, paper cup and container previews…"
    );
    if (preserveExisting) {
      showInstantLineArtInk(
        root,
        getSelectedInkColor(root),
        lineArtFullPreviewUrl,
        lineArtPreviewVersion
      );
    } else {
      setStampPreviewCard(
        root,
        "line_art",
        "ready",
        lineArtPreviewUrl,
        lineArtFullPreviewUrl,
        lineArtPreviewVersion
      );
    }
    const selectedColor = getSelectedInkColor(root);
    stampPreviewKinds.forEach((kind) => {
      if (
        preserveExisting &&
        keepInstantStampPreviewReady(root, kind, selectedColor)
      ) {
        return;
      }
      setStampPreviewCard(root, kind, preserveExisting ? "updating" : "generating");
    });
  }

  function renderStampPreviewResults(
    root,
    previews,
    expectedColor,
    expectedSourceVersion
  ) {
    previews.forEach((preview) => {
      if (!stampPreviewKinds.includes(preview.kind)) return;
      if (
        (expectedColor && preview.inkColor !== expectedColor) ||
        (expectedSourceVersion && preview.sourceVersion !== expectedSourceVersion)
      ) {
        return;
      }

      if (preview.status === "completed" && preview.previewUrl) {
        setStampPreviewCard(
          root,
          preview.kind,
          "ready",
          preview.previewUrl,
          preview.fullPreviewUrl,
          preview.version
        );
      } else if (preview.status === "failed") {
        if (!keepInstantStampPreviewReady(root, preview.kind, expectedColor)) {
          setStampPreviewCard(root, preview.kind, "failed");
        }
      } else {
        if (!keepInstantStampPreviewReady(root, preview.kind, expectedColor)) {
          setStampPreviewCard(root, preview.kind, "generating");
        }
      }
    });
  }

  async function pollStampPreviews(
    root,
    uploadId,
    sessionId,
    expectedColor,
    expectedSourceVersion,
    isCurrent = () => true,
    signal
  ) {
    const deadline = Date.now() + 4 * 60 * 1000;
    const previewProfile = getPreviewProfile(root);
    const path =
      `${encodeURIComponent(uploadId)}/stamp-previews-status` +
      `?sessionId=${encodeURIComponent(sessionId)}` +
      `&previewProfile=${encodeURIComponent(previewProfile)}`;

    while (Date.now() < deadline) {
      if (!isCurrent()) return null;
      const result = await getJson(path, { signal });
      if (!isCurrent()) return null;
      if (
        result.previewProfile !== previewProfile ||
        result.inkColor !== expectedColor ||
        result.sourceVersion !== expectedSourceVersion
      ) {
        return null;
      }
      const previews = Array.isArray(result.previews) ? result.previews : [];
      renderStampPreviewResults(
        root,
        previews,
        expectedColor,
        expectedSourceVersion
      );

      const failed = previews.find((preview) => preview.status === "failed");
      if (failed) {
        throw new Error(
          failed.error ||
            root.dataset.stampPreviewsFailed ||
            "One or more product previews could not be created."
        );
      }

      const completedCount = previews.filter(
        (preview) => preview.status === "completed" && preview.previewUrl
      ).length;
      if (completedCount === stampPreviewKinds.length) return result;

      if (completedCount > 0) {
        setStampPreviewSummary(
          root,
          "generating",
          `${completedCount} of ${stampPreviewKinds.length} product previews ready…`
        );
      }

      await wait(1000, signal);
    }

    throw new Error(
      root.dataset.stampPreviewsTimeout ||
        "The product previews are taking longer than expected. Please try again."
    );
  }

  function uploadFile(uploadId, file, sessionId) {
    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("sessionId", sessionId);
    formData.append("file", file);

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", appProxyBase + "file");
      request.addEventListener("load", () => {
        let body = {};

        try {
          body = JSON.parse(request.responseText || "{}");
        } catch (_error) {
          body = {};
        }

        if (request.status >= 200 && request.status < 300 && body.ok !== false) {
          resolve(body);
        } else {
          reject(new Error((body.errors && body.errors.join(" ")) || "Upload failed."));
        }
      });
      request.addEventListener("error", () => reject(new Error("Upload failed.")));
      request.send(formData);
    });
  }

  function clearPreview(root) {
    const preview = find(root, "[data-upload-preview]");
    if (!preview) return;

    preview.hidden = true;
    preview.innerHTML = "";
  }

  function showPreview(root, file, onRemove) {
    const preview = find(root, "[data-upload-preview]");
    if (!preview) return;

    preview.innerHTML = "";
    preview.hidden = false;

    const shell = document.createElement("div");
    shell.className = "smm-upload__preview-shell";

    if (file.type.startsWith("image/")) {
      const image = document.createElement("img");
      image.alt = file.name;
      image.src = URL.createObjectURL(file);
      image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
      shell.appendChild(image);
    } else {
      const fileTile = document.createElement("div");
      fileTile.className = "smm-upload__preview-file";
      fileTile.innerHTML = "<strong>PDF</strong>";

      const fileName = document.createElement("span");
      fileName.className = "smm-upload__preview-name";
      fileName.textContent = file.name;
      fileTile.appendChild(fileName);
      shell.appendChild(fileTile);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "smm-upload__remove";
    removeButton.setAttribute("aria-label", "Remove uploaded file");
    removeButton.textContent = "x";
    removeButton.addEventListener("click", onRemove);
    shell.appendChild(removeButton);

    preview.appendChild(shell);
  }

  function enhanceUploader(root) {
    if (root.dataset.smmLineArtReady === "true") return;
    root.dataset.smmLineArtReady = "true";

    const trigger = find(root, "[data-upload-trigger]");
    const fileInput = find(root, "[data-upload-input]");
    const form = getProductForm(root);
    const required = root.dataset.required === "true";
    const idleLabel = trigger.textContent.trim() || "Upload Picture";
    const sessionId = getSessionId();
    const state = {
      uploadId: null,
      filename: null,
      artworkUrl: null,
      lineArtUrl: null,
      lineArtPreviewUrl: null,
      lineArtFullPreviewUrl: null,
      lineArtPreviewVersion: null,
      inkColor: null,
      desiredInkColor: null,
      previewReady: false,
      uploading: false,
      generationRunId: 0,
      inkSwitchStartedAt: null,
      inkSwitchTarget: null,
      instantArtworkMask: null,
      instantArtworkPromise: null,
      instantPreviewRunId: 0,
      inkUpdateFallbackColor: null,
      file: null
    };
    let generationProgress = 0;
    let generationProgressTimer = null;
    let generationProgressTick = 0;
    let activeGenerationController = null;
    let inkChangeTimer = null;

    function cancelActiveGeneration() {
      if (activeGenerationController) {
        activeGenerationController.abort();
        activeGenerationController = null;
      }
    }

    function cancelScheduledInkChange() {
      if (inkChangeTimer !== null) {
        window.clearTimeout(inkChangeTimer);
        inkChangeTimer = null;
      }
    }

    function finishInkSwitchMetric(outcome, color, errorCode = null) {
      if (
        !Number.isFinite(state.inkSwitchStartedAt) ||
        state.inkSwitchTarget !== color
      ) {
        return;
      }

      reportPerformanceMetric({
        uploadId: state.uploadId,
        sessionId,
        phase: "ink_switch",
        outcome,
        startedAt: state.inkSwitchStartedAt,
        inkColor: color,
        mode: "line_art_and_mockups",
        errorCode
      });
      state.inkSwitchStartedAt = null;
      state.inkSwitchTarget = null;
    }

    function stopGenerationProgress() {
      if (generationProgressTimer === null) return;

      window.clearInterval(generationProgressTimer);
      generationProgressTimer = null;
    }

    function startGenerationProgress(startAt, cap, preserveCurrent = false) {
      stopGenerationProgress();
      generationProgress = preserveCurrent
        ? Math.max(generationProgress, startAt)
        : startAt;
      generationProgressTick = 0;
      setStampPreviewProgress(root, generationProgress);

      generationProgressTimer = window.setInterval(() => {
        if (generationProgress >= cap) {
          stopGenerationProgress();
          return;
        }

        const increments = [2, 3, 2, 1, 3, 2];
        const increment = increments[generationProgressTick % increments.length];
        generationProgressTick += 1;
        generationProgress = Math.min(cap, generationProgress + increment);
        setStampPreviewProgress(root, generationProgress);
      }, 520);
    }

    function completeGenerationProgress() {
      stopGenerationProgress();
      generationProgress = 100;
      setStampPreviewProgress(root, generationProgress);
    }

    function settleInstantInkPreview(color) {
      if (
        !state.uploadId ||
        state.desiredInkColor !== color ||
        getSelectedInkColor(root) !== color
      ) {
        return;
      }

      state.inkUpdateFallbackColor = null;
      state.previewReady = true;
      state.uploading = false;
      completeGenerationProgress();
      setStampPreviewSummary(
        root,
        "ready",
        root.dataset.stampPreviewsReady || "Previews ready"
      );
      setButton(trigger, "uploaded", "Change File");
      setStatus(root, "Your stamp previews are ready.", "success");
    }

    function showInkUpdateFallback(color) {
      if (
        !state.uploadId ||
        state.desiredInkColor !== color ||
        getSelectedInkColor(root) !== color
      ) {
        return;
      }

      state.inkUpdateFallbackColor = color;
      state.previewReady = false;
      state.uploading = true;
      showLineArtGenerating(root, true);
      startGenerationProgress(70, 78);
      setButton(
        trigger,
        "uploading",
        root.dataset.lineArtGenerating || "Creating line art…"
      );
      setStatus(
        root,
        root.dataset.stampPreviewsUpdatingColor ||
          "Updating previews for your selected ink…"
      );
    }

    // The Permanent Stamp theme's sticky bar predates this Line Art app and
    // discovers required uploaders through this marker. Add it only after the
    // Line Art module owns the block so the legacy uploader cannot initialize it.
    if (document.querySelector("[data-printmivo-sticky-product-atc]")) {
      root.setAttribute("data-stamp-upload", "");
    }

    if (required) {
      setAddToCartEnabled(form, false);
    }
    enableStampPreviewLightbox(root);
    setTextFieldsVisible(root, false, false);
    setButton(trigger, "idle", idleLabel);
    syncPreviewInkControls(root);

    root.querySelectorAll("[data-preview-ink-color]").forEach((button) => {
      button.addEventListener("click", () => {
        const color = button.dataset.previewInkColor || "";
        if (!supportedInkColors.includes(color)) return;

        const changed = selectInkColor(root, color, button);
        syncPreviewInkControls(root, color);
        showInstantLineArtInk(root, color);
        if (state.uploadId && (!changed || color !== state.inkColor)) {
          requestInkGeneration(color);
        }
      });
    });

    async function removeUpload() {
      if (state.uploading) return;

      const previousUploadId = state.uploadId;
      state.generationRunId += 1;
      cancelScheduledInkChange();
      cancelActiveGeneration();
      stopGenerationProgress();
      generationProgress = 0;
      state.uploadId = null;
      state.filename = null;
      state.artworkUrl = null;
      state.lineArtUrl = null;
      state.lineArtPreviewUrl = null;
      state.lineArtFullPreviewUrl = null;
      state.lineArtPreviewVersion = null;
      state.inkColor = null;
      state.desiredInkColor = null;
      state.inkSwitchStartedAt = null;
      state.inkSwitchTarget = null;
      state.instantArtworkMask = null;
      state.instantArtworkPromise = null;
      state.instantPreviewRunId += 1;
      state.inkUpdateFallbackColor = null;
      state.previewReady = false;
      state.file = null;
      fileInput.value = "";
      clearPreview(root);
      resetStampPreviews(root);
      setTextFieldsVisible(root, false, true);
      setLineItemProperties(root, form, "", "", "", "");
      clearTextLineItemProperties(root, form);
      setStatus(root, "");
      setButton(trigger, "idle", idleLabel);

      if (required) {
        setAddToCartEnabled(form, false);
      }

      if (previousUploadId) {
        try {
          await postJson("remove", { uploadId: previousUploadId, sessionId });
        } catch (_error) {
          // Removal is best-effort; the cleanup job can still expire abandoned files.
        }
      }
    }

    async function generateStampPreviews(
      runId,
      preserveExisting = false,
      expectedColor = state.inkColor,
      expectedSourceVersion = state.lineArtPreviewVersion,
      signal
    ) {
      if (
        runId !== state.generationRunId ||
        !state.uploadId ||
        !state.lineArtPreviewUrl
      ) {
        return;
      }

      const mockupsStartedAt = performanceNow();

      const visibleFallback =
        preserveExisting && state.inkUpdateFallbackColor === expectedColor;
      state.previewReady = preserveExisting && !visibleFallback;
      state.uploading = !preserveExisting || visibleFallback;
      if (!preserveExisting || visibleFallback) {
        showMockupsGenerating(
          root,
          state.lineArtPreviewUrl,
          state.lineArtFullPreviewUrl,
          state.lineArtPreviewVersion,
          preserveExisting
        );
        startGenerationProgress(preserveExisting ? 78 : 62, 94, preserveExisting);
        setButton(trigger, "uploading", "Creating 3 product previews…");
        setStatus(
          root,
          root.dataset.stampPreviewsGeneratingMockups ||
            "Creating your product previews…"
        );
      }

      try {
        const startResult = await postJson("stamp-previews", {
          uploadId: state.uploadId,
          sessionId,
          inkColor: expectedColor,
          sourceVersion: expectedSourceVersion,
          previewProfile: getPreviewProfile(root)
        }, { signal });
        if (runId !== state.generationRunId) return;
        if (
          startResult.previewProfile !== getPreviewProfile(root) ||
          startResult.inkColor !== expectedColor ||
          startResult.sourceVersion !== expectedSourceVersion
        ) {
          return;
        }
        const startedPreviews = Array.isArray(startResult.previews)
          ? startResult.previews
          : [];
        renderStampPreviewResults(
          root,
          startedPreviews,
          expectedColor,
          expectedSourceVersion
        );

        const failedPreview = startedPreviews.find(
          (preview) => preview.status === "failed"
        );
        if (failedPreview) {
          throw new Error(
            failedPreview.error ||
              root.dataset.stampPreviewsFailed ||
              "One or more product previews could not be created."
          );
        }

        const allPreviewsReady = stampPreviewKinds.every((kind) =>
          startedPreviews.some(
            (preview) =>
              preview.kind === kind &&
              preview.status === "completed" &&
              preview.previewUrl
          )
        );
        if (!allPreviewsReady) {
          const pollResult = await pollStampPreviews(
            root,
            state.uploadId,
            sessionId,
            expectedColor,
            expectedSourceVersion,
            () => runId === state.generationRunId,
            signal
          );
          if (!pollResult || runId !== state.generationRunId) return;
        }

        if (getSelectedInkColor(root) !== expectedColor) {
          requestInkGeneration(getSelectedInkColor(root));
          return;
        }

        state.previewReady = true;
        state.uploading = false;
        state.inkUpdateFallbackColor = null;
        completeGenerationProgress();
        setStampPreviewSummary(
          root,
          "ready",
          root.dataset.stampPreviewsReady || "Previews ready"
        );
        setButton(trigger, "uploaded", "Change File");
        setStatus(root, "Your stamp previews are ready.", "success");

        reportPerformanceMetric({
          uploadId: state.uploadId,
          sessionId,
          phase: "mockups",
          outcome: "success",
          startedAt: mockupsStartedAt,
          inkColor: expectedColor,
          mode: preserveExisting ? "ink_change" : "initial"
        });
        finishInkSwitchMetric("success", expectedColor);

        if (required) {
          setAddToCartEnabled(form, true);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        if (runId !== state.generationRunId) return;
        if (preserveExisting && state.inkUpdateFallbackColor !== expectedColor) {
          state.previewReady = true;
          state.uploading = false;
          reportPerformanceMetric({
            uploadId: state.uploadId,
            sessionId,
            phase: "mockups",
            outcome: "failure",
            startedAt: mockupsStartedAt,
            inkColor: expectedColor,
            mode: "ink_change",
            errorCode: "background_preview_failed"
          });
          finishInkSwitchMetric(
            "failure",
            expectedColor,
            "background_preview_failed"
          );
          return;
        }
        stopGenerationProgress();
        state.previewReady = false;
        state.uploading = false;
        stampPreviewKinds.forEach((kind) => {
          const card = find(root, `[data-stamp-preview-card="${kind}"]`);
          if (card && card.dataset.state !== "ready") {
            setStampPreviewCard(root, kind, "failed");
          }
        });
        setStampPreviewSummary(
          root,
          "failed",
          error.message ||
            root.dataset.stampPreviewsFailed ||
            "One or more previews could not be created."
        );
        setButton(trigger, "failed", "Change File");
        setStatus(
          root,
          error.message ||
            root.dataset.stampPreviewsFailed ||
            "One or more previews could not be created.",
          "error"
        );
        reportPerformanceMetric({
          uploadId: state.uploadId,
          sessionId,
          phase: "mockups",
          outcome: "failure",
          startedAt: mockupsStartedAt,
          inkColor: expectedColor,
          mode: preserveExisting ? "ink_change" : "initial",
          errorCode: "preview_failed"
        });
        finishInkSwitchMetric("failure", expectedColor, "preview_failed");
        if (required) setAddToCartEnabled(form, true);
      }
    }

    function requestInkGeneration(color) {
      const requestedColor = String(color || "").trim().toLowerCase();
      if (!state.uploadId || !supportedInkColors.includes(requestedColor)) return;
      if (
        requestedColor === state.desiredInkColor &&
        (inkChangeTimer !== null || activeGenerationController)
      ) {
        return;
      }
      const cardsAlreadyUseRequestedColor = stampPreviewKinds.every((kind) => {
        const card = find(root, `[data-stamp-preview-card="${kind}"]`);
        return card?.dataset.inkColor === requestedColor;
      });
      if (
        requestedColor === state.desiredInkColor &&
        state.previewReady &&
        cardsAlreadyUseRequestedColor
      ) {
        return;
      }

      state.inkSwitchStartedAt = performanceNow();
      state.inkSwitchTarget = requestedColor;
      state.desiredInkColor = requestedColor;
      state.inkUpdateFallbackColor = null;
      const instantPreviewStartedAt = performanceNow();
      renderInstantProductPreviews(root, state, requestedColor)
        .then((rendered) => {
          if (!rendered) {
            showInkUpdateFallback(requestedColor);
            return;
          }
          settleInstantInkPreview(requestedColor);
          reportPerformanceMetric({
            uploadId: state.uploadId,
            sessionId,
            phase: "instant_preview",
            outcome: "success",
            startedAt: instantPreviewStartedAt,
            inkColor: requestedColor,
            mode: "browser_composite"
          });
        })
        .catch(() => {
          showInkUpdateFallback(requestedColor);
        });
      state.generationRunId += 1;
      const runId = state.generationRunId;
      cancelScheduledInkChange();
      cancelActiveGeneration();
      syncPreviewInkControls(root, requestedColor);
      showInstantLineArtInk(root, requestedColor);

      // Product themes can emit more than one change event while replacing a
      // variant control. Coalesce them into exactly one latest-color request.
      inkChangeTimer = window.setTimeout(() => {
        inkChangeTimer = null;
        generateLineArt(false, { runId, requestedColor });
      }, 120);
    }

    async function generateLineArt(shouldScrollToPreviews = false, request = null) {
      if (!state.uploadId) return;

      const runId = request?.runId || state.generationRunId + 1;
      if (request?.runId && request.runId !== state.generationRunId) return;
      if (!request?.runId) {
        state.generationRunId = runId;
        cancelScheduledInkChange();
        cancelActiveGeneration();
      }
      const requestedColor = request?.requestedColor || getSelectedInkColor(root);
      const controller = new AbortController();
      const signal = controller.signal;
      activeGenerationController = controller;
      const preserveExisting = Boolean(state.lineArtPreviewUrl);
      const lineArtStartedAt = performanceNow();
      state.desiredInkColor = requestedColor;
      syncPreviewInkControls(root, requestedColor);
      state.uploading = !preserveExisting;
      state.previewReady = preserveExisting;
      if (!preserveExisting) {
        state.lineArtUrl = null;
        showLineArtGenerating(root, false);
      }

      if (shouldScrollToPreviews) {
        scrollToStampPreviews(root);
      }

      setLineItemProperties(
        root,
        form,
        state.uploadId,
        state.filename,
        state.artworkUrl,
        preserveExisting ? state.lineArtUrl : ""
      );

      try {
        if (!preserveExisting) {
          startGenerationProgress(6, 58);
          setButton(
            trigger,
            "uploading",
            root.dataset.lineArtGenerating || "Creating line art…"
          );
          setStatus(
            root,
            root.dataset.lineArtGenerating || "Creating stamp-ready line art…"
          );
        }

        const startResult = await postJson("line-art", {
          uploadId: state.uploadId,
          sessionId,
          inkColor: requestedColor
        }, { signal });
        if (runId !== state.generationRunId) return;

        const result =
          startResult.status === "completed" &&
          startResult.previewUrl &&
          startResult.lineArtUrl
            ? startResult
            : await pollLineArt(
                root,
                state.uploadId,
                sessionId,
                () => runId === state.generationRunId,
                signal
              );
        if (!result || runId !== state.generationRunId) return;
        const currentColor = getSelectedInkColor(root);

        if (currentColor !== result.color || state.desiredInkColor !== result.color) {
          requestInkGeneration(currentColor);
          return;
        }
        if (!result.version) {
          throw new Error("The line-art revision could not be verified.");
        }

        state.lineArtUrl = result.lineArtUrl;
        state.lineArtPreviewUrl = result.previewUrl;
        state.lineArtFullPreviewUrl = result.fullPreviewUrl || result.previewUrl;
        state.lineArtPreviewVersion = result.version || null;
        state.inkColor = result.color;
        if (!state.instantArtworkMask && !state.instantArtworkPromise) {
          const maskSourceUrl = withPreviewVersion(
            state.lineArtFullPreviewUrl || state.lineArtPreviewUrl,
            state.lineArtPreviewVersion
          );
          const maskUploadId = state.uploadId;
          const maskPromise = prepareInstantArtworkMask(maskSourceUrl)
            .then((mask) => {
              if (
                state.uploadId === maskUploadId &&
                state.instantArtworkPromise === maskPromise
              ) {
                state.instantArtworkMask = mask;
              }
              return mask;
            })
            .catch(() => {
              if (state.instantArtworkPromise === maskPromise) {
                state.instantArtworkPromise = null;
              }
              return null;
            });
          state.instantArtworkPromise = maskPromise;
          scheduleInstantMockupPreload(root);
        }
        reportPerformanceMetric({
          uploadId: state.uploadId,
          sessionId,
          phase: "line_art",
          outcome: "success",
          startedAt: lineArtStartedAt,
          inkColor: result.color,
          mode: preserveExisting ? "ink_change" : "initial"
        });
        syncPreviewInkControls(root, result.color);
        setLineItemProperties(
          root,
          form,
          state.uploadId,
          state.filename,
          state.artworkUrl,
          state.lineArtUrl
        );
        if (preserveExisting) {
          showInstantLineArtInk(
            root,
            result.color,
            state.lineArtFullPreviewUrl,
            state.lineArtPreviewVersion
          );
        } else {
          setStampPreviewCard(
            root,
            "line_art",
            "ready",
            state.lineArtPreviewUrl,
            state.lineArtFullPreviewUrl,
            state.lineArtPreviewVersion
          );
        }
        if (preserveExisting) await wait(80, signal);
        if (runId !== state.generationRunId) return;
        await generateStampPreviews(
          runId,
          preserveExisting,
          result.color,
          result.version,
          signal
        );
      } catch (error) {
        if (isAbortError(error)) return;
        if (runId !== state.generationRunId) return;

        if (preserveExisting && state.inkUpdateFallbackColor !== requestedColor) {
          state.uploading = false;
          state.previewReady = true;
          reportPerformanceMetric({
            uploadId: state.uploadId,
            sessionId,
            phase: "line_art",
            outcome: "failure",
            startedAt: lineArtStartedAt,
            inkColor: requestedColor,
            mode: "ink_change",
            errorCode: "background_generation_failed"
          });
          finishInkSwitchMetric(
            "failure",
            requestedColor,
            "background_generation_failed"
          );
          return;
        }

        stopGenerationProgress();
        state.uploading = false;
        state.previewReady = false;
        if (!preserveExisting) {
          state.lineArtUrl = null;
          state.lineArtPreviewUrl = null;
          state.lineArtFullPreviewUrl = null;
          state.lineArtPreviewVersion = null;
          setStampPreviewCard(root, "line_art", "failed");
        }
        setStampPreviewSummary(
          root,
          "failed",
          error.message || root.dataset.lineArtFailed || "Line art generation failed."
        );
        setButton(trigger, "failed", "Change File");
        setStatus(
          root,
          "Your logo is uploaded. The previews could not be updated, but you can still add to cart.",
          "error"
        );
        reportPerformanceMetric({
          uploadId: state.uploadId,
          sessionId,
          phase: "line_art",
          outcome: "failure",
          startedAt: lineArtStartedAt,
          inkColor: requestedColor,
          mode: preserveExisting ? "ink_change" : "initial",
          errorCode: "generation_failed"
        });
        finishInkSwitchMetric("failure", requestedColor, "generation_failed");
        if (required) setAddToCartEnabled(form, true);
      } finally {
        if (activeGenerationController === controller) {
          activeGenerationController = null;
        }
      }
    }

    trigger.addEventListener("click", () => {
      if (!state.uploading) {
        fileInput.click();
      }
    });

    const previewRetry = find(root, "[data-stamp-previews-retry]");
    if (previewRetry) {
      previewRetry.addEventListener("click", () => {
        if (!state.uploading && state.lineArtUrl) {
          generateLineArt();
        }
      });
    }

    Array.from(root.querySelectorAll("[data-upload-text-field]")).forEach((field) => {
      updateCharacterCount(field);
      field.addEventListener("input", () => updateCharacterCount(field));
    });

    fileInput.addEventListener("change", async () => {
      const selectedFile = fileInput.files && fileInput.files[0];
      if (!selectedFile) return;
      const uploadStartedAt = performanceNow();
      let metricsUploadId = null;

      const maxBytes = Number(root.dataset.maxBytes || "0");
      if (!(allowedTypes.includes(selectedFile.type) || allowedExtensions.includes(getExtension(selectedFile.name)))) {
        fileInput.value = "";
        clearPreview(root);
        setTextFieldsVisible(root, false, false);
        clearTextLineItemProperties(root, form);
        setStatus(root, "Please upload a JPG, PNG, or WEBP file.", "error");
        return;
      }

      // Mark the form busy before preparing a camera image, so a customer can
      // never add the product while its artwork is still being processed.
      state.uploading = true;
      if (required) setAddToCartEnabled(form, false);
      setButton(trigger, "uploading", "Preparing photo…");
      setStatus(root, "Preparing photo for a faster upload…");
      const file = await optimizeImageForUpload(selectedFile);

      if (maxBytes && file.size > maxBytes) {
        state.uploading = false;
        setButton(trigger, "idle", idleLabel);
        fileInput.value = "";
        clearPreview(root);
        setTextFieldsVisible(root, false, false);
        clearTextLineItemProperties(root, form);
        setStatus(root, `File is too large. Maximum size is ${formatFileSize(maxBytes)}.`, "error");
        return;
      }

      cancelScheduledInkChange();
      cancelActiveGeneration();

      if (state.uploadId) {
        try {
          await postJson("remove", { uploadId: state.uploadId, sessionId });
        } catch (_error) {
          // Ignore previous upload removal errors while replacing the file.
        }
      }

      state.generationRunId += 1;
      state.uploadId = null;
      state.filename = null;
      state.artworkUrl = null;
      state.lineArtUrl = null;
      state.lineArtPreviewUrl = null;
      state.lineArtFullPreviewUrl = null;
      state.lineArtPreviewVersion = null;
      state.inkColor = null;
      state.desiredInkColor = null;
      state.inkSwitchStartedAt = null;
      state.inkSwitchTarget = null;
      state.instantArtworkMask = null;
      state.instantArtworkPromise = null;
      state.instantPreviewRunId += 1;
      state.inkUpdateFallbackColor = null;
      state.previewReady = false;
      state.file = file;
      stopGenerationProgress();
      generationProgress = 0;
      clearPreview(root);
      resetStampPreviews(root);
      setTextFieldsVisible(root, false, false);
      setLineItemProperties(root, form, "", "", "", "");
      clearTextLineItemProperties(root, form);

      if (required) {
        setAddToCartEnabled(form, false);
      }

      setStatus(root, "");
      const uploadProgress = startSimulatedUploadProgress(trigger);

      try {
        const initResult = await postJson("init", {
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
          productId: root.dataset.productId,
          productGid: root.dataset.productGid,
          productHandle: root.dataset.productHandle,
          productTitle: root.dataset.productTitle,
          variantId: getVariantId(root, form),
          variantGid: root.dataset.variantGid,
          variantTitle: root.dataset.variantTitle,
          selectedSize: getSelectedSize(root),
          quantity: getQuantity(form),
          sessionId,
          cartToken: getCartToken(),
          customerId: root.dataset.customerId || null
        });
        metricsUploadId = initResult.uploadId;

        await uploadFile(initResult.uploadId, file, sessionId);
        await uploadProgress.complete();

        state.uploadId = initResult.uploadId;
        state.filename = selectedFile.name;
        state.artworkUrl = initResult.artworkUrl || null;
        setLineItemProperties(root, form, state.uploadId, state.filename, state.artworkUrl, "");
        showPreview(root, file, removeUpload);
        setTextFieldsVisible(root, true, false);
        if (required) setAddToCartEnabled(form, true);
        reportPerformanceMetric({
          uploadId: state.uploadId,
          sessionId,
          phase: "upload",
          outcome: "success",
          startedAt: uploadStartedAt,
          mode: "prepare_and_upload"
        });
        await generateLineArt(true);
      } catch (error) {
        reportPerformanceMetric({
          uploadId: metricsUploadId,
          sessionId,
          phase: "upload",
          outcome: "failure",
          startedAt: uploadStartedAt,
          mode: "prepare_and_upload",
          errorCode: "upload_failed"
        });
        uploadProgress.stop();
        stopGenerationProgress();
        generationProgress = 0;
        state.uploading = false;
        state.uploadId = null;
        state.filename = null;
        state.artworkUrl = null;
        state.lineArtUrl = null;
        state.lineArtPreviewUrl = null;
        state.lineArtFullPreviewUrl = null;
        state.lineArtPreviewVersion = null;
        state.inkColor = null;
        state.desiredInkColor = null;
        state.inkSwitchStartedAt = null;
        state.inkSwitchTarget = null;
        state.instantArtworkMask = null;
        state.instantArtworkPromise = null;
        state.instantPreviewRunId += 1;
        state.inkUpdateFallbackColor = null;
        state.previewReady = false;
        state.file = null;
        fileInput.value = "";
        clearPreview(root);
        resetStampPreviews(root);
        setTextFieldsVisible(root, false, false);
        setLineItemProperties(root, form, "", "", "", "");
        clearTextLineItemProperties(root, form);
        setButton(trigger, "idle", idleLabel);

        if (required) {
          setAddToCartEnabled(form, false);
        }

        setStatus(root, error.message || "Upload failed. Please try again.", "error");
      }
    });

    if (form) {
      form.addEventListener("formdata", (event) => {
        if (state.uploadId) {
          setFormDataLineItemProperties(
            root,
            event.formData,
            state.uploadId,
            state.filename,
            state.artworkUrl,
            state.lineArtUrl
          );
        }
      });

      getSubmitButtons(form).forEach((button) => {
        button.addEventListener(
          "click",
          async (event) => {
            await handleAddToCart(root, form, sessionId, state, event, button);
          },
          true
        );
      });

      document.addEventListener(
        "click",
        async (event) => {
          const button = getClickedAddToCartControl(event.target, form);

          if (button) {
            await handleAddToCart(root, form, sessionId, state, event, button);
          }
        },
        true
      );

      form.addEventListener("change", () => {
        window.setTimeout(async () => {
          const selectedColor = getSelectedInkColor(root);
          syncPreviewInkControls(root, selectedColor);
          showInstantLineArtInk(root, selectedColor);
          if (!state.uploadId) return;
          requestInkGeneration(selectedColor);
        }, 0);
      });

      form.addEventListener("submit", (event) => {
        if (state.uploading && !state.uploadId) {
          event.preventDefault();
          setStatus(root, "Please wait until the file finishes uploading.", "error");
          return;
        }

        if (required && !state.uploadId) {
          event.preventDefault();
          setStatus(root, "Please upload a picture before adding this product to cart.", "error");
          return;
        }

        if (state.uploadId) {
          syncLineItemProperties(
            root,
            form,
            state.uploadId,
            state.filename,
            state.artworkUrl,
            state.lineArtUrl
          );
          sendCartUpdate(root, form, sessionId, state.uploadId);
        }
      }, true);
    }
  }

  function initializeUploaders(scope) {
    const target = scope && scope.querySelectorAll ? scope : document;
    target.querySelectorAll("[data-line-art-upload]").forEach(enhanceUploader);
  }

  function getQuickViewProductUrl(container) {
    const link = container.querySelector(".m-product-title a[href*='/products/']");
    return link ? link.href : null;
  }

  function updateQuickViewUploadData(root, form, container) {
    const productId = form.dataset.productId || "";
    const handle = form.dataset.productHandle || "";
    const title = container.querySelector(".m-product-title")?.textContent?.trim() || "";
    const variantInput = form.querySelector("[name='id']");
    const selectedVariant = container.querySelector(
      "script[type='application/json'][data-selected-variant]"
    );
    let variant = null;

    if (selectedVariant && selectedVariant.textContent) {
      try {
        variant = JSON.parse(selectedVariant.textContent);
      } catch (_error) {
        variant = null;
      }
    }

    const variantId = (variantInput && variantInput.value) || (variant && variant.id) || "";
    root.dataset.productId = productId || root.dataset.productId || "";
    root.dataset.productGid = productId ? `gid://shopify/Product/${productId}` : root.dataset.productGid;
    root.dataset.productHandle = handle || root.dataset.productHandle || "";
    root.dataset.productTitle = title || root.dataset.productTitle || "";
    root.dataset.variantId = String(variantId || root.dataset.variantId || "");
    root.dataset.variantGid = variantId
      ? `gid://shopify/ProductVariant/${variantId}`
      : root.dataset.variantGid;
    root.dataset.variantTitle = (variant && variant.title) || root.dataset.variantTitle || "";
  }

  async function hydrateQuickView(container) {
    const form = container.querySelector("form.product-form-product-quickview");
    const productUrl = getQuickViewProductUrl(container);

    if (!form || !productUrl) return;

    const productKey = form.dataset.productHandle || productUrl;
    if (container.dataset.smmLineArtQuickViewProduct === productKey) return;

    container.dataset.smmLineArtQuickViewProduct = productKey;
    container.querySelectorAll("[data-smm-line-art-quick-view-upload]").forEach((node) => node.remove());

    try {
      const response = await fetch(productUrl, {
        headers: { Accept: "text/html" },
        credentials: "same-origin"
      });

      if (!response.ok || container.dataset.smmLineArtQuickViewProduct !== productKey) return;

      const page = new DOMParser().parseFromString(await response.text(), "text/html");
      const source = page.querySelector("[data-line-art-upload]");

      // Only products whose normal product template contains the app block get
      // an uploader in Quick View. Ordinary products are left untouched.
      if (!source) return;

      const root = source.cloneNode(true);
      root.removeAttribute("id");
      root.removeAttribute("data-smm-line-art-ready");
      root.dataset.smmLineArtQuickViewUpload = "true";
      updateQuickViewUploadData(root, form, container);

      const wrapper = form.querySelector(".m-product-form--wrapper");
      if (wrapper) {
        form.insertBefore(root, wrapper);
      } else {
        form.prepend(root);
      }

      enhanceUploader(root);
    } catch (_error) {
      delete container.dataset.smmLineArtQuickViewProduct;
    }
  }

  function scanQuickViews(scope) {
    if (!document.querySelector("[data-smm-line-art-quick-view-loader]")) return;

    const target = scope && scope.querySelectorAll ? scope : document;
    const containers = [];

    if (target.matches && target.matches(".m-product-quickview--info")) {
      containers.push(target);
    }

    containers.push(...target.querySelectorAll(".m-product-quickview--info"));
    containers.forEach(hydrateQuickView);
  }

  initializeUploaders(document);
  scanQuickViews(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        initializeUploaders(node);
        scanQuickViews(node);
      });
    });

    // Minimog may reuse the same modal shell while replacing its contents.
    scanQuickViews(document);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
