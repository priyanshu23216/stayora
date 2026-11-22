import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn } from "../middlewares/auth.js";

const bookingRouter = express.Router();

// Protect all /bookings/* routes: user must be logged in to book a room
bookingRouter.use(isLoggedIn);

// Booking page for a specific room (triggered by "Book This Room" button)
// Full URL: GET /bookings/new/:roomId
bookingRouter.get("/new/:roomId", async (req, res, next) => {
    try {
        const roomId = req.params.roomId;

        // Fetch room + its property details here and render your booking form page
        // Example: return res.render("bookings/new", { ... });
        return res.send(`Booking page for Room ID: ${roomId}`);
    } catch (err) {
        return next(err);
    }
});

// Error-handling middleware for booking routes
bookingRouter.use((err, req, res, next) => {
    req.flash("error", "Something went wrong with your booking. Please try again.");
    return res.redirect("/listings");
});

export default bookingRouter;
