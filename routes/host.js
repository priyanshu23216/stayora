import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn, isHost } from "../middlewares/auth.js";

const hostRouter = express.Router();

// Protect all /host/* routes: user must be logged in and have ROLE === "host"
hostRouter.use(isLoggedIn, isHost);

// Host routes will go here, e.g.:
// hostRouter.get("/dashboard", async (req, res, next) => { ... });
// hostRouter.get("/listings/new", ...);
// hostRouter.post("/listings", ...);

// Error-handling middleware for host routes
hostRouter.use((err, req, res, next) => {
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/");
});

export default hostRouter;
