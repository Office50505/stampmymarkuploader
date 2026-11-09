"use strict";

// Loaded by the small theme-extension bootstrap after Liquid renders the app block.

(function () {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
  const stampPreviewKinds = ["box", "cup", "bag"];
  const appProxyBase = "/apps/line-art-upload/uploads/";
  const sessionKey = "smm_upload_session_id";

  const find = (root, selector) => root.querySelector(selector);

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

  // Camera photos are often several megabytes even when the artwork itself is
  // simple. Resize only large JPEGs before upload; every other file type keeps
  // its original pixels and bytes. If the browser cannot optimise a photo, the
  // original file is used as a safe fallback.
  const jpegOptimizationThreshold = 1024 * 1024;
  const maxPhotoEdge = 2048;
  const jpegQuality = 0.9;

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

  async function optimizeJpegForUpload(file) {
    if (file.type !== "image/jpeg" || file.size <= jpegOptimizationThreshold) {
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
      const context = canvas.getContext("2d", { alpha: false });

      if (!context) return file;

      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const optimizedBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", jpegQuality);
      });

      // Never trade a customer's original for a larger version.
      if (!optimizedBlob || optimizedBlob.size >= file.size) return file;

      return new File([optimizedBlob], file.name.replace(/\.[^.]+$/, ".jpg"), {
        type: "image/jpeg",
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
    return (
      root.closest("form[action*='/cart/add']") ||
      document.querySelector("form[action*='/cart/add']")
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

  function getSelectedOption(root, optionName) {
    const form = getProductForm(root);
    const scope = form || document;
    const namedOptions = Array.from(scope.querySelectorAll("[name^='options']")).filter(
      (input) => input.name === `options[${optionName}]`
    );
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
      "properties[StampMyMark line art]",
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
    setFormDataValue(formData, "properties[StampMyMark line art]", lineArtUrl);

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
    if (state.uploading) {
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

    if (state.uploadId && !state.lineArtUrl) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(root, root.dataset.lineArtGenerating || "Creating stamp-ready line art…", "error");
      return;
    }

    if (state.uploadId && !state.previewReady) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(root, "Please wait until your product previews are ready.", "error");
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

  async function postJson(path, payload) {
    const response = await fetch(appProxyBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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

  async function getJson(path) {
    const response = await fetch(appProxyBase + path, {
      method: "GET",
      headers: { Accept: "application/json" }
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

  const wait = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  async function pollLineArt(root, uploadId, sessionId) {
    const deadline = Date.now() + 3 * 60 * 1000;
    const path =
      `${encodeURIComponent(uploadId)}/line-art-status` +
      `?sessionId=${encodeURIComponent(sessionId)}`;

    while (Date.now() < deadline) {
      const result = await getJson(path);

      if (result.status === "completed" && result.previewUrl && result.lineArtUrl) {
        return result;
      }

      if (result.status === "failed") {
        throw new Error(result.error || root.dataset.lineArtFailed || "Line art generation failed.");
      }

      await wait(2500);
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

  function setStampPreviewCard(root, kind, state, previewUrl) {
    const card = find(root, `[data-stamp-preview-card="${kind}"]`);
    if (!card) return;

    const image = find(card, "[data-stamp-preview-image]");
    const status = find(card, "[data-stamp-preview-state]");
    const labels = {
      waiting: "Waiting for line art",
      generating: kind === "line_art" ? "Drawing line art…" : `Creating ${kind}…`,
      failed: "Preview failed"
    };

    card.dataset.state = state;
    if (status) status.textContent = labels[state] || "";

    if (image) {
      if (state === "ready" && previewUrl) {
        image.hidden = false;
        image.src = `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}v=${Date.now()}`;
      } else {
        image.hidden = true;
        image.removeAttribute("src");
      }
    }
  }

  function resetStampPreviews(root) {
    const section = find(root, "[data-stamp-previews]");
    if (section) {
      section.hidden = true;
      section.dataset.state = "waiting";
    }

    ["line_art", ...stampPreviewKinds].forEach((kind) => {
      setStampPreviewCard(root, kind, "waiting");
    });
  }

  function showLineArtGenerating(root) {
    setStampPreviewSummary(
      root,
      "generating",
      root.dataset.stampPreviewsGeneratingLineArt || "Drawing your stamp line art…"
    );
    setStampPreviewCard(root, "line_art", "generating");
    stampPreviewKinds.forEach((kind) => setStampPreviewCard(root, kind, "waiting"));
  }

  function showMockupsGenerating(root, lineArtPreviewUrl) {
    setStampPreviewSummary(
      root,
      "generating",
      root.dataset.stampPreviewsGeneratingMockups ||
        "Creating your box, cup and bag previews…"
    );
    setStampPreviewCard(root, "line_art", "ready", lineArtPreviewUrl);
    stampPreviewKinds.forEach((kind) => setStampPreviewCard(root, kind, "generating"));
  }

  function renderStampPreviewResults(root, previews) {
    previews.forEach((preview) => {
      if (!stampPreviewKinds.includes(preview.kind)) return;

      if (preview.status === "completed" && preview.previewUrl) {
        setStampPreviewCard(root, preview.kind, "ready", preview.previewUrl);
      } else if (preview.status === "failed") {
        setStampPreviewCard(root, preview.kind, "failed");
      } else {
        setStampPreviewCard(root, preview.kind, "generating");
      }
    });
  }

  async function pollStampPreviews(root, uploadId, sessionId) {
    const deadline = Date.now() + 4 * 60 * 1000;
    const path =
      `${encodeURIComponent(uploadId)}/stamp-previews-status` +
      `?sessionId=${encodeURIComponent(sessionId)}`;

    while (Date.now() < deadline) {
      const result = await getJson(path);
      const previews = Array.isArray(result.previews) ? result.previews : [];
      renderStampPreviewResults(root, previews);

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

      await wait(2500);
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
    preview.classList.remove("smm-upload__preview--line-art");
  }

  function showPreview(root, file, onRemove) {
    const preview = find(root, "[data-upload-preview]");
    if (!preview) return;

    preview.innerHTML = "";
    preview.hidden = false;
    preview.classList.remove("smm-upload__preview--line-art");

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

  function showLineArtPreview(root, previewUrl, color, onRemove) {
    const preview = find(root, "[data-upload-preview]");
    if (!preview) return;

    preview.innerHTML = "";
    preview.hidden = false;
    preview.classList.add("smm-upload__preview--line-art");

    const shell = document.createElement("div");
    shell.className = "smm-upload__preview-shell";

    const image = document.createElement("img");
    image.alt = `Generated ${color || "selected"} stamp line art`;
    image.src = previewUrl;
    shell.appendChild(image);

    const badge = document.createElement("span");
    badge.className = "smm-upload__line-art-badge";
    badge.textContent = `${color || "selected"} line art`;
    shell.appendChild(badge);

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
      inkColor: null,
      previewReady: false,
      uploading: false,
      file: null
    };

    if (required) {
      setAddToCartEnabled(form, false);
    }
    setTextFieldsVisible(root, false, false);
    setButton(trigger, "idle", idleLabel);

    async function removeUpload() {
      if (state.uploading) return;

      const previousUploadId = state.uploadId;
      state.uploadId = null;
      state.filename = null;
      state.artworkUrl = null;
      state.lineArtUrl = null;
      state.lineArtPreviewUrl = null;
      state.inkColor = null;
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

    async function generateStampPreviews() {
      if (!state.uploadId || !state.lineArtPreviewUrl) return;

      state.previewReady = false;
      state.uploading = true;
      showMockupsGenerating(root, state.lineArtPreviewUrl);
      setButton(trigger, "uploading", "Creating 3 product previews…");
      setStatus(
        root,
        root.dataset.stampPreviewsGeneratingMockups ||
          "Creating your box, cup and bag previews…"
      );

      try {
        await postJson("stamp-previews", {
          uploadId: state.uploadId,
          sessionId
        });
        await pollStampPreviews(root, state.uploadId, sessionId);

        if (getSelectedInkColor(root) !== state.inkColor) {
          await generateLineArt();
          return;
        }

        state.previewReady = true;
        state.uploading = false;
        setStampPreviewSummary(
          root,
          "ready",
          root.dataset.stampPreviewsReady || "Previews ready"
        );
        setButton(trigger, "uploaded", "Change File");
        setStatus(root, "Your stamp previews are ready.", "success");

        if (required) {
          setAddToCartEnabled(form, true);
        }
      } catch (error) {
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
        setButton(trigger, "uploaded", "Change File");
        setStatus(
          root,
          error.message ||
            root.dataset.stampPreviewsFailed ||
            "One or more previews could not be created.",
          "error"
        );
        if (required) setAddToCartEnabled(form, false);
      }
    }

    async function generateLineArt() {
      if (!state.uploadId) return;

      state.uploading = true;
      state.previewReady = false;
      state.lineArtUrl = null;
      state.lineArtPreviewUrl = null;
      showLineArtGenerating(root);
      setLineItemProperties(
        root,
        form,
        state.uploadId,
        state.filename,
        state.artworkUrl,
        ""
      );

      if (required) {
        setAddToCartEnabled(form, false);
      }

      while (state.uploadId) {
        const requestedColor = getSelectedInkColor(root);
        state.inkColor = requestedColor;
        setButton(
          trigger,
          "uploading",
          root.dataset.lineArtGenerating || "Creating line art…"
        );
        setStatus(
          root,
          root.dataset.lineArtGenerating || "Creating stamp-ready line art…"
        );

        await postJson("line-art", {
          uploadId: state.uploadId,
          sessionId,
          inkColor: requestedColor
        });

        const result = await pollLineArt(root, state.uploadId, sessionId);
        const currentColor = getSelectedInkColor(root);

        if (currentColor !== result.color) {
          continue;
        }

        state.lineArtUrl = result.lineArtUrl;
        state.lineArtPreviewUrl = result.previewUrl;
        state.inkColor = result.color;
        showLineArtPreview(root, result.previewUrl, result.color, removeUpload);
        setLineItemProperties(
          root,
          form,
          state.uploadId,
          state.filename,
          state.artworkUrl,
          state.lineArtUrl
        );
        await generateStampPreviews();
        return;
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
          generateStampPreviews();
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
      const file = await optimizeJpegForUpload(selectedFile);

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

      if (state.uploadId) {
        try {
          await postJson("remove", { uploadId: state.uploadId, sessionId });
        } catch (_error) {
          // Ignore previous upload removal errors while replacing the file.
        }
      }

      state.uploadId = null;
      state.filename = null;
      state.artworkUrl = null;
      state.lineArtUrl = null;
      state.lineArtPreviewUrl = null;
      state.inkColor = null;
      state.previewReady = false;
      state.file = file;
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

        await uploadFile(initResult.uploadId, file, sessionId);
        await uploadProgress.complete();

        state.uploadId = initResult.uploadId;
        state.filename = selectedFile.name;
        state.artworkUrl = initResult.artworkUrl || null;
        setLineItemProperties(root, form, state.uploadId, state.filename, state.artworkUrl, "");
        showPreview(root, file, removeUpload);
        setTextFieldsVisible(root, true, false);
        await generateLineArt();
      } catch (error) {
        uploadProgress.stop();
        state.uploading = false;
        state.uploadId = null;
        state.filename = null;
        state.artworkUrl = null;
        state.lineArtUrl = null;
        state.lineArtPreviewUrl = null;
        state.inkColor = null;
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
          if (
            !state.uploadId ||
            !state.lineArtUrl ||
            state.uploading ||
            getSelectedInkColor(root) === state.inkColor
          ) {
            return;
          }

          try {
            await generateLineArt();
          } catch (error) {
            state.uploading = false;
            state.lineArtUrl = null;
            state.lineArtPreviewUrl = null;
            state.previewReady = false;
            setLineItemProperties(
              root,
              form,
              state.uploadId,
              state.filename,
              state.artworkUrl,
              ""
            );
            showPreview(root, state.file, removeUpload);
            setStampPreviewCard(root, "line_art", "failed");
            setStampPreviewSummary(
              root,
              "failed",
              error.message || root.dataset.lineArtFailed || "Line art generation failed."
            );
            setButton(trigger, "uploaded", "Change File");
            setStatus(
              root,
              error.message || root.dataset.lineArtFailed || "Line art generation failed.",
              "error"
            );
            if (required) setAddToCartEnabled(form, false);
          }
        }, 0);
      });

      form.addEventListener("submit", (event) => {
        if (state.uploading) {
          event.preventDefault();
          setStatus(root, "Please wait until the file finishes uploading.", "error");
          return;
        }

        if (required && !state.uploadId) {
          event.preventDefault();
          setStatus(root, "Please upload a picture before adding this product to cart.", "error");
          return;
        }

        if (state.uploadId && !state.lineArtUrl) {
          event.preventDefault();
          setStatus(root, root.dataset.lineArtGenerating || "Creating stamp-ready line art…", "error");
          return;
        }

        if (state.uploadId && !state.previewReady) {
          event.preventDefault();
          setStatus(root, "Please wait until your product previews are ready.", "error");
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
