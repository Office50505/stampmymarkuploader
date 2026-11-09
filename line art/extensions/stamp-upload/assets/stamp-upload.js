"use strict";

(function () {
  let loading = null;

  function boot() {
    if (loading) return;

    const mount =
      document.querySelector("[data-stamp-upload][data-smm-module-url]") ||
      document.querySelector("[data-smm-quick-view-loader][data-smm-module-url]");
    const moduleUrl = mount && mount.dataset.smmModuleUrl;

    if (!moduleUrl) return;

    loading = import(moduleUrl).catch((error) => {
      loading = null;
      console.error("Line Art Uploader could not start", error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  new MutationObserver(boot).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
