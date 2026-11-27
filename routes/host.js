import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import upload from "../config/multer.js";
import { isLoggedIn, isHost, isValidUuid } from "../middlewares/auth.js";
import { verifyCsrfToken } from "../middlewares/csrf.js";
import { newListingSchema, editListingSchema, roomSchema } from "../utils/validator.js";
import { uploadBufferToCloudinary, destroyCloudinaryAssets } from "../utils/cloudinaryUpload.js";
import { validateUploadedImages } from "../utils/imageValidation.js";
import { atomicIncrWithExpiry, invalidatePropertyCache } from "../utils/redisHelpers.js";
import { calculateCancellationDetails, formatDisplayDate } from "../utils/cancellationPolicy.js";

const hostRouter = express.Router();

const MAX_GALLERY_IMAGES_TOTAL = 12;
const MAX_ROOM_IMAGES_TOTAL = 8;

// Protect all /host/* routes: user must be logged in and have ROLE === "host"
hostRouter.use(isLoggedIn, isHost);

// Allow 1 cover image and up to 6 gallery images per request
const uploadPropertyImages = upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 6 },
]);

// Allow up to 4 room photos per request
const uploadRoomImages = upload.array("roomImages", 4);

// Atomic rate limiter for host upload/mutation routes (prevents RAM/Cloudinary abuse)
async function hostUploadLimiter(req, res, next) {
    try {
        const key = `host:upload:${req.user.ID}`;
        const count = await atomicIncrWithExpiry(key, 900);
        if (count > 30) {
            req.flash("error", "Too many upload requests. Please wait 15 minutes and try again.");
            return res.redirect("/host/dashboard");
        }
        return next();
    } catch (err) {
        return next(err);
    }
}

// Verify property UUID + ownership BEFORE Multer buffers up to 35MB into memory
async function requireOwnedProperty(req, res, next) {
    try {
        const propertyId = req.params.propertyId;
        if (!isValidUuid(propertyId)) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }
        const [rows] = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );
        if (rows.length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }
        req.ownedProperty = rows[0];
        return next();
    } catch (err) {
        return next(err);
    }
}

// Helper 1: Convert checkbox input (undefined, single string, or array) into a unique list
function getUniqueList(value) {
    const items = Array.isArray(value) ? value : value ? [value] : [];
    return [...new Set(items)];
}

// Helper 2: Keep only real amenity IDs that exist in database for the given category
async function filterValidAmenities(connection, selectedIds, category) {
    if (selectedIds.length === 0) {
        return [];
    }
    const [rows] = await connection.execute(
        `SELECT ID FROM amenities WHERE CATEGORY = ?`,
        [category]
    );
    const validDbIds = new Set(rows.map((r) => r.ID));
    return selectedIds.filter((id) => validDbIds.has(id));
}

// Helper 3: Keep properties.total_rooms, max_guests, and price_per_night in sync with its rooms
async function syncPropertyRoomStats(connection, propertyId) {
    const [rooms] = await connection.execute(
        `SELECT TOTAL_ROOMS, CAPACITY, PRICE_PER_NIGHT FROM rooms WHERE property_id = ?`,
        [propertyId]
    );

    if (rooms.length === 0) {
        // When last room is deleted, mark property unavailable so guests can't hit empty bookable listing
        await connection.execute(
            `UPDATE properties SET total_rooms = 0, AVAILABILITY_STATUS = 'unavailable' WHERE ID = ?`,
            [propertyId]
        );
        return;
    }

    let totalRoomsSum = 0;
    let maxGuestsFound = 1;
    let minPriceFound = Number(rooms[0].PRICE_PER_NIGHT);

    for (const room of rooms) {
        totalRoomsSum += Number(room.TOTAL_ROOMS);
        if (Number(room.CAPACITY) > maxGuestsFound) {
            maxGuestsFound = Number(room.CAPACITY);
        }
        if (Number(room.PRICE_PER_NIGHT) < minPriceFound) {
            minPriceFound = Number(room.PRICE_PER_NIGHT);
        }
    }

    await connection.execute(
        `UPDATE properties
         SET total_rooms = ?, max_guests = ?, price_per_night = ?
         WHERE ID = ?`,
        [totalRoomsSum, maxGuestsFound, minPriceFound, propertyId]
    );
}

// Helper 4: Format HH:MM into HH:MM:00 for MySQL TIME column
function formatSqlTime(timeStr) {
    return timeStr.length === 5 ? `${timeStr}:00` : timeStr;
}

// Helper 5: Safe rollback wrapper
async function safeRollback(connection) {
    if (!connection) return;
    try {
        await connection.rollback();
    } catch (rbErr) {
        console.error("Host rollback error:", rbErr);
    }
}

// Helper 6: Check peak concurrent future occupancy for a room
function computePeakFutureOccupancy(bookings) {
    if (bookings.length === 0) return 0;
    const events = [];
    for (const b of bookings) {
        const count = Number(b.rooms_count || 1);
        events.push({ date: b.CHECK_IN_DATE, delta: count });
        events.push({ date: b.CHECK_OUT_DATE, delta: -count });
    }
    // Check-outs happen before check-ins on the same day (-1 before +1)
    events.sort((a, b) => (a.date === b.date ? a.delta - b.delta : a.date < b.date ? -1 : 1));
    let current = 0;
    let peak = 0;
    for (const ev of events) {
        current += ev.delta;
        if (current > peak) peak = current;
    }
    return peak;
}

