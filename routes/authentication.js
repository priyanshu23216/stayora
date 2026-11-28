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
import { signupSchema, loginCheck, resetPassword, emailValidator, otpValidator, signupIdValidator } from "../utils/validator.js";
import { ensureCsrfToken } from "../middlewares/csrf.js";
import { isLoggedIn } from "../middlewares/auth.js";
import "dotenv/config";

const router = express.Router();

const FOUNDER_EMAIL = (process.env.FOUNDER_EMAIL || "").toLowerCase().trim();
const TEN_MINUTES = 600;
const MAX_OTP_TRIES = 5;

// Helper 1: Normalize email for rate-limit keys only (blocks Gmail dot & +alias spam bypass)
function normalizeEmailForRateLimit(email) {
    let [name, domain] = email.toLowerCase().trim().split("@");
    name = name.split("+")[0];

    if (domain === "gmail.com" || domain === "googlemail.com") {
        name = name.replaceAll(".", "");
        domain = "gmail.com";
    }

    return `${name}@${domain}`;
}

// Helper 2: Compare two SHA-256 hex strings safely (prevents timing attacks)
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
        const result = signupSchema.safeParse(req.body);
        if (!result.success) {
            req.flash("error", result.error.issues[0].message);
            return res.redirect("/authenticate/signup");
        }

        const { name, email, password } = result.data;

        // Step 2: Check if email is already registered
        const [users] = await db.execute("SELECT ID FROM users WHERE EMAIL = ?", [email]);
        if (users.length > 0) {
            req.flash("error", "This email is already registered. Please login!");
            return res.redirect("/authenticate/signup");
        }

        // Step 3: Per-email OTP spam cap (max 5 OTP emails per 15 min across all IPs & Gmail aliases)
        const rateLimitEmail = normalizeEmailForRateLimit(email);
        const sentCount = await atomicIncrWithExpiry(`otpEmail:${rateLimitEmail}`, 900);
        if (sentCount > 5) {
            req.flash("error", "Too many verification codes requested for this email. Please try again after 15 minutes.");
            return res.redirect("/authenticate/signup");
        }

        // Step 4: Create unique signupId, 4-char Request Ref, password hash, and 6-digit OTP
        const signupId = uuidv4();
        const refCode = crypto.randomBytes(2).toString("hex").toUpperCase();
        const otp = crypto.randomInt(100000, 1000000).toString();
        const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
        const passwordHash = await bcrypt.hash(password, 12);

        const pendingUser = {
            id: uuidv4(),
            name,
            email,
            passwordHash,
            role: "guest",
            refCode,
        };

        // Step 5: Store OTP and pending signup in Redis under signupId (NOT email)
        await redis.set(`otp:${signupId}`, otpHash, "EX", TEN_MINUTES);
        await redis.set(`signup:${signupId}`, JSON.stringify(pendingUser), "EX", TEN_MINUTES);

        // Step 6: Send OTP email with refCode
        await sendOtpEmail(email, otp, refCode);

        return res.render("auth/enter-otp", {
            title: "Verify OTP",
            email,
            signupId,
            refCode,
        });
    } catch (err) {
        return next(err);
    }
});

