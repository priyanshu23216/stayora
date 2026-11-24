import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn, isAdmin, isValidUuid } from "../middlewares/auth.js";
import { rejectPropertySchema, hostVerifySchema } from "../utils/validator.js";
import { sendPropertyApprovedEmail, sendPropertyRejectedEmail } from "../utils/mailer.js";
import { invalidatePropertyCache } from "../utils/redisHelpers.js";

const adminRouter = express.Router();

// Protect all /admin/* routes: only logged-in users with ROLE === "admin" can access
adminRouter.use(isLoggedIn, isAdmin);

// 1. GET /admin/dashboard -> Show KPI summary and all listings (filtered by status tab)
adminRouter.get("/dashboard", async (req, res, next) => {
    try {
        let status = typeof req.query.status === "string" ? req.query.status : "all";
        if (status !== "pending" && status !== "approved" && status !== "rejected") {
            status = "all";
        }

        let page = parseInt(typeof req.query.page === "string" ? req.query.page : "1", 10);
        if (!Number.isInteger(page) || page < 1) {
            page = 1;
        }
        const limit = 12;

        const [pendingCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'pending'`
        );
        const [approvedCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'approved'`
        );
        const [rejectedCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'rejected'`
        );
        const [bookingsCountRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM bookings`
        );

        const stats = {
            pending: Number(pendingCountRows[0].total),
            approved: Number(approvedCountRows[0].total),
            rejected: Number(rejectedCountRows[0].total),
            bookings: Number(bookingsCountRows[0].total),
        };
        stats.all = stats.pending + stats.approved + stats.rejected;

        let activeTotal = stats.all;
        if (status === "pending") activeTotal = stats.pending;
        else if (status === "approved") activeTotal = stats.approved;
        else if (status === "rejected") activeTotal = stats.rejected;

        const totalPages = Math.max(1, Math.ceil(activeTotal / limit));
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        let listingsRows;
        if (status === "all") {
            const [rows] = await db.execute(
                `SELECT properties.ID,
                        properties.title,
                        properties.image,
                        properties.PROPERTY_TYPE,
                        properties.city,
                        properties.state,
                        properties.price_per_night,
                        properties.verification_status,
                        properties.AVAILABILITY_STATUS,
                        properties.created_at,
                        users.NAME AS host_name,
                        users.EMAIL AS host_email
                 FROM properties
                 JOIN users ON properties.HOST_ID = users.ID
                 ORDER BY properties.created_at DESC
                 LIMIT ? OFFSET ?`,
                [String(limit), String(offset)]
            );
            listingsRows = rows;
        } else {
            const [rows] = await db.execute(
                `SELECT properties.ID,
                        properties.title,
                        properties.image,
                        properties.PROPERTY_TYPE,
                        properties.city,
                        properties.state,
                        properties.price_per_night,
                        properties.verification_status,
                        properties.AVAILABILITY_STATUS,
                        properties.created_at,
                        users.NAME AS host_name,
                        users.EMAIL AS host_email
                 FROM properties
                 JOIN users ON properties.HOST_ID = users.ID
                 WHERE properties.verification_status = ?
                 ORDER BY properties.created_at DESC
                 LIMIT ? OFFSET ?`,
                [status, String(limit), String(offset)]
            );
            listingsRows = rows;
        }

        return res.render("admin/dashboard", {
            title: "Admin Dashboard",
            stats,
            status,
            listings: listingsRows,
            currentPage: page,
            totalPages,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. GET /admin/listings/:propertyId -> Review full property details, host info, and rooms
adminRouter.get("/listings/:propertyId", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        if (!isValidUuid(propertyId)) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }

        const [propertyRows] = await db.execute(
            `SELECT * FROM properties WHERE ID = ?`,
            [propertyId]
        );
        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }
        const property = propertyRows[0];

        const [hostRows] = await db.execute(
            `SELECT ID, NAME, EMAIL, is_host_verified FROM users WHERE ID = ?`,
            [property.HOST_ID]
        );
        const host = hostRows[0] || null;

        const [propertyImages] = await db.execute(
            `SELECT IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );

        const [propertyAmenities] = await db.execute(
            `SELECT amenities.NAME
             FROM property_amenities
             JOIN amenities ON property_amenities.AMENITY_ID = amenities.ID
             WHERE property_amenities.property_id = ?
             ORDER BY amenities.NAME ASC`,
            [propertyId]
        );

        const [rooms] = await db.execute(
            `SELECT * FROM rooms WHERE property_id = ? ORDER BY PRICE_PER_NIGHT ASC`,
            [propertyId]
        );

        const [roomImages] = await db.execute(
            `SELECT room_images.ROOM_ID, room_images.IMAGE_URL
             FROM room_images
             JOIN rooms ON room_images.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?`,
            [propertyId]
        );

        const [roomAmenities] = await db.execute(
            `SELECT room_amenities.ROOM_ID, amenities.NAME
             FROM room_amenities
             JOIN amenities ON room_amenities.AMENITY_ID = amenities.ID
             JOIN rooms ON room_amenities.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?
             ORDER BY amenities.NAME ASC`,
            [propertyId]
        );

        for (const room of rooms) {
            room.images = roomImages.filter((img) => img.ROOM_ID === room.ID);
            room.amenities = roomAmenities.filter((am) => am.ROOM_ID === room.ID);
        }

        return res.render("admin/show", {
            title: `Review: ${property.title}`,
            property,
            host,
            propertyImages,
            propertyAmenities,
            rooms,
        });
    } catch (err) {
        return next(err);
    }
});

// 3. PATCH /admin/listings/:propertyId/approve -> Approve a property (must have at least 1 room)
adminRouter.patch("/listings/:propertyId/approve", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        if (!isValidUuid(propertyId)) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }

        const [propertyRows] = await db.execute(
            `SELECT ID, title, city, state, HOST_ID FROM properties WHERE ID = ?`,
            [propertyId]
        );
        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }
        const property = propertyRows[0];

        // Require at least 1 bookable room before approving
        const [roomCountRows] = await db.execute(
            `SELECT COUNT(*) AS roomCount FROM rooms WHERE property_id = ? AND TOTAL_ROOMS > 0`,
            [propertyId]
        );
        if (Number(roomCountRows[0].roomCount) === 0) {
            req.flash("error", "Cannot approve a property that has no rooms listed.");
            return res.redirect(`/admin/listings/${propertyId}`);
        }

        await db.execute(
            `UPDATE properties
             SET verification_status = 'approved',
                 verified_by_admin_user_id = ?,
                 verified_at = NOW(),
                 rejection_reason = NULL
             WHERE ID = ?`,
            [req.user.ID, propertyId]
        );

        // Invalidate both the property detail cache and O(1) listings cache version
        await invalidatePropertyCache(propertyId);

        db.execute(`SELECT NAME, EMAIL FROM users WHERE ID = ?`, [property.HOST_ID])
            .then(([hostRows]) => {
                const host = hostRows[0];
                if (!host) return;
                return sendPropertyApprovedEmail(host.EMAIL, {
                    propertyId: property.ID,
                    title: property.title,
                    city: property.city,
                    state: property.state,
                    hostName: host.NAME,
                });
            })
            .catch((emailErr) => console.error("Property approved email error:", emailErr));

        req.flash("success", `"${property.title}" has been approved and is now live on Stayora!`);
        return res.redirect(`/admin/listings/${propertyId}`);
    } catch (err) {
        return next(err);
    }
});

// 4. PATCH /admin/listings/:propertyId/reject -> Reject/unlist a property with Zod-validated reason
adminRouter.patch("/listings/:propertyId/reject", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        if (!isValidUuid(propertyId)) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }

        const validation = rejectPropertySchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect(`/admin/listings/${propertyId}`);
        }

        const [propertyRows] = await db.execute(
            `SELECT ID, title, city, state, HOST_ID FROM properties WHERE ID = ?`,
            [propertyId]
        );
        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }
        const property = propertyRows[0];

        // Check if any upcoming active bookings exist so admin is alerted
        const [activeBookingRows] = await db.execute(
            `SELECT COUNT(*) AS activeCount
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?
               AND bookings.STATUS IN ('pending', 'confirmed')
               AND bookings.CHECK_OUT_DATE >= CURDATE()`,
            [propertyId]
        );
        const activeCount = Number(activeBookingRows[0].activeCount);

        await db.execute(
            `UPDATE properties
             SET verification_status = 'rejected',
                 verified_by_admin_user_id = ?,
                 verified_at = NOW(),
                 rejection_reason = ?
             WHERE ID = ?`,
            [req.user.ID, validation.data.rejectionReason, propertyId]
        );

        await invalidatePropertyCache(propertyId);

        db.execute(`SELECT NAME, EMAIL FROM users WHERE ID = ?`, [property.HOST_ID])
            .then(([hostRows]) => {
                const host = hostRows[0];
                if (!host) return;
                return sendPropertyRejectedEmail(host.EMAIL, {
                    propertyId: property.ID,
                    title: property.title,
                    city: property.city,
                    state: property.state,
                    hostName: host.NAME,
                    rejectionReason: validation.data.rejectionReason,
                });
            })
            .catch((emailErr) => console.error("Property rejected email error:", emailErr));

        const activeNote =
            activeCount > 0
                ? ` Note: ${activeCount} active upcoming guest booking(s) exist on this property and should be reviewed by support.`
                : "";

        req.flash("success", `"${property.title}" has been rejected.${activeNote}`);
        return res.redirect(`/admin/listings/${propertyId}`);
    } catch (err) {
        return next(err);
    }
});

// 5. PATCH /admin/hosts/:hostId/verify -> Atomically toggle host's verified badge (1 <-> 0)
adminRouter.patch("/hosts/:hostId/verify", async (req, res, next) => {
    try {
        const hostId = req.params.hostId;
        if (!isValidUuid(hostId)) {
            req.flash("error", "Host account not found.");
            return res.redirect("/admin/dashboard");
        }

        const validation = hostVerifySchema.safeParse(req.body);
        const safePropertyId = validation.success && validation.data.propertyId ? validation.data.propertyId : null;

        // Atomic SQL flip avoids read-modify-write toggle race
        const [updateResult] = await db.execute(
            `UPDATE users
             SET is_host_verified = CASE WHEN COALESCE(is_host_verified, 0) = 1 THEN 0 ELSE 1 END
             WHERE ID = ? AND ROLE = 'host'`,
            [hostId]
        );

        if (updateResult.affectedRows === 0) {
            req.flash("error", "Host account not found.");
            return res.redirect("/admin/dashboard");
        }

        const [hostRows] = await db.execute(
            `SELECT NAME, is_host_verified FROM users WHERE ID = ?`,
            [hostId]
        );
        const host = hostRows[0];

        const [hostProperties] = await db.execute(
            `SELECT ID FROM properties WHERE HOST_ID = ?`,
            [hostId]
        );
        if (hostProperties.length > 0) {
            await redis.del(...hostProperties.map((p) => `property:${p.ID}`));
        }

        if (host.is_host_verified === 1) {
            req.flash("success", `${host.NAME} is now a Verified Host.`);
        } else {
            req.flash("success", `Verified Host badge removed from ${host.NAME}.`);
        }

        if (safePropertyId) {
            return res.redirect(`/admin/listings/${safePropertyId}`);
        }
        return res.redirect("/admin/dashboard");
    } catch (err) {
        return next(err);
    }
});

// Error-handling middleware for admin routes
adminRouter.use((err, req, res, next) => {
    console.error("Admin route error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/admin/dashboard");
});

export default adminRouter;
