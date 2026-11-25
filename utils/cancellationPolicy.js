// Helper 1: Convert a MySQL DATE ("2026-10-10"), TIMESTAMP ("2026-10-10 18:10:05"),
// or JS Date object safely into a local JS Date (without time-zone bugs)
function parseDateOnly(dateValue) {
    if (!dateValue) {
        return null;
    }

    let dateObject;

    if (typeof dateValue === "string") {
        // Take only the first 10 characters: "YYYY-MM-DD"
        // This works for both DATE ("2026-10-10") and TIMESTAMP ("2026-11-23 18:10:05")
        const onlyDate = dateValue.trim().slice(0, 10);
        dateObject = new Date(onlyDate + "T00:00:00");
    } else {
        dateObject = new Date(dateValue);
    }

    // Safety check: if date is invalid, return null instead of "Invalid Date"
    if (isNaN(dateObject.getTime())) {
        return null;
    }

    return dateObject;
}

// Helper 2: Combine a date (e.g. "2026-10-10") and a time string (e.g. "13:00:00")
// into one complete local Date object
function combineDateAndTime(dateValue, timeString) {
    const dateObject = parseDateOnly(dateValue);
    if (!dateObject) {
        return new Date(NaN);
    }

    const safeTime = timeString || "13:00:00";
    const timeParts = safeTime.split(":");
    const hours = Number(timeParts[0]) || 0;
    const minutes = Number(timeParts[1]) || 0;

    dateObject.setHours(hours, minutes, 0, 0);
    return dateObject;
}

// Helper 3: Format any date or timestamp cleanly for UI display (e.g. "10 Oct 2026")
export function formatDisplayDate(dateValue) {
    const dateObject = parseDateOnly(dateValue);
    if (!dateObject) {
        return "";
    }

    return dateObject.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

// Helper 4: Check if a booking can be cancelled and calculate the refund amount
export function calculateCancellationDetails(booking) {
    const now = new Date();
    const checkInDateTime = combineDateAndTime(
        booking.CHECK_IN_DATE,
        booking.check_in_time || "13:00:00"
    );
    const checkOutDateTime = combineDateAndTime(
        booking.CHECK_OUT_DATE,
        booking.check_out_time || "11:00:00"
    );

    const policyText =
        booking.cancellation_policy ||
        "Flexible: Free cancellation up to 24 hours before check-in.";

    const isActive = booking.STATUS === "pending" || booking.STATUS === "confirmed";
    const isOngoing = isActive && now >= checkInDateTime && now < checkOutDateTime;

    // Rule 1: Booking cannot be cancelled if it is already completed/cancelled, or check-in has started
    if (!isActive || now >= checkInDateTime) {
        let lockedMessage = "This booking can no longer be cancelled.";
        if (isOngoing) {
            lockedMessage = "Your check-in time has started, so this booking can't be cancelled.";
        }

        return {
            canCancel: false,
            isOngoing: isOngoing,
            refundPercent: 0,
            refundAmount: 0,
            policyText: policyText,
            refundNote: lockedMessage,
        };
    }

    // Rule 2: Calculate how many hours are left before check-in
    const millisecondsLeft = checkInDateTime - now;
    const hoursLeft = millisecondsLeft / (1000 * 60 * 60);
    let refundPercent = 0;

    if (policyText.startsWith("Strict")) {
        // Strict: 50% refund up to 7 days (168 hours) before check-in
        if (hoursLeft >= 168) {
            refundPercent = 50;
        } else {
            refundPercent = 0;
        }
    } else if (policyText.startsWith("Moderate")) {
        // Moderate: 5+ days -> 100%, 3+ days -> 60%, 2+ days -> 50%, under 48h -> 0%
        if (hoursLeft >= 120) {
            refundPercent = 100;
        } else if (hoursLeft >= 72) {
            refundPercent = 60;
        } else if (hoursLeft >= 48) {
            refundPercent = 50;
        } else {
            refundPercent = 0;
        }
    } else if (policyText.includes("48 hours")) {
        // Free 48h: 100% refund up to 48 hours before check-in, 50% after
        if (hoursLeft >= 48) {
            refundPercent = 100;
        } else {
            refundPercent = 50;
        }
    } else {
        // Flexible (default): 100% refund up to 24 hours before check-in
        if (hoursLeft >= 24) {
            refundPercent = 100;
        } else {
            refundPercent = 0;
        }
    }

    // Rule 3: Compute final rupee refund amount and display message
    const totalAmount = Number(booking.TOTAL_AMOUNT) || 0;
    const refundAmount = Math.round((totalAmount * refundPercent) / 100);
    const formattedRefund = refundAmount.toLocaleString("en-IN");

    let refundNote = "No refund (₹0). This booking is outside the refund period.";
    if (refundPercent === 100) {
        refundNote = `You'll get a full refund of ₹${formattedRefund} (100%).`;
    } else if (refundPercent > 0) {
        refundNote = `You'll get a ${refundPercent}% refund of ₹${formattedRefund}.`;
    }

    return {
        canCancel: true,
        isOngoing: false,
        refundPercent: refundPercent,
        refundAmount: refundAmount,
        policyText: policyText,
        refundNote: refundNote,
    };
}
