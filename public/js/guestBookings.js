document.addEventListener("DOMContentLoaded", () => {
    const cancelButtons = document.querySelectorAll(".open-cancel-modal-btn");
    const modal = document.getElementById("cancelBookingModal");
    const backBtn = document.getElementById("cancelModalBackBtn");
    const confirmBtn = document.getElementById("cancelModalConfirmBtn");
    const form = document.getElementById("cancelBookingForm");
    const propertyText = document.getElementById("cancelModalProperty");
    const policyText = document.getElementById("cancelModalPolicy");
    const refundText = document.getElementById("cancelModalRefund");

    if (!modal || !backBtn || !confirmBtn || !form) {
        return;
    }

    function openModal(button) {
        const bookingId = button.dataset.bookingId;
        const propertyTitle = button.dataset.propertyTitle;
        const policy = button.dataset.policyText;
        const refundNote = button.dataset.refundNote;
        const refundPercent = Number(button.dataset.refundPercent || 0);

        form.action = `/guest/bookings/${bookingId}/cancel?_method=PATCH`;
        propertyText.textContent = `Cancel your stay at "${propertyTitle}"? Once confirmed, your room will be released immediately.`;
        policyText.textContent = policy;
        refundText.textContent = refundNote;

        refundText.classList.remove("is-full", "is-partial", "is-none");
        if (refundPercent === 100) {
            refundText.classList.add("is-full");
        } else if (refundPercent > 0) {
            refundText.classList.add("is-partial");
        } else {
            refundText.classList.add("is-none");
        }

        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm Cancel";

        modal.hidden = false;
        document.body.classList.add("apple-modal-open");

        window.requestAnimationFrame(() => {
            modal.classList.add("is-open");
            backBtn.focus();
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

    for (let btn of cancelButtons) {
        btn.addEventListener("click", () => {
            openModal(btn);
        });
    }

    backBtn.addEventListener("click", closeModal);

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

    // Prevent double-clicks while cancelling
    form.addEventListener("submit", () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Cancelling...";
    });
});
