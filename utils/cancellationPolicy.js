// Combine a MySQL date + time string (e.g. "13:00:00") into one local Date object
function combineDateAndTime(dateVal, timeStr) {
    const d = typeof dateVal === "string"
        ? new Date(dateVal + "T00:00:00")
        : new Date(dateVal);

    const parts = (timeStr || "13:00:00").split(":");
    d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    return d;
}

// Format date cleanly for UI display (e.g. "10 Dec 2026")
export function formatDisplayDate(dateVal) {
    const d = typeof dateVal === "string"
        ? new Date(dateVal + "T00:00:00")
        : new Date(dateVal);

    return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

// Check if booking can be cancelled and calculate refund from property's policy
export function calculateCancellationDetails(booking) {
    const now = new Date();
    const checkIn = combineDateAndTime(booking.CHECK_IN_DATE, booking.check_in_time || "13:00:00");
    const checkOut = combineDateAndTime(booking.CHECK_OUT_DATE, booking.check_out_time || "11:00:00");

    const policyText = booking.cancellation_policy || "Flexible: Free cancellation up to 24 hours before check-in.";
    const isActive = booking.STATUS === "pending" || booking.STATUS === "confirmed";
    const isOngoing = isActive && now >= checkIn && now < checkOut;

    // Cannot cancel if already cancelled/completed OR check-in has started
    if (!isActive || now >= checkIn) {
        return {
            canCancel: false,
            isOngoing: isOngoing,
            refundPercent: 0,
            refundAmount: 0,
            policyText: policyText,
            refundNote: isOngoing
                ? "Your check-in time has started, so this booking can't be cancelled."
                : "This booking can no longer be cancelled.",
        };
    }

    // Calculate hours left until check-in time
    const hoursLeft = (checkIn - now) / (1000 * 60 * 60);
    let refundPercent = 0;

    if (policyText.startsWith("Strict")) {
        // Strict: 50% refund up to 7 days (168 hrs) before check-in; 0% after
        refundPercent = hoursLeft >= 168 ? 50 : 0;
    } else if (policyText.startsWith("Moderate")) {
        // Moderate (multi-tier, checked highest hours -> lowest hours):
        // 5+ days (120h) -> 100%, 3+ days (72h) -> 60%, 2+ days (48h) -> 50%, < 48h -> 0%
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
        // Free 48h: 100% refund up to 48 hrs before check-in; 50% after
        refundPercent = hoursLeft >= 48 ? 100 : 50;
    } else {
        // Flexible (default): 100% refund up to 24 hrs before check-in; 0% after
        refundPercent = hoursLeft >= 24 ? 100 : 0;
    }

    const refundAmount = Math.round((Number(booking.TOTAL_AMOUNT) * refundPercent) / 100);
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
