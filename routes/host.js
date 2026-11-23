import express from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import redis from "../config/redis.js";
import upload from "../config/multer.js";
import { isLoggedIn, isHost } from "../middlewares/auth.js";
import { newListingSchema, editListingSchema, roomSchema } from "../utils/validator.js";
import { uploadBufferToCloudinary } from "../utils/cloudinaryUpload.js";

const hostRouter = express.Router();

// Protect all /host/* routes: user must be logged in and have ROLE === "host"
hostRouter.use(isLoggedIn, isHost);

// Allow 1 cover image and up to 6 gallery images when creating or editing a property
const uploadPropertyImages = upload.fields([
    { name: "coverImage", maxCount: 1 },
    { name: "galleryImages", maxCount: 6 },
]);

// Allow up to 4 room photos when creating or editing a room
const uploadRoomImages = upload.array("roomImages", 4);

// Helper 1: Convert checkbox input (undefined, single string, or array) into a unique list
function getUniqueList(value) {
    let items = [];
    if (Array.isArray(value)) {
        items = value;
    } else if (value) {
        items = [value];
    }

    const uniqueItems = [];
    for (let item of items) {
        if (!uniqueItems.includes(item)) {
            uniqueItems.push(item);
        }
    }
    return uniqueItems;
}

// Helper 2: Keep only real amenity IDs that exist in database for the given category ('property' or 'room')
async function filterValidAmenities(connection, selectedIds, category) {
    if (selectedIds.length === 0) {
        return [];
    }

    const amenityResult = await connection.execute(
        `SELECT ID FROM amenities WHERE CATEGORY = ?`,
        [category]
    );
    const validDbIds = [];
    for (let row of amenityResult[0]) {
        validDbIds.push(row.ID);
    }

    const cleanIds = [];
    for (let id of selectedIds) {
        if (validDbIds.includes(id)) {
            cleanIds.push(id);
        }
    }
    return cleanIds;
}

