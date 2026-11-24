// Authentication routes: signup, OTP verification, login, Google OAuth, forgot/reset password, logout
import express from "express";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import passport from "../config/passport.js";
import { sendOtpEmail, resetPassEmail, passChangeAlertEmail } from "../utils/mailer.js";
import crypto from "crypto";
import redis from "../config/redis.js";
import { atomicIncrWithExpiry } from "../utils/redisHelpers.js";
import { signupSchema, loginCheck, resetPassword, emailValidator, otpValidator } from "../utils/validator.js";
import "dotenv/config";

const router = express.Router();

const FOUNDER_EMAIL = (process.env.FOUNDER_EMAIL || "").toLowerCase().trim();
const OTP_TTL_SECONDS = 600; // 10 minutes (matches OTP email text)
const PENDING_SIGNUP_TTL_SECONDS = 600; // 10 minutes
const MAX_OTP_VERIFY_ATTEMPTS = 5;

function timingSafeHexMatch(a, b) {
    if (typeof a !== "string" || typeof b !== "string") {
        return false;
    }
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// Atomic Redis IP rate limiter factory for auth routes
function createIpRateLimiter(prefix, maxRequests, windowSeconds, redirectPath, errorMessage) {
    return async (req, res, next) => {
        try {
            const key = `${prefix}:ip:${req.ip}`;
            const count = await atomicIncrWithExpiry(key, windowSeconds);
            if (count > maxRequests) {
                req.flash("error", errorMessage);
                return res.redirect(redirectPath);
            }
            return next();
        } catch (err) {
            return next(err);
        }
    };
}

const signupLimiter = createIpRateLimiter(
    "signup",
    10,
    900,
    "/authenticate/signup",
    "Too many signup attempts from this IP. Please try again after 15 minutes."
);

const loginIPlimiter = createIpRateLimiter(
    "login",
    30,
    900,
    "/authenticate/login",
    "Too many login attempts from this IP. Please try again after 15 minutes."
);

const otpVerifyIPlimiter = createIpRateLimiter(
    "otpVerify",
    20,
    900,
    "/authenticate/signup",
    "Too many OTP verification attempts from this IP. Please try again after 15 minutes."
);

const otpResendIPlimiter = createIpRateLimiter(
    "otpResendIp",
    10,
    900,
    "/authenticate/signup",
    "Too many OTP resend requests from this IP. Please try again after 15 minutes."
);

const forgotPassIPlimiter = createIpRateLimiter(
    "forgotPass",
    10,
    900,
    "/authenticate/forgot-password",
    "Too many password reset requests from this IP. Please try again after 15 minutes."
);

const resetPassIPlimiter = createIpRateLimiter(
    "resetPass",
    15,
    900,
    "/authenticate/forgot-password",
    "Too many password reset attempts. Please try again after 15 minutes."
);

// Keyed by (IP + email) so a remote attacker cannot lock out a legitimate user's account
async function loginEmailLimiter(req, res, next) {
    try {
        const result = loginCheck.safeParse(req.body);
        if (!result.success) {
            req.flash("error", "Invalid email or password");
            return res.redirect("/authenticate/login");
        }
        const email = result.data.email;
        const redisKey = `login:attempts:${req.ip}:${email}`;
        const count = await atomicIncrWithExpiry(redisKey, 900);

        if (count > 5) {
            req.flash("error", "Too many login attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/login");
        }
        req.loginRateLimitKey = redisKey;
        return next();
    } catch (err) {
        return next(err);
    }
}

async function forgotPassEmailLimiter(req, res, next) {
    try {
        const result = emailValidator.safeParse(req.body);
        if (!result.success) {
            req.flash("error", result.error.issues[0].message);
            return res.redirect("/authenticate/forgot-password");
        }
        const email = result.data.email;
        const redisKey = `forgotPass:attempts:${email}`;
        const count = await atomicIncrWithExpiry(redisKey, 900);

        if (count > 5) {
            req.flash("error", "Too many password reset attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/forgot-password");
        }
        return next();
    } catch (err) {
        return next(err);
    }
}

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
        // Clear failed login counter on successful login so legitimate users aren't locked out
        if (req.loginRateLimitKey) {
            await redis.del(req.loginRateLimitKey).catch(() => {});
        }
        if (FOUNDER_EMAIL && req.user.EMAIL === FOUNDER_EMAIL) {
            req.flash("jarvis", `Access granted. Welcome back, ${req.user.NAME}.`);
        } else {
            req.flash("success", `Welcome back, ${req.user.NAME}!`);
        }
        res.redirect("/");
    }
);

router.get("/signup", (req, res) => {
    res.render("auth/signup", { title: "Sign Up" });
});

