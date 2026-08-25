(() => {
  const loginBtn = document.getElementById("login-btn");
  const popover = document.getElementById("login-popover");
  const secretInput = document.getElementById("login-secret");
  const submitBtn = document.getElementById("login-submit");
  const cancelBtn = document.getElementById("login-cancel");
  const errorEl = document.getElementById("login-error");

  function openPopover() {
    popover.hidden = false;
    errorEl.hidden = true;
    secretInput.value = "";
    secretInput.focus();
  }

  function closePopover() {
    popover.hidden = true;
  }

  function submit() {
    const hex = secretInput.value.trim();
    errorEl.hidden = true;

    if (!hex) {
      errorEl.textContent = "Paste your secretKeyHex first.";
      errorEl.hidden = false;
      return;
    }

    try {
      const record = window.TechnocoreIdentity.importFromSecretKeyHex(hex);
      closePopover();
      window.dispatchEvent(
        new CustomEvent("technocore:identity-changed", { detail: record })
      );
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't import that key.";
      errorEl.hidden = false;
    }
  }

  loginBtn.addEventListener("click", () => {
    if (popover.hidden) openPopover();
    else closePopover();
  });

  cancelBtn.addEventListener("click", closePopover);
  submitBtn.addEventListener("click", submit);

  secretInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") closePopover();
  });

  document.addEventListener("click", (e) => {
    if (popover.hidden) return;
    if (popover.contains(e.target) || e.target === loginBtn) return;
    closePopover();
  });
})();
