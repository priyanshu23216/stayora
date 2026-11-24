import express from "express";
import db from "../config/db.js";
import { isLoggedIn, isValidUuid } from "../middlewares/auth.js";
import { sendBookingCancellation } from "../utils/mailer.js";
import {
    calculateCancellationDetails,
    formatDisplayDate,
} from "../utils/cancellationPolicy.js";

const guestRouter = express.Router();

// Protect all /guest/* routes: any logged-in user can view & manage their own bookings
guestRouter.use(isLoggedIn);

function formatLocalSqlTimestamp(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    const hh = String(dateObj.getHours()).padStart(2, "0");
    const mm = String(dateObj.getMinutes()).padStart(2, "0");
    const ss = String(dateObj.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

// 1. GET /guest/dashboard -> Show logged-in user's personal bookings with KPIs, tabs, and pagination
guestRouter.get("/dashboard", async (req, res, next) => {
    try {
        const userId = req.user.ID;

        // Step 1: Auto-sync completed stays using consistent Node local timestamp (avoids DB/Node timezone drift)
        const nowTimestamp = formatLocalSqlTimestamp(new Date());
        await db.execute(
            `UPDATE bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             SET bookings.STATUS = 'completed'
             WHERE bookings.USER_ID = ?
               AND bookings.STATUS = 'confirmed'
               AND TIMESTAMP(bookings.CHECK_OUT_DATE, COALESCE(properties.check_out_time, '11:00:00')) <= ?`,
            [userId, nowTimestamp]
        );

        // Step 2: Read optional tab filter (?status=all | upcoming | completed | cancelled)
        let status = typeof req.query.status === "string" ? req.query.status : "all";
        if (status !== "upcoming" && status !== "completed" && status !== "cancelled") {
            status = "all";
        }

        // Step 3: Read page number safely (10 bookings per page)
        let page = parseInt(typeof req.query.page === "string" ? req.query.page : "1", 10);
        if (!Number.isInteger(page) || page < 1) {
            page = 1;
        }
        const limit = 10;

        // Step 4: Fetch KPI summary counts
        const [upcomingCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM bookings WHERE USER_ID = ? AND STATUS IN ('pending', 'confirmed')`,
            [userId]
        );
        const [completedCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM bookings WHERE USER_ID = ? AND STATUS = 'completed'`,
            [userId]
        );
        const [cancelledCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM bookings WHERE USER_ID = ? AND STATUS = 'cancelled'`,
            [userId]
        );

        const stats = {
            upcoming: Number(upcomingCountRows[0].total),
            completed: Number(completedCountRows[0].total),
            cancelled: Number(cancelledCountRows[0].total),
        };
        stats.all = stats.upcoming + stats.completed + stats.cancelled;

        let activeTotal = stats.all;
        if (status === "upcoming") activeTotal = stats.upcoming;
        else if (status === "completed") activeTotal = stats.completed;
        else if (status === "cancelled") activeTotal = stats.cancelled;

        const totalPages = Math.max(1, Math.ceil(activeTotal / limit));
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        let statusCondition = "";
        if (status === "upcoming") {
            statusCondition = "AND bookings.STATUS IN ('pending', 'confirmed')";
        } else if (status === "completed") {
            statusCondition = "AND bookings.STATUS = 'completed'";
        } else if (status === "cancelled") {
            statusCondition = "AND bookings.STATUS = 'cancelled'";
        }

        // Use snapshotted bookings.cancellation_policy (fallback to properties.cancellation_policy for legacy rows)
        const [rawBookings] = await db.execute(
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
                    COALESCE(bookings.cancellation_policy, properties.cancellation_policy) AS cancellation_policy,
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

        const bookings = rawBookings.map((item) => {
            const diffMs = new Date(`${item.CHECK_OUT_DATE}T00:00:00`) - new Date(`${item.CHECK_IN_DATE}T00:00:00`);
            const nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            const cancellation = calculateCancellationDetails(item);

            return {
                ...item,
                nights,
                checkInDisplay: formatDisplayDate(item.CHECK_IN_DATE),
                checkOutDisplay: formatDisplayDate(item.CHECK_OUT_DATE),
                cancellation,
            };
        });

        return res.render("guest/dashboard", {
            title: "My Bookings",
            stats,
            status,
            bookings,
            currentPage: page,
            totalPages,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. PATCH /guest/bookings/:bookingId/cancel -> Atomically cancel user's own upcoming booking
guestRouter.patch("/bookings/:bookingId/cancel", async (req, res, next) => {
    const bookingId = req.params.bookingId;
    if (!isValidUuid(bookingId)) {
        req.flash("error", "Invalid booking reference.");
        return res.redirect("/guest/dashboard");
    }

    const userId = req.user.ID;
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Lock booking row FOR UPDATE and verify ownership (IDOR protection)
        const [rows] = await connection.execute(
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
                    COALESCE(bookings.cancellation_policy, properties.cancellation_policy) AS cancellation_policy
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE bookings.ID = ? AND bookings.USER_ID = ?
             FOR UPDATE`,
            [bookingId, userId]
        );

        if (rows.length === 0) {
            await connection.rollback();
            req.flash("error", "Booking not found or you do not have permission to cancel it.");
            return res.redirect("/guest/dashboard");
        }

        const booking = rows[0];
        const cancellation = calculateCancellationDetails(booking);

        if (!cancellation.canCancel) {
            await connection.rollback();
            req.flash("error", cancellation.refundNote);
            return res.redirect("/guest/dashboard");
        }

        const [updateResult] = await connection.execute(
            `UPDATE bookings
             SET STATUS = 'cancelled'
             WHERE ID = ? AND USER_ID = ? AND STATUS IN ('pending', 'confirmed')`,
            [bookingId, userId]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            req.flash("error", "This booking has already been cancelled or completed.");
            return res.redirect("/guest/dashboard");
        }

        await connection.commit();

        sendBookingCancellation(req.user.EMAIL, {
            bookingId: booking.ID,
            hotelName: booking.property_title,
            roomType: booking.ROOM_TYPE,
            checkIn: formatDisplayDate(booking.CHECK_IN_DATE),
            checkOut: formatDisplayDate(booking.CHECK_OUT_DATE),
            totalPrice: booking.TOTAL_AMOUNT,
            refundPercent: cancellation.refundPercent,
            refundAmount: cancellation.refundAmount,
            refundNote: cancellation.refundNote,
        }).catch((emailErr) => {
            console.error("Booking cancellation email error:", emailErr);
        });

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
        if (connection) {
            try {
                await connection.rollback();
            } catch (rbErr) {
                console.error("Guest cancel rollback error:", rbErr);
            }
        }
        return next(err);
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Error-handling middleware for guest routes
guestRouter.use((err, req, res, next) => {
    console.error("Guest route error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/");
});

export default guestRouter;