router.post("/signup/add", signupLimiter, async (req, res, next) => {
    try {
        const result = signupSchema.safeParse(req.body);
        if (!result.success) {
            req.flash("error", result.error.issues[0].message);
            return res.redirect("/authenticate/signup");
        }

        const { name, email, password } = result.data;

        const [existingUsers] = await db.execute(
            "SELECT ID FROM users WHERE EMAIL = ?",
            [email]
        );
        if (existingUsers.length > 0) {
            req.flash("error", "This email is already registered. Please login!");
            return res.redirect("/authenticate/signup");
        }

        const id = uuidv4();
        const role = "guest";
        const passwordHash = await bcrypt.hash(password, 12);
        const otp = crypto.randomInt(100000, 1000000).toString();
        const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");
        const pendingSignup = JSON.stringify({ id, name, email, passwordHash, role });

        await redis.set(`otp:${email}`, hashedOTP, "EX", OTP_TTL_SECONDS);
        await redis.set(`signup:pending:${email}`, pendingSignup, "EX", PENDING_SIGNUP_TTL_SECONDS);
        await redis.del(`otp:fails:${email}`);

        try {
            await sendOtpEmail(email, otp);
        } catch (err) {
            return next(err);
        }

        return res.render("auth/enter-otp", { title: "Verify OTP", email });
    } catch (err) {
        return next(err);
    }
});

router.post("/signup/verify-otp", otpVerifyIPlimiter, async (req, res, next) => {
    try {
        const result = otpValidator.safeParse(req.body);
        if (!result.success) {
            const firstIssue = result.error.issues[0];
            const safeEmail = typeof req.body?.email === "string" ? req.body.email.toLowerCase().trim() : "";
            if (firstIssue.path[0] === "otp" && safeEmail && emailValidator.safeParse({ email: safeEmail }).success) {
                return res.render("auth/enter-otp", {
                    email: safeEmail,
                    title: "Verify OTP",
                    error: [firstIssue.message],
                });
            }
            req.flash("error", firstIssue.message);
            return res.redirect("/authenticate/signup");
        }

        const signupEmail = result.data.email;
        const otp = result.data.otp;

        const pendingSignup = await redis.get(`signup:pending:${signupEmail}`);
        if (!pendingSignup) {
            req.flash("error", "Your signup session has expired. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        const storedOtp = await redis.get(`otp:${signupEmail}`);
        if (!storedOtp) {
            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: signupEmail,
                error: ["Your OTP has expired or been invalidated. Please request a new code."],
            });
        }

        const enteredHashOTP = crypto.createHash("sha256").update(otp).digest("hex");

        if (!timingSafeHexMatch(enteredHashOTP, storedOtp)) {
            const failCount = await atomicIncrWithExpiry(`otp:fails:${signupEmail}`, OTP_TTL_SECONDS);
            if (failCount >= MAX_OTP_VERIFY_ATTEMPTS) {
                // Invalidate OTP immediately after 5 wrong guesses to stop brute-force
                await redis.del(`otp:${signupEmail}`);
                return res.render("auth/enter-otp", {
                    title: "Verify OTP",
                    email: signupEmail,
                    error: ["Too many incorrect OTP attempts. Please request a new verification code."],
                });
            }
            return res.render("auth/enter-otp", {
                title: "Verify OTP",
                email: signupEmail,
                error: [`Incorrect OTP. ${MAX_OTP_VERIFY_ATTEMPTS - failCount} attempt(s) remaining.`],
            });
        }

        // Consume OTP and pending signup keys immediately before inserting user
        await redis.del(
            `otp:${signupEmail}`,
            `signup:pending:${signupEmail}`,
            `otp:fails:${signupEmail}`,
            `otpResend:${signupEmail}`
        );

        const storedSignUp = JSON.parse(pendingSignup);
        const { id, name, email, passwordHash, role } = storedSignUp;

        await db.execute(
            "INSERT INTO users (ID, NAME, EMAIL, PASSWORD, ROLE, IS_VERIFIED, session_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [id, name, email, passwordHash, role, 1, 1]
        );

        req.login({ ID: id, NAME: name, EMAIL: email, ROLE: role, session_version: 1 }, (err) => {
            if (err) {
                return next(err);
            }
            req.flash("success", `Welcome to Stayora, ${name}!`);
            return res.redirect("/");
        });
    } catch (err) {
        return next(err);
    }
});

