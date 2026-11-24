// Live nights and total price calculator + double-submit protection on the booking checkout page
const checkInInput = document.getElementById("checkIn");
const checkOutInput = document.getElementById("checkOut");
const priceSummary = document.getElementById("priceSummary");
const nightsCountEl = document.getElementById("nightsCount");
const subtotalTextEl = document.getElementById("subtotalText");
const totalPriceTextEl = document.getElementById("totalPriceText");
const bookingForm = document.getElementById("bookingForm");

if (checkInInput && checkOutInput && priceSummary) {
    const pricePerNight = Number(priceSummary.getAttribute("data-price"));

    function updatePriceSummary() {
        const checkInValue = checkInInput.value;
        const checkOutValue = checkOutInput.value;

        if (checkInValue) {
            checkOutInput.min = checkInValue;
        }

        if (!checkInValue || !checkOutValue) {
            nightsCountEl.textContent = "0";
            subtotalTextEl.textContent = "₹0";
            totalPriceTextEl.textContent = "Select dates";
            return;
        }

        const startDate = new Date(checkInValue + "T00:00:00");
        const endDate = new Date(checkOutValue + "T00:00:00");
        const diffInMs = endDate - startDate;
        const nights = Math.round(diffInMs / (1000 * 60 * 60 * 24));

        if (nights > 60) {
            nightsCountEl.textContent = String(nights);
            subtotalTextEl.textContent = "—";
            totalPriceTextEl.textContent = "Max 60 nights per booking";
        } else if (nights > 0) {
            const total = nights * pricePerNight;
            nightsCountEl.textContent = String(nights);
            subtotalTextEl.textContent = "₹" + total.toLocaleString("en-IN");
            totalPriceTextEl.textContent = "₹" + total.toLocaleString("en-IN");
        } else {
            nightsCountEl.textContent = "0";
            subtotalTextEl.textContent = "₹0";
            totalPriceTextEl.textContent = "Check-out must be after check-in";
        }
    }

    checkInInput.addEventListener("change", updatePriceSummary);
    checkOutInput.addEventListener("change", updatePriceSummary);
}

if (bookingForm) {
    bookingForm.addEventListener("submit", () => {
        const submitBtn = bookingForm.querySelector(".booking-submit-btn");
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = "Confirming Booking...";
        }
    });
}