// Helper 3: Keep properties.total_rooms, max_guests, and price_per_night in sync with its rooms
async function syncPropertyRoomStats(connection, propertyId) {
    const roomsResult = await connection.execute(
        `SELECT TOTAL_ROOMS, CAPACITY, PRICE_PER_NIGHT FROM rooms WHERE property_id = ?`,
        [propertyId]
    );
    const rooms = roomsResult[0];

    if (rooms.length === 0) {
        return;
    }

    let totalRoomsSum = 0;
    let maxGuestsFound = 1;
    let minPriceFound = Number(rooms[0].PRICE_PER_NIGHT);

    for (let room of rooms) {
        totalRoomsSum = totalRoomsSum + Number(room.TOTAL_ROOMS);

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
    if (timeStr.length === 5) {
        return `${timeStr}:00`;
    }
    return timeStr;
}

// Helper 5: Clear Redis cache for this property and cached /listings pages
async function clearListingCache(propertyId) {
    await redis.del(`property:${propertyId}`);

    const listKeys = await redis.keys("listingsBy*");
    if (listKeys.length > 0) {
        await redis.del(...listKeys);
    }
}

/* ==========================================================================
   PROPERTY CRUD ROUTES
   ========================================================================== */

// 1. GET /host/dashboard -> Show all properties listed by this host (newest first)
hostRouter.get("/dashboard", async (req, res, next) => {
    try {
        const result = await db.execute(
            `SELECT * FROM properties WHERE HOST_ID = ? ORDER BY created_at DESC`,
            [req.user.ID]
        );
        const listings = result[0];

        return res.render("host/dashboard", {
            title: "Host Dashboard",
            listings: listings,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. GET /host/listings/new -> Show the multipart form to create a new listing
hostRouter.get("/listings/new", async (req, res, next) => {
    try {
        const amenityResult = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'property' ORDER BY NAME ASC`
        );
        const amenities = amenityResult[0];

        return res.render("host/new", {
            title: "New Listing",
            amenities: amenities,
        });
    } catch (err) {
        return next(err);
    }
});

// 3. POST /host/listings -> Validate with Zod, upload images to Cloudinary, and save property
hostRouter.post("/listings", uploadPropertyImages, async (req, res, next) => {
    // Step 1: Validate all form inputs using Zod + regex
    const validation = newListingSchema.safeParse(req.body);

    if (!validation.success) {
        req.flash("error", validation.error.issues[0].message);
        return res.redirect("/host/listings/new");
    }

    // Step 2: Check that a cover image was uploaded
    let coverFiles = [];
    let galleryFiles = [];
    if (req.files && req.files.coverImage) {
        coverFiles = req.files.coverImage;
    }
    if (req.files && req.files.galleryImages) {
        galleryFiles = req.files.galleryImages;
    }

    if (coverFiles.length === 0) {
        req.flash("error", "Please upload a cover image for your property.");
        return res.redirect("/host/listings/new");
    }

    const data = validation.data;
    const latitude = data.latitude === "" ? null : Number(data.latitude);
    const longitude = data.longitude === "" ? null : Number(data.longitude);
    const checkInTime = formatSqlTime(data.checkInTime);
    const checkOutTime = formatSqlTime(data.checkOutTime);
    const requestedAmenities = getUniqueList(data.amenities);

    // Step 3: Upload cover image and gallery images to Cloudinary
    let coverUrl = "";
    const galleryUrls = [];

    try {
        const coverUpload = await uploadBufferToCloudinary(coverFiles[0].buffer, "stayora/properties");
        coverUrl = coverUpload.url;

        for (let file of galleryFiles) {
            const galleryUpload = await uploadBufferToCloudinary(file.buffer, "stayora/properties/gallery");
            galleryUrls.push(galleryUpload.url);
        }
    } catch (uploadErr) {
        console.error("Cloudinary upload error:", uploadErr);
        req.flash("error", "Failed to upload images. Please try again.");
        return res.redirect("/host/listings/new");
    }

    // Step 4: Save property, gallery images, and valid amenities inside a SQL transaction
    const connection = await db.getConnection();

    try {
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

        for (let imgUrl of galleryUrls) {
            await connection.execute(
                `INSERT INTO property_images (ID, property_id, IMAGE_URL) VALUES (?, ?, ?)`,
                [uuidv4(), propertyId, imgUrl]
            );
        }

        for (let amenityId of validAmenities) {
            await connection.execute(
                `INSERT INTO property_amenities (ID, property_id, AMENITY_ID) VALUES (?, ?, ?)`,
                [uuidv4(), propertyId, amenityId]
            );
        }

        await connection.commit();

        req.flash("success", `"${data.title}" created! Now add rooms so guests can book your stay.`);
        return res.redirect(`/host/listings/${propertyId}`);
    } catch (err) {
        await connection.rollback();
        return next(err);
    } finally {
        connection.release();
    }
});

// 4. GET /host/listings/:propertyId -> View More page showing property details + all its rooms
hostRouter.get("/listings/:propertyId", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;

        // Step 1: Fetch property and verify it belongs to the logged-in host
        const propertyResult = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );
        const propertyRows = propertyResult[0];

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const property = propertyRows[0];

        // Step 2: Fetch gallery images of this property
        const imagesResult = await db.execute(
            `SELECT ID, IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );
        const propertyImages = imagesResult[0];

        // Step 3: Fetch amenities of this property
        const amenitiesResult = await db.execute(
            `SELECT amenities.ID, amenities.NAME
             FROM property_amenities
             JOIN amenities ON property_amenities.AMENITY_ID = amenities.ID
             WHERE property_amenities.property_id = ?
             ORDER BY amenities.NAME ASC`,
            [propertyId]
        );
        const propertyAmenities = amenitiesResult[0];

        // Step 4: Fetch all rooms of this property
        const roomsResult = await db.execute(
            `SELECT * FROM rooms WHERE property_id = ? ORDER BY PRICE_PER_NIGHT ASC`,
            [propertyId]
        );
        const rooms = roomsResult[0];

        // Step 5: Fetch images and amenities for every room in this property
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

        // Step 6: Attach each room's images and amenities inside that room object
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

        return res.render("host/show", {
            title: property.title,
            property: property,
            propertyImages: propertyImages,
            propertyAmenities: propertyAmenities,
            rooms: rooms,
        });
    } catch (err) {
        return next(err);
    }
});

// 5. GET /host/listings/:propertyId/edit -> Show pre-filled multipart edit form for property
hostRouter.get("/listings/:propertyId/edit", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;

        // Step 1: Fetch property and verify ownership
        const propertyResult = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );
        const propertyRows = propertyResult[0];

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const property = propertyRows[0];

        let checkInValue = "13:00";
        if (property.check_in_time) {
            checkInValue = String(property.check_in_time).slice(0, 5);
        }

        let checkOutValue = "11:00";
        if (property.check_out_time) {
            checkOutValue = String(property.check_out_time).slice(0, 5);
        }

        // Step 2: Fetch all property amenities
        const allAmenitiesResult = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'property' ORDER BY NAME ASC`
        );
        const amenities = allAmenitiesResult[0];

        // Step 3: Fetch currently checked amenity IDs for this property
        const selectedResult = await db.execute(
            `SELECT AMENITY_ID FROM property_amenities WHERE property_id = ?`,
            [propertyId]
        );
        const selectedAmenityIds = [];
        for (let row of selectedResult[0]) {
            selectedAmenityIds.push(row.AMENITY_ID);
        }

        // Step 4: Fetch existing gallery photos
        const galleryResult = await db.execute(
            `SELECT ID, IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );
        const propertyImages = galleryResult[0];

        return res.render("host/edit", {
            title: `Edit ${property.title}`,
            property: property,
            checkInValue: checkInValue,
            checkOutValue: checkOutValue,
            amenities: amenities,
            selectedAmenityIds: selectedAmenityIds,
            propertyImages: propertyImages,
        });
    } catch (err) {
        return next(err);
    }
});

// 6. PUT /host/listings/:propertyId -> Validate with Zod, upload optional new images, and update property
hostRouter.put("/listings/:propertyId", uploadPropertyImages, async (req, res, next) => {
    const propertyId = req.params.propertyId;

    // Step 1: Verify property ownership
    let existingProperty;
    try {
        const propertyResult = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );
        if (propertyResult[0].length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }
        existingProperty = propertyResult[0][0];
    } catch (err) {
        return next(err);
    }

    // Step 2: Validate form inputs with Zod + regex
    const validation = editListingSchema.safeParse(req.body);

    if (!validation.success) {
        req.flash("error", validation.error.issues[0].message);
        return res.redirect(`/host/listings/${propertyId}/edit`);
    }

    const data = validation.data;
    const latitude = data.latitude === "" ? null : Number(data.latitude);
    const longitude = data.longitude === "" ? null : Number(data.longitude);
    const checkInTime = formatSqlTime(data.checkInTime);
    const checkOutTime = formatSqlTime(data.checkOutTime);
    const requestedAmenities = getUniqueList(data.amenities);

    // Step 3: Upload optional new cover image and gallery images to Cloudinary
    let coverFiles = [];
    let galleryFiles = [];
    if (req.files && req.files.coverImage) {
        coverFiles = req.files.coverImage;
    }
    if (req.files && req.files.galleryImages) {
        galleryFiles = req.files.galleryImages;
    }

    let coverUrl = existingProperty.image;
    const newGalleryUrls = [];

    try {
        if (coverFiles.length > 0) {
            const coverUpload = await uploadBufferToCloudinary(coverFiles[0].buffer, "stayora/properties");
            coverUrl = coverUpload.url;
        }

        for (let file of galleryFiles) {
            const galleryUpload = await uploadBufferToCloudinary(file.buffer, "stayora/properties/gallery");
            newGalleryUrls.push(galleryUpload.url);
        }
    } catch (uploadErr) {
        console.error("Cloudinary upload error:", uploadErr);
        req.flash("error", "Failed to upload images. Please try again.");
        return res.redirect(`/host/listings/${propertyId}/edit`);
    }

    // Step 4: Update property, add new gallery images, and refresh amenities inside a transaction
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const validAmenities = await filterValidAmenities(connection, requestedAmenities, "property");

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

        for (let imgUrl of newGalleryUrls) {
            await connection.execute(
                `INSERT INTO property_images (ID, property_id, IMAGE_URL) VALUES (?, ?, ?)`,
                [uuidv4(), propertyId, imgUrl]
            );
        }

        await connection.execute(
            `DELETE FROM property_amenities WHERE property_id = ?`,
            [propertyId]
        );

        for (let amenityId of validAmenities) {
            await connection.execute(
                `INSERT INTO property_amenities (ID, property_id, AMENITY_ID) VALUES (?, ?, ?)`,
                [uuidv4(), propertyId, amenityId]
            );
        }

        await connection.commit();

        // Step 5: Clear Redis cache so updated details appear right away
        await clearListingCache(propertyId);

        req.flash("success", `"${data.title}" has been updated successfully!`);
        return res.redirect(`/host/listings/${propertyId}`);
    } catch (err) {
        await connection.rollback();
        return next(err);
    } finally {
        connection.release();
    }
});