router.post("/signup/resend-otp", otpResendIPlimiter, async (req, res, next) => {
    try {
        const result = emailValidator.safeParse(req.body);
        if (!result.success) {
            req.flash("error", "Invalid email. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        const email = result.data.email;
        const pendingSignup = await redis.get(`signup:pending:${email}`);

        if (!pendingSignup) {
            req.flash("error", "Your session has expired. Please sign up again.");
            return res.redirect("/authenticate/signup");
        }

        const track = await atomicIncrWithExpiry(`otpResend:${email}`, 900);
        if (track > 3) {
            req.flash("error", "You have exceeded the maximum number of OTP resend attempts. Please try again after 15 minutes.");
            return res.redirect("/authenticate/signup");
        }

        const otp = crypto.randomInt(100000, 1000000).toString();
        const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");
        await redis.set(`otp:${email}`, hashedOTP, "EX", OTP_TTL_SECONDS);
        await redis.del(`otp:fails:${email}`);

        await sendOtpEmail(email, otp);
        return res.render("auth/enter-otp", {
            title: "Verify OTP",
            email,
            success: ["A new OTP has been sent to your email."],
        });
    } catch (err) {
        return next(err);
    }
});

router.get(
    "/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
    })
);

router.get(
    "/google/callback",
    passport.authenticate("google", {
        failureRedirect: "/authenticate/login",
        failureFlash: true,
    }),
    (req, res) => {
        if (FOUNDER_EMAIL && req.user.EMAIL === FOUNDER_EMAIL) {
            req.flash("jarvis", `Access granted. Welcome back, ${req.user.NAME}.`);
        } else {
            req.flash("success", `Welcome to Stayora, ${req.user.NAME}!`);
        }
        res.redirect("/");
    }
);

router.get("/forgot-password", (req, res) => {
    res.render("auth/forgot-password", { title: "Forgot Password" });
});

router.post("/forgot-password/submit", forgotPassIPlimiter, forgotPassEmailLimiter, async (req, res, next) => {
    try {
        const result = emailValidator.safeParse(req.body);
        if (!result.success) {
            req.flash("error", result.error.issues[0].message);
            return res.redirect("/authenticate/forgot-password");
        }

        const email = result.data.email;
        const [arr] = await db.execute("SELECT ID, PASSWORD FROM users WHERE EMAIL = ?", [email]);
        const user = arr[0];

        const genericSuccessMsg =
            "If an account with that email exists, a password reset link has been sent to your inbox.";

        if (!user) {
            req.flash("success", genericSuccessMsg);
            return res.redirect("/authenticate/forgot-password");
        }

        if (!user.PASSWORD) {
            // Dispatch asynchronously to avoid SMTP timing side-channel for email enumeration
            resetPassEmail(
                email,
                "Your Stayora account uses Google Sign-In, so there's no password to reset. Use Continue with Google to log in."
            ).catch((mailErr) => console.error("Google account reset notice email error:", mailErr));

            req.flash("success", genericSuccessMsg);
            return res.redirect("/authenticate/forgot-password");
        }

        const token = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
        await redis.set(`resetPass:${hashedToken}`, email, "EX", 600);

        const resetLink = `${process.env.APP_URL}/authenticate/forgot-password/${token}`;
        // Dispatch asynchronously to avoid SMTP timing side-channel for email enumeration
        resetPassEmail(email, resetLink).catch((mailErr) =>
            console.error("Password reset email error:", mailErr)
        );

        req.flash("success", genericSuccessMsg);
        return res.redirect("/authenticate/forgot-password");
    } catch (err) {
        return next(err);
    }
});

router.get("/forgot-password/:token", resetPassIPlimiter, async (req, res, next) => {
    try {
        const token = req.params.token;
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
        return res.render("auth/reset-password", { title: "Reset Password", token });
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

        const result = resetPassword.safeParse(req.body);
        if (!result.success) {
            return res.render("auth/reset-password", {
                title: "Reset Password",
                token,
                error: [result.error.issues[0].message],
            });
        }

        const password = result.data.password;
        const hashedPass = await bcrypt.hash(password, 12);

        // Update password AND increment session_version to invalidate all active sessions immediately
        await db.execute(
            "UPDATE users SET PASSWORD = ?, session_version = session_version + 1 WHERE EMAIL = ?",
            [hashedPass, email]
        );
        await redis.del(`resetPass:${hashedToken}`);
        await redis.del(`login:attempts:${req.ip}:${email}`);

        passChangeAlertEmail(email).catch((mailErr) =>
            console.error("Password change alert email error:", mailErr)
        );

        req.flash("success", "Your password has been changed. Please log in with your new password.");
        return res.redirect("/authenticate/login");
    } catch (err) {
        return next(err);
    }
});

// Logout must be POST (CSRF-protected) and destroy session + clear cookie cleanly
router.post("/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.session.destroy((destroyErr) => {
            if (destroyErr) {
                console.error("Session destroy error on logout:", destroyErr);
            }
            res.clearCookie("stayora.sid");
            return res.redirect("/");
        });
    });
});

// Error-handling middleware for auth routes
router.use((err, req, res, next) => {
    console.error("Auth route error:", err);
    req.flash("error", "An unexpected error occurred. Please try again.");
    return res.redirect("/");
});

export default router;
