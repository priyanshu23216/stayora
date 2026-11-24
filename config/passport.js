import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import db from "./db.js";

// Serialize user by ID and session_version (so password reset invalidates all existing sessions)
passport.serializeUser((user, done) => {
    done(null, { id: user.ID, v: user.session_version ?? 1 });
});

// Deserialize user by ID and verify session_version
passport.deserializeUser(async (payload, done) => {
    try {
        const id = typeof payload === "string" ? payload : payload?.id;
        const sessionVersion = typeof payload === "object" && payload !== null ? payload.v : null;

        if (!id) {
            return done(null, false);
        }

        const [rows] = await db.execute(
            "SELECT ID, NAME, EMAIL, ROLE, IS_VERIFIED, session_version FROM users WHERE ID = ?",
            [id]
        );

        const user = rows[0];

        if (!user) {
            return done(null, false);
        }

        // Invalidate session if user reset their password / rotated session_version
        if (sessionVersion !== null && Number(user.session_version) !== Number(sessionVersion)) {
            return done(null, false);
        }

        return done(null, user);
    } catch (err) {
        return done(err);
    }
});

// Local Strategy
passport.use(
    new LocalStrategy(
        { usernameField: "email", passwordField: "password" },
        async (email, password, done) => {
            try {
                if (typeof email !== "string" || typeof password !== "string" || password.length > 72) {
                    return done(null, false, { message: "Invalid email or password" });
                }

                const emailCleaned = email.toLowerCase().trim();
                const [result] = await db.execute(
                    "SELECT ID, NAME, EMAIL, PASSWORD, ROLE, IS_VERIFIED, session_version FROM users WHERE EMAIL = ?",
                    [emailCleaned]
                );
                const user = result[0];

                // Use uniform error message to prevent account/OAuth enumeration
                if (!user || !user.PASSWORD) {
                    return done(null, false, { message: "Invalid email or password" });
                }

                if (!user.IS_VERIFIED) {
                    return done(null, false, { message: "Please verify your email before logging in." });
                }

                const isMatch = await bcrypt.compare(password, user.PASSWORD);
                if (!isMatch) {
                    return done(null, false, { message: "Invalid email or password" });
                }

                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    )
);

// Google OAuth Strategy
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // 1. Check if the user already exists by Google ID
                const [user] = await db.execute(
                    "SELECT ID, NAME, EMAIL, ROLE, IS_VERIFIED, session_version FROM users WHERE GOOGLE_ID = ?",
                    [profile.id]
                );
                if (user.length > 0) {
                    return done(null, user[0]);
                }

                // 2. Require a verified email from Google profile before linking or creating an account
                let email = null;
                let emailVerified = false;

                if (profile.emails && profile.emails.length > 0) {
                    email = profile.emails[0].value.toLowerCase().trim();
                    emailVerified =
                        profile.emails[0].verified === true ||
                        profile._json?.email_verified === true;
                }

                if (!email || !emailVerified) {
                    return done(null, false, {
                        message: "A verified Google email address is required to sign in.",
                    });
                }

                // 3. Check if an account with this email already exists
                const [usersByEmail] = await db.execute(
                    "SELECT ID, NAME, EMAIL, ROLE, IS_VERIFIED, session_version FROM users WHERE EMAIL = ?",
                    [email]
                );

                if (usersByEmail.length > 0) {
                    const existingUser = usersByEmail[0];

                    // Never silently auto-link privileged admin accounts via OAuth
                    if (existingUser.ROLE === "admin") {
                        return done(null, false, {
                            message: "Admin accounts must sign in using email and password.",
                        });
                    }

                    await db.execute(
                        "UPDATE users SET GOOGLE_ID = ?, IS_VERIFIED = 1 WHERE ID = ?",
                        [profile.id, existingUser.ID]
                    );
                    return done(null, existingUser);
                }

                // 4. Create a new verified guest account
                const id = uuidv4();
                let name = "Guest User";
                if (profile.displayName) {
                    name = profile.displayName.trim().slice(0, 100);
                } else if (profile.name?.givenName && profile.name?.familyName) {
                    name = `${profile.name.givenName} ${profile.name.familyName}`.trim().slice(0, 100);
                } else if (profile.name?.givenName) {
                    name = profile.name.givenName.trim().slice(0, 100);
                }

                const role = "guest";

                await db.execute(
                    "INSERT INTO users (ID, NAME, EMAIL, GOOGLE_ID, ROLE, IS_VERIFIED, session_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [id, name, email, profile.id, role, 1, 1]
                );

                const newUser = {
                    ID: id,
                    NAME: name,
                    EMAIL: email,
                    ROLE: role,
                    IS_VERIFIED: 1,
                    session_version: 1,
                };
                return done(null, newUser);
            } catch (err) {
                return done(err);
            }
        }
    )
);

export default passport;
