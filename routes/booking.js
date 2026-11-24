import express from "express";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import { isLoggedIn } from "../middlewares/auth.js";
import { sendBookingConfirmation } from "../utils/mailer.js";

const bookingRouter = express.Router();

// Protect all /bookings/* routes: user must be logged in to book a room
bookingRouter.use(isLoggedIn);

// 1. GET /bookings/new/:roomId -> Show booking form page for a specific room
bookingRouter.get("/new/:roomId", async (req, res, next) => {
    try {
        const roomId = req.params.roomId;

        // Fetch room details along with its property details
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

        // Check if property is approved and available
        if (room.verification_status !== "approved") {
            req.flash("error", "This property is not available for booking.");
            return res.redirect("/listings");
        }

        if (room.AVAILABILITY_STATUS !== "available") {
            req.flash("error", "This property is currently unavailable for booking.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        // Prevent host from booking their own property
        if (req.user && room.HOST_ID === req.user.ID) {
            req.flash("error", "You cannot book your own property.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        // Fetch 1 cover photo for this room (fallback to property image if none)
        const imageResult = await db.execute(
            `SELECT IMAGE_URL FROM room_images WHERE ROOM_ID = ? LIMIT 1`,
            [roomId]
        );
        const imageRows = imageResult[0];

        let roomImage = room.property_image;
        if (imageRows.length > 0) {
            roomImage = imageRows[0].IMAGE_URL;
        }

        // Today's date in YYYY-MM-DD format for calendar min attribute
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const today = `${year}-${month}-${day}`;

        return res.render("bookings/new", {
            title: `Book ${room.ROOM_TYPE}`,
            room: room,
            roomImage: roomImage,
            today: today
        });
    } catch (err) {
        return next(err);
    }
});

// 2. POST /bookings/new/:roomId -> Validate, lock room row, check availability & confirm booking
bookingRouter.post("/new/:roomId", async (req, res, next) => {
    const roomId = req.params.roomId;
    const checkIn = req.body.checkIn;
    const checkOut = req.body.checkOut;
    const guests = parseInt(req.body.guests);

    // Step 1: Basic form validation before touching database
    if (!checkIn || !checkOut || !guests) {
        req.flash("error", "Please select check-in date, check-out date, and guests.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    const checkInDate = new Date(checkIn + "T00:00:00");
    const checkOutDate = new Date(checkOut + "T00:00:00");
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
        req.flash("error", "Please enter valid dates.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    if (checkInDate < todayDate) {
        req.flash("error", "Check-in date cannot be in the past.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    if (checkOutDate <= checkInDate) {
        req.flash("error", "Check-out date must be after check-in date.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    if (guests < 1) {
        req.flash("error", "At least 1 guest is required.");
        return res.redirect(`/bookings/new/${roomId}`);
    }

    // Calculate total number of nights
    const diffInMs = checkOutDate - checkInDate;
    const nights = Math.round(diffInMs / (1000 * 60 * 60 * 24));

    // Step 2: Borrow 1 dedicated connection from pool for the transaction
    const connection = await db.getConnection();

    try {
        // Step 3: Start SQL Transaction
        await connection.beginTransaction();

        // Step 4: Fetch room + property and LOCK this room row (FOR UPDATE)
        const roomResult = await connection.execute(
            `SELECT rooms.*,
                    properties.title AS property_title,
                    properties.AVAILABILITY_STATUS,
                    properties.verification_status,
                    properties.HOST_ID
             FROM rooms
             JOIN properties ON rooms.property_id = properties.ID
             WHERE rooms.ID = ?
             FOR UPDATE`,
            [roomId]
        );
        const roomRows = roomResult[0];

        if (roomRows.length === 0) {
            await connection.rollback();
            req.flash("error", "Room not found.");
            return res.redirect("/listings");
        }

        const room = roomRows[0];

        if (room.verification_status !== "approved" || room.AVAILABILITY_STATUS !== "available") {
            await connection.rollback();
            req.flash("error", "This property is currently not available for booking.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        if (room.HOST_ID === req.user.ID) {
            await connection.rollback();
            req.flash("error", "You cannot book your own property.");
            return res.redirect(`/listings/${room.property_id}`);
        }

        // Step 5: Check guests capacity
        if (guests > room.CAPACITY) {
            await connection.rollback();
            req.flash("error", `Maximum ${room.CAPACITY} guests are allowed in this room.`);
            return res.redirect(`/bookings/new/${roomId}`);
        }

        // Step 6: Count overlapping active bookings for this room and selected dates
        const overlapResult = await connection.execute(
            `SELECT COUNT(*) AS bookedCount
             FROM bookings
             WHERE ROOM_ID = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CHECK_IN_DATE < ?
               AND CHECK_OUT_DATE > ?`,
            [roomId, checkOut, checkIn]
        );
        const bookedCount = overlapResult[0][0].bookedCount;

        // Calculate remaining available rooms
        const availableRooms = room.TOTAL_ROOMS - bookedCount;

        if (availableRooms < 1) {
            await connection.rollback();
            req.flash("error", "Sorry, this room is sold out for the selected dates. Please try different dates.");
            return res.redirect(`/bookings/new/${roomId}`);
        }

        // Step 7: Calculate total amount securely on backend
        const totalAmount = nights * Number(room.PRICE_PER_NIGHT);
        const bookingId = uuidv4();

        // Step 8: Insert confirmed booking into database
        await connection.execute(
            `INSERT INTO bookings (ID, USER_ID, ROOM_ID, CHECK_IN_DATE, CHECK_OUT_DATE, GUESTS, TOTAL_AMOUNT, STATUS)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [bookingId, req.user.ID, roomId, checkIn, checkOut, guests, totalAmount, "confirmed"]
        );

        // Step 9: Commit transaction (saves booking permanently and releases row lock)
        await connection.commit();

        // Step 10: Fetch host details and send booking confirmation email to the guest
        try {
            const hostResult = await db.execute(
                `SELECT NAME, EMAIL FROM users WHERE ID = ?`,
                [room.HOST_ID]
            );
            const host = hostResult[0][0];

            await sendBookingConfirmation(req.user.EMAIL, {
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
        } catch (emailErr) {
            // Do not fail the already-committed booking if email delivery fails
            console.error("Booking confirmation email error:", emailErr);
        }

        req.flash("success", `Booking confirmed for ${nights} night(s)! Total amount: ₹${totalAmount}. A confirmation email has been sent to ${req.user.EMAIL}.`);
        return res.redirect("/guest/dashboard");
    } catch (err) {
        // Undo changes and release lock if any unexpected error occurs
        await connection.rollback();
        return next(err);
    } finally {
        // Always return connection back to pool
        connection.release();
    }
});

// Error-handling middleware for booking routes
bookingRouter.use((err, req, res, next) => {
    console.error("Booking route error:", err);
    req.flash("error", "Something went wrong with your booking. Please try again.");
    return res.redirect("/listings");
});

export default bookingRouter;
