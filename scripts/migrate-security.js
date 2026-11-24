import "dotenv/config";
import db from "../config/db.js";

async function migrate() {
    try {
        const [bookingCols] = await db.query(
            "SHOW COLUMNS FROM bookings LIKE 'cancellation_policy'"
        );
        if (bookingCols.length === 0) {
            await db.query(
                "ALTER TABLE bookings ADD COLUMN cancellation_policy TEXT NULL"
            );
            console.log("Added column: bookings.cancellation_policy");
        } else {
            console.log("Column already exists: bookings.cancellation_policy");
        }

        const [userCols] = await db.query(
            "SHOW COLUMNS FROM users LIKE 'session_version'"
        );
        if (userCols.length === 0) {
            await db.query(
                "ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 1"
            );
            console.log("Added column: users.session_version");
        } else {
            console.log("Column already exists: users.session_version");
        }

        console.log("Security schema migration complete.");
    } catch (err) {
        console.error("Migration failed:", err);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

migrate();
