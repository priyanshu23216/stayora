import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn } from "../middlewares/auth.js";

const guestRouter = express.Router();

// Protect all /guest/* routes: any logged-in user (guest, host, or admin) can view their own bookings & reviews
guestRouter.use(isLoggedIn);

// Guest routes will go here, e.g.:
// guestRouter.get("/dashboard", async (req, res, next) => { ... });
// guestRouter.get("/bookings", async (req, res, next) => { ... });

// Error-handling middleware for guest routes
guestRouter.use((err, req, res, next) => {
    console.error("Guest route error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/");
});

export default guestRouter;
