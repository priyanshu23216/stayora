import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn, isAdmin } from "../middlewares/auth.js";
import { rejectPropertySchema, hostVerifySchema } from "../utils/validator.js";

const adminRouter = express.Router();

// Protect all /admin/* routes: only logged-in users with ROLE === "admin" can access
adminRouter.use(isLoggedIn, isAdmin);

// Helper: Clear cached /categories and /listings search/filter pages in Redis
async function clearListingPagesCache() {
    await redis.del("categories:all");

    const listKeys = await redis.keys("listingsBy*");
    if (listKeys.length > 0) {
        await redis.del(...listKeys);
    }
}

// 1. GET /admin/dashboard -> Show KPI summary and all listings (default: All, or filtered by status tab)
adminRouter.get("/dashboard", async (req, res, next) => {
    try {
        // Step 1: Read optional status filter from URL (?status=pending | approved | rejected)
        // If no status is given, show "all" listings by default
        let status = req.query.status;
        if (status !== "pending" && status !== "approved" && status !== "rejected") {
            status = "all";
        }

        // Step 2: Read current page number safely (12 properties per page)
        let page = parseInt(req.query.page, 10);
        if (!page || page < 1) {
            page = 1;
        }
        const limit = 12;

        // Step 3: Fetch simple KPI counts for the top summary cards
        const pendingCountResult = await db.execute(
            `SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'pending'`
        );
        const approvedCountResult = await db.execute(
            `SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'approved'`
        );
        const rejectedCountResult = await db.execute(
            `SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'rejected'`
        );
        const bookingsCountResult = await db.execute(
            `SELECT COUNT(*) AS total FROM bookings`
        );

        const pendingTotal = pendingCountResult[0][0].total;
        const approvedTotal = approvedCountResult[0][0].total;
        const rejectedTotal = rejectedCountResult[0][0].total;
        const allTotal = pendingTotal + approvedTotal + rejectedTotal;

        const stats = {
            all: allTotal,
            pending: pendingTotal,
            approved: approvedTotal,
            rejected: rejectedTotal,
            bookings: bookingsCountResult[0][0].total,
        };

        // Step 4: Calculate total pages and keep page within valid bounds
        let activeTotal = stats.all;
        if (status === "pending") {
            activeTotal = stats.pending;
        } else if (status === "approved") {
            activeTotal = stats.approved;
        } else if (status === "rejected") {
            activeTotal = stats.rejected;
        }

        let totalPages = Math.ceil(activeTotal / limit);
        if (totalPages < 1) {
            totalPages = 1;
        }
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        // Step 5: Fetch 12 properties for this tab along with host name & email
        let listingsResult;

        if (status === "all") {
            listingsResult = await db.execute(
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
        } else {
            listingsResult = await db.execute(
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
        }

        const listings = listingsResult[0];

        return res.render("admin/dashboard", {
            title: "Admin Dashboard",
            stats: stats,
            status: status,
            listings: listings,
            currentPage: page,
            totalPages: totalPages,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. GET /admin/listings/:propertyId -> Review full property details, host info, and rooms
adminRouter.get("/listings/:propertyId", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;

        // Step 1: Fetch property details
        const propertyResult = await db.execute(
            `SELECT * FROM properties WHERE ID = ?`,
            [propertyId]
        );
        const propertyRows = propertyResult[0];

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }
        const property = propertyRows[0];

        // Step 2: Fetch host details (including verification badge flag)
        const hostResult = await db.execute(
            `SELECT ID, NAME, EMAIL, is_host_verified FROM users WHERE ID = ?`,
            [property.HOST_ID]
        );
        const host = hostResult[0][0];

        // Step 3: Fetch gallery images of this property
        const imagesResult = await db.execute(
            `SELECT IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );
        const propertyImages = imagesResult[0];

        // Step 4: Fetch amenities of this property
        const amenitiesResult = await db.execute(
            `SELECT amenities.NAME
             FROM property_amenities
             JOIN amenities ON property_amenities.AMENITY_ID = amenities.ID
             WHERE property_amenities.property_id = ?
             ORDER BY amenities.NAME ASC`,
            [propertyId]
        );
        const propertyAmenities = amenitiesResult[0];

        // Step 5: Fetch all rooms of this property
        const roomsResult = await db.execute(
            `SELECT * FROM rooms WHERE property_id = ? ORDER BY PRICE_PER_NIGHT ASC`,
            [propertyId]
        );
        const rooms = roomsResult[0];

        // Step 6: Fetch room images and room amenities for every room in this property
        const roomImagesResult = await db.execute(
            `SELECT room_images.ROOM_ID, room_images.IMAGE_URL
             FROM room_images
             JOIN rooms ON room_images.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?`,
            [propertyId]
        );
        const roomImages = roomImagesResult[0];

        const roomAmenitiesResult = await db.execute(
            `SELECT room_amenities.ROOM_ID, amenities.NAME
             FROM room_amenities
             JOIN amenities ON room_amenities.AMENITY_ID = amenities.ID
             JOIN rooms ON room_amenities.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?
             ORDER BY amenities.NAME ASC`,
            [propertyId]
        );
        const roomAmenities = roomAmenitiesResult[0];

        // Step 7: Attach each room's images and amenities inside that room object
        for (let room of rooms) {
            room.images = [];
            room.amenities = [];

            for (let imageItem of roomImages) {
                if (imageItem.ROOM_ID === room.ID) {
                    room.images.push(imageItem);
                }
            }

            for (let amenityItem of roomAmenities) {
                if (amenityItem.ROOM_ID === room.ID) {
                    room.amenities.push(amenityItem);
                }
            }
        }

        return res.render("admin/show", {
            title: `Review: ${property.title}`,
            property: property,
            host: host,
            propertyImages: propertyImages,
            propertyAmenities: propertyAmenities,
            rooms: rooms,
        });
    } catch (err) {
        return next(err);
    }
});

// 3. PATCH /admin/listings/:propertyId/approve -> Approve a property so it goes live on /listings
adminRouter.patch("/listings/:propertyId/approve", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;

        // Step 1: Check that this property exists
        const propertyResult = await db.execute(
            `SELECT ID, title FROM properties WHERE ID = ?`,
            [propertyId]
        );
        const propertyRows = propertyResult[0];

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }
        const propertyTitle = propertyRows[0].title;

        // Step 2: Update status to 'approved', save admin ID & timestamp, clear any old rejection reason
        await db.execute(
            `UPDATE properties
             SET verification_status = 'approved',
                 verified_by_admin_user_id = ?,
                 verified_at = NOW(),
                 rejection_reason = NULL
             WHERE ID = ?`,
            [req.user.ID, propertyId]
        );

        // Step 3: Clear /listings and /categories caches so this newly approved stay appears right away
        await clearListingPagesCache();

        req.flash("success", `"${propertyTitle}" has been approved and is now live on Stayora!`);
        return res.redirect(`/admin/listings/${propertyId}`);
    } catch (err) {
        return next(err);
    }
});

// 4. PATCH /admin/listings/:propertyId/reject -> Reject a property with Zod-validated rejection reason
adminRouter.patch("/listings/:propertyId/reject", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;

        // Step 1: Validate rejection reason using Zod + regex
        const validation = rejectPropertySchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect(`/admin/listings/${propertyId}`);
        }

        // Step 2: Check that this property exists
        const propertyResult = await db.execute(
            `SELECT ID, title FROM properties WHERE ID = ?`,
            [propertyId]
        );
        const propertyRows = propertyResult[0];

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/admin/dashboard");
        }
        const propertyTitle = propertyRows[0].title;

        // Step 3: Update status to 'rejected' and store the admin's reason
        await db.execute(
            `UPDATE properties
             SET verification_status = 'rejected',
                 verified_by_admin_user_id = ?,
                 verified_at = NOW(),
                 rejection_reason = ?
             WHERE ID = ?`,
            [req.user.ID, validation.data.rejectionReason, propertyId]
        );

        // Step 4: Clear cached /listings/:id (if already approved before) plus /listings and /categories caches
        await redis.del(`property:${propertyId}`);
        await clearListingPagesCache();

        req.flash("success", `"${propertyTitle}" has been rejected.`);
        return res.redirect(`/admin/listings/${propertyId}`);
    } catch (err) {
        return next(err);
    }
});

// 5. PATCH /admin/hosts/:hostId/verify -> Toggle host's verified badge (1 <-> 0)
adminRouter.patch("/hosts/:hostId/verify", async (req, res, next) => {
    try {
        const hostId = req.params.hostId;

        // Step 1: Validate optional propertyId for safe internal redirect
        const validation = hostVerifySchema.safeParse(req.body);
        let safePropertyId = null;
        if (validation.success && validation.data.propertyId) {
            safePropertyId = validation.data.propertyId;
        }

        // Step 2: Fetch host account
        const hostResult = await db.execute(
            `SELECT ID, NAME, is_host_verified FROM users WHERE ID = ? AND ROLE = 'host'`,
            [hostId]
        );
        const hostRows = hostResult[0];

        if (hostRows.length === 0) {
            req.flash("error", "Host account not found.");
            return res.redirect("/admin/dashboard");
        }

        const host = hostRows[0];
        let newVerifiedValue = 1;
        if (host.is_host_verified === 1) {
            newVerifiedValue = 0;
        }

        // Step 3: Update is_host_verified flag in users table
        await db.execute(
            `UPDATE users SET is_host_verified = ? WHERE ID = ?`,
            [newVerifiedValue, hostId]
        );

        // Step 4: Clear cached property detail pages owned by this host so badge updates right away
        const hostPropertiesResult = await db.execute(
            `SELECT ID FROM properties WHERE HOST_ID = ?`,
            [hostId]
        );
        for (let prop of hostPropertiesResult[0]) {
            await redis.del(`property:${prop.ID}`);
        }

        if (newVerifiedValue === 1) {
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
