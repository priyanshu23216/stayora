import express from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import { isLoggedIn, isGuest, isValidUuid } from "../middlewares/auth.js";
import { sendBookingConfirmation } from "../utils/mailer.js";
import { bookingSchema } from "../utils/validator.js";
import { atomicIncrWithExpiry } from "../utils/redisHelpers.js";

const bookingRouter = express.Router();

const MAX_STAY_NIGHTS = 60;           // Max nights in a single booking
const MAX_ADVANCE_BOOKING_DAYS = 365; // Cannot book more than 1 year in advance
const MAX_ACTIVE_BOOKINGS = 15;       // Max upcoming bookings allowed per user

// Protect all /bookings/* routes: user must be logged in as a guest or host
bookingRouter.use(isLoggedIn, isGuest);

// Helper 1: Format a JS Date as "YYYY-MM-DD" in local time
function formatTodayDate(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

// Helper 2: Check every single night between checkIn and checkOut, and find the busiest night.
// Example: If room has 2 units, Guest A booked Dec 1-3 and Guest B booked Dec 3-5,
// then on any single night between Dec 1-5 only 1 unit is occupied -> so Guest C CAN still book Dec 1-5!
export function getPeakNightlyOccupancy(overlappingBookings, checkInStr, nights) {
    const startMs = new Date(`${checkInStr}T00:00:00Z`).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    let busiestNightCount = 0;

    for (let i = 0; i < nights; i++) {
        const currentNight = new Date(startMs + i * oneDayMs).toISOString().slice(0, 10);
        let roomsUsedThisNight = 0;

        for (let booking of overlappingBookings) {
            if (booking.CHECK_IN_DATE <= currentNight && booking.CHECK_OUT_DATE > currentNight) {
                roomsUsedThisNight++;
            }
        }

        if (roomsUsedThisNight > busiestNightCount) {
            busiestNightCount = roomsUsedThisNight;
        }
    }

    return busiestNightCount;
}

// Rate limiter: Max 10 booking attempts per 15 minutes per user
async function bookingRateLimiter(req, res, next) {
    try {
        const redisKey = `booking:create:${req.user.ID}:${req.ip}`;
        const attempts = await atomicIncrWithExpiry(redisKey, 900);

        if (attempts > 10) {
            req.flash("error", "Too many booking attempts. Please wait 15 minutes before trying again.");
            return res.redirect("/listings");
        }
        return next();
    } catch (err) {
        return next(err);
    }
}

// 1. GET /bookings/new/:roomId -> Show booking checkout page for a specific room
bookingRouter.get("/new/:roomId", async (req, res, next) => {
    try {
        const roomId = req.params.roomId;
        if (!isValidUuid(roomId)) {
            req.flash("error", "Room not found.");
            return res.redirect("/listings");
        }

        const roomResult = await db.execute(
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
        const roomRows = roomResult[0];

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

        // Prevent host from booking their own property
        if (room.HOST_ID === req.user.ID) {
            req.flash("error", "You cannot book your own property.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        const imageResult = await db.execute(
            `SELECT IMAGE_URL FROM room_images WHERE ROOM_ID = ? LIMIT 1`,
            [roomId]
        );

        let roomImage = room.property_image;
        if (imageResult[0].length > 0) {
            roomImage = imageResult[0][0].IMAGE_URL;
        }

        const today = formatTodayDate(new Date());

        return res.render("bookings/new", {
            title: `Book ${room.ROOM_TYPE}`,
            room: room,
            roomImage: roomImage,
            today: today,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. POST /bookings/new/:roomId -> Validate, lock room row, check availability & confirm booking
bookingRouter.post("/new/:roomId", bookingRateLimiter, async (req, res, next) => {
    const roomId = req.params.roomId;
    if (!isValidUuid(roomId)) {
        req.flash("error", "Invalid room selected.");
        return res.redirect("/listings");
    }

    // Step 1: Validate checkIn, checkOut, and guests using Zod
    const validation = bookingSchema.safeParse(req.body);
    if (!validation.success) {
        req.flash("error", validation.error.issues[0].message);
        return res.redirect(`/bookings/new/${roomId}`);
    }

    const checkIn = validation.data.checkIn;
    const checkOut = validation.data.checkOut;
    const guests = validation.data.guests;

    // Step 2: Check date logic (no past dates, checkOut > checkIn, max 60 nights, max 365 days advance)
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

    const oneDayMs = 1000 * 60 * 60 * 24;
    const nights = Math.round((checkOutDate - checkInDate) / oneDayMs);
    const daysInAdvance = Math.round((checkInDate - todayDate) / oneDayMs);

    if (nights > MAX_STAY_NIGHTS) {
        req.flash("error", `Stays cannot exceed ${MAX_STAY_NIGHTS} nights per booking.`);
        return res.redirect(`/bookings/new/${roomId}`);
    }

    if (daysInAdvance > MAX_ADVANCE_BOOKING_DAYS) {
        req.flash("error", `Bookings can only be made up to ${MAX_ADVANCE_BOOKING_DAYS} days in advance.`);
        return res.redirect(`/bookings/new/${roomId}`);
    }

    // Step 3: Start a MySQL transaction on 1 dedicated connection
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Step 4: Lock this room row (FOR UPDATE) so 2 users cannot double-book the last room at the same time
        const roomResult = await connection.execute(
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

        if (roomResult[0].length === 0) {
            await connection.rollback();
            req.flash("error", "Room not found.");
            return res.redirect("/listings");
        }

        const room = roomResult[0][0];

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

        // Reject same-day booking if check-in time for today has already passed
        const timeParts = String(room.check_in_time || "13:00:00").split(":");
        const checkInDateTime = new Date(checkInDate.getTime());
        checkInDateTime.setHours(Number(timeParts[0]) || 13, Number(timeParts[1]) || 0, 0, 0);

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

        // Step 5: Prevent one user from hoarding too many active upcoming bookings
        const userActiveResult = await connection.execute(
            `SELECT COUNT(*) AS activeCount
             FROM bookings
             WHERE USER_ID = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CHECK_OUT_DATE >= ?`,
            [req.user.ID, formatTodayDate(todayDate)]
        );
        if (Number(userActiveResult[0][0].activeCount) >= MAX_ACTIVE_BOOKINGS) {
            await connection.rollback();
            req.flash("error", `You already have ${MAX_ACTIVE_BOOKINGS} active bookings. Please complete or cancel one first.`);
            return res.redirect("/guest/dashboard");
        }

        // Step 6: Prevent accidental double-click duplicate booking within 2 minutes
        const duplicateResult = await connection.execute(
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
        if (duplicateResult[0].length > 0) {
            await connection.rollback();
            req.flash("error", "A matching booking was just submitted. Please check your dashboard.");
            return res.redirect("/guest/dashboard");
        }

        // Step 7: Check peak occupancy across every single night in [checkIn, checkOut)
        const overlapResult = await connection.execute(
            `SELECT CHECK_IN_DATE, CHECK_OUT_DATE
             FROM bookings
             WHERE ROOM_ID = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CHECK_IN_DATE < ?
               AND CHECK_OUT_DATE > ?`,
            [roomId, checkOut, checkIn]
        );

        const peakOccupied = getPeakNightlyOccupancy(overlapResult[0], checkIn, nights);
        if (peakOccupied >= Number(room.TOTAL_ROOMS)) {
            await connection.rollback();
            req.flash("error", "Sorry, this room is sold out for one or more of the selected dates. Please try different dates.");
            return res.redirect(`/bookings/new/${roomId}`);
        }

        // Step 8: Calculate price on backend & save a snapshot of the property's cancellation policy
        const totalAmount = Number((nights * Number(room.PRICE_PER_NIGHT)).toFixed(2));
        const bookingId = uuidv4();
        const policySnapshot =
            room.cancellation_policy || "Flexible — Free cancellation up to 24 hours before check-in";

        await connection.execute(
            `INSERT INTO bookings (ID, USER_ID, ROOM_ID, CHECK_IN_DATE, CHECK_OUT_DATE, GUESTS, TOTAL_AMOUNT, STATUS, cancellation_policy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [bookingId, req.user.ID, roomId, checkIn, checkOut, guests, totalAmount, "confirmed", policySnapshot]
        );

        // Step 9: Commit transaction and release row lock
        await connection.commit();

        // Step 10: Send confirmation email in background (never fails an already-committed booking)
        db.execute(`SELECT NAME, EMAIL FROM users WHERE ID = ?`, [room.HOST_ID])
            .then(([hostRows]) => {
                let host = { NAME: "Stayora Host", EMAIL: "support@stayora.com" };
                if (hostRows.length > 0) {
                    host = hostRows[0];
                }
                return sendBookingConfirmation(req.user.EMAIL, {
                    bookingId: bookingId,
                    hotelName: room.property_title,
                    roomType: room.ROOM_TYPE,
                    checkIn: checkIn,
                    checkOut: checkOut,
                    guests: guests,
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