// 7. DELETE /host/listings/:propertyId -> Delete a host's property safely
hostRouter.delete("/listings/:propertyId", async (req, res, next) => {
    const propertyId = req.params.propertyId;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Step 1: Verify ownership
        const propertyResult = await connection.execute(
            `SELECT ID, title FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );

        if (propertyResult[0].length === 0) {
            await connection.rollback();
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const propertyTitle = propertyResult[0][0].title;

        // Step 2: Fetch all rooms of this property
        const roomsResult = await connection.execute(
            `SELECT ID FROM rooms WHERE property_id = ?`,
            [propertyId]
        );
        const rooms = roomsResult[0];

        // Step 3: Block deletion if any room has active (pending or confirmed) bookings
        for (let room of rooms) {
            const activeResult = await connection.execute(
                `SELECT COUNT(*) AS activeCount
                 FROM bookings
                 WHERE ROOM_ID = ? AND STATUS IN ('pending', 'confirmed')`,
                [room.ID]
            );

            if (activeResult[0][0].activeCount > 0) {
                await connection.rollback();
                req.flash("error", "Cannot delete this property because it has active bookings.");
                return res.redirect(`/host/listings/${propertyId}`);
            }
        }

        // Step 4: Delete reviews, bookings, room images, room amenities, and rooms cleanly
        await connection.execute(`DELETE FROM review WHERE property_id = ?`, [propertyId]);

        for (let room of rooms) {
            const bookingRows = await connection.execute(
                `SELECT ID FROM bookings WHERE ROOM_ID = ?`,
                [room.ID]
            );
            for (let booking of bookingRows[0]) {
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

        // Step 5: Clear Redis cache for this property
        await clearListingCache(propertyId);

        req.flash("success", `"${propertyTitle}" has been deleted.`);
        return res.redirect("/host/dashboard");
    } catch (err) {
        await connection.rollback();
        return next(err);
    } finally {
        connection.release();
    }
});

/* ==========================================================================
   ROOM CRUD ROUTES (Inside a Host's Property)
   ========================================================================== */

// 8. GET /host/listings/:propertyId/rooms/new -> Show multipart form to add a new room
hostRouter.get("/listings/:propertyId/rooms/new", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;

        // Step 1: Verify property belongs to the logged-in host
        const propertyResult = await db.execute(
            `SELECT ID, title FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );

        if (propertyResult[0].length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const property = propertyResult[0][0];

        // Step 2: Fetch room amenities from database
        const amenityResult = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'room' ORDER BY NAME ASC`
        );
        const amenities = amenityResult[0];

        return res.render("host/rooms/new", {
            title: `Add Room - ${property.title}`,
            property: property,
            amenities: amenities,
        });
    } catch (err) {
        return next(err);
    }
});

// 9. POST /host/listings/:propertyId/rooms -> Validate with Zod, upload room photos, and save room
hostRouter.post("/listings/:propertyId/rooms", uploadRoomImages, async (req, res, next) => {
    const propertyId = req.params.propertyId;

    // Step 1: Verify property belongs to the logged-in host
    try {
        const propertyResult = await db.execute(
            `SELECT ID FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );
        if (propertyResult[0].length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }
    } catch (err) {
        return next(err);
    }

    // Step 2: Validate room form inputs with Zod + regex
    const validation = roomSchema.safeParse(req.body);

    if (!validation.success) {
        req.flash("error", validation.error.issues[0].message);
        return res.redirect(`/host/listings/${propertyId}/rooms/new`);
    }

    const data = validation.data;
    const requestedAmenities = getUniqueList(data.amenities);
    const roomFiles = req.files || [];

    // Step 3: Upload optional room photos to Cloudinary (up to 4 photos)
    const roomImageUrls = [];

    try {
        for (let file of roomFiles) {
            const uploaded = await uploadBufferToCloudinary(file.buffer, "stayora/rooms");
            roomImageUrls.push(uploaded.url);
        }
    } catch (uploadErr) {
        console.error("Cloudinary room image upload error:", uploadErr);
        req.flash("error", "Failed to upload room images. Please try again.");
        return res.redirect(`/host/listings/${propertyId}/rooms/new`);
    }

    // Step 4: Save room, room images, valid room amenities, and sync property stats
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const roomId = uuidv4();
        const validAmenities = await filterValidAmenities(connection, requestedAmenities, "room");

        await connection.execute(
            `INSERT INTO rooms (ID, property_id, ROOM_TYPE, DESCRIPTION, CAPACITY, TOTAL_ROOMS, PRICE_PER_NIGHT)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [roomId, propertyId, data.roomType, data.description, data.capacity, data.totalRooms, data.pricePerNight]
        );

        for (let imgUrl of roomImageUrls) {
            await connection.execute(
                `INSERT INTO room_images (ID, ROOM_ID, IMAGE_URL) VALUES (?, ?, ?)`,
                [uuidv4(), roomId, imgUrl]
            );
        }

        for (let amenityId of validAmenities) {
            await connection.execute(
                `INSERT INTO room_amenities (ID, ROOM_ID, AMENITY_ID) VALUES (?, ?, ?)`,
                [uuidv4(), roomId, amenityId]
            );
        }

        await syncPropertyRoomStats(connection, propertyId);

        await connection.commit();

        // Step 5: Clear Redis cache so updated rooms show on the public page
        await clearListingCache(propertyId);

        req.flash("success", `Room "${data.roomType}" has been added!`);
        return res.redirect(`/host/listings/${propertyId}`);
    } catch (err) {
        await connection.rollback();
        return next(err);
    } finally {
        connection.release();
    }
});

// 10. GET /host/listings/:propertyId/rooms/:roomId/edit -> Show pre-filled edit form for a room
hostRouter.get("/listings/:propertyId/rooms/:roomId/edit", async (req, res, next) => {
    try {
        const propertyId = req.params.propertyId;
        const roomId = req.params.roomId;

        // Step 1: Verify property belongs to the logged-in host
        const propertyResult = await db.execute(
            `SELECT ID, title FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );

        if (propertyResult[0].length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const property = propertyResult[0][0];

        // Step 2: Fetch room belonging to this property
        const roomResult = await db.execute(
            `SELECT * FROM rooms WHERE ID = ? AND property_id = ?`,
            [roomId, propertyId]
        );

        if (roomResult[0].length === 0) {
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }

        const room = roomResult[0][0];

        // Step 3: Fetch all room amenities
        const allAmenitiesResult = await db.execute(
            `SELECT ID, NAME FROM amenities WHERE CATEGORY = 'room' ORDER BY NAME ASC`
        );
        const amenities = allAmenitiesResult[0];

        // Step 4: Fetch currently checked amenity IDs for this room
        const selectedResult = await db.execute(
            `SELECT AMENITY_ID FROM room_amenities WHERE ROOM_ID = ?`,
            [roomId]
        );
        const selectedAmenityIds = [];
        for (let row of selectedResult[0]) {
            selectedAmenityIds.push(row.AMENITY_ID);
        }

        // Step 5: Fetch existing room photos
        const imagesResult = await db.execute(
            `SELECT ID, IMAGE_URL FROM room_images WHERE ROOM_ID = ?`,
            [roomId]
        );
        const roomImages = imagesResult[0];

        return res.render("host/rooms/edit", {
            title: `Edit ${room.ROOM_TYPE}`,
            property: property,
            room: room,
            amenities: amenities,
            selectedAmenityIds: selectedAmenityIds,
            roomImages: roomImages,
        });
    } catch (err) {
        return next(err);
    }
});

