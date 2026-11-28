// Authentication routes: signup, OTP verification, login, Google OAuth, forgot/reset password, logout
import express from "express";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import crypto from "crypto";
import db from "../config/db.js";
import passport from "../config/passport.js";
import redis from "../config/redis.js";
import { atomicIncrWithExpiry } from "../utils/redisHelpers.js";
import { sendOtpEmail, resetPassEmail, passChangeAlertEmail } from "../utils/mailer.js";
import { signupSchema, loginCheck, resetPassword, emailValidator, otpValidator } from "../utils/validator.js";
import { ensureCsrfToken } from "../middlewares/csrf.js";
import { isLoggedIn } from "../middlewares/auth.js";
import "dotenv/config";

const router = express.Router();

const FOUNDER_EMAIL = (process.env.FOUNDER_EMAIL || "").toLowerCase().trim();
const OTP_EXPIRY_SECONDS = 600;       // 10 minutes
const MAX_OTP_WRONG_TRIES = 5;        // Invalidate OTP after 5 wrong guesses

// Helper 1: Compare two SHA-256 hex strings safely (prevents timing attacks)
function isHashMatching(hashA, hashB) {
    if (typeof hashA !== "string" || typeof hashB !== "string") {
        return false;
    }
    const bufA = Buffer.from(hashA, "utf8");
    const bufB = Buffer.from(hashB, "utf8");
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// Helper 2: Simple reusable IP rate limiter backed by Redis (blocks brute-force bots)
function makeIpLimiter(prefix, maxTries, windowSeconds, redirectUrl, message) {
    return async function (req, res, next) {
        try {
            const redisKey = `${prefix}:ip:${req.ip}`;
            const attempts = await atomicIncrWithExpiry(redisKey, windowSeconds);

            if (attempts > maxTries) {
                req.flash("error", message);
                return res.redirect(redirectUrl);
            }
            return next();
        } catch (err) {
            return next(err);
        }
    };
}

// IP Rate Limiters for each sensitive auth action (15-minute window = 900 seconds)
const signupLimiter = makeIpLimiter(
    "signup", 10, 900, "/authenticate/signup",
    "Too many signup attempts from this IP. Please try again after 15 minutes."
);
const loginIPlimiter = makeIpLimiter(
    "login", 30, 900, "/authenticate/login",
    "Too many login attempts from this IP. Please try again after 15 minutes."
);
const otpVerifyIPlimiter = makeIpLimiter(
    "otpVerify", 20, 900, "/authenticate/signup",
    "Too many OTP verification attempts from this IP. Please try again after 15 minutes."
);
const otpResendIPlimiter = makeIpLimiter(
    "otpResendIp", 10, 900, "/authenticate/signup",
    "Too many OTP resend requests from this IP. Please try again after 15 minutes."
);
const forgotPassIPlimiter = makeIpLimiter(
    "forgotPass", 10, 900, "/authenticate/forgot-password",
    "Too many password reset requests from this IP. Please try again after 15 minutes."
);
const resetPassIPlimiter = makeIpLimiter(
    "resetPass", 15, 900, "/authenticate/forgot-password",
    "Too many password reset attempts. Please try again after 15 minutes."
);

// Login limiter per (IP + email) so a remote attacker cannot lock out another user's account
async function loginEmailLimiter(req, res, next) {
    try {
        const validation = loginCheck.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", "Invalid email or password");
            return res.redirect("/authenticate/login");
        }

        const email = validation.data.email;
        const redisKey = `login:attempts:${req.ip}:${email}`;
        const attempts = await atomicIncrWithExpiry(redisKey, 900);

        if (attempts > 5) {
            req.flash("error", "Too many login attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/login");
        }

        // Save key on req so we can clear it once login succeeds
        req.loginRateLimitKey = redisKey;
        return next();
    } catch (err) {
        return next(err);
    }
}

// Forgot-password limiter per email (max 5 reset emails per 15 min)
async function forgotPassEmailLimiter(req, res, next) {
    try {
        const validation = emailValidator.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect("/authenticate/forgot-password");
        }

        const email = validation.data.email;
        const redisKey = `forgotPass:attempts:${email}`;
        const attempts = await atomicIncrWithExpiry(redisKey, 900);

        if (attempts > 5) {
            req.flash("error", "Too many password reset attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/forgot-password");
        }

        return next();
    } catch (err) {
        return next(err);
    }
}

