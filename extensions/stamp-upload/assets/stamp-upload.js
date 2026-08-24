(function () {
  var allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  var allowedExtensions = ["jpg", "jpeg", "png", "webp", "pdf"];

  function qs(root, selector) {
    return root.querySelector(selector);
  }

  function text(node, value, className) {
    if (!node) return;
    node.textContent = value || "";
    node.className = "smm-upload__status" + (className ? " " + className : "");
  }

  function getSessionId() {
    var key = "smm_upload_session_id";
    try {
      var existing = window.localStorage.getItem(key);
      if (existing) return existing;
      var id = "sess_" + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : String(Date.now()) + Math.random().toString(16).slice(2));
      window.localStorage.setItem(key, id);
      return id;
    } catch (_error) {
      return "sess_" + String(Date.now()) + Math.random().toString(16).slice(2);
    }
  }

  function getCartToken() {
    var match = document.cookie.match(/(?:^|;\s*)cart=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function extension(filename) {
    var match = /\.([a-z0-9]+)$/i.exec(filename || "");
    return match ? match[1].toLowerCase() : "";
  }

  function formatBytes(bytes) {
    if (bytes > 1048576) return Math.round(bytes / 1048576) + " MB";
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function findProductForm(block) {
    return block.closest("form[action*='/cart/add']") || document.querySelector("form[action*='/cart/add']");
  }

  function selectedSize(form, optionName) {
    if (!form || !optionName) return "";
    var lower = optionName.toLowerCase();
    var selects = Array.prototype.slice.call(form.querySelectorAll("select"));
    for (var i = 0; i < selects.length; i += 1) {
      var select = selects[i];
      var name = (select.getAttribute("name") || "").toLowerCase();
      var label = form.querySelector("label[for='" + select.id + "']");
      var labelText = label ? label.textContent.toLowerCase() : "";
      if (name.indexOf(lower) >= 0 || labelText.indexOf(lower) >= 0) return select.value;
    }
    var checked = form.querySelector("input[type='radio']:checked");
    if (checked) return checked.value;
    return "";
  }

  function quantity(form) {
    if (!form) return 1;
    var input = form.querySelector("input[name='quantity']");
    var value = input ? Number(input.value) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function variantId(form, block) {
    var input = form && form.querySelector("[name='id']");
    return input && input.value ? input.value : block.dataset.variantId || "";
  }

  function setProgress(block, value) {
    var progress = qs(block, "[data-upload-progress]");
    var bar = qs(block, "[data-upload-progress-bar]");
    if (!progress || !bar) return;
    progress.hidden = false;
    bar.style.width = Math.max(0, Math.min(100, value)) + "%";
  }

  function hideProgress(block) {
    var progress = qs(block, "[data-upload-progress]");
    if (progress) progress.hidden = true;
    setProgress(block, 0);
  }

  function addProperty(form, name, value) {
    if (!form) return;
    var input = form.querySelector("input[name='properties[" + name + "]']");
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "properties[" + name + "]";
      form.appendChild(input);
    }
    input.disabled = !value;
    input.value = value || "";
  }

  function addUploadProperties(form, uploadId, filename) {
    addProperty(form, "_stampmymark_upload_id", uploadId);
    addProperty(form, "_stampmymark_original_filename", filename);
  }

  function clearUploadProperties(form) {
    addUploadProperties(form, "", "");
  }

  function submitButtons(form) {
    if (!form) return [];
    var buttons = Array.prototype.slice.call(form.querySelectorAll("button[type='submit'], input[type='submit'], button[name='add']"));
    var paymentButtons = Array.prototype.slice.call(document.querySelectorAll(".shopify-payment-button button"));
    return buttons.concat(paymentButtons);
  }

  function setCartEnabled(form, enabled) {
    submitButtons(form).forEach(function (button) {
      button.disabled = !enabled;
      button.setAttribute("aria-disabled", enabled ? "false" : "true");
    });
  }

  function renderPreview(block, file) {
    var preview = qs(block, "[data-upload-preview]");
    if (!preview) return;
    preview.hidden = false;
    preview.innerHTML = "";
    var media = document.createElement(file.type.indexOf("image/") === 0 ? "img" : "span");
    if (media.tagName === "IMG") {
      media.alt = "";
      media.src = URL.createObjectURL(file);
    } else {
      media.className = "smm-upload__preview-file";
      media.textContent = "PDF";
    }
    var copy = document.createElement("div");
    var name = document.createElement("div");
    var meta = document.createElement("div");
    name.className = "smm-upload__preview-name";
    meta.className = "smm-upload__preview-meta";
    name.textContent = file.name;
    meta.textContent = formatBytes(file.size);
    copy.appendChild(name);
    copy.appendChild(meta);
    preview.appendChild(media);
    preview.appendChild(copy);
  }

  function requestJson(url, payload) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || body.ok === false) {
          throw new Error(body.error || (body.details && body.details[0]) || "Upload failed.");
        }
        return body;
      });
    });
  }

  function uploadToBackend(uploadId, sessionId, file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var formData = new FormData();
      formData.append("uploadId", uploadId);
      formData.append("sessionId", sessionId);
      formData.append("file", file);
      xhr.open("POST", "/apps/stamp-upload/uploads/file");
      xhr.withCredentials = true;
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable) onProgress(5 + Math.round((event.loaded / event.total) * 90));
      };
      xhr.onload = function () {
        var body = {};
        try {
          body = JSON.parse(xhr.responseText || "{}");
        } catch (_error) {}
        if (xhr.status >= 200 && xhr.status < 300 && body.ok !== false) resolve(body);
        else reject(new Error(body.error || "Upload failed."));
      };
      xhr.onerror = function () {
        reject(new Error("Upload failed."));
      };
      xhr.send(formData);
    });
  }

  function initBlock(block) {
    var input = qs(block, "[data-upload-input]");
    var trigger = qs(block, "[data-upload-trigger]");
    var status = qs(block, "[data-upload-status]");
    var actions = qs(block, "[data-upload-actions]");
    var replace = qs(block, "[data-upload-replace]");
    var remove = qs(block, "[data-upload-remove]");
    var form = findProductForm(block);
    var required = block.dataset.required !== "false";
    var maxBytes = Number(block.dataset.maxBytes || 26214400);
    var sessionId = getSessionId();
    var state = { uploadId: "", filename: "", uploading: false };

    if (required) setCartEnabled(form, false);

    trigger.addEventListener("click", function () {
      input.click();
    });

    replace.addEventListener("click", function () {
      input.click();
    });

    remove.addEventListener("click", function () {
      if (state.uploadId) {
        requestJson("/apps/stamp-upload/uploads/remove", {
          uploadId: state.uploadId,
          sessionId: sessionId
        }).catch(function () {});
      }
      state = { uploadId: "", filename: "", uploading: false };
      input.value = "";
      qs(block, "[data-upload-preview]").hidden = true;
      actions.hidden = true;
      clearUploadProperties(form);
      hideProgress(block);
      text(status, "");
      if (required) setCartEnabled(form, false);
    });

    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      var ext = extension(file && file.name);
      if (!file) return;
      if (allowedTypes.indexOf(file.type) < 0 || allowedExtensions.indexOf(ext) < 0) {
        text(status, "Please upload a JPG, PNG, WEBP, or PDF file.", "is-error");
        return;
      }
      if (file.size > maxBytes) {
        text(status, "File must be " + Math.round(maxBytes / 1048576) + "MB or smaller.", "is-error");
        return;
      }

      state.uploading = true;
      state.uploadId = "";
      state.filename = file.name;
      clearUploadProperties(form);
      if (required) setCartEnabled(form, false);
      trigger.disabled = true;
      actions.hidden = true;
      renderPreview(block, file);
      setProgress(block, 3);
      text(status, "Preparing upload...");

      var payload = {
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
        productId: block.dataset.productId,
        productHandle: block.dataset.productHandle,
        productTitle: block.dataset.productTitle,
        variantId: variantId(form, block),
        variantTitle: block.dataset.variantTitle,
        selectedSize: selectedSize(form, block.dataset.sizeOptionName),
        quantity: quantity(form),
        sessionId: sessionId,
        cartToken: getCartToken(),
        customerId: block.dataset.customerId
      };

      requestJson("/apps/stamp-upload/uploads/init", payload)
        .then(function (init) {
          state.uploadId = init.uploadId;
          text(status, "Uploading...");
          return uploadToBackend(state.uploadId, sessionId, file, function (progress) {
            setProgress(block, progress);
          });
        })
        .then(function () {
          state.uploading = false;
          setProgress(block, 100);
          addUploadProperties(form, state.uploadId, file.name);
          setCartEnabled(form, true);
          actions.hidden = false;
          text(status, "Upload complete.", "is-success");
        })
        .catch(function (error) {
          state.uploading = false;
          state.uploadId = "";
          clearUploadProperties(form);
          if (required) setCartEnabled(form, false);
          text(status, error.message || "Upload failed.", "is-error");
        })
        .finally(function () {
          trigger.disabled = false;
        });
    });

    if (form) {
      form.addEventListener("submit", function (event) {
        if (form.dataset.smmSubmitting === "true") return;
        if (required && !state.uploadId) {
          event.preventDefault();
          text(status, "Please upload your picture before adding to cart.", "is-error");
          return;
        }
        if (state.uploading) {
          event.preventDefault();
          text(status, "Please wait for the upload to finish.", "is-error");
          return;
        }
        event.preventDefault();
        requestJson("/apps/stamp-upload/uploads/cart", {
          uploadId: state.uploadId,
          sessionId: sessionId,
          cartToken: getCartToken(),
          quantity: quantity(form),
          selectedSize: selectedSize(form, block.dataset.sizeOptionName),
          variantId: variantId(form, block)
        }).finally(function () {
          form.dataset.smmSubmitting = "true";
          form.submit();
        });
      });
    }
  }

  document.querySelectorAll("[data-stamp-upload]").forEach(initBlock);
})();
