// Live nights, rooms, guests cap, and total price calculator + double-submit protection
const checkInInput = document.getElementById("checkIn");
const checkOutInput = document.getElementById("checkOut");
const roomsCountSelect = document.getElementById("roomsCount");
const guestsSelect = document.getElementById("guests");
const guestsHintEl = document.getElementById("guestsHint");
const priceSummary = document.getElementById("priceSummary");
const nightsCountEl = document.getElementById("nightsCount");
const roomsCountTextEl = document.getElementById("roomsCountText");
const subtotalTextEl = document.getElementById("subtotalText");
const totalPriceTextEl = document.getElementById("totalPriceText");
const bookingForm = document.getElementById("bookingForm");

function updateGuestOptions() {
    if (!roomsCountSelect || !guestsSelect) return;

    const capacityPerRoom = Number(guestsSelect.getAttribute("data-capacity")) || 1;
    const roomsCount = Number(roomsCountSelect.value) || 1;
    const maxGuests = capacityPerRoom * roomsCount;
    const currentGuests = Number(guestsSelect.value) || 1;

    guestsSelect.innerHTML = "";
    for (let g = 1; g <= maxGuests; g++) {
        const option = document.createElement("option");
        option.value = String(g);
        option.textContent = g === 1 ? "1 Guest" : `${g} Guests`;
        guestsSelect.appendChild(option);
    }

    guestsSelect.value = String(Math.min(currentGuests, maxGuests));

    if (guestsHintEl) {
        guestsHintEl.textContent = `Maximum ${maxGuests} guests allowed for ${roomsCount} ${roomsCount === 1 ? "room" : "rooms"}.`;
    }
}

if (checkInInput && checkOutInput && priceSummary) {
    const pricePerNight = Number(priceSummary.getAttribute("data-price"));

    function updatePriceSummary() {
        const checkInValue = checkInInput.value;
        const checkOutValue = checkOutInput.value;
        const roomsCount = roomsCountSelect ? Number(roomsCountSelect.value) || 1 : 1;

        if (roomsCountTextEl) {
            roomsCountTextEl.textContent = String(roomsCount);
        }

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
            const total = nights * pricePerNight * roomsCount;
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

    if (roomsCountSelect) {
        roomsCountSelect.addEventListener("change", () => {
            updateGuestOptions();
            updatePriceSummary();
        });
    }
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