/* ==========================================================================
   1. LOGIN ROUTES
   ========================================================================== */

router.get("/login", (req, res) => {
    res.render("auth/login", { title: "login" });
});

router.post(
    "/login/verify",
    loginIPlimiter,
    loginEmailLimiter,
    passport.authenticate("local", {
        failureRedirect: "/authenticate/login",
        failureFlash: true,
    }),
    async (req, res) => {
        // Generate CSRF token once when the logged-in session is created (never on GET)
        ensureCsrfToken(req);

        // Clear login attempt counter after successful login
        if (req.loginRateLimitKey) {
            try {
                await redis.del(req.loginRateLimitKey);
            } catch (err) {
                console.error("Failed to clear login counter:", err.message);
            }
        }

        if (FOUNDER_EMAIL && req.user.EMAIL === FOUNDER_EMAIL) {
            req.flash("jarvis", `Access granted. Welcome back, ${req.user.NAME}.`);
        } else {
            req.flash("success", `Welcome back, ${req.user.NAME}!`);
        }
        return res.redirect("/");
    }
);

/* ==========================================================================
   2. SIGNUP & OTP VERIFICATION ROUTES
   ========================================================================== */

router.get("/signup", (req, res) => {
    res.render("auth/signup", { title: "Sign Up" });
});

router.post("/signup/add", signupLimiter, async (req, res, next) => {
    try {
        // Step 1: Validate name, email, and strong password using Zod
        const validation = signupSchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect("/authenticate/signup");
        }

        const name = validation.data.name;
        const email = validation.data.email;
        const password = validation.data.password;

        // Step 2: Check if email is already registered
        const [existingUsers] = await db.execute(
            "SELECT ID FROM users WHERE EMAIL = ?",
            [email]
        );
        if (existingUsers.length > 0) {
            req.flash("error", "This email is already registered. Please login!");
            return res.redirect("/authenticate/signup");
        }

        // Step 3: Hash password & generate a random 6-digit OTP
        const id = uuidv4();
        const role = "guest";
        const passwordHash = await bcrypt.hash(password, 12);
        const otp = crypto.randomInt(100000, 1000000).toString();
        const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");

        // Step 4: Store hashed OTP and pending user data in Redis for 10 minutes
        const pendingSignup = JSON.stringify({ id, name, email, passwordHash, role });
        await redis.set(`otp:${email}`, hashedOTP, "EX", OTP_EXPIRY_SECONDS);
        await redis.set(`signup:pending:${email}`, pendingSignup, "EX", OTP_EXPIRY_SECONDS);
        await redis.del(`otp:fails:${email}`);

        // Step 5: Send OTP email
        await sendOtpEmail(email, otp);

        return res.render("auth/enter-otp", { title: "Verify OTP", email: email });
    } catch (err) {
        return next(err);
    }
});

