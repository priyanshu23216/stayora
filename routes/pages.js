import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";

const pageRouter = express.Router();

// Explore by Category Page (with Redis caching)
pageRouter.get("/categories", async (req, res, next) => {
    try {
        const cacheKey = "categories:all";

        // Step 1: Check if categories data is already stored in Redis cache (fall back to MySQL if Redis is down)
        let cachedData = null;
        try {
            cachedData = await redis.get(cacheKey);
        } catch (cacheErr) {
            console.error("Categories cache read error (falling back to MySQL):", cacheErr.message);
        }

        if (cachedData) {
            const parsedCategories = JSON.parse(cachedData);
            return res.render("pages/categories", {
                title: "Categories",
                categories: parsedCategories
            });
        }

        // Step 2: List of all property categories to fetch from MySQL
        const categoryList = [
            { type: "hotel", heading: "Hotels", description: "Boutique and classic hotels with full-service comfort." },
            { type: "resort", heading: "Resorts", description: "Relaxing getaways with pools, spas, and scenic views." },
            { type: "villa", heading: "Villas", description: "Private luxury villas ideal for families and group escapes." },
            { type: "apartment", heading: "Apartments", description: "Modern urban apartments with home-like convenience." },
            { type: "guesthouse", heading: "Guesthouses", description: "Warm, peaceful homestays and heritage guesthouses." },
            { type: "hostel", heading: "Hostels", description: "Budget-friendly social stays for solo travellers and backpackers." }
        ];

        const categories = [];

        // Step 3: Fetch 4 approved properties for each category
        for (let categoryItem of categoryList) {
            const result = await db.execute(
                `SELECT ID, title, image, city, state, price_per_night, PROPERTY_TYPE
                 FROM properties
                 WHERE PROPERTY_TYPE = ? AND verification_status = 'approved'
                 ORDER BY price_per_night ASC
                 LIMIT 4`,
                [categoryItem.type]
            );
            const properties = result[0];

            categories.push({
                type: categoryItem.type,
                heading: categoryItem.heading,
                description: categoryItem.description,
                properties: properties
            });
        }

        // Step 4: Save the categories array in Redis cache for 10 minutes (600 seconds)
        try {
            await redis.set(cacheKey, JSON.stringify(categories), "EX", 600);
        } catch (cacheErr) {
            console.error("Categories cache write error:", cacheErr.message);
        }

        // Step 5: Render the categories EJS page
        return res.render("pages/categories", {
            title: "Categories",
            categories: categories
        });
    } catch (err) {
        return next(err);
    }
});

// Popular Destinations Page (with 10-minute Redis caching)
pageRouter.get("/destinations", async (req, res, next) => {
    try {
        const cacheKey = "destinations:popular";

        // Step 1: Check if popular destinations data is already cached in Redis (fall back to MySQL if Redis is down)
        let cachedData = null;
        try {
            cachedData = await redis.get(cacheKey);
        } catch (cacheErr) {
            console.error("Destinations cache read error (falling back to MySQL):", cacheErr.message);
        }

        if (cachedData) {
            const parsedDestinations = JSON.parse(cachedData);
            return res.render("pages/destinations", {
                title: "Popular Destinations",
                destinations: parsedDestinations,
            });
        }

        // Step 2: Fetch top 12 cities with the most approved stays from MySQL
        const [cityRows] = await db.execute(
            `SELECT city,
                    state,
                    COUNT(*) AS stay_count,
                    MIN(price_per_night) AS min_price
             FROM properties
             WHERE verification_status = 'approved'
             GROUP BY city, state
             ORDER BY stay_count DESC, city ASC
             LIMIT 12`
        );

        // Step 3: Pick 1 cover photo for each destination city
        const destinations = [];
        for (let row of cityRows) {
            const [imageRows] = await db.execute(
                `SELECT image
                 FROM properties
                 WHERE city = ? AND verification_status = 'approved'
                 ORDER BY price_per_night DESC
                 LIMIT 1`,
                [row.city]
            );

            let coverImage = "/images/hero-villa.jpg";
            if (imageRows.length > 0 && imageRows[0].image) {
                coverImage = imageRows[0].image;
            }

            destinations.push({
                city: row.city,
                state: row.state,
                stayCount: Number(row.stay_count || 0),
                minPrice: Number(row.min_price || 0).toLocaleString("en-IN"),
                image: coverImage,
            });
        }

        // Step 4: Save destinations in Redis cache for 10 minutes (600 seconds)
        try {
            await redis.set(cacheKey, JSON.stringify(destinations), "EX", 600);
        } catch (cacheErr) {
            console.error("Destinations cache write error:", cacheErr.message);
        }

        // Step 5: Render the Popular Destinations EJS page
        return res.render("pages/destinations", {
            title: "Popular Destinations",
            destinations: destinations,
        });
    } catch (err) {
        return next(err);
    }
});

// Company Pages
pageRouter.get("/about", (req, res) => {
    return res.render("pages/about", { title: "About Stayora" });
});

pageRouter.get("/contact", (req, res) => {
    return res.render("pages/contact", { title: "Contact Us" });
});

// Support & Legal Pages
pageRouter.get("/help", (req, res) => {
    return res.render("pages/help", { title: "Help Centre" });
});

pageRouter.get("/privacy", (req, res) => {
    return res.render("pages/privacy", { title: "Privacy Policy" });
});

pageRouter.get("/terms", (req, res) => {
    return res.render("pages/terms", { title: "Terms & Conditions" });
});

// Error-handling middleware for pages routes
pageRouter.use((err, req, res, next) => {
    console.error("Pages route error:", err);
    req.flash("error", "Something went wrong. Please try again.");
    return res.redirect("/");
});

export default pageRouter;
