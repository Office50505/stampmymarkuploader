"use strict";

(function () {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const allowedExtensions = ["jpg", "jpeg", "png", "webp", "pdf"];
  const appProxyBase = "/apps/stamp-upload/uploads/";
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

  function setStatus(root, message, state) {
    const status = find(root, "[data-upload-status]");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("is-error", state === "error");
    status.classList.toggle("is-success", state === "success");
  }

  function setButton(button, state, label) {
    button.textContent = label;
    button.dataset.uploadState = state;
    button.disabled = state === "uploading";
  }

  function getProductForm(root) {
    return (
      root.closest("form[action*='/cart/add']") ||
      document.querySelector("form[action*='/cart/add']")
    );
  }

  function getSelectedSize(root) {
    const optionName = root.dataset.sizeOptionName || "Size";
    const namedOption = Array.from(document.querySelectorAll("[name^='options']")).find(
      (input) => input.name === `options[${optionName}]`
    );

    if (namedOption && "value" in namedOption) {
      return namedOption.value;
    }

    const firstOption = document.querySelector("select[name^='options']");
    return firstOption ? firstOption.value : root.dataset.variantTitle || null;
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

  function buildAdminUploadUrl(root, uploadId) {
    const appUrl = (root.dataset.appUrl || "").trim().replace(/\/+$/, "");
    if (!appUrl || !uploadId) return "";

    return `${appUrl}/app/uploads?selected=${encodeURIComponent(uploadId)}`;
  }

  function setLineItemProperties(root, form, uploadId, filename) {
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
      buildAdminUploadUrl(root, uploadId)
    );
  }

  function getSubmitButtons(form) {
    return form ? Array.from(form.querySelectorAll("[type='submit'], button[name='add']")) : [];
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
  }

  async function postJson(path, payload) {
    const response = await fetch(appProxyBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.ok === false) {
      throw new Error((body.errors && body.errors.join(" ")) || "Upload request failed.");
    }

    return body;
  }

  function uploadFile(uploadId, file, sessionId, onProgress) {
    const formData = new FormData();
    formData.append("uploadId", uploadId);
    formData.append("sessionId", sessionId);
    formData.append("file", file);

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", appProxyBase + "file");
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
        }
      });
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
    if (root.dataset.smmReady === "true") return;
    root.dataset.smmReady = "true";

    const trigger = find(root, "[data-upload-trigger]");
    const fileInput = find(root, "[data-upload-input]");
    const form = getProductForm(root);
    const required = root.dataset.required === "true";
    const idleLabel = trigger.textContent.trim() || "Upload Picture";
    const sessionId = getSessionId();
    const state = {
      uploadId: null,
      filename: null,
      uploading: false,
      file: null
    };

    if (required) {
      setAddToCartEnabled(form, false);
    }
    setButton(trigger, "idle", idleLabel);

    async function removeUpload() {
      if (state.uploading) return;

      const previousUploadId = state.uploadId;
      state.uploadId = null;
      state.filename = null;
      state.file = null;
      fileInput.value = "";
      clearPreview(root);
      setLineItemProperties(root, form, "", "");
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

    trigger.addEventListener("click", () => {
      if (!state.uploading) {
        fileInput.click();
      }
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      const maxBytes = Number(root.dataset.maxBytes || "0");
      if (!(allowedTypes.includes(file.type) || allowedExtensions.includes(getExtension(file.name)))) {
        fileInput.value = "";
        clearPreview(root);
        setStatus(root, "Please upload a JPG, PNG, WEBP, or PDF file.", "error");
        return;
      }

      if (maxBytes && file.size > maxBytes) {
        fileInput.value = "";
        clearPreview(root);
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

      state.uploading = true;
      state.uploadId = null;
      state.filename = null;
      state.file = file;
      clearPreview(root);
      setLineItemProperties(root, form, "", "");

      if (required) {
        setAddToCartEnabled(form, false);
      }

      setStatus(root, "Uploading original file...");
      setButton(trigger, "uploading", "0% Uploading... Please wait.");

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

        await uploadFile(initResult.uploadId, file, sessionId, (percent) => {
          setButton(trigger, "uploading", `${percent}% Uploading... Please wait.`);
        });

        state.uploadId = initResult.uploadId;
        state.filename = file.name;
        state.uploading = false;
        setLineItemProperties(root, form, state.uploadId, state.filename);
        showPreview(root, file, removeUpload);
        setStatus(root, "File uploaded successfully.", "success");
        setButton(trigger, "uploaded", "Change File");

        if (required) {
          setAddToCartEnabled(form, true);
        }
      } catch (error) {
        state.uploading = false;
        state.uploadId = null;
        state.filename = null;
        state.file = null;
        fileInput.value = "";
        clearPreview(root);
        setLineItemProperties(root, form, "", "");
        setButton(trigger, "idle", idleLabel);

        if (required) {
          setAddToCartEnabled(form, false);
        }

        setStatus(root, error.message || "Upload failed. Please try again.", "error");
      }
    });

    if (form) {
      form.addEventListener("submit", async (event) => {
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

        if (state.uploadId) {
          event.preventDefault();

          try {
            await postJson("cart", {
              uploadId: state.uploadId,
              sessionId,
              cartToken: getCartToken(),
              quantity: getQuantity(form),
              selectedSize: getSelectedSize(root),
              variantId: getVariantId(root, form)
            });
            form.submit();
          } catch (error) {
            setStatus(root, error.message || "Could not attach upload to cart.", "error");
          }
        }
      });
    }
  }

  document.querySelectorAll("[data-stamp-upload]").forEach(enhanceUploader);
})();