// Helper 7: Format local Date as MySQL TIMESTAMP string (keeps Node & MySQL check-out sync consistent)
function formatLocalSqlTimestamp(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    const hh = String(dateObj.getHours()).padStart(2, "0");
    const mm = String(dateObj.getMinutes()).padStart(2, "0");
    const ss = String(dateObj.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/* ==========================================================================
   PROPERTY CRUD & HOST BOOKINGS ROUTES
   ========================================================================== */

// 1. GET /host/dashboard -> Show all properties listed by this host (newest first)
hostRouter.get("/dashboard", async (req, res, next) => {
    try {
        const [listings] = await db.execute(
            `SELECT * FROM properties WHERE HOST_ID = ? ORDER BY created_at DESC`,
            [req.user.ID]
        );

        const [activeBookingRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE properties.HOST_ID = ?
               AND bookings.STATUS IN ('pending', 'confirmed')
               AND bookings.CHECK_OUT_DATE >= CURDATE()`,
            [req.user.ID]
        );
        const upcomingBookingsCount = Number(activeBookingRows[0]?.total || 0);

        return res.render("host/dashboard", {
            title: "Host Dashboard",
            listings,
            upcomingBookingsCount,
        });
    } catch (err) {
        return next(err);
    }
});

// 1B. GET /host/bookings -> Show all guest reservations across this host's properties
hostRouter.get("/bookings", async (req, res, next) => {
    try {
        const hostId = req.user.ID;

        // Step 1: Mark past confirmed bookings as "completed" once their check-out time has passed
        const nowTimestamp = formatLocalSqlTimestamp(new Date());
        await db.execute(
            `UPDATE bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             SET bookings.STATUS = 'completed'
             WHERE properties.HOST_ID = ?
               AND bookings.STATUS = 'confirmed'
               AND TIMESTAMP(bookings.CHECK_OUT_DATE, IFNULL(properties.check_out_time, '11:00:00')) <= ?`,
            [hostId, nowTimestamp]
        );

        // Step 2: Fetch all properties owned by this host (used for the property filter dropdown)
        const [hostProperties] = await db.execute(
            `SELECT ID, title, city
             FROM properties
             WHERE HOST_ID = ?
             ORDER BY title ASC`,
            [hostId]
        );

        // Step 3: Read optional tab filter (?status=all | upcoming | completed | cancelled)
        let status = typeof req.query.status === "string" ? req.query.status : "all";
        if (status !== "upcoming" && status !== "completed" && status !== "cancelled") {
            status = "all";
        }

        // Step 4: Read optional property filter (?propertyId=...) and verify this host owns it
        let selectedPropertyId = "";
        if (typeof req.query.propertyId === "string" && isValidUuid(req.query.propertyId)) {
            for (let prop of hostProperties) {
                if (prop.ID === req.query.propertyId) {
                    selectedPropertyId = prop.ID;
                    break;
                }
            }
        }

        // Step 5: Read page number safely (10 bookings per page)
        let page = parseInt(typeof req.query.page === "string" ? req.query.page : "1", 10);
        if (!Number.isInteger(page) || page < 1) {
            page = 1;
        }
        const limit = 10;

        // Build simple WHERE filter (always locked to this host's properties)
        let propertyFilterSql = "";
        const filterParams = [hostId];
        if (selectedPropertyId) {
            propertyFilterSql = "AND properties.ID = ?";
            filterParams.push(selectedPropertyId);
        }

        // Step 6: Fetch simple KPI counts and total earned revenue (excluding cancelled bookings)
        const [upcomingCountRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE properties.HOST_ID = ? ${propertyFilterSql}
               AND bookings.STATUS IN ('pending', 'confirmed')`,
            filterParams
        );

        const [completedCountRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE properties.HOST_ID = ? ${propertyFilterSql}
               AND bookings.STATUS = 'completed'`,
            filterParams
        );

        const [cancelledCountRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE properties.HOST_ID = ? ${propertyFilterSql}
               AND bookings.STATUS = 'cancelled'`,
            filterParams
        );

        const [revenueRows] = await db.execute(
            `SELECT SUM(bookings.TOTAL_AMOUNT) AS total
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             WHERE properties.HOST_ID = ? ${propertyFilterSql}
               AND bookings.STATUS IN ('confirmed', 'completed')`,
            filterParams
        );

        const upcomingCount = Number(upcomingCountRows[0].total || 0);
        const completedCount = Number(completedCountRows[0].total || 0);
        const cancelledCount = Number(cancelledCountRows[0].total || 0);
        const totalRevenue = Number(revenueRows[0].total || 0);

        const stats = {
            all: upcomingCount + completedCount + cancelledCount,
            upcoming: upcomingCount,
            completed: completedCount,
            cancelled: cancelledCount,
            revenue: totalRevenue,
            revenueFormatted: totalRevenue.toLocaleString("en-IN"),
        };

        // Step 7: Calculate total pages for the active tab
        let activeTotal = stats.all;
        if (status === "upcoming") {
            activeTotal = stats.upcoming;
        } else if (status === "completed") {
            activeTotal = stats.completed;
        } else if (status === "cancelled") {
            activeTotal = stats.cancelled;
        }

        const totalPages = Math.max(1, Math.ceil(activeTotal / limit));
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        let statusCondition = "";
        if (status === "upcoming") {
            statusCondition = "AND bookings.STATUS IN ('pending', 'confirmed')";
        } else if (status === "completed") {
            statusCondition = "AND bookings.STATUS = 'completed'";
        } else if (status === "cancelled") {
            statusCondition = "AND bookings.STATUS = 'cancelled'";
        }

        // Step 8: Fetch paginated bookings joined with rooms, properties, and users (the guest)
        const queryParams = filterParams.slice();
        queryParams.push(String(limit), String(offset));

        const [rawBookings] = await db.execute(
            `SELECT bookings.ID,
                    bookings.ROOM_ID,
                    bookings.CHECK_IN_DATE,
                    bookings.CHECK_OUT_DATE,
                    bookings.GUESTS,
                    bookings.rooms_count,
                    bookings.TOTAL_AMOUNT,
                    bookings.STATUS,
                    bookings.CREATED_AT,
                    bookings.cancellation_policy AS booking_policy,
                    rooms.ROOM_TYPE,
                    rooms.PRICE_PER_NIGHT,
                    properties.ID AS property_id,
                    properties.title AS property_title,
                    properties.image AS property_image,
                    properties.city AS property_city,
                    properties.state AS property_state,
                    properties.verification_status AS property_verification_status,
                    properties.check_in_time,
                    properties.check_out_time,
                    properties.cancellation_policy AS property_policy,
                    users.NAME AS guest_name,
                    users.EMAIL AS guest_email,
                    users.phone AS guest_phone
             FROM bookings
             JOIN rooms ON bookings.ROOM_ID = rooms.ID
             JOIN properties ON rooms.property_id = properties.ID
             JOIN users ON bookings.USER_ID = users.ID
             WHERE properties.HOST_ID = ?
               ${propertyFilterSql}
               ${statusCondition}
             ORDER BY bookings.CREATED_AT DESC, bookings.ID DESC
             LIMIT ? OFFSET ?`,
            queryParams
        );

        // Step 9: Format dates, nights, policy, and ongoing status for display in EJS
        const bookings = [];
        for (let item of rawBookings) {
            const checkInMs = new Date(`${item.CHECK_IN_DATE}T00:00:00`);
            const checkOutMs = new Date(`${item.CHECK_OUT_DATE}T00:00:00`);
            const nights = Math.max(1, Math.round((checkOutMs - checkInMs) / (1000 * 60 * 60 * 24)));

            // Use the policy saved at booking time; fall back to property policy for older rows
            const policyToUse = item.booking_policy || item.property_policy;
            const details = calculateCancellationDetails({
                STATUS: item.STATUS,
                CHECK_IN_DATE: item.CHECK_IN_DATE,
                CHECK_OUT_DATE: item.CHECK_OUT_DATE,
                check_in_time: item.check_in_time,
                check_out_time: item.check_out_time,
                TOTAL_AMOUNT: item.TOTAL_AMOUNT,
                cancellation_policy: policyToUse,
            });

            bookings.push({
                ID: item.ID,
                ROOM_ID: item.ROOM_ID,
                GUESTS: item.GUESTS,
                rooms_count: Number(item.rooms_count || 1),
                STATUS: item.STATUS,
                ROOM_TYPE: item.ROOM_TYPE,
                property_id: item.property_id,
                property_title: item.property_title,
                property_image: item.property_image,
                property_city: item.property_city,
                property_state: item.property_state,
                property_verification_status: item.property_verification_status,
                guest_name: item.guest_name,
                guest_email: item.guest_email,
                guest_phone: item.guest_phone,
                nights: nights,
                amountFormatted: Number(item.TOTAL_AMOUNT || 0).toLocaleString("en-IN"),
                checkInDisplay: formatDisplayDate(item.CHECK_IN_DATE),
                checkOutDisplay: formatDisplayDate(item.CHECK_OUT_DATE),
                bookedOnDisplay: item.CREATED_AT ? formatDisplayDate(item.CREATED_AT) : "",
                isOngoing: details.isOngoing,
                policyText: details.policyText,
            });
        }

        // Extra query string appended to tab & pagination links when a property is selected
        const propertyQuery = selectedPropertyId ? `&propertyId=${selectedPropertyId}` : "";

        return res.render("host/bookings", {
            title: "Guest Bookings",
            stats: stats,
            status: status,
            selectedPropertyId: selectedPropertyId,
            propertyQuery: propertyQuery,
            hostProperties: hostProperties,
            bookings: bookings,
            currentPage: page,
            totalPages: totalPages,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. GET /host/listings/new -> Show the multipart form to create a new listing
hostRouter.get("/listings/new", async (req, res, next) => {
    try {
        const [amenities] = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'property' ORDER BY NAME ASC`
        );

        return res.render("host/new", {
            title: "New Listing",
            amenities,
        });
    } catch (err) {
        return next(err);
    }
});

// 3. POST /host/listings -> Rate limit, Multer, CSRF, Zod, magic-byte check, Cloudinary upload, DB save
hostRouter.post(
    "/listings",
    hostUploadLimiter,
    uploadPropertyImages,
    verifyCsrfToken,
    async (req, res, next) => {
        const validation = newListingSchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect("/host/listings/new");
        }

        const coverFiles = req.files?.coverImage || [];
        const galleryFiles = req.files?.galleryImages || [];

        if (coverFiles.length === 0) {
            req.flash("error", "Please upload a cover image for your property.");
            return res.redirect("/host/listings/new");
        }

        // Magic-byte verification blocks spoofed MIME headers before touching Cloudinary
        if (!validateUploadedImages([...coverFiles, ...galleryFiles])) {
            req.flash("error", "One or more uploaded files are not valid JPEG, PNG, WEBP, or AVIF images.");
            return res.redirect("/host/listings/new");
        }

        const data = validation.data;
        const latitude = data.latitude === "" ? null : Number(data.latitude);
        const longitude = data.longitude === "" ? null : Number(data.longitude);
        const checkInTime = formatSqlTime(data.checkInTime);
        const checkOutTime = formatSqlTime(data.checkOutTime);
        const requestedAmenities = getUniqueList(data.amenities);

        let coverUrl = "";
        const galleryUrls = [];
        const uploadedPublicIds = [];

        try {
            const coverUpload = await uploadBufferToCloudinary(coverFiles[0].buffer, "stayora/properties");
            coverUrl = coverUpload.url;
            uploadedPublicIds.push(coverUpload.publicId);

            for (const file of galleryFiles) {
                const galleryUpload = await uploadBufferToCloudinary(file.buffer, "stayora/properties/gallery");
                galleryUrls.push(galleryUpload.url);
                uploadedPublicIds.push(galleryUpload.publicId);
            }
        } catch (uploadErr) {
            await destroyCloudinaryAssets(uploadedPublicIds);
            console.error("Cloudinary upload error:", uploadErr);
            req.flash("error", "Failed to upload images. Please try again.");
            return res.redirect("/host/listings/new");
        }

        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const propertyId = uuidv4();
            const validAmenities = await filterValidAmenities(connection, requestedAmenities, "property");

            await connection.execute(
                `INSERT INTO properties (
                    ID, title, description, image, PROPERTY_TYPE, BATHROOMS, price_per_night,
                    location, city, state, pincode, latitude, longitude,
                    AVAILABILITY_STATUS, verification_status, total_rooms, max_guests,
                    check_in_time, check_out_time, cancellation_policy, HOST_ID
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    propertyId,
                    data.title,
                    data.description,
                    coverUrl,
                    data.propertyType,
                    data.bathrooms,
                    data.pricePerNight,
                    data.location,
                    data.city,
                    data.state,
                    data.pincode,
                    latitude,
                    longitude,
                    "available",
                    "pending",
                    data.totalRooms,
                    data.maxGuests,
                    checkInTime,
                    checkOutTime,
                    data.cancellationPolicy,
                    req.user.ID,
                ]
            );

            for (const imgUrl of galleryUrls) {
                await connection.execute(
                    `INSERT INTO property_images (ID, property_id, IMAGE_URL) VALUES (?, ?, ?)`,
                    [uuidv4(), propertyId, imgUrl]
                );
            }

            for (const amenityId of validAmenities) {
                await connection.execute(
                    `INSERT INTO property_amenities (ID, property_id, AMENITY_ID) VALUES (?, ?, ?)`,
                    [uuidv4(), propertyId, amenityId]
                );
            }

            await connection.commit();

            req.flash("success", `"${data.title}" created! Now add rooms so guests can book your stay.`);
            return res.redirect(`/host/listings/${propertyId}`);
        } catch (err) {
            await safeRollback(connection);
            await destroyCloudinaryAssets(uploadedPublicIds);
            return next(err);
        } finally {
            if (connection) connection.release();
        }
    }
);

// 4. GET /host/listings/:propertyId -> View More page showing property details + all its rooms
hostRouter.get("/listings/:propertyId", requireOwnedProperty, async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        const property = req.ownedProperty;

        const [propertyImages] = await db.execute(
            `SELECT ID, IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );

        const [propertyAmenities] = await db.execute(
            `SELECT amenities.ID, amenities.NAME
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

        return res.render("host/show", {
            title: property.title,
            property,
            propertyImages,
            propertyAmenities,
            rooms,
        });
    } catch (err) {
        return next(err);
    }
});

// 5. GET /host/listings/:propertyId/edit -> Show pre-filled multipart edit form for property
hostRouter.get("/listings/:propertyId/edit", requireOwnedProperty, async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        const property = req.ownedProperty;

        const checkInValue = property.check_in_time ? String(property.check_in_time).slice(0, 5) : "13:00";
        const checkOutValue = property.check_out_time ? String(property.check_out_time).slice(0, 5) : "11:00";

        const [amenities] = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'property' ORDER BY NAME ASC`
        );

        const [selectedRows] = await db.execute(
            `SELECT AMENITY_ID FROM property_amenities WHERE property_id = ?`,
            [propertyId]
        );
        const selectedAmenityIds = selectedRows.map((row) => row.AMENITY_ID);

        const [propertyImages] = await db.execute(
            `SELECT ID, IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );

        return res.render("host/edit", {
            title: `Edit ${property.title}`,
            property,
            checkInValue,
            checkOutValue,
            amenities,
            selectedAmenityIds,
            propertyImages,
        });
    } catch (err) {
        return next(err);
    }
});

// 6. PUT /host/listings/:propertyId -> Ownership checked BEFORE Multer, CSRF, magic-bytes, re-verification on edits
hostRouter.put(
    "/listings/:propertyId",
    hostUploadLimiter,
    requireOwnedProperty,
    uploadPropertyImages,
    verifyCsrfToken,
    async (req, res, next) => {
        const propertyId = req.params.propertyId;
        const existingProperty = req.ownedProperty;

        const validation = editListingSchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect(`/host/listings/${propertyId}/edit`);
        }

        const coverFiles = req.files?.coverImage || [];
        const galleryFiles = req.files?.galleryImages || [];

        if (!validateUploadedImages([...coverFiles, ...galleryFiles])) {
            req.flash("error", "One or more uploaded files are not valid JPEG, PNG, WEBP, or AVIF images.");
            return res.redirect(`/host/listings/${propertyId}/edit`);
        }

        // Enforce total gallery cap so hosts cannot append unlimited images
        if (galleryFiles.length > 0) {
            const [existingCountRows] = await db.execute(
                `SELECT COUNT(*) AS imgCount FROM property_images WHERE property_id = ?`,
                [propertyId]
            );
            const currentCount = Number(existingCountRows[0].imgCount);
            if (currentCount + galleryFiles.length > MAX_GALLERY_IMAGES_TOTAL) {
                req.flash(
                    "error",
                    `A property can have at most ${MAX_GALLERY_IMAGES_TOTAL} gallery images (currently ${currentCount}).`
                );
                return res.redirect(`/host/listings/${propertyId}/edit`);
            }
        }

        const data = validation.data;
        const latitude = data.latitude === "" ? null : Number(data.latitude);
        const longitude = data.longitude === "" ? null : Number(data.longitude);
        const checkInTime = formatSqlTime(data.checkInTime);
        const checkOutTime = formatSqlTime(data.checkOutTime);
        const requestedAmenities = getUniqueList(data.amenities);

        let coverUrl = existingProperty.image;
        const newGalleryUrls = [];
        const uploadedPublicIds = [];

        try {
            if (coverFiles.length > 0) {
                const coverUpload = await uploadBufferToCloudinary(coverFiles[0].buffer, "stayora/properties");
                coverUrl = coverUpload.url;
                uploadedPublicIds.push(coverUpload.publicId);
            }

            for (const file of galleryFiles) {
                const galleryUpload = await uploadBufferToCloudinary(file.buffer, "stayora/properties/gallery");
                newGalleryUrls.push(galleryUpload.url);
                uploadedPublicIds.push(galleryUpload.publicId);
            }
        } catch (uploadErr) {
            await destroyCloudinaryAssets(uploadedPublicIds);
            console.error("Cloudinary upload error:", uploadErr);
            req.flash("error", "Failed to upload images. Please try again.");
            return res.redirect(`/host/listings/${propertyId}/edit`);
        }

        // Determine whether material content changed (prevents post-approval bait-and-switch AND unblocks rejected listings)
        const contentChanged =
            data.title !== existingProperty.title ||
            data.description !== existingProperty.description ||
            data.propertyType !== existingProperty.PROPERTY_TYPE ||
            data.location !== existingProperty.location ||
            data.city !== existingProperty.city ||
            data.state !== existingProperty.state ||
            data.pincode !== existingProperty.pincode ||
            coverFiles.length > 0 ||
            galleryFiles.length > 0;

        const requiresReReview =
            existingProperty.verification_status === "rejected" ||
            (existingProperty.verification_status === "approved" && contentChanged);

        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const validAmenities = await filterValidAmenities(connection, requestedAmenities, "property");

            if (requiresReReview) {
                await connection.execute(
                    `UPDATE properties
                     SET title = ?,
                         description = ?,
                         image = ?,
                         PROPERTY_TYPE = ?,
                         BATHROOMS = ?,
                         price_per_night = ?,
                         location = ?,
                         city = ?,
                         state = ?,
                         pincode = ?,
                         latitude = ?,
                         longitude = ?,
                         AVAILABILITY_STATUS = ?,
                         total_rooms = ?,
                         max_guests = ?,
                         check_in_time = ?,
                         check_out_time = ?,
                         cancellation_policy = ?,
                         verification_status = 'pending',
                         rejection_reason = NULL,
                         verified_by_admin_user_id = NULL,
                         verified_at = NULL
                     WHERE ID = ? AND HOST_ID = ?`,
                    [
                        data.title,
                        data.description,
                        coverUrl,
                        data.propertyType,
                        data.bathrooms,
                        data.pricePerNight,
                        data.location,
                        data.city,
                        data.state,
                        data.pincode,
                        latitude,
                        longitude,
                        data.availabilityStatus,
                        data.totalRooms,
                        data.maxGuests,
                        checkInTime,
                        checkOutTime,
                        data.cancellationPolicy,
                        propertyId,
                        req.user.ID,
                    ]
                );
            } else {
                await connection.execute(
                    `UPDATE properties
                     SET title = ?,
                         description = ?,
                         image = ?,
                         PROPERTY_TYPE = ?,
                         BATHROOMS = ?,
                         price_per_night = ?,
                         location = ?,
                         city = ?,
                         state = ?,
                         pincode = ?,
                         latitude = ?,
                         longitude = ?,
                         AVAILABILITY_STATUS = ?,
                         total_rooms = ?,
                         max_guests = ?,
                         check_in_time = ?,
                         check_out_time = ?,
                         cancellation_policy = ?
                     WHERE ID = ? AND HOST_ID = ?`,
                    [
                        data.title,
                        data.description,
                        coverUrl,
                        data.propertyType,
                        data.bathrooms,
                        data.pricePerNight,
                        data.location,
                        data.city,
                        data.state,
                        data.pincode,
                        latitude,
                        longitude,
                        data.availabilityStatus,
                        data.totalRooms,
                        data.maxGuests,
                        checkInTime,
                        checkOutTime,
                        data.cancellationPolicy,
                        propertyId,
                        req.user.ID,
                    ]
                );
            }

            for (const imgUrl of newGalleryUrls) {
                await connection.execute(
                    `INSERT INTO property_images (ID, property_id, IMAGE_URL) VALUES (?, ?, ?)`,
                    [uuidv4(), propertyId, imgUrl]
                );
            }

            await connection.execute(`DELETE FROM property_amenities WHERE property_id = ?`, [propertyId]);

            for (const amenityId of validAmenities) {
                await connection.execute(
                    `INSERT INTO property_amenities (ID, property_id, AMENITY_ID) VALUES (?, ?, ?)`,
                    [uuidv4(), propertyId, amenityId]
                );
            }

            // Re-sync price/rooms/guests if rooms exist (prevents bait-and-switch base pricing)
            const [existingRooms] = await connection.execute(
                `SELECT ID FROM rooms WHERE property_id = ? LIMIT 1`,
                [propertyId]
            );
            if (existingRooms.length > 0) {
                await syncPropertyRoomStats(connection, propertyId);
            }

            await connection.commit();
            await invalidatePropertyCache(propertyId);

            if (requiresReReview) {
                req.flash(
                    "success",
                    `"${data.title}" has been updated and submitted for quick admin verification.`
                );
            } else {
                req.flash("success", `"${data.title}" has been updated successfully!`);
            }
            return res.redirect(`/host/listings/${propertyId}`);
        } catch (err) {
            await safeRollback(connection);
            await destroyCloudinaryAssets(uploadedPublicIds);
            return next(err);
        } finally {
            if (connection) connection.release();
        }
    }
);

