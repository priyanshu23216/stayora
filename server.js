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

// Trust first reverse proxy in production (so req.ip and secure cookies work behind Nginx/Render/Cloudflare)
if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/boilerplate.ejs");

// Security headers & Content Security Policy
app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "img-src": ["'self'", "data:", "https://images.unsplash.com", "https://res.cloudinary.com"],
                "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
                "frame-ancestors": ["'self'"],
            },
        },
    })
);

// Serve static assets before session/passport middleware
app.use(express.static(path.join(__dirname, "public")));

// Global abuse protection rate limiter (generous for normal browsing, stops flooding)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
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

app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));
app.use(methodOverride("_method"));
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// Expose flash & current user globally before CSRF (so 403 error page has layout locals)
app.use((req, res, next) => {
    res.locals.currentUser = req.user || null;
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.jarvis = req.flash("jarvis");
    next();
});

// Synchronizer-token CSRF protection + Origin/Referer verification
app.use(csrfProtection);

app.use("/authenticate", users);
app.use("/listings", lists);
app.use("/host", hostRoutes);
app.use("/guest", guestRoutes);
app.use("/admin", adminRoutes);
app.use("/bookings", bookingRoutes);
app.use("/", pageRoutes);

app.get("/", (req, res) => {
    res.render("index", { title: "Home" });
});

// 404 Not Found handler
app.use((req, res) => {
    res.status(404).render("pages/error", {
        title: "404 Not Found",
        statusCode: 404,
        heading: "Page not found",
        message: "The page you are looking for does not exist or may have been moved.",
    });
});

// Global error handler (never leaks stack traces to clients)
app.use((err, req, res, next) => {
    console.error("Unhandled application error:", err);
    if (res.headersSent) {
        return next(err);
    }
    return res.status(err.status || 500).render("pages/error", {
        title: "Something went wrong",
        statusCode: err.status || 500,
        heading: "Something went wrong",
        message: "An unexpected error occurred on our end. Please try again in a moment.",
    });
});


app.listen(process.env.PORT, () => {
    console.log(`Server is listening on port ${PORT}`);
});
