import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn, isValidUuid } from "../middlewares/auth.js";
import { getListingsCacheVersion } from "../utils/redisHelpers.js";

const lists = express.Router();

// Allowed filter values (prevents invalid or fake query params from hitting DB/Redis)
const ALLOWED_TYPES = ["All Types", "hotel", "resort", "villa", "apartment", "guesthouse", "hostel"];
const ALLOWED_PRICES = ["Any Price", "under_3000", "3000_5000", "5000_10000", "10000_20000", "above_20000"];
const ALLOWED_SORTS = ["Low to High", "High to Low", "Top Rated"];

// Helper: Safely read a query parameter as a single clean string
// (Protects against URL tricks like ?city=Goa&city=Mumbai where req.query.city becomes an Array)
function getCleanQueryText(value, maxLength) {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().slice(0, maxLength);
}

// 1. GET /listings -> Show approved stays with optional city, type, price, sort, and pagination
lists.get("/", async (req, res, next) => {
    try {
        // Step 1: Read and clean all filter inputs from URL query string
        const city = getCleanQueryText(req.query.city, 60);
        const rawType = getCleanQueryText(req.query.type, 30);
        const rawPrice = getCleanQueryText(req.query.price, 30);
        const rawSort = getCleanQueryText(req.query.sort, 30);

        // Use default values if user didn't pass a filter or passed an invalid one
        let type = "All Types";
        if (ALLOWED_TYPES.includes(rawType)) {
            type = rawType;
        }

        let price = "Any Price";
        if (ALLOWED_PRICES.includes(rawPrice)) {
            price = rawPrice;
        }

        let sort = "Low to High";
        if (ALLOWED_SORTS.includes(rawSort)) {
            sort = rawSort;
        }

        // Step 2: Read page number safely (12 properties per page)
        let page = parseInt(getCleanQueryText(req.query.page, 10), 10);
        if (!page || page < 1) {
            page = 1;
        }
        if (page > 10000) {
            page = 10000;
        }

        const limit = 12;

        // Step 3: Check Redis cache first using O(1) cache version number (fall back to MySQL if Redis is down)
        const cacheVersion = await getListingsCacheVersion();
        const cityKey = city ? city.toLowerCase() : "all";
        const cacheKey = `listings:v${cacheVersion}:${cityKey}:${type}:${price}:${sort}:${page}`;

        let cachedValue = null;
        try {
            cachedValue = await redis.get(cacheKey);
        } catch (cacheErr) {
            console.error("Listings cache read error (falling back to MySQL):", cacheErr.message);
        }

        if (cachedValue) {
            const parsedObj = JSON.parse(cachedValue);
            return res.render("listings/listings", {
                title: city ? `Stays in ${city}` : "All Stays",
                listings: parsedObj.listings,
                totalPages: parsedObj.totalPages,
                currentPage: parsedObj.currentPage,
                searchQuery: city,
                type: type,
                price: price,
                sort: sort,
            });
        }

        // Step 4: Build SQL WHERE conditions safely using ? placeholders
        let condition = "WHERE properties.verification_status = 'approved'";
        const values = [];

        if (city) {
            condition = condition + " AND properties.city = ?";
            values.push(city);
        }

        if (type !== "All Types") {
            condition = condition + " AND properties.PROPERTY_TYPE = ?";
            values.push(type);
        }

        if (price === "under_3000") {
            condition = condition + " AND properties.price_per_night < 3000";
        } else if (price === "3000_5000") {
            condition = condition + " AND properties.price_per_night BETWEEN 3000 AND 5000";
        } else if (price === "5000_10000") {
            condition = condition + " AND properties.price_per_night BETWEEN 5000 AND 10000";
        } else if (price === "10000_20000") {
            condition = condition + " AND properties.price_per_night BETWEEN 10000 AND 20000";
        } else if (price === "above_20000") {
            condition = condition + " AND properties.price_per_night > 20000";
        }

        // Step 5: Count total matching properties & keep page number inside valid range
        const countResult = await db.execute(
            `SELECT COUNT(*) AS total FROM properties ${condition}`,
            values
        );
        const totalProperties = Number(countResult[0][0].total);

        let totalPages = Math.ceil(totalProperties / limit);
        if (totalPages < 1) {
            totalPages = 1;
        }
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        // Step 6: Fetch 12 properties for this page with chosen sorting
        const queryValues = [...values, String(limit), String(offset)];
        let result;

        if (sort === "High to Low") {
            result = await db.execute(
                `SELECT * FROM properties ${condition} ORDER BY properties.price_per_night DESC, properties.ID LIMIT ? OFFSET ?`,
                queryValues
            );
        } else if (sort === "Top Rated") {
            result = await db.execute(
                `SELECT properties.*
                 FROM properties
                 LEFT JOIN review ON properties.ID = review.property_id
                 ${condition}
                 GROUP BY properties.ID
                 ORDER BY AVG(review.RATING) DESC, properties.ID
                 LIMIT ? OFFSET ?`,
                queryValues
            );
        } else {
            result = await db.execute(
                `SELECT * FROM properties ${condition} ORDER BY properties.price_per_night ASC, properties.ID LIMIT ? OFFSET ?`,
                queryValues
            );
        }

        const listings = result[0];

        // Step 7: Save non-empty results in Redis for 10 minutes (skip empty results to save Redis memory)
        if (listings.length > 0) {
            const finalCacheKey = `listings:v${cacheVersion}:${cityKey}:${type}:${price}:${sort}:${page}`;
            try {
                await redis.set(
                    finalCacheKey,
                    JSON.stringify({ listings: listings, totalPages: totalPages, currentPage: page }),
                    "EX",
                    600
                );
            } catch (cacheErr) {
                console.error("Listings cache write error:", cacheErr.message);
            }
        }

        return res.render("listings/listings", {
            title: city ? `Stays in ${city}` : "All Stays",
            listings: listings,
            currentPage: page,
            totalPages: totalPages,
            searchQuery: city,
            type: type,
            price: price,
            sort: sort,
        });
    } catch (err) {
        return next(err);
    }
});