// 7. DELETE /host/listings/:propertyId -> Lock rooms FOR UPDATE & delete safely
hostRouter.delete("/listings/:propertyId", async (req, res, next) => {
    const propertyId = req.params.propertyId;
    if (!isValidUuid(propertyId)) {
        req.flash("error", "Property not found or you do not have access to it.");
        return res.redirect("/host/dashboard");
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [propertyRows] = await connection.execute(
            `SELECT ID, title FROM properties WHERE ID = ? AND HOST_ID = ? FOR UPDATE`,
            [propertyId, req.user.ID]
        );
        if (propertyRows.length === 0) {
            await connection.rollback();
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }
        const propertyTitle = propertyRows[0].title;

        // Lock all rooms FOR UPDATE to prevent concurrent booking TOCTOU race
        const [rooms] = await connection.execute(
            `SELECT ID FROM rooms WHERE property_id = ? FOR UPDATE`,
            [propertyId]
        );

        // Block deletion only if any room has active upcoming/ongoing bookings (ignores long-past un-synced stays)
        for (const room of rooms) {
            const [activeRows] = await connection.execute(
                `SELECT COUNT(*) AS activeCount
                 FROM bookings
                 WHERE ROOM_ID = ?
                   AND STATUS IN ('pending', 'confirmed')
                   AND CHECK_OUT_DATE >= CURDATE()`,
                [room.ID]
            );
            if (Number(activeRows[0].activeCount) > 0) {
                await connection.rollback();
                req.flash("error", "Cannot delete this property because it has active upcoming bookings.");
                return res.redirect(`/host/listings/${propertyId}`);
            }
        }

        await connection.execute(`DELETE FROM review WHERE property_id = ?`, [propertyId]);

        for (const room of rooms) {
            const [bookingRows] = await connection.execute(
                `SELECT ID FROM bookings WHERE ROOM_ID = ?`,
                [room.ID]
            );
            for (const booking of bookingRows) {
                await connection.execute(`DELETE FROM review WHERE BOOKING_ID = ?`, [booking.ID]);
            }
            await connection.execute(`DELETE FROM bookings WHERE ROOM_ID = ?`, [room.ID]);
            await connection.execute(`DELETE FROM room_images WHERE ROOM_ID = ?`, [room.ID]);
            await connection.execute(`DELETE FROM room_amenities WHERE ROOM_ID = ?`, [room.ID]);
        }

        await connection.execute(`DELETE FROM rooms WHERE property_id = ?`, [propertyId]);
        await connection.execute(`DELETE FROM property_images WHERE property_id = ?`, [propertyId]);
        await connection.execute(`DELETE FROM property_amenities WHERE property_id = ?`, [propertyId]);
        await connection.execute(
            `DELETE FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );

        await connection.commit();
        await invalidatePropertyCache(propertyId);

        req.flash("success", `"${propertyTitle}" has been deleted.`);
        return res.redirect("/host/dashboard");
    } catch (err) {
        await safeRollback(connection);
        return next(err);
    } finally {
        if (connection) connection.release();
    }
});

/* ==========================================================================
   ROOM CRUD ROUTES (Inside a Host's Property)
   ========================================================================== */

// 8. GET /host/listings/:propertyId/rooms/new
hostRouter.get("/listings/:propertyId/rooms/new", requireOwnedProperty, async (req, res, next) => {
    try {
        const property = req.ownedProperty;
        const [amenities] = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'room' ORDER BY NAME ASC`
        );

        return res.render("host/rooms/new", {
            title: `Add Room - ${property.title}`,
            property,
            amenities,
        });
    } catch (err) {
        return next(err);
    }
});

