import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import methodOverride from "method-override";
import expressLayouts from "express-ejs-layouts";
import sessionMiddleware from "./config/session.js";
import flash from "connect-flash";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import db from "./config/db.js";
import redis from "./config/redis.js";
import passport from "./config/passport.js";
import { csrfProtection } from "./middlewares/csrf.js";

import users from "./routes/authentication.js";
import lists from "./routes/listings.js";
import hostRoutes from "./routes/host.js";
import guestRoutes from "./routes/guest.js";
import adminRoutes from "./routes/admin.js";
import bookingRoutes from "./routes/booking.js";
import pageRoutes from "./routes/pages.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Step 1: Trust proxy in production (needed when hosted behind Nginx/Render/Cloudflare)
if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
}

// Step 2: Setup EJS view engine and shared layout
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/boilerplate.ejs");

// Step 3: Security HTTP headers (Helmet + Content Security Policy to block XSS & clickjacking)
// Note: Helmet defaults Referrer-Policy to "no-referrer", which causes browsers to send
// "Origin: null" on same-site POST form submissions and fail Origin === Host CSRF checks.
app.use(
    helmet({
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "img-src": ["'self'", "data:", "https://images.unsplash.com", "https://res.cloudinary.com"],
                "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
                "frame-ancestors": ["'self'"],
                "upgrade-insecure-requests": process.env.NODE_ENV === "production" ? [] : null,
            },
        },
    })
);

// Step 4: Serve static files (CSS, JS, images) before sessions run
app.use(express.static(path.join(__dirname, "public")));

// Ignore browser background probes so they never hit session or route handlers
app.get("/favicon.ico", (req, res) => res.status(204).end());
app.use("/.well-known", (req, res) => res.status(204).end());

// Initialize safe EJS layout locals early so 429/413/400 error pages never crash navbar/boilerplate
app.use((req, res, next) => {
    res.locals.currentUser = null;
    res.locals.success = [];
    res.locals.error = [];
    res.locals.jarvis = [];
    res.locals.csrfToken = "";
    next();
});

// Step 5: Global rate limiter (blocks bot flooding across the whole site)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 600,               // max 600 requests per IP per 15 min
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        return res.status(429).render("pages/error", {
            title: "429 Too Many Requests",
            statusCode: 429,
            heading: "Too many requests",
            message: "You are sending requests too quickly. Please wait a few minutes and try again.",
        });
    },
});
app.use(globalLimiter);

// Step 6: Parse form data & JSON (limit size to 100kb to prevent large payload DoS)
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

// Step 7: Allow HTML forms to send PUT, PATCH, DELETE using ?_method=PUT etc.
app.use(methodOverride("_method"));

// Step 8: Sessions (stored in Redis), Passport login, and flash messages
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// Step 9: Make currentUser and flash messages available in all EJS pages.
// Note: We only call req.flash() if req.session.flash already exists, so unlogged-in visitors
// do NOT accidentally get a session cookie on every GET page load.
app.use((req, res, next) => {
    res.locals.currentUser = req.user || null;

    if (req.session && req.session.flash) {
        res.locals.success = req.flash("success");
        res.locals.error = req.flash("error");
        res.locals.jarvis = req.flash("jarvis");
    } else {
        res.locals.success = [];
        res.locals.error = [];
        res.locals.jarvis = [];
    }

    next();
});

// Step 10: CSRF Protection (generates csrfToken for logged-in users & verifies POST/PUT/PATCH/DELETE)
app.use(csrfProtection);

// Step 11: Mount all application routes
app.use("/authenticate", users);
app.use("/listings", lists);
app.use("/host", hostRoutes);
app.use("/guest", guestRoutes);
app.use("/admin", adminRoutes);
app.use("/bookings", bookingRoutes);
app.use("/", pageRoutes);

// Home page route
app.get("/", (req, res) => {
    res.render("index", { title: "Home" });
});

// Step 12: 404 Not Found handler (runs when no route matched)
app.use((req, res) => {
    res.status(404).render("pages/error", {
        title: "404 Not Found",
        statusCode: 404,
        heading: "Page not found",
        message: "The page you are looking for does not exist or may have been moved.",
    });
});

// Step 13: Global error handler (catches unexpected crashes without showing raw stack traces)
app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.status || err.statusCode || 500;
    if (statusCode >= 500) {
        console.error("Unhandled application error:", err);
    }

    let heading = "Something went wrong";
    let message = "An unexpected error occurred on our end. Please try again in a moment.";
    if (statusCode === 413) {
        heading = "Request too large";
        message = "The submitted data is too large. Please reduce the size and try again.";
    } else if (statusCode === 400) {
        heading = "Invalid request";
        message = "The request could not be processed because the data was malformed.";
    }

    return res.status(statusCode).render("pages/error", {
        title: `${statusCode} Error`,
        statusCode: statusCode,
        heading: heading,
        message: message,
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
