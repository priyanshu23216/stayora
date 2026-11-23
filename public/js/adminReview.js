document.addEventListener("DOMContentLoaded", () => {
    const openBtn = document.getElementById("openRejectModalBtn");
    const modal = document.getElementById("rejectPropertyModal");
    const cancelBtn = document.getElementById("rejectModalCancel");
    const submitBtn = document.getElementById("rejectModalSubmit");
    const form = document.getElementById("rejectPropertyForm");
    const reasonInput = document.getElementById("rejectionReason");
    const charCount = document.getElementById("rejectCharCount");

    if (!openBtn || !modal || !cancelBtn || !submitBtn || !form || !reasonInput) {
        return;
    }

    function openModal() {
        modal.hidden = false;
        document.body.classList.add("apple-modal-open");

        window.requestAnimationFrame(() => {
            modal.classList.add("is-open");
            reasonInput.focus();
        });
    }

    function closeModal() {
        modal.classList.remove("is-open");
        document.body.classList.remove("apple-modal-open");

        window.setTimeout(() => {
            if (!modal.classList.contains("is-open")) {
                modal.hidden = true;
            }
        }, 200);
    }

    openBtn.addEventListener("click", openModal);
    cancelBtn.addEventListener("click", closeModal);

    // Close modal when clicking outside the white dialog card
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });

    // Close modal when pressing Escape key
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) {
            closeModal();
        }
    });

    // Update live character counter while typing the rejection reason
    if (charCount) {
        reasonInput.addEventListener("input", () => {
            charCount.textContent = `${reasonInput.value.length} / 500`;
        });
    }

    // Prevent double clicks while submitting
    form.addEventListener("submit", () => {
        submitBtn.disabled = true;
        submitBtn.textContent = "Rejecting...";
    });
});