// 9. POST /host/listings/:propertyId/rooms
hostRouter.post(
    "/listings/:propertyId/rooms",
    hostUploadLimiter,
    requireOwnedProperty,
    uploadRoomImages,
    verifyCsrfToken,
    async (req, res, next) => {
        const propertyId = req.params.propertyId;

        const validation = roomSchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect(`/host/listings/${propertyId}/rooms/new`);
        }

        const roomFiles = req.files || [];
        if (!validateUploadedImages(roomFiles)) {
            req.flash("error", "One or more uploaded files are not valid JPEG, PNG, WEBP, or AVIF images.");
            return res.redirect(`/host/listings/${propertyId}/rooms/new`);
        }

        const data = validation.data;
        const requestedAmenities = getUniqueList(data.amenities);
        const roomImageUrls = [];
        const uploadedPublicIds = [];

        try {
            for (const file of roomFiles) {
                const uploaded = await uploadBufferToCloudinary(file.buffer, "stayora/rooms");
                roomImageUrls.push(uploaded.url);
                uploadedPublicIds.push(uploaded.publicId);
            }
        } catch (uploadErr) {
            await destroyCloudinaryAssets(uploadedPublicIds);
            console.error("Cloudinary room image upload error:", uploadErr);
            req.flash("error", "Failed to upload room images. Please try again.");
            return res.redirect(`/host/listings/${propertyId}/rooms/new`);
        }

        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            const roomId = uuidv4();
            const validAmenities = await filterValidAmenities(connection, requestedAmenities, "room");

            await connection.execute(
                `INSERT INTO rooms (ID, property_id, ROOM_TYPE, DESCRIPTION, CAPACITY, TOTAL_ROOMS, PRICE_PER_NIGHT)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [roomId, propertyId, data.roomType, data.description, data.capacity, data.totalRooms, data.pricePerNight]
            );

            for (const imgUrl of roomImageUrls) {
                await connection.execute(
                    `INSERT INTO room_images (ID, ROOM_ID, IMAGE_URL) VALUES (?, ?, ?)`,
                    [uuidv4(), roomId, imgUrl]
                );
            }

            for (const amenityId of validAmenities) {
                await connection.execute(
                    `INSERT INTO room_amenities (ID, ROOM_ID, AMENITY_ID) VALUES (?, ?, ?)`,
                    [uuidv4(), roomId, amenityId]
                );
            }

            await syncPropertyRoomStats(connection, propertyId);

            await connection.commit();
            await invalidatePropertyCache(propertyId);

            req.flash("success", `Room "${data.roomType}" has been added!`);
            return res.redirect(`/host/listings/${propertyId}`);
        } catch (err) {
            await safeRollback(connection);
            await destroyCloudinaryAssets(uploadedPublicIds);
            return next(err);
        } finally {
            if (connection) connection.release();
        }
    }
);

// 10. GET /host/listings/:propertyId/rooms/:roomId/edit
hostRouter.get("/listings/:propertyId/rooms/:roomId/edit", requireOwnedProperty, async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        const roomId = req.params.roomId;
        if (!isValidUuid(roomId)) {
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }

        const property = req.ownedProperty;
        const [roomRows] = await db.execute(
            `SELECT * FROM rooms WHERE ID = ? AND property_id = ?`,
            [roomId, propertyId]
        );
        if (roomRows.length === 0) {
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }
        const room = roomRows[0];

        const [amenities] = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'room' ORDER BY NAME ASC`
        );

        const [selectedRows] = await db.execute(
            `SELECT AMENITY_ID FROM room_amenities WHERE ROOM_ID = ?`,
            [roomId]
        );
        const selectedAmenityIds = selectedRows.map((row) => row.AMENITY_ID);

        const [roomImages] = await db.execute(
            `SELECT ID, IMAGE_URL FROM room_images WHERE ROOM_ID = ?`,
            [roomId]
        );

        return res.render("host/rooms/edit", {
            title: `Edit ${room.ROOM_TYPE}`,
            property,
            room,
            amenities,
            selectedAmenityIds,
            roomImages,
        });
    } catch (err) {
        return next(err);
    }
});