router.post("/signup/verify-otp", otpVerifyIPlimiter, async (req, res, next) => {
    try {
        // Step 1: Validate email and 6-digit OTP format
        const validation = otpValidator.safeParse(req.body);
        if (!validation.success) {
            const firstIssue = validation.error.issues[0];
            let safeEmail = "";
            if (req.body && typeof req.body.email === "string") {
                safeEmail = req.body.email.toLowerCase().trim();
            }

            if (firstIssue.path[0] === "otp" && emailValidator.safeParse({ email: safeEmail }).success) {
                return res.render("auth/enter-otp", {
                    title: "Verify OTP",
                    email: safeEmail,
                    error: [firstIssue.message],
                });
            }

            req.flash("error", firstIssue.message);
            return res.redirect("/authenticate/signup");
        }

        const signupEmail = validation.data.email;
        const otp = validation.data.otp;

        // Step 2: Check pending signup session in Redis
        const pendingSignup = await redis.get(`signup:pending:${signupEmail}`);
        if (!pendingSignup) {
            req.flash("error", "Your signup session has expired. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        // Step 3: Check stored OTP hash in Redis
        const storedOtpHash = await redis.get(`otp:${signupEmail}`);
        if (!storedOtpHash) {
            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: signupEmail,
                error: ["Your OTP has expired or been invalidated. Please request a new code."],
            });
        }

        const enteredOtpHash = crypto.createHash("sha256").update(otp).digest("hex");

        // Step 4: If OTP is wrong, count failed guesses -> delete OTP after 5 wrong tries!
        if (!isHashMatching(enteredOtpHash, storedOtpHash)) {
            const failCount = await atomicIncrWithExpiry(`otp:fails:${signupEmail}`, OTP_EXPIRY_SECONDS);

            if (failCount >= MAX_OTP_WRONG_TRIES) {
                await redis.del(`otp:${signupEmail}`);
                return res.render("auth/enter-otp", {
                    title: "Verify OTP",
                    email: signupEmail,
                    error: ["Too many incorrect OTP attempts. Please request a new verification code."],
                });
            }

            const triesLeft = MAX_OTP_WRONG_TRIES - failCount;
            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: signupEmail,
                error: [`Incorrect OTP. ${triesLeft} attempt(s) remaining.`],
            });
        }

        // Step 5: OTP matched! Immediately delete all temporary Redis keys so OTP cannot be reused
        await redis.del(
            `otp:${signupEmail}`,
            `signup:pending:${signupEmail}`,
            `otp:fails:${signupEmail}`,
            `otpResend:${signupEmail}`
        );

        // Step 6: Save verified user in MySQL and log them in
        const userData = JSON.parse(pendingSignup);
        await db.execute(
            "INSERT INTO users (ID, NAME, EMAIL, PASSWORD, ROLE, IS_VERIFIED, session_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [userData.id, userData.name, userData.email, userData.passwordHash, userData.role, 1, 1]
        );

        const loggedInUser = {
            ID: userData.id,
            NAME: userData.name,
            EMAIL: userData.email,
            ROLE: userData.role,
            session_version: 1,
        };

        req.login(loggedInUser, (err) => {
            if (err) {
                return next(err);
            }
            ensureCsrfToken(req);
            req.flash("success", `Welcome to Stayora, ${userData.name}!`);
            return res.redirect("/");
        });
    } catch (err) {
        return next(err);
    }
});

router.post("/signup/resend-otp", otpResendIPlimiter, async (req, res, next) => {
    try {
        const validation = emailValidator.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", "Invalid email. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        const email = validation.data.email;
        const pendingSignup = await redis.get(`signup:pending:${email}`);
        if (!pendingSignup) {
            req.flash("error", "Your session has expired. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        // Allow max 3 OTP resends per 15 minutes for this email
        const resendCount = await atomicIncrWithExpiry(`otpResend:${email}`, 900);
        if (resendCount > 3) {
            req.flash("error", "You have exceeded the maximum number of OTP resend attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/signup");
        }

        // Generate fresh OTP & reset failed-guess counter
        const otp = crypto.randomInt(100000, 1000000).toString();
        const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");
        await redis.set(`otp:${email}`, hashedOTP, "EX", OTP_EXPIRY_SECONDS);
        await redis.del(`otp:fails:${email}`);

        await sendOtpEmail(email, otp);

        return res.render("auth/enter-otp", {
            title: "Verify OTP",
            email: email,
            success: ["A new OTP has been sent to your email."],
        });
    } catch (err) {
        return next(err);
    }
});

/* ==========================================================================
   3. GOOGLE OAUTH ROUTES
   ========================================================================== */

router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
    "/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/authenticate/login",
        failureFlash: true,
    }),
    (req, res) => {
        ensureCsrfToken(req);
        if (FOUNDER_EMAIL && req.user.EMAIL === FOUNDER_EMAIL) {
            req.flash("jarvis", `Access granted. Welcome back, ${req.user.NAME}.`);
        } else {
            req.flash("success", `Welcome to Stayora, ${req.user.NAME}!`);
        }
        return res.redirect("/");
    }
);

/* ==========================================================================
   4. FORGOT PASSWORD & RESET PASSWORD ROUTES
   ========================================================================== */

router.get("/forgot-password", (req, res) => {
    res.render("auth/forgot-password", { title: "Forgot Password" });
});

