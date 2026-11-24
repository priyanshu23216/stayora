import express from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import { isLoggedIn, isGuest, isValidUuid } from "../middlewares/auth.js";
import { sendBookingConfirmation } from "../utils/mailer.js";
import { bookingSchema } from "../utils/validator.js";
import { atomicIncrWithExpiry } from "../utils/redisHelpers.js";

const bookingRouter = express.Router();

const MAX_STAY_NIGHTS = 60;
const MAX_ADVANCE_BOOKING_DAYS = 365;
const MAX_ACTIVE_BOOKINGS_PER_USER = 15;

// Protect all /bookings/* routes: user must be logged in as a guest or host
bookingRouter.use(isLoggedIn, isGuest);

function formatLocalIsoDate(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Computes peak concurrent occupancy on any single night in [checkIn, checkOut)
export function getPeakNightlyOccupancy(overlappingBookings, checkInStr, nights) {
    const startMs = new Date(`${checkInStr}T00:00:00Z`).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    let maxOccupied = 0;

    for (let i = 0; i < nights; i++) {
        const nightDateStr = new Date(startMs + i * dayMs).toISOString().slice(0, 10);
        let occupiedThisNight = 0;
        for (const b of overlappingBookings) {
            if (b.CHECK_IN_DATE <= nightDateStr && b.CHECK_OUT_DATE > nightDateStr) {
                occupiedThisNight++;
            }
        }
        if (occupiedThisNight > maxOccupied) {
            maxOccupied = occupiedThisNight;
        }
    }

    return maxOccupied;
}

// Atomic booking rate limiter (stops inventory-exhaustion flooding)
async function bookingRateLimiter(req, res, next) {
    try {
        const key = `booking:create:${req.user.ID}:${req.ip}`;
        const count = await atomicIncrWithExpiry(key, 900);
        if (count > 10) {
            req.flash("error", "Too many booking attempts. Please wait 15 minutes before trying again.");
            return res.redirect("/listings");
        }
        return next();
    } catch (err) {
        return next(err);
    }
}

// 1. GET /bookings/new/:roomId -> Show booking form page for a specific room
bookingRouter.get("/new/:roomId", async (req, res, next) => {
    try {
        const roomId = req.params.roomId;
        if (!isValidUuid(roomId)) {
            req.flash("error", "Room not found.");
            return res.redirect("/listings");
        }

        const [roomRows] = await db.execute(
            `SELECT rooms.*,
                    properties.ID AS property_id,
                    properties.title AS property_title,
                    properties.image AS property_image,
                    properties.location AS property_location,
                    properties.city AS property_city,
                    properties.state AS property_state,
                    properties.check_in_time,
                    properties.check_out_time,
                    properties.cancellation_policy,
                    properties.AVAILABILITY_STATUS,
                    properties.verification_status,
                    properties.HOST_ID
             FROM rooms
             JOIN properties ON rooms.property_id = properties.ID
             WHERE rooms.ID = ?`,
            [roomId]
        );

        if (roomRows.length === 0) {
            req.flash("error", "Room not found.");
            return res.redirect("/listings");
        }

        const room = roomRows[0];

        if (room.verification_status !== "approved") {
            req.flash("error", "This property is not available for booking.");
            return res.redirect("/listings");
        }

        if (room.AVAILABILITY_STATUS !== "available" || room.TOTAL_ROOMS < 1) {
            req.flash("error", "This property is currently unavailable for booking.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        if (room.HOST_ID === req.user.ID) {
            req.flash("error", "You cannot book your own property.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        const [imageRows] = await db.execute(
            `SELECT IMAGE_URL FROM room_images WHERE ROOM_ID = ? LIMIT 1`,
            [roomId]
        );

        const roomImage = imageRows.length > 0 ? imageRows[0].IMAGE_URL : room.property_image;
        const today = formatLocalIsoDate(new Date());

        return res.render("bookings/new", {
            title: `Book ${room.ROOM_TYPE}`,
            room,
            roomImage,
            today,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. POST /bookings/new/:roomId -> Validate, lock room row, check peak nightly occupancy & confirm booking
bookingRouter.post("/new/:roomId", bookingRateLimiter, async (req, res, next) => {
    const roomId = req.params.roomId;
    if (!isValidUuid(roomId)) {
        req.flash("error", "Invalid room selected.");
        return res.redirect("/listings");
    }

    // Step 1: Strict Zod validation (rejects rollover dates, non-integers, HPP arrays)
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) {
        req.flash("error", parsed.error.issues[0].message);
        return res.redirect(`/bookings/new/${roomId}`);
    }

    const { checkIn, checkOut, guests } = parsed.data;

    const now = new Date();
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const checkInDate = new Date(`${checkIn}T00:00:00`);
    const checkOutDate = new Date(`${checkOut}T00:00:00`);

    if (checkInDate < todayDate) {
        req.flash("error", "Check-in date cannot be in the past.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    if (checkOutDate <= checkInDate) {
        req.flash("error", "Check-out date must be after check-in date.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    const dayMs = 1000 * 60 * 60 * 24;
    const nights = Math.round((checkOutDate - checkInDate) / dayMs);
    const daysInAdvance = Math.round((checkInDate - todayDate) / dayMs);

    if (nights > MAX_STAY_NIGHTS) {
        req.flash("error", `Stays cannot exceed ${MAX_STAY_NIGHTS} nights per booking.`);
        return res.redirect(`/bookings/new/${roomId}`);
    }

    if (daysInAdvance > MAX_ADVANCE_BOOKING_DAYS) {
        req.flash("error", `Bookings can only be made up to ${MAX_ADVANCE_BOOKING_DAYS} days in advance.`);
        return res.redirect(`/bookings/new/${roomId}`);
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Step 2: Lock room row FOR UPDATE to serialize concurrent bookings for this room
        const [roomRows] = await connection.execute(
            `SELECT rooms.*,
                    properties.title AS property_title,
                    properties.AVAILABILITY_STATUS,
                    properties.verification_status,
                    properties.HOST_ID,
                    properties.check_in_time,
                    properties.cancellation_policy
             FROM rooms
             JOIN properties ON rooms.property_id = properties.ID
             WHERE rooms.ID = ?
             FOR UPDATE`,
            [roomId]
        );

        if (roomRows.length === 0) {
            await connection.rollback();
            req.flash("error", "Room not found.");
            return res.redirect("/listings");
        }

        const room = roomRows[0];

        if (room.verification_status !== "approved" || room.AVAILABILITY_STATUS !== "available" || room.TOTAL_ROOMS < 1) {
            await connection.rollback();
            req.flash("error", "This property is currently not available for booking.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        if (room.HOST_ID === req.user.ID) {
            await connection.rollback();
            req.flash("error", "You cannot book your own property.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        // Reject same-day booking if check-in time has already passed
        const checkInParts = String(room.check_in_time || "13:00:00").split(":");
        const checkInDateTime = new Date(checkInDate.getTime());
        checkInDateTime.setHours(Number(checkInParts[0]) || 13, Number(checkInParts[1]) || 0, 0, 0);
        if (now >= checkInDateTime) {
            await connection.rollback();
            req.flash("error", "Check-in time for today has already passed. Please select a future date.");
            return res.redirect(`/bookings/new/${roomId}`);
        }

        if (guests > room.CAPACITY) {
            await connection.rollback();
            req.flash("error", `Maximum ${room.CAPACITY} guests are allowed in this room.`);
            return res.redirect(`/bookings/new/${roomId}`);
        }

        // Step 3: Cap total active future bookings per user (prevents inventory-exhaustion DoS)
        const [userActiveRows] = await connection.execute(
            `SELECT COUNT(*) AS activeCount
             FROM bookings
             WHERE USER_ID = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CHECK_OUT_DATE >= ?`,
            [req.user.ID, formatLocalIsoDate(todayDate)]
        );
        if (Number(userActiveRows[0].activeCount) >= MAX_ACTIVE_BOOKINGS_PER_USER) {
            await connection.rollback();
            req.flash("error", `You already have ${MAX_ACTIVE_BOOKINGS_PER_USER} active bookings. Please complete or cancel one before booking more.`);
            return res.redirect("/guest/dashboard");
        }

        // Step 4: Guard against accidental double-submit (identical booking created within last 2 minutes)
        const [dupRows] = await connection.execute(
            `SELECT ID FROM bookings
             WHERE USER_ID = ?
               AND ROOM_ID = ?
               AND CHECK_IN_DATE = ?
               AND CHECK_OUT_DATE = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CREATED_AT >= (NOW() - INTERVAL 2 MINUTE)
             LIMIT 1`,
            [req.user.ID, roomId, checkIn, checkOut]
        );
        if (dupRows.length > 0) {
            await connection.rollback();
            req.flash("error", "A matching booking was just submitted. Please check your dashboard.");
            return res.redirect("/guest/dashboard");
        }

        // Step 5: Accurate peak nightly occupancy check across every night in [checkIn, checkOut)
        const [overlappingBookings] = await connection.execute(
            `SELECT CHECK_IN_DATE, CHECK_OUT_DATE
             FROM bookings
             WHERE ROOM_ID = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CHECK_IN_DATE < ?
               AND CHECK_OUT_DATE > ?`,
            [roomId, checkOut, checkIn]
        );

        const peakOccupied = getPeakNightlyOccupancy(overlappingBookings, checkIn, nights);
        if (peakOccupied >= Number(room.TOTAL_ROOMS)) {
            await connection.rollback();
            req.flash("error", "Sorry, this room is sold out for one or more of the selected dates. Please try different dates.");
            return res.redirect(`/bookings/new/${roomId}`);
        }

        // Step 6: Calculate total amount securely on backend & snapshot cancellation policy
        const totalAmount = Number((nights * Number(room.PRICE_PER_NIGHT)).toFixed(2));
        const bookingId = uuidv4();
        const policySnapshot =
            room.cancellation_policy || "Flexible — Free cancellation up to 24 hours before check-in";

        await connection.execute(
            `INSERT INTO bookings (ID, USER_ID, ROOM_ID, CHECK_IN_DATE, CHECK_OUT_DATE, GUESTS, TOTAL_AMOUNT, STATUS, cancellation_policy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [bookingId, req.user.ID, roomId, checkIn, checkOut, guests, totalAmount, "confirmed", policySnapshot]
        );

        await connection.commit();

        // Step 7: Send confirmation email asynchronously so SMTP never delays/fails a committed booking
        db.execute(`SELECT NAME, EMAIL FROM users WHERE ID = ?`, [room.HOST_ID])
            .then(([hostRows]) => {
                const host = hostRows[0] || { NAME: "Stayora Host", EMAIL: "support@stayora.com" };
                return sendBookingConfirmation(req.user.EMAIL, {
                    bookingId,
                    hotelName: room.property_title,
                    roomType: room.ROOM_TYPE,
                    checkIn,
                    checkOut,
                    guests,
                    totalPrice: totalAmount,
                    hostName: host.NAME,
                    hostEmail: host.EMAIL,
                });
            })
            .catch((emailErr) => {
                console.error("Booking confirmation email error:", emailErr);
            });

        req.flash(
            "success",
            `Booking confirmed for ${nights} night(s)! Total amount: ₹${totalAmount}. A confirmation email has been sent to ${req.user.EMAIL}.`
        );
        return res.redirect("/guest/dashboard");
    } catch (err) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rbErr) {
                console.error("Booking rollback error:", rbErr);
            }
        }
        return next(err);
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Error-handling middleware for booking routes
bookingRouter.use((err, req, res, next) => {
    console.error("Booking route error:", err);
    req.flash("error", "Something went wrong with your booking. Please try again.");
    return res.redirect("/listings");
});

export default bookingRouter;