// 11. PUT /host/listings/:propertyId/rooms/:roomId
hostRouter.put(
    "/listings/:propertyId/rooms/:roomId",
    hostUploadLimiter,
    requireOwnedProperty,
    uploadRoomImages,
    verifyCsrfToken,
    async (req, res, next) => {
        const propertyId = req.params.propertyId;
        const roomId = req.params.roomId;
        if (!isValidUuid(roomId)) {
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }

        const validation = roomSchema.safeParse(req.body);
        if (!validation.success) {
            req.flash("error", validation.error.issues[0].message);
            return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
        }

        const roomFiles = req.files || [];
        if (!validateUploadedImages(roomFiles)) {
            req.flash("error", "One or more uploaded files are not valid JPEG, PNG, WEBP, or AVIF images.");
            return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
        }

        if (roomFiles.length > 0) {
            const [imgCountRows] = await db.execute(
                `SELECT COUNT(*) AS imgCount FROM room_images WHERE ROOM_ID = ?`,
                [roomId]
            );
            const currentCount = Number(imgCountRows[0].imgCount);
            if (currentCount + roomFiles.length > MAX_ROOM_IMAGES_TOTAL) {
                req.flash(
                    "error",
                    `A room can have at most ${MAX_ROOM_IMAGES_TOTAL} images (currently ${currentCount}).`
                );
                return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
            }
        }

        const data = validation.data;
        const requestedAmenities = getUniqueList(data.amenities);
        const newRoomImageUrls = [];
        const uploadedPublicIds = [];

        try {
            for (const file of roomFiles) {
                const uploaded = await uploadBufferToCloudinary(file.buffer, "stayora/rooms");
                newRoomImageUrls.push(uploaded.url);
                uploadedPublicIds.push(uploaded.publicId);
            }
        } catch (uploadErr) {
            await destroyCloudinaryAssets(uploadedPublicIds);
            console.error("Cloudinary room image upload error:", uploadErr);
            req.flash("error", "Failed to upload room images. Please try again.");
            return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
        }

        let connection;
        try {
            connection = await db.getConnection();
            await connection.beginTransaction();

            // Lock room row FOR UPDATE to prevent reducing inventory/capacity below active bookings
            const [roomRows] = await connection.execute(
                `SELECT ID FROM rooms WHERE ID = ? AND property_id = ? FOR UPDATE`,
                [roomId, propertyId]
            );
            if (roomRows.length === 0) {
                await connection.rollback();
                await destroyCloudinaryAssets(uploadedPublicIds);
                req.flash("error", "Room not found.");
                return res.redirect(`/host/listings/${propertyId}`);
            }

            const [activeBookings] = await connection.execute(
                `SELECT CHECK_IN_DATE, CHECK_OUT_DATE, GUESTS, rooms_count
                 FROM bookings
                 WHERE ROOM_ID = ?
                   AND STATUS IN ('pending', 'confirmed')
                   AND CHECK_OUT_DATE >= CURDATE()`,
                [roomId]
            );

            const peakOccupied = computePeakFutureOccupancy(activeBookings);
            if (data.totalRooms < peakOccupied) {
                await connection.rollback();
                await destroyCloudinaryAssets(uploadedPublicIds);
                req.flash(
                    "error",
                    `Cannot reduce room count to ${data.totalRooms} because ${peakOccupied} room(s) are already booked for upcoming dates.`
                );
                return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
            }

            let maxBookedGuests = 0;
            for (const b of activeBookings) {
                const perRoomGuests = Math.ceil(Number(b.GUESTS) / Number(b.rooms_count || 1));
                if (perRoomGuests > maxBookedGuests) maxBookedGuests = perRoomGuests;
            }
            if (data.capacity < maxBookedGuests) {
                await connection.rollback();
                await destroyCloudinaryAssets(uploadedPublicIds);
                req.flash(
                    "error",
                    `Cannot reduce room capacity to ${data.capacity} because an active booking already has ${maxBookedGuests} guest(s).`
                );
                return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
            }

            const validAmenities = await filterValidAmenities(connection, requestedAmenities, "room");

            await connection.execute(
                `UPDATE rooms
                 SET ROOM_TYPE = ?,
                     DESCRIPTION = ?,
                     CAPACITY = ?,
                     TOTAL_ROOMS = ?,
                     PRICE_PER_NIGHT = ?
                 WHERE ID = ? AND property_id = ?`,
                [data.roomType, data.description, data.capacity, data.totalRooms, data.pricePerNight, roomId, propertyId]
            );

            for (const imgUrl of newRoomImageUrls) {
                await connection.execute(
                    `INSERT INTO room_images (ID, ROOM_ID, IMAGE_URL) VALUES (?, ?, ?)`,
                    [uuidv4(), roomId, imgUrl]
                );
            }

            await connection.execute(`DELETE FROM room_amenities WHERE ROOM_ID = ?`, [roomId]);

            for (const amenityId of validAmenities) {
                await connection.execute(
                    `INSERT INTO room_amenities (ID, ROOM_ID, AMENITY_ID) VALUES (?, ?, ?)`,
                    [uuidv4(), roomId, amenityId]
                );
            }

            await syncPropertyRoomStats(connection, propertyId);

            await connection.commit();
            await invalidatePropertyCache(propertyId);

            req.flash("success", `Room "${data.roomType}" has been updated!`);
            return res.redirect(`/host/listings/${propertyId}`);
        } catch (err) {
            await safeRollback(connection);
            await destroyCloudinaryAssets(uploadedPublicIds);
            return next(err);
        } finally {
            if (connection) connection.release();
        }
    }
);