router.post("/signup/verify-otp", otpVerifyIPlimiter, async (req, res, next) => {
    try {
        const { signupId, otp } = req.body;

        // Step 1: Validate signupId from hidden form field
        if (!signupIdValidator.safeParse({ signupId }).success) {
            req.flash("error", "Invalid signup session. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        // Step 2: Load pending signup from Redis using signupId
        const rawUser = await redis.get(`signup:${signupId}`);
        if (!rawUser) {
            req.flash("error", "Your signup session has expired. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }
        const user = JSON.parse(rawUser);

        // Step 3: Validate 6-digit OTP format
        const otpCheck = otpValidator.safeParse({ signupId, otp });
        if (!otpCheck.success) {
            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: user.email,
                signupId,
                refCode: user.refCode,
                error: [otpCheck.error.issues[0].message],
            });
        }

        // Step 4: Load stored OTP hash from Redis using signupId
        const savedHash = await redis.get(`otp:${signupId}`);
        if (!savedHash) {
            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: user.email,
                signupId,
                refCode: user.refCode,
                error: ["Your OTP has expired or been invalidated. Please request a new code."],
            });
        }

        const enteredHash = crypto.createHash("sha256").update(otpCheck.data.otp).digest("hex");

        // Step 5: Wrong OTP -> count failed tries and invalidate OTP after 5 wrong guesses
        if (!isHashMatching(enteredHash, savedHash)) {
            const tries = await atomicIncrWithExpiry(`otpFails:${signupId}`, TEN_MINUTES);

            if (tries >= MAX_OTP_TRIES) {
                await redis.del(`otp:${signupId}`);
                return res.render("auth/enter-otp", {
                    title: "Verify OTP",
                    email: user.email,
                    signupId,
                    refCode: user.refCode,
                    error: ["Too many incorrect OTP attempts. Please request a new verification code."],
                });
            }

            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: user.email,
                signupId,
                refCode: user.refCode,
                error: [`Incorrect OTP. ${MAX_OTP_TRIES - tries} attempt(s) remaining.`],
            });
        }

        // Step 6: OTP matched -> delete temporary Redis keys
        const rateLimitEmail = normalizeEmailForRateLimit(user.email);
        await redis.del(
            `otp:${signupId}`,
            `signup:${signupId}`,
            `otpFails:${signupId}`,
            `otpResend:${rateLimitEmail}`
        );

        // Step 7: Save verified user in MySQL and log them in
        try {
            await db.execute(
                "INSERT INTO users (ID, NAME, EMAIL, PASSWORD, ROLE, IS_VERIFIED, session_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [user.id, user.name, user.email, user.passwordHash, user.role, 1, 1]
            );
        } catch (dbErr) {
            if (dbErr && dbErr.code === "ER_DUP_ENTRY") {
                req.flash("error", "This email is already registered. Please login!");
                return res.redirect("/authenticate/login");
            }
            throw dbErr;
        }

        const loggedInUser = {
            ID: user.id,
            NAME: user.name,
            EMAIL: user.email,
            ROLE: user.role,
            session_version: 1,
        };

        req.login(loggedInUser, (err) => {
            if (err) return next(err);
            ensureCsrfToken(req);
            req.flash("success", `Welcome to Stayora, ${user.name}!`);
            return res.redirect("/");
        });
    } catch (err) {
        return next(err);
    }
});

router.post("/signup/resend-otp", otpResendIPlimiter, async (req, res, next) => {
    try {
        // Step 1: Validate signupId from hidden form field
        const result = signupIdValidator.safeParse(req.body);
        if (!result.success) {
            req.flash("error", "Invalid session. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        const { signupId } = result.data;

        // Step 2: Load pending signup (has email + same refCode)
        const rawUser = await redis.get(`signup:${signupId}`);
        if (!rawUser) {
            req.flash("error", "Your session has expired. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }
        const { email, refCode } = JSON.parse(rawUser);
        const rateLimitEmail = normalizeEmailForRateLimit(email);

        // Step 3: Max 3 resends and max 5 total OTP emails per 15 minutes for this email
        const resends = await atomicIncrWithExpiry(`otpResend:${rateLimitEmail}`, 900);
        if (resends > 3) {
            req.flash("error", "You have exceeded the maximum number of OTP resend attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/signup");
        }

        const sentCount = await atomicIncrWithExpiry(`otpEmail:${rateLimitEmail}`, 900);
        if (sentCount > 5) {
            req.flash("error", "Too many verification codes requested for this email. Please try again after 15 minutes.");
            return res.redirect("/authenticate/signup");
        }

        // Step 4: Generate fresh OTP under the SAME signupId and reset wrong tries
        const otp = crypto.randomInt(100000, 1000000).toString();
        const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
        await redis.set(`otp:${signupId}`, otpHash, "EX", TEN_MINUTES);
        await redis.del(`otpFails:${signupId}`);

        // Step 5: Send new OTP email with the SAME refCode
        await sendOtpEmail(email, otp, refCode);

        return res.render("auth/enter-otp", {
            title: "Verify OTP",
            email,
            signupId,
            refCode,
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