router.post("/forgot-password/submit", forgotPassIPlimiter, forgotPassEmailLimiter, async (req, res, next) => {
    try {
        const validation = emailValidator.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect("/authenticate/forgot-password");
        }

        const email = validation.data.email;
        const [rows] = await db.execute("SELECT ID, PASSWORD FROM users WHERE EMAIL = ?", [email]);
        const user = rows[0];

        // Always show the exact same message so attackers cannot guess which emails are registered
        const genericMessage =
            "If an account with that email exists, a password reset link has been sent to your inbox.";

        if (!user) {
            req.flash("success", genericMessage);
            return res.redirect("/authenticate/forgot-password");
        }

        // Send email in the background (without await) so response time stays identical for all emails
        if (!user.PASSWORD) {
            resetPassEmail(
                email,
                "Your Stayora account uses Google Sign-In, so there's no password to reset. Use Continue with Google to log in."
            ).catch((err) => console.error("Google reset notice email error:", err));

            req.flash("success", genericMessage);
            return res.redirect("/authenticate/forgot-password");
        }

        // Create a secure random reset token and save its SHA-256 hash in Redis for 10 minutes
        const token = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
        await redis.set(`resetPass:${hashedToken}`, email, "EX", 600);

        const resetLink = `${process.env.APP_URL}/authenticate/forgot-password/${token}`;
        resetPassEmail(email, resetLink).catch((err) =>
            console.error("Password reset email error:", err)
        );

        req.flash("success", genericMessage);
        return res.redirect("/authenticate/forgot-password");
    } catch (err) {
        return next(err);
    }
});

router.get("/forgot-password/:token", resetPassIPlimiter, async (req, res, next) => {
    try {
        const token = req.params.token;

        // Reset token must be a 64-character hex string
        if (!/^[a-f0-9]{64}$/i.test(token)) {
            req.flash("error", "Reset link is invalid or expired.");
            return res.redirect("/authenticate/forgot-password");
        }

        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
        const email = await redis.get(`resetPass:${hashedToken}`);

        if (!email) {
            req.flash("error", "Reset link is invalid or expired.");
            return res.redirect("/authenticate/forgot-password");
        }

        return res.render("auth/reset-password", { title: "Reset Password", token: token });
    } catch (err) {
        return next(err);
    }
});

router.post("/reset-password/:token", resetPassIPlimiter, async (req, res, next) => {
    try {
        const token = req.params.token;
        if (!/^[a-f0-9]{64}$/i.test(token)) {
            req.flash("error", "Reset link is invalid or expired.");
            return res.redirect("/authenticate/forgot-password");
        }

        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
        const email = await redis.get(`resetPass:${hashedToken}`);

        if (!email) {
            req.flash("error", "Reset link is invalid or expired. Please request a new one.");
            return res.redirect("/authenticate/forgot-password");
        }

        const validation = resetPassword.safeParse(req.body);
        if (!validation.success) {
            return res.render("auth/reset-password", {
                title: "Reset Password",
                token: token,
                error: [validation.error.issues[0].message],
            });
        }

        const hashedPass = await bcrypt.hash(validation.data.password, 12);

        // Save new password AND bump session_version (+1) to log out all old devices/sessions immediately
        await db.execute(
            "UPDATE users SET PASSWORD = ?, session_version = session_version + 1 WHERE EMAIL = ?",
            [hashedPass, email]
        );
        await redis.del(`resetPass:${hashedToken}`);
        await redis.del(`login:attempts:${req.ip}:${email}`);

        passChangeAlertEmail(email).catch((err) =>
            console.error("Password change alert email error:", err)
        );

        req.flash("success", "Your password has been changed. Please log in with your new password.");
        return res.redirect("/authenticate/login");
    } catch (err) {
        return next(err);
    }
});

/* ==========================================================================
   5. LOGOUT ROUTE (POST + CSRF-protected)
   ========================================================================== */

router.post("/logout", isLoggedIn, (req, res, next) => {
    // Passport 0.7 automatically regenerates & clears the old Redis session
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.flash("success", "You have been logged out successfully!");
        return res.redirect("/");
    });
});

// Error handling middleware for auth routes
router.use((err, req, res, next) => {
    console.error("Auth route error:", err);
    req.flash("error", "An unexpected error occurred. Please try again.");
    return res.redirect("/");
});

export default router;
