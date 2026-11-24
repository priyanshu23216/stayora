import express from "express";
import db from "../config/db.js";
import { isLoggedIn } from "../middlewares/auth.js";
import { sendBookingCancellation } from "../utils/mailer.js";
import {
    calculateCancellationDetails,
    formatDisplayDate,
} from "../utils/cancellationPolicy.js";

const guestRouter = express.Router();

// Protect all /guest/* routes: any logged-in user (guest, host, or admin) can view & manage their own bookings
guestRouter.use(isLoggedIn);

// 1. GET /guest/dashboard -> Show logged-in user's personal bookings with KPIs, tabs, and pagination
guestRouter.get("/dashboard", async (req, res, next) => {
    try {
        const userId = req.user.ID;

        // Step 1: Auto-sync completed stays whose check-out date + time has passed
        await db.execute(
            `UPDATE bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             SET bookings.STATUS = 'completed'
             WHERE bookings.USER_ID = ?
               AND bookings.STATUS = 'confirmed'
               AND TIMESTAMP(bookings.CHECK_OUT_DATE, COALESCE(properties.check_out_time, '11:00:00')) <= NOW()`,
            [userId]
        );

        // Step 2: Read optional tab filter (?status=all | upcoming | completed | cancelled)
        let status = req.query.status;
        if (status !== "upcoming" && status !== "completed" && status !== "cancelled") {
            status = "all";
        }

        // Step 3: Read page number safely (10 bookings per page)
        let page = parseInt(req.query.page, 10);
        if (!page || page < 1) {
            page = 1;
        }
        const limit = 10;

        // Step 4: Fetch KPI summary counts for this user's bookings
        const upcomingCountResult = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             WHERE USER_ID = ? AND STATUS IN ('pending', 'confirmed')`,
            [userId]
        );
        const completedCountResult = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             WHERE USER_ID = ? AND STATUS = 'completed'`,
            [userId]
        );
        const cancelledCountResult = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             WHERE USER_ID = ? AND STATUS = 'cancelled'`,
            [userId]
        );

        const upcomingTotal = upcomingCountResult[0][0].total;
        const completedTotal = completedCountResult[0][0].total;
        const cancelledTotal = cancelledCountResult[0][0].total;
        const allTotal = upcomingTotal + completedTotal + cancelledTotal;

        const stats = {
            all: allTotal,
            upcoming: upcomingTotal,
            completed: completedTotal,
            cancelled: cancelledTotal,
        };

        // Step 5: Calculate total pages and keep current page within valid bounds
        let activeTotal = stats.all;
        if (status === "upcoming") {
            activeTotal = stats.upcoming;
        } else if (status === "completed") {
            activeTotal = stats.completed;
        } else if (status === "cancelled") {
            activeTotal = stats.cancelled;
        }

        let totalPages = Math.ceil(activeTotal / limit);
        if (totalPages < 1) {
            totalPages = 1;
        }
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        // Step 6: Fetch paginated bookings joined with room, property, and host contact details
        let statusCondition = "";
        if (status === "upcoming") {
            statusCondition = "AND bookings.STATUS IN ('pending', 'confirmed')";
        } else if (status === "completed") {
            statusCondition = "AND bookings.STATUS = 'completed'";
        } else if (status === "cancelled") {
            statusCondition = "AND bookings.STATUS = 'cancelled'";
        }

        const bookingsResult = await db.execute(
            `SELECT bookings.ID,
                    bookings.ROOM_ID,
                    bookings.CHECK_IN_DATE,
                    bookings.CHECK_OUT_DATE,
                    bookings.GUESTS,
                    bookings.TOTAL_AMOUNT,
                    bookings.STATUS,
                    bookings.CREATED_AT,
                    rooms.ROOM_TYPE,
                    rooms.PRICE_PER_NIGHT,
                    properties.ID AS property_id,
                    properties.title AS property_title,
                    properties.image AS property_image,
                    properties.city AS property_city,
                    properties.state AS property_state,
                    properties.check_in_time,
                    properties.check_out_time,
                    properties.cancellation_policy,
                    host.NAME AS host_name,
                    host.EMAIL AS host_email
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             JOIN users AS host ON properties.HOST_ID = host.ID
             WHERE bookings.USER_ID = ?
               ${statusCondition}
             ORDER BY bookings.CREATED_AT DESC
             LIMIT ? OFFSET ?`,
            [userId, String(limit), String(offset)]
        );
        const rawBookings = bookingsResult[0];

        // Step 7: Prepare display dates, nights count, and cancellation info for EJS
        const bookings = [];
        for (let item of rawBookings) {
            const diffMs = new Date(item.CHECK_OUT_DATE) - new Date(item.CHECK_IN_DATE);
            const nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            const cancellation = calculateCancellationDetails(item);

            bookings.push({
                ...item,
                nights: nights,
                checkInDisplay: formatDisplayDate(item.CHECK_IN_DATE),
                checkOutDisplay: formatDisplayDate(item.CHECK_OUT_DATE),
                cancellation: cancellation,
            });
        }

        return res.render("guest/dashboard", {
            title: "My Bookings",
            stats: stats,
            status: status,
            bookings: bookings,
            currentPage: page,
            totalPages: totalPages,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. PATCH /guest/bookings/:bookingId/cancel -> Cancel user's own upcoming booking
guestRouter.patch("/bookings/:bookingId/cancel", async (req, res, next) => {
    try {
        const bookingId = req.params.bookingId;
        const userId = req.user.ID;

        // Step 1: Fetch booking ONLY if it belongs to logged-in user (IDOR protection)
        const bookingResult = await db.execute(
            `SELECT bookings.ID,
                    bookings.USER_ID,
                    bookings.CHECK_IN_DATE,
                    bookings.CHECK_OUT_DATE,
                    bookings.GUESTS,
                    bookings.TOTAL_AMOUNT,
                    bookings.STATUS,
                    rooms.ROOM_TYPE,
                    properties.title AS property_title,
                    properties.check_in_time,
                    properties.check_out_time,
                    properties.cancellation_policy
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE bookings.ID = ? AND bookings.USER_ID = ?`,
            [bookingId, userId]
        );
        const rows = bookingResult[0];

        if (rows.length === 0) {
            req.flash("error", "Booking not found or you do not have permission to cancel it.");
            return res.redirect("/guest/dashboard");
        }

        const booking = rows[0];

        // Step 2: Check eligibility and calculate refund from property's cancellation policy
        const cancellation = calculateCancellationDetails(booking);

        if (!cancellation.canCancel) {
            req.flash("error", cancellation.refundNote);
            return res.redirect("/guest/dashboard");
        }

        // Step 3: Atomically mark booking 'cancelled' (room becomes available again immediately)
        const updateResult = await db.execute(
            `UPDATE bookings
             SET STATUS = 'cancelled'
             WHERE ID = ? AND USER_ID = ? AND STATUS IN ('pending', 'confirmed')`,
            [bookingId, userId]
        );

        if (updateResult[0].affectedRows === 0) {
            req.flash("error", "This booking has already been cancelled or completed.");
            return res.redirect("/guest/dashboard");
        }

        // Step 4: Send cancellation confirmation email with exact refund details
        try {
            await sendBookingCancellation(req.user.EMAIL, {
                bookingId: booking.ID,
                hotelName: booking.property_title,
                roomType: booking.ROOM_TYPE,
                checkIn: formatDisplayDate(booking.CHECK_IN_DATE),
                checkOut: formatDisplayDate(booking.CHECK_OUT_DATE),
                totalPrice: booking.TOTAL_AMOUNT,
                refundPercent: cancellation.refundPercent,
                refundAmount: cancellation.refundAmount,
                refundNote: cancellation.refundNote,
            });
        } catch (emailErr) {
            // Do not fail an already-cancelled booking if email delivery fails
            console.error("Booking cancellation email error:", emailErr);
        }

        if (cancellation.refundAmount > 0) {
            req.flash(
                "success",
                `Booking at "${booking.property_title}" has been cancelled. Eligible refund: ₹${cancellation.refundAmount} (${cancellation.refundPercent}%). A confirmation email has been sent.`
            );
        } else {
            req.flash(
                "success",
                `Booking at "${booking.property_title}" has been cancelled (non-refundable per property policy). A confirmation email has been sent.`
            );
        }

        return res.redirect("/guest/dashboard?status=cancelled");
    } catch (err) {
        return next(err);
    }
});

// Error-handling middleware for guest routes
guestRouter.use((err, req, res, next) => {
    console.error("Guest route error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/");
});

export default guestRouter;
