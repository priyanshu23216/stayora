import express from "express";
import db from "../config/db.js";
import redis from "../config/redis.js";

const pageRouter = express.Router();

// Explore by Category Page (with Redis caching)
pageRouter.get("/categories", async (req, res, next) => {
    try {
        const cacheKey = "categories:all";

        // Step 1: Check if categories data is already stored in Redis cache
        const cachedData = await redis.get(cacheKey);

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
        await redis.set(cacheKey, JSON.stringify(categories), "EX", 600);

        // Step 5: Render the categories EJS page
        return res.render("pages/categories", {
            title: "Categories",
            categories: categories
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