// 12. DELETE /host/listings/:propertyId/rooms/:roomId -> Lock room FOR UPDATE & use same connection (no pool deadlock)
hostRouter.delete("/listings/:propertyId/rooms/:roomId", async (req, res, next) => {
    const propertyId = req.params.propertyId;
    const roomId = req.params.roomId;
    if (!isValidUuid(propertyId) || !isValidUuid(roomId)) {
        req.flash("error", "Property or room not found.");
        return res.redirect("/host/dashboard");
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Use connection.execute (NOT db.execute) to avoid connection-pool deadlock
        const [propertyRows] = await connection.execute(
            `SELECT ID FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );
        if (propertyRows.length === 0) {
            await connection.rollback();
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        // Lock room row FOR UPDATE to prevent concurrent booking TOCTOU race
        const [roomRows] = await connection.execute(
            `SELECT ID, ROOM_TYPE FROM rooms WHERE ID = ? AND property_id = ? FOR UPDATE`,
            [roomId, propertyId]
        );
        if (roomRows.length === 0) {
            await connection.rollback();
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }
        const roomType = roomRows[0].ROOM_TYPE;

        const [activeBookingsRows] = await connection.execute(
            `SELECT COUNT(*) AS activeCount
             FROM bookings
             WHERE ROOM_ID = ?
               AND STATUS IN ('pending', 'confirmed')
               AND CHECK_OUT_DATE >= CURDATE()`,
            [roomId]
        );
        if (Number(activeBookingsRows[0].activeCount) > 0) {
            await connection.rollback();
            req.flash("error", "Cannot delete this room because it has active upcoming bookings.");
            return res.redirect(`/host/listings/${propertyId}`);
        }

        const [bookingRows] = await connection.execute(
            `SELECT ID FROM bookings WHERE ROOM_ID = ?`,
            [roomId]
        );
        for (const booking of bookingRows) {
            await connection.execute(`DELETE FROM review WHERE BOOKING_ID = ?`, [booking.ID]);
        }

        await connection.execute(`DELETE FROM bookings WHERE ROOM_ID = ?`, [roomId]);
        await connection.execute(`DELETE FROM room_images WHERE ROOM_ID = ?`, [roomId]);
        await connection.execute(`DELETE FROM room_amenities WHERE ROOM_ID = ?`, [roomId]);
        await connection.execute(`DELETE FROM rooms WHERE ID = ? AND property_id = ?`, [roomId, propertyId]);

        await syncPropertyRoomStats(connection, propertyId);

        await connection.commit();
        await invalidatePropertyCache(propertyId);

        req.flash("success", `Room "${roomType}" has been deleted.`);
        return res.redirect(`/host/listings/${propertyId}`);
    } catch (err) {
        await safeRollback(connection);
        return next(err);
    } finally {
        if (connection) connection.release();
    }
});

// Error-handling middleware for host routes (safe internal redirects without double /edit)
hostRouter.use((err, req, res, next) => {
    console.error("Host route error:", err);

    let safeRedirect = "/host/dashboard";
    const pathOnly = (req.path || "").replace(/\/+$/, "");

    if (pathOnly === "/listings") {
        safeRedirect = "/host/listings/new";
    } else if (pathOnly.endsWith("/rooms")) {
        safeRedirect = `/host${pathOnly}/new`;
    } else if (pathOnly.endsWith("/edit") || pathOnly.endsWith("/new")) {
        safeRedirect = `/host${pathOnly}`;
    } else if (pathOnly.includes("/rooms/")) {
        safeRedirect = `/host${pathOnly}/edit`;
    } else if (pathOnly.startsWith("/listings/")) {
        safeRedirect = `/host${pathOnly}/edit`;
    }

    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            req.flash("error", "Each image must be 5 MB or smaller.");
        } else {
            req.flash("error", "Too many images selected. Please upload within the allowed limit.");
        }
        return res.redirect(safeRedirect);
    }

    if (err.code === "INVALID_FILE_TYPE") {
        req.flash("error", err.message);
        return res.redirect(safeRedirect);
    }

    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/host/dashboard");
});

export default hostRouter;
