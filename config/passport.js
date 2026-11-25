import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import db from "./db.js";

// Step 1: Save user's ID and session_version inside Redis session cookie data
// Why session_version? When user resets their password, we do session_version + 1 in MySQL,
// so any old stolen session cookies stop matching and get logged out automatically!
passport.serializeUser((user, done) => {
    const version = user.session_version || 1;
    done(null, { id: user.ID, v: version });
});

// Step 2: On every request, load fresh user details from MySQL using ID from session
passport.deserializeUser(async (sessionData, done) => {
    try {
        let userId = null;
        let savedVersion = null;

        // Support both old format (plain string ID) and new format ({ id, v })
        if (typeof sessionData === "string") {
            userId = sessionData;
        } else if (sessionData && sessionData.id) {
            userId = sessionData.id;
            savedVersion = sessionData.v;
        }

        if (!userId) {
            return done(null, false);
        }

        const [rows] = await db.execute(
            "SELECT ID, NAME, EMAIL, ROLE, IS_VERIFIED, session_version FROM users WHERE ID = ?",
            [userId]
        );
        const user = rows[0];

        if (!user) {
            return done(null, false);
        }

        // If user changed their password recently, kick out old sessions immediately
        if (savedVersion !== null && Number(user.session_version) !== Number(savedVersion)) {
            return done(null, false);
        }

        return done(null, user);
    } catch (err) {
        return done(err);
    }
});

// Step 3: Local Email + Password Login Strategy
passport.use(
    new LocalStrategy(
        { usernameField: "email", passwordField: "password" },
        async (email, password, done) => {
            try {
                // Reject non-string inputs or passwords over 72 chars (bcrypt limit)
                if (typeof email !== "string" || typeof password !== "string" || password.length > 72) {
                    return done(null, false, { message: "Invalid email or password" });
                }

                const emailCleaned = email.toLowerCase().trim();
                const [result] = await db.execute(
                    "SELECT ID, NAME, EMAIL, PASSWORD, ROLE, IS_VERIFIED, session_version FROM users WHERE EMAIL = ?",
                    [emailCleaned]
                );
                const user = result[0];

                // Use the same error message if user doesn't exist OR signed up via Google (prevents account enumeration)
                if (!user || !user.PASSWORD) {
                    return done(null, false, { message: "Invalid email or password" });
                }

                // Block unverified accounts from logging in
                if (!user.IS_VERIFIED) {
                    return done(null, false, { message: "Please verify your email before logging in." });
                }

                // Compare entered password with bcrypt hash in database
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

// Step 4: Google OAuth 2.0 Login Strategy
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // 1. Check if this Google account already exists in our database
                const [existingGoogleUsers] = await db.execute(
                    "SELECT ID, NAME, EMAIL, ROLE, IS_VERIFIED, session_version FROM users WHERE GOOGLE_ID = ?",
                    [profile.id]
                );
                if (existingGoogleUsers.length > 0) {
                    return done(null, existingGoogleUsers[0]);
                }

                // 2. Read email from Google profile AND make sure Google verified that email
                let email = null;
                let isEmailVerified = false;

                if (profile.emails && profile.emails.length > 0) {
                    email = profile.emails[0].value.toLowerCase().trim();
                    if (profile.emails[0].verified === true) {
                        isEmailVerified = true;
                    }
                    if (profile._json && profile._json.email_verified === true) {
                        isEmailVerified = true;
                    }
                }

                if (!email || !isEmailVerified) {
                    return done(null, false, {
                        message: "A verified Google email address is required to sign in.",
                    });
                }

                // 3. Check if a user with this email already registered with email/password
                const [usersByEmail] = await db.execute(
                    "SELECT ID, NAME, EMAIL, ROLE, IS_VERIFIED, session_version FROM users WHERE EMAIL = ?",
                    [email]
                );

                if (usersByEmail.length > 0) {
                    const existingUser = usersByEmail[0];

                    // Security rule: Never auto-link an admin account via Google OAuth
                    if (existingUser.ROLE === "admin") {
                        return done(null, false, {
                            message: "Admin accounts must sign in using email and password.",
                        });
                    }

                    // Link Google ID to this existing guest/host account
                    await db.execute(
                        "UPDATE users SET GOOGLE_ID = ?, IS_VERIFIED = 1 WHERE ID = ?",
                        [profile.id, existingUser.ID]
                    );
                    return done(null, existingUser);
                }

                // 4. Brand new user -> pick display name safely and create a guest account
                let name = "Guest User";
                if (profile.displayName) {
                    name = profile.displayName.trim().slice(0, 100);
                } else if (profile.name && profile.name.givenName && profile.name.familyName) {
                    name = `${profile.name.givenName} ${profile.name.familyName}`.trim().slice(0, 100);
                } else if (profile.name && profile.name.givenName) {
                    name = profile.name.givenName.trim().slice(0, 100);
                }

                const id = uuidv4();
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
