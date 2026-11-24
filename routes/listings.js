import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";
import { isLoggedIn, isValidUuid } from "../middlewares/auth.js";
import { getListingsCacheVersion } from "../utils/redisHelpers.js";

const lists = express.Router();

const ALLOWED_TYPES = new Set([
    "All Types",
    "hotel",
    "resort",
    "villa",
    "apartment",
    "guesthouse",
    "hostel",
]);

const ALLOWED_PRICES = new Set([
    "Any Price",
    "under_3000",
    "3000_5000",
    "5000_10000",
    "10000_20000",
    "above_20000",
]);

const ALLOWED_SORTS = new Set([
    "Low to High",
    "High to Low",
    "Top Rated",
]);

function readSingleQueryString(val, maxLen = 60) {
    if (typeof val !== "string") {
        return "";
    }
    return val.trim().slice(0, maxLen);
}

// Unified, hang-proof, HPP-safe, O(1)-cache-versioned /listings route
lists.get("/", async (req, res, next) => {
    try {
        const city = readSingleQueryString(req.query.city, 60);
        const rawType = readSingleQueryString(req.query.type, 30);
        const rawPrice = readSingleQueryString(req.query.price, 30);
        const rawSort = readSingleQueryString(req.query.sort, 30);

        const type = ALLOWED_TYPES.has(rawType) ? rawType : "All Types";
        const price = ALLOWED_PRICES.has(rawPrice) ? rawPrice : "Any Price";
        const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : "Low to High";

        let page = parseInt(readSingleQueryString(req.query.page, 10), 10);
        if (!Number.isInteger(page) || page < 1) {
            page = 1;
        }
        // Hard upper bound on requested page before querying DB
        if (page > 10000) {
            page = 10000;
        }

        const limit = 12;
        const cacheVersion = await getListingsCacheVersion();
        const cityKey = city ? city.toLowerCase() : "_all";
        const cacheKey = `listings:v${cacheVersion}:${cityKey}:${type}:${price}:${sort}:${page}`;

        const cachedValue = await redis.get(cacheKey);
        if (cachedValue) {
            const parsedObj = JSON.parse(cachedValue);
            return res.render("listings/listings", {
                title: city ? `Stays in ${city}` : "All Stays",
                listings: parsedObj.listings,
                totalPages: parsedObj.totalPages,
                currentPage: parsedObj.currentPage,
                searchQuery: city,
                type,
                price,
                sort,
            });
        }

        const whereClauses = ["properties.verification_status = 'approved'"];
        const values = [];

        if (city) {
            whereClauses.push("properties.city = ?");
            values.push(city);
        }

        if (type !== "All Types") {
            whereClauses.push("properties.PROPERTY_TYPE = ?");
            values.push(type);
        }

        if (price === "under_3000") {
            whereClauses.push("properties.price_per_night < 3000");
        } else if (price === "3000_5000") {
            whereClauses.push("properties.price_per_night BETWEEN 3000 AND 5000");
        } else if (price === "5000_10000") {
            whereClauses.push("properties.price_per_night BETWEEN 5000 AND 10000");
        } else if (price === "10000_20000") {
            whereClauses.push("properties.price_per_night BETWEEN 10000 AND 20000");
        } else if (price === "above_20000") {
            whereClauses.push("properties.price_per_night > 20000");
        }

        const condition = `WHERE ${whereClauses.join(" AND ")}`;

        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total FROM properties ${condition}`,
            values
        );
        const propertiesCount = Number(countRows[0].total);
        const totalPages = Math.max(1, Math.ceil(propertiesCount / limit));

        // Clamp page to valid bounds so out-of-range page numbers never waste DB OFFSET scans
        if (page > totalPages) {
            page = totalPages;
        }
        const offset = (page - 1) * limit;

        const queryValues = [...values, String(limit), String(offset)];
        let listingsResult;

        if (sort === "High to Low") {
            listingsResult = await db.execute(
                `SELECT * FROM properties ${condition} ORDER BY properties.price_per_night DESC, properties.ID LIMIT ? OFFSET ?`,
                queryValues
            );
        } else if (sort === "Top Rated") {
            listingsResult = await db.execute(
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
            listingsResult = await db.execute(
                `SELECT * FROM properties ${condition} ORDER BY properties.price_per_night ASC, properties.ID LIMIT ? OFFSET ?`,
                queryValues
            );
        }

        const listings = listingsResult[0];

        // Only cache non-empty results to prevent Redis cache-bombing with random city names
        if (listings.length > 0) {
            const clampedKey = `listings:v${cacheVersion}:${cityKey}:${type}:${price}:${sort}:${page}`;
            await redis.set(
                clampedKey,
                JSON.stringify({ listings, totalPages, currentPage: page }),
                "EX",
                600
            );
        }

        return res.render("listings/listings", {
            title: city ? `Stays in ${city}` : "All Stays",
            listings,
            currentPage: page,
            totalPages,
            searchQuery: city,
            type,
            price,
            sort,
        });
    } catch (err) {
        return next(err);
    }
});

// Role upgrade MUST be POST (CSRF-protected) to prevent silent GET-based privilege escalation
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

// Single property detail page (dynamic route kept after static routes)
lists.get("/:id", async (req, res, next) => {
    try {
        const propertyId = req.params.id;
        if (!isValidUuid(propertyId)) {
            req.flash("error", "Property not found.");
            return res.redirect("/listings");
        }

        const cacheKey = `property:${propertyId}`;
        const cachedData = await redis.get(cacheKey);

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

        const [propertyRows] = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND verification_status = 'approved'`,
            [propertyId]
        );

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/listings");
        }

        const property = propertyRows[0];

        const [hostRows] = await db.execute(
            `SELECT NAME, avatar_url, is_host_verified FROM users WHERE ID = ?`,
            [property.HOST_ID]
        );
        const host =
            hostRows.length > 0
                ? hostRows[0]
                : { NAME: "Stayora Host", avatar_url: null, is_host_verified: 0 };

        const [propertyImages] = await db.execute(
            `SELECT IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );

        const [propertyAmenities] = await db.execute(
            `SELECT amenities.NAME
             FROM property_amenities
             JOIN amenities ON property_amenities.AMENITY_ID = amenities.ID
             WHERE property_amenities.property_id = ?`,
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
             WHERE rooms.property_id = ?`,
            [propertyId]
        );

        for (const room of rooms) {
            room.images = roomImages.filter((img) => img.ROOM_ID === room.ID);
            room.amenities = roomAmenities.filter((am) => am.ROOM_ID === room.ID);
        }

        const [reviews] = await db.execute(
            `SELECT review.ID, review.RATING, review.COMMENT, users.NAME AS reviewer_name, users.avatar_url AS reviewer_avatar
             FROM review
             JOIN users ON review.USER_ID = users.ID
             WHERE review.property_id = ?`,
            [propertyId]
        );

        let totalRating = 0;
        for (const reviewItem of reviews) {
            totalRating += reviewItem.RATING;
        }
        const avgRating = reviews.length > 0 ? (totalRating / reviews.length).toFixed(1) : 0;

        const dataToCache = {
            property,
            host,
            propertyImages,
            propertyAmenities,
            rooms,
            reviews,
            avgRating,
        };
        await redis.set(cacheKey, JSON.stringify(dataToCache), "EX", 600);

        return res.render("listings/show", {
            title: property.title,
            ...dataToCache,
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