// 2. GET /listings/update/host -> Read-only route for unlogged-in "+ Become a Host" clicks
// Never changes database on GET! If user is logged out, isLoggedIn flashes "Please log in first."
lists.get("/update/host", isLoggedIn, (req, res) => {
    if (req.user.ROLE === "host") {
        return res.redirect("/host/dashboard");
    }
    if (req.user.ROLE === "admin") {
        req.flash("error", "Admin accounts cannot be switched to host accounts.");
        return res.redirect("/");
    }
    return res.redirect("/");
});

// 3. POST /listings/update/host -> Upgrades a logged-in guest to host (CSRF-protected!)
lists.post("/update/host", isLoggedIn, async (req, res, next) => {
    try {
        if (req.user.ROLE === "admin") {
            req.flash("error", "Admin accounts cannot be switched to host accounts.");
            return res.redirect("/");
        }

        if (req.user.ROLE !== "host") {
            await db.execute("UPDATE users SET ROLE = ? WHERE ID = ?", ["host", req.user.ID]);
            req.user.ROLE = "host";
            req.flash("success", "Welcome to Stayora Hosting! You're ready to list your first stay.");
        }

        return res.redirect("/host/dashboard");
    } catch (err) {
        return next(err);
    }
});

// 4. GET /listings/:id -> Show full details of a single approved property (kept last after static routes)
lists.get("/:id", async (req, res, next) => {
    try {
        const propertyId = req.params.id;

        // Reject invalid UUID format before querying Redis or MySQL
        if (!isValidUuid(propertyId)) {
            req.flash("error", "Property not found.");
            return res.redirect("/listings");
        }

        const cacheKey = `property:${propertyId}`;

        // Step 1: Check Redis cache first (fall back to MySQL if Redis is down)
        let cachedData = null;
        try {
            cachedData = await redis.get(cacheKey);
        } catch (cacheErr) {
            console.error("Property cache read error (falling back to MySQL):", cacheErr.message);
        }

        if (cachedData) {
            const parsedData = JSON.parse(cachedData);
            return res.render("listings/show", {
                title: parsedData.property.title,
                property: parsedData.property,
                host: parsedData.host,
                propertyImages: parsedData.propertyImages,
                propertyAmenities: parsedData.propertyAmenities,
                rooms: parsedData.rooms,
                reviews: parsedData.reviews,
                avgRating: parsedData.avgRating,
            });
        }

        // Step 2: Fetch approved property from MySQL
        const propertyResult = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND verification_status = 'approved'`,
            [propertyId]
        );
        if (propertyResult[0].length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/listings");
        }
        const property = propertyResult[0][0];

        // Step 3: Fetch host info
        const hostResult = await db.execute(
            `SELECT NAME, avatar_url, is_host_verified FROM users WHERE ID = ?`,
            [property.HOST_ID]
        );
        let host = { NAME: "Stayora Host", avatar_url: null, is_host_verified: 0 };
        if (hostResult[0].length > 0) {
            host = hostResult[0][0];
        }

        // Step 4: Fetch gallery images, amenities, rooms, room images, and room amenities
        const imagesResult = await db.execute(
            `SELECT IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );
        const propertyImages = imagesResult[0];

        const amenitiesResult = await db.execute(
            `SELECT amenities.NAME
             FROM property_amenities
             JOIN amenities ON property_amenities.AMENITY_ID = amenities.ID
             WHERE property_amenities.property_id = ?`,
            [propertyId]
        );
        const propertyAmenities = amenitiesResult[0];

        const roomsResult = await db.execute(
            `SELECT * FROM rooms WHERE property_id = ? ORDER BY PRICE_PER_NIGHT ASC`,
            [propertyId]
        );
        const rooms = roomsResult[0];

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
             WHERE rooms.property_id = ?`,
            [propertyId]
        );
        const roomAmenities = roomAmenitiesResult[0];

        // Attach each room's images and amenities to that room object
        for (let room of rooms) {
            room.images = [];
            room.amenities = [];

            for (let img of roomImages) {
                if (img.ROOM_ID === room.ID) {
                    room.images.push(img);
                }
            }
            for (let am of roomAmenities) {
                if (am.ROOM_ID === room.ID) {
                    room.amenities.push(am);
                }
            }
        }

        // Step 5: Fetch reviews (newest first) and calculate average rating
        const reviewsResult = await db.execute(
            `SELECT review.ID, review.RATING, review.COMMENT, users.NAME AS reviewer_name, users.avatar_url AS reviewer_avatar
             FROM review
             JOIN users ON review.USER_ID = users.ID
             WHERE review.property_id = ?
             ORDER BY review.CREATED_AT DESC`,
            [propertyId]
        );
        const reviews = reviewsResult[0];

        let totalRating = 0;
        for (let rev of reviews) {
            totalRating = totalRating + rev.RATING;
        }
        let avgRating = 0;
        if (reviews.length > 0) {
            avgRating = (totalRating / reviews.length).toFixed(1);
        }

        // Step 6: Save in Redis cache for 10 minutes
        const dataToCache = {
            property: property,
            host: host,
            propertyImages: propertyImages,
            propertyAmenities: propertyAmenities,
            rooms: rooms,
            reviews: reviews,
            avgRating: avgRating,
        };
        try {
            await redis.set(cacheKey, JSON.stringify(dataToCache), "EX", 600);
        } catch (cacheErr) {
            console.error("Property cache write error:", cacheErr.message);
        }

        return res.render("listings/show", {
            title: property.title,
            property: property,
            host: host,
            propertyImages: propertyImages,
            propertyAmenities: propertyAmenities,
            rooms: rooms,
            reviews: reviews,
            avgRating: avgRating,
        });
    } catch (err) {
        return next(err);
    }
});

// Error handling middleware for listings routes
lists.use((err, req, res, next) => {
    console.error("Listings route error:", err);
    req.flash("error", "Some unexpected error occurred. Please try again!");
    return res.redirect("/");
});

export default lists;
