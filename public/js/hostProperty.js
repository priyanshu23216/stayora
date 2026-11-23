document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("deleteConfirmModal");
    const titleEl = document.getElementById("deleteModalTitle");
    const descEl = document.getElementById("deleteModalDesc");
    const cancelBtn = document.getElementById("deleteModalCancel");
    const confirmBtn = document.getElementById("deleteModalConfirm");
    const deleteForms = document.querySelectorAll(".js-delete-confirm-form");

    if (!modal || !titleEl || !descEl || !cancelBtn || !confirmBtn) {
        return;
    }

    let pendingForm = null;

    function openModal(form) {
        pendingForm = form;
        titleEl.textContent = form.dataset.deleteTitle || "Confirm Deletion";
        descEl.textContent = form.dataset.deleteMessage || "Are you sure you want to delete this item? This action cannot be undone.";
        confirmBtn.textContent = form.dataset.confirmLabel || "Delete";
        confirmBtn.disabled = false;

        modal.hidden = false;
        document.body.classList.add("apple-modal-open");

        // Trigger smooth fade & scale animation on the next frame
        window.requestAnimationFrame(() => {
            modal.classList.add("is-open");
            cancelBtn.focus();
        });
    }

    function closeModal() {
        modal.classList.remove("is-open");
        document.body.classList.remove("apple-modal-open");
        pendingForm = null;

        window.setTimeout(() => {
            if (!modal.classList.contains("is-open")) {
                modal.hidden = true;
            }
        }, 200);
    }

    // Intercept property & room delete forms to show our custom Apple-like modal
    for (let form of deleteForms) {
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            openModal(form);
        });
    }

    // Confirm deletion -> submit the stored form directly
    confirmBtn.addEventListener("click", () => {
        if (!pendingForm) {
            return;
        }
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Deleting...";
        pendingForm.submit();
    });

    // Cancel button closes modal
    cancelBtn.addEventListener("click", closeModal);

    // Clicking outside the modal card closes it
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    // Pressing Escape key closes modal
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) {
            closeModal();
        }
    });
});
