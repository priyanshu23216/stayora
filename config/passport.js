import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import db from "./db.js";

// Serialize user by ID
passport.serializeUser((user, done) => {
    done(null, user.ID);
});
// Deserialize user by ID
passport.deserializeUser(async (id, done) => {
    try {
        const [rows] = await db.execute(
            "SELECT ID, NAME, EMAIL, ROLE FROM USERS WHERE ID = ?",
            [id]
        );

        const user = rows[0];

        if (!user) {
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
                // check if the user exists in the database by email
                const emailCleaned = email.toLowerCase().trim(); // Normalize the email to lowercase and trim whitespace
                const [result] = await db.execute(
                    "SELECT * FROM USERS WHERE EMAIL = ?",
                    [emailCleaned]
                );
                const user = result[0];

                // If the user is not found, return an error message

                if (!user) {
                    return done(null, false, { message: "Invalid email or password" });
                };
                // If the user is found but does not have a password (e.g., registered via Google/GitHub), return an error message

                if (!user.PASSWORD) {
                    return done(null, false, { message: "Please login using Google" });
                }
                // Compare the provided password with the hashed password in the database

                const isMatch = await bcrypt.compare(password, user.PASSWORD);
                if (!isMatch) {
                    return done(null, false, { message: "Invalid email or password" });
                };

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
            callbackURL: process.env.GOOGLE_CALLBACK_URL
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Check if the user already exists in the database by Google ID
                const [user] = await db.execute(
                    "SELECT ID, NAME, EMAIL, ROLE FROM USERS WHERE GOOGLE_ID = ?",
                    [profile.id]
                );
                if (user.length > 0) {
                    return done(null, user[0]);
                };
                // If the user is not found by Google ID, check if the email exists in the database

                let email = null;

                if ( profile.emails && profile.emails.length>0){
                    email = profile.emails[0].value.toLowerCase().trim(); // Normalize the email to lowercase and trim Extraspaces
                };
                if (email) { // If email is found, check if it exists in the database
            const [usersByEmail] = await db.execute("SELECT ID, NAME, EMAIL, ROLE FROM USERS WHERE EMAIL = ?", [email] );     
                if (usersByEmail.length > 0) {
                        await db.execute( "UPDATE USERS SET GOOGLE_ID = ? WHERE EMAIL = ?", [profile.id, email] );
                        return done(null, usersByEmail[0]);
                    }
                } else if (!email) { // If no email is found in the Google profile, return an error message
                    return done(null, false, { message: "No email found in Google profile" });
                };

           // If the user is not found by Google ID or email, create a new user
                const id = uuidv4();
                let name = null;
                if (profile.displayName) {
                    name = profile.displayName;
                }else {// If displayName is not available, construct the name from givenName and familyName
                    if( profile.name && profile.name.givenName && profile.name.familyName){
                        name = `${profile.name.givenName} ${profile.name.familyName}`;
                    }else if (profile.name && profile.name.givenName) {
                        name = profile.name.givenName;
                    }else{
                        name = "Guest User";
                    }                
                }; 
                
                const role = "guest"; // Default role for new users

    await db.execute( "INSERT INTO USERS (ID, NAME, EMAIL, GOOGLE_ID, ROLE , IS_VERIFIED) VALUES (?, ?, ?, ?, ? , ?)",[id, name, email, profile.id, role , 1] );
                const newUser = { ID: id, NAME: name, EMAIL: email, ROLE: role };
                return done(null, newUser);
            } catch (err) {
                return done(err);
            }
        }
    )
);

export default passport;