// 11. PUT /host/listings/:propertyId/rooms/:roomId -> Validate with Zod, upload optional photos, update room
hostRouter.put("/listings/:propertyId/rooms/:roomId", uploadRoomImages, async (req, res, next) => {
    const propertyId = req.params.propertyId;
    const roomId = req.params.roomId;

    // Step 1: Verify property ownership and room existence
    try {
        const propertyResult = await db.execute(
            `SELECT ID FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );

        if (propertyResult[0].length === 0) {
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const roomResult = await db.execute(
            `SELECT ID FROM rooms WHERE ID = ? AND property_id = ?`,
            [roomId, propertyId]
        );

        if (roomResult[0].length === 0) {
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }
    } catch (err) {
        return next(err);
    }

    // Step 2: Validate room form inputs with Zod + regex
    const validation = roomSchema.safeParse(req.body);

    if (!validation.success) {
        req.flash("error", validation.error.issues[0].message);
        return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
    }

    const data = validation.data;
    const requestedAmenities = getUniqueList(data.amenities);
    const roomFiles = req.files || [];

    // Step 3: Upload any newly added room photos to Cloudinary
    const newRoomImageUrls = [];

    try {
        for (let file of roomFiles) {
            const uploaded = await uploadBufferToCloudinary(file.buffer, "stayora/rooms");
            newRoomImageUrls.push(uploaded.url);
        }
    } catch (uploadErr) {
        console.error("Cloudinary room image upload error:", uploadErr);
        req.flash("error", "Failed to upload room images. Please try again.");
        return res.redirect(`/host/listings/${propertyId}/rooms/${roomId}/edit`);
    }

    // Step 4: Update room, add new images, refresh valid room amenities, and sync property stats
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

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

        for (let imgUrl of newRoomImageUrls) {
            await connection.execute(
                `INSERT INTO room_images (ID, ROOM_ID, IMAGE_URL) VALUES (?, ?, ?)`,
                [uuidv4(), roomId, imgUrl]
            );
        }

        await connection.execute(
            `DELETE FROM room_amenities WHERE ROOM_ID = ?`,
            [roomId]
        );

        for (let amenityId of validAmenities) {
            await connection.execute(
                `INSERT INTO room_amenities (ID, ROOM_ID, AMENITY_ID) VALUES (?, ?, ?)`,
                [uuidv4(), roomId, amenityId]
            );
        }

        await syncPropertyRoomStats(connection, propertyId);

        await connection.commit();

        // Step 5: Clear Redis cache for this property
        await clearListingCache(propertyId);

        req.flash("success", `Room "${data.roomType}" has been updated!`);
        return res.redirect(`/host/listings/${propertyId}`);
    } catch (err) {
        await connection.rollback();
        return next(err);
    } finally {
        connection.release();
    }
});

// 12. DELETE /host/listings/:propertyId/rooms/:roomId -> Delete a room safely
hostRouter.delete("/listings/:propertyId/rooms/:roomId", async (req, res, next) => {
    const propertyId = req.params.propertyId;
    const roomId = req.params.roomId;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Step 1: Verify property belongs to host and room belongs to property
        const propertyResult = await db.execute(
            `SELECT ID FROM properties WHERE ID = ? AND HOST_ID = ?`,
            [propertyId, req.user.ID]
        );

        if (propertyResult[0].length === 0) {
            await connection.rollback();
            req.flash("error", "Property not found or you do not have access to it.");
            return res.redirect("/host/dashboard");
        }

        const roomResult = await connection.execute(
            `SELECT ID, ROOM_TYPE FROM rooms WHERE ID = ? AND property_id = ?`,
            [roomId, propertyId]
        );

        if (roomResult[0].length === 0) {
            await connection.rollback();
            req.flash("error", "Room not found.");
            return res.redirect(`/host/listings/${propertyId}`);
        }

        const roomType = roomResult[0][0].ROOM_TYPE;

        // Step 2: Block deletion if this room has active (pending or confirmed) bookings
        const activeBookingsResult = await connection.execute(
            `SELECT COUNT(*) AS activeCount
             FROM bookings
             WHERE ROOM_ID = ? AND STATUS IN ('pending', 'confirmed')`,
            [roomId]
        );

        if (activeBookingsResult[0][0].activeCount > 0) {
            await connection.rollback();
            req.flash("error", "Cannot delete this room because it has active bookings.");
            return res.redirect(`/host/listings/${propertyId}`);
        }

        // Step 3: Delete reviews linked to past bookings of this room first (foreign key safety)
        const bookingRows = await connection.execute(
            `SELECT ID FROM bookings WHERE ROOM_ID = ?`,
            [roomId]
        );
        for (let booking of bookingRows[0]) {
            await connection.execute(`DELETE FROM review WHERE BOOKING_ID = ?`, [booking.ID]);
        }

        // Step 4: Delete bookings, room images, room amenities, and the room
        await connection.execute(`DELETE FROM bookings WHERE ROOM_ID = ?`, [roomId]);
        await connection.execute(`DELETE FROM room_images WHERE ROOM_ID = ?`, [roomId]);
        await connection.execute(`DELETE FROM room_amenities WHERE ROOM_ID = ?`, [roomId]);
        await connection.execute(`DELETE FROM rooms WHERE ID = ? AND property_id = ?`, [roomId, propertyId]);

        await syncPropertyRoomStats(connection, propertyId);

        await connection.commit();

        // Step 5: Clear Redis cache for this property
        await clearListingCache(propertyId);

        req.flash("success", `Room "${roomType}" has been deleted.`);
        return res.redirect(`/host/listings/${propertyId}`);
    } catch (err) {
        await connection.rollback();
        return next(err);
    } finally {
        connection.release();
    }
});

// Error-handling middleware for host routes (safe internal redirects only, never open redirect)
hostRouter.use((err, req, res, next) => {
    console.error("Host route error:", err);

    // Pick a safe internal redirect path based on the route URL
    let safeRedirect = "/host/dashboard";
    const pathOnly = req.path || "";

    if (pathOnly === "/listings") {
        safeRedirect = "/host/listings/new";
    } else if (pathOnly.endsWith("/rooms")) {
        safeRedirect = `/host${pathOnly}/new`;
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
