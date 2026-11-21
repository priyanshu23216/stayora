import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn, isAdmin } from "../middlewares/auth.js";

const adminRouter = express.Router();

// Protect all /admin/* routes: user must be logged in and have ROLE === "admin"
adminRouter.use(isLoggedIn, isAdmin);

// Admin routes will go here, e.g.:
// adminRouter.get("/dashboard", async (req, res, next) => { ... });
// adminRouter.patch("/listings/:id/verify", async (req, res, next) => { ... });

// Error-handling middleware for admin routes
adminRouter.use((err, req, res, next) => {
    console.error("Admin route error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/");
});

export default adminRouter;
