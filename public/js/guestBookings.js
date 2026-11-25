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

    // =========================================================================
    // Write a Review Modal (1 final verified review per completed booking)
    // =========================================================================
    const reviewButtons = document.querySelectorAll(".open-review-modal-btn");
    const reviewModal = document.getElementById("reviewBookingModal");
    const reviewForm = document.getElementById("reviewBookingForm");
    const reviewPropertyText = document.getElementById("reviewModalProperty");
    const reviewRatingInput = document.getElementById("reviewRatingInput");
    const reviewRatingLabel = document.getElementById("reviewRatingLabel");
    const reviewCommentInput = document.getElementById("reviewCommentInput");
    const reviewCharCount = document.getElementById("reviewCharCount");
    const reviewCancelBtn = document.getElementById("reviewModalCancelBtn");
    const reviewSubmitBtn = document.getElementById("reviewModalSubmitBtn");
    const starButtons = document.querySelectorAll(".review-star-btn");

    const ratingLabels = {
        1: "1 / 5 — Poor",
        2: "2 / 5 — Fair",
        3: "3 / 5 — Good",
        4: "4 / 5 — Very Good",
        5: "5 / 5 — Excellent",
    };

    function setSelectedStars(starCount) {
        reviewRatingInput.value = String(starCount);
        if (reviewRatingLabel) {
            reviewRatingLabel.textContent = ratingLabels[starCount] || `${starCount} / 5`;
        }
        for (let starBtn of starButtons) {
            const num = Number(starBtn.dataset.star);
            if (num <= starCount) {
                starBtn.classList.add("is-selected");
            } else {
                starBtn.classList.remove("is-selected");
            }
        }
    }

    function openReviewModal(button) {
        const bookingId = button.dataset.bookingId;
        const propertyTitle = button.dataset.propertyTitle;

        reviewForm.action = `/guest/bookings/${bookingId}/review`;
        reviewPropertyText.textContent = `How was your stay at "${propertyTitle}"? Reviews are final once submitted.`;

        setSelectedStars(5);
        reviewCommentInput.value = "";
        if (reviewCharCount) {
            reviewCharCount.textContent = "0 / 1000";
        }
        reviewSubmitBtn.disabled = false;
        reviewSubmitBtn.textContent = "Submit Review";

        reviewModal.hidden = false;
        document.body.classList.add("apple-modal-open");

        window.requestAnimationFrame(() => {
            reviewModal.classList.add("is-open");
            reviewCommentInput.focus();
        });
    }

    function closeReviewModal() {
        reviewModal.classList.remove("is-open");
        document.body.classList.remove("apple-modal-open");

        window.setTimeout(() => {
            if (!reviewModal.classList.contains("is-open")) {
                reviewModal.hidden = true;
            }
        }, 200);
    }

    if (reviewModal && reviewForm && reviewCancelBtn && reviewSubmitBtn) {
        for (let btn of reviewButtons) {
            btn.addEventListener("click", () => {
                openReviewModal(btn);
            });
        }

        for (let starBtn of starButtons) {
            starBtn.addEventListener("click", () => {
                const chosen = Number(starBtn.dataset.star);
                setSelectedStars(chosen);
            });
        }

        if (reviewCommentInput && reviewCharCount) {
            reviewCommentInput.addEventListener("input", () => {
                reviewCharCount.textContent = `${reviewCommentInput.value.length} / 1000`;
            });
        }

        reviewCancelBtn.addEventListener("click", closeReviewModal);

        reviewModal.addEventListener("click", (event) => {
            if (event.target === reviewModal) {
                closeReviewModal();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !reviewModal.hidden) {
                closeReviewModal();
            }
        });

        reviewForm.addEventListener("submit", () => {
            reviewSubmitBtn.disabled = true;
            reviewSubmitBtn.textContent = "Submitting...";
        });
    }
});
