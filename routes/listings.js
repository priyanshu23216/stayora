import express from 'express';
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import rateLimit from "express-rate-limit";
import passport from "../config/passport.js";
import {sendOtpEmail , resetPassEmail , passChangeAlertEmail} from "../utils/mailer.js";
import crypto from "crypto";
import redis from "../config/redis.js";
import {signupSchema , loginCheck ,resetPassword , emailValidator , otpValidator }from "../utils/validator.js";
import "dotenv/config";




const lists = express.Router();

export const isLoggedIn = (req, res, next) => {
    if (!req.user) {
        req.flash("error", "Please log in first.");
        return res.redirect("/authenticate/login");
    }
    return next();
};

lists.get('/' , async( req , res , next)=>{
     let city = req.query.city;
    if( city ){ // check if city exists in query string and if it exists then remove its additional space
        city = city.trim();
    };
    const type = req.query.type;
    const price = req.query.price;
    const sort = req.query.sort;

    if ( city &&  !type && !price && !sort ){
        let page = parseInt(req.query.page); // to fetch page number in the form of integer
        if(!page || page < 0){
            page = 1;
        }
        // use redis to store caching and if that data is present in redis just render from redis instead of fetching from each time in MySQL
        const cacheKey = `listingsBy : ${city} : ${page}`;
        const cacheValue = await redis.get(cacheKey);
        
        if(cacheValue ){ // if that filtered city already exists in caching then render it simply
            const parsedObj = JSON.parse(cacheValue);
            return res.render('listings/listings' , { listings : parsedObj.listings , totalPages : parsedObj.totalPages , title : `Stays in ${city}` , currentPage : page , searchQuery : city }  );
        }

    const limit = 12; // no of rows to be fetched at one time from MySQL and just display that on listings page
    const offset = ( page - 1 ) * limit; // no of start rows to be skipped

    // to get properties of that searched city sorted by price_per_night in ASC order
    const result = await db.execute(`SELECT * FROM properties WHERE city = ? AND verification_status = 'approved' ORDER BY price_per_night , ID LIMIT ? OFFSET ?`,[city, String(limit), String(offset)] );
    const listings = result[0];

    // to count total number of properties in that city
    const countResult = await db.execute(`SELECT COUNT(*) AS total FROM properties WHERE city = ? AND verification_status = 'approved'`,[city] );
    const propertiesCount = countResult[0][0].total;
    const totalPages = Math.ceil(propertiesCount/12);

    // save that data in redis cache before sending response 
    await redis.set(cacheKey , JSON.stringify({ listings , totalPages}) , "EX" , 600); 

    return res.render('listings/listings' ,  {title : `Stays in ${ city }` , listings , currentPage : page , totalPages , searchQuery : city } );

    }
    if ( !city && type ==="All Types" && price === "Any Price" && sort === "Low to High" ){
        let page = parseInt(req.query.page); // to fetch page number in the form of integer
        if(!page || page < 0){
            page = 1;
        }

        const cacheKey = `listingsBy:${type}:${price}:${sort}:${page}`;
        const cacheValue = await redis.get(cacheKey);

        if ( cacheValue ){
            const parsedObj = JSON.parse(cacheValue);
            return res.render('listings/listings' , { type : type , price : price , sort : sort ,listings : parsedObj.listings , totalPages : parsedObj.totalPages , title : `Stays All` , currentPage : page  });
        };

        const limit = 12;
        const offset = ( page - 1 ) * limit;

         const result = await db.execute(`SELECT * FROM properties WHERE verification_status = 'approved' ORDER BY price_per_night , ID LIMIT ? OFFSET ?`,[String(limit), String(offset)] );
         const listings = result[ 0 ];

         const countResult = await db.execute(`SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'approved'` );
        const propertiesCount = countResult[0][0].total;
         const totalPages = Math.ceil(propertiesCount/12);

         await redis.set(cacheKey , JSON.stringify({listings , totalPages}) , "EX" , 600);

         return res.render('listings/listings' , { type : type , price : price , sort : sort ,title : `Stays All` , listings , currentPage : page , totalPages });
        
    }

    // if neither city nor any filter is selected (default /listings page)
    if ( !city && !type && !price && !sort ){
        let page = parseInt(req.query.page);
        if(!page || page < 0){
            page = 1;
        }

        const cacheKey = `listingsBy:All:${page}`;
        const cacheValue = await redis.get(cacheKey);

        if ( cacheValue ){
            const parsedObj = JSON.parse(cacheValue);
            return res.render('listings/listings' , { listings : parsedObj.listings , totalPages : parsedObj.totalPages , title : `All Stays` , currentPage : page });
        };

        const limit = 12;
        const offset = ( page - 1 ) * limit;

        const result = await db.execute(`SELECT * FROM properties WHERE verification_status = 'approved' ORDER BY price_per_night , ID LIMIT ? OFFSET ?` , [String(limit) , String(offset)] );
        const listings = result[0];

        const countResult = await db.execute(`SELECT COUNT(*) AS total FROM properties WHERE verification_status = 'approved'` );
        const propertiesCount = countResult[0][0].total;
        const totalPages = Math.ceil(propertiesCount/12);

        await redis.set(cacheKey , JSON.stringify({ listings , totalPages }) , "EX" , 600);

        return res.render('listings/listings' , { title : `All Stays` , listings , currentPage : page , totalPages });
    }

    // filters WITHOUT city (type + price + sort)
    if ( !city && type && price && sort ){
        let page = parseInt(req.query.page);
        if(!page || page < 0){
            page = 1;
        }

        const cacheKey = `listingsBy:All:${type}:${price}:${sort}:${page}`;
        const cacheValue = await redis.get(cacheKey);

        if ( cacheValue ){
            const parsedObj = JSON.parse(cacheValue);
            return res.render('listings/listings' , { type : type , price : price , sort : sort , listings : parsedObj.listings , totalPages : parsedObj.totalPages , title : `Stays All` , currentPage : page });
        };

        const limit = 12;
        const offset = ( page - 1 ) * limit;

        let condition = `WHERE properties.verification_status = 'approved'`;
        let values = [];

        if ( type !== "All Types" ){
            condition = condition + ` AND properties.PROPERTY_TYPE = ?`;
            values.push(type);
        }

        if ( price === "under_3000" ){
            condition = condition + ` AND properties.price_per_night < 3000`;
        } else if ( price === "3000_5000" ){
            condition = condition + ` AND properties.price_per_night BETWEEN 3000 AND 5000`;
        } else if ( price === "5000_10000" ){
            condition = condition + ` AND properties.price_per_night BETWEEN 5000 AND 10000`;
        } else if ( price === "10000_20000" ){
            condition = condition + ` AND properties.price_per_night BETWEEN 10000 AND 20000`;
        } else if ( price === "above_20000" ){
            condition = condition + ` AND properties.price_per_night > 20000`;
        }

        const countResult = await db.execute(`SELECT COUNT(*) AS total FROM properties ${condition}` , values );
        const propertiesCount = countResult[0][0].total;
        const totalPages = Math.ceil(propertiesCount/12);

        values.push(String(limit));
        values.push(String(offset));

        let result;
        if ( sort === "Low to High" ){
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night  , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "High to Low" ){
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "Top Rated" ){
            result = await db.execute(`SELECT properties.* FROM properties LEFT JOIN review ON properties.ID = review.property_id ${condition} GROUP BY properties.ID ORDER BY AVG(review.RATING) DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else {
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night  , properties.ID LIMIT ? OFFSET ?` , values );
        }

        const listings = result[0];

        await redis.set(cacheKey , JSON.stringify({ listings , totalPages }) , "EX" , 600);

        return res.render('listings/listings' , { type : type , price : price , sort : sort , title : `Stays All` , listings , currentPage : page , totalPages });
    }

    // filters WITH city (city + type + price + sort)
    if ( city && type && price && sort ){
        let page = parseInt(req.query.page);
        if(!page || page < 0){
            page = 1;
        }

        const cacheKey = `listingsBy:${city}:${type}:${price}:${sort}:${page}`;
        const cacheValue = await redis.get(cacheKey);

        if ( cacheValue ){
            const parsedObj = JSON.parse(cacheValue);
            return res.render('listings/listings' , { searchQuery : city , type : type , price : price , sort : sort , listings : parsedObj.listings , totalPages : parsedObj.totalPages , title : `Stays in ${city}` , currentPage : page });
        };

        const limit = 12;
        const offset = ( page - 1 ) * limit;

        let condition = `WHERE properties.verification_status = 'approved' AND properties.city = ?`;
        let values = [city];

        if ( type !== "All Types" ){
            condition = condition + ` AND properties.PROPERTY_TYPE = ?`;
            values.push(type);
        }

        if ( price === "under_3000" ){
            condition = condition + ` AND properties.price_per_night < 3000`;
        } else if ( price === "3000_5000" ){
            condition = condition + ` AND properties.price_per_night BETWEEN 3000 AND 5000`;
        } else if ( price === "5000_10000" ){
            condition = condition + ` AND properties.price_per_night BETWEEN 5000 AND 10000`;
        } else if ( price === "10000_20000" ){
            condition = condition + ` AND properties.price_per_night BETWEEN 10000 AND 20000`;
        } else if ( price === "above_20000" ){
            condition = condition + ` AND properties.price_per_night > 20000`;
        }

        const countResult = await db.execute(`SELECT COUNT(*) AS total FROM properties ${condition}` , values );
        const propertiesCount = countResult[0][0].total;
        const totalPages = Math.ceil(propertiesCount/12);

        values.push(String(limit));
        values.push(String(offset));

        let result;
        if ( sort === "Low to High" ){
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night  , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "High to Low" ){
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "Top Rated" ){
            result = await db.execute(`SELECT properties.* FROM properties LEFT JOIN review ON properties.ID = review.property_id ${condition} GROUP BY properties.ID ORDER BY AVG(review.RATING) DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else {
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night  , properties.ID LIMIT ? OFFSET ?` , values );
        }

        const listings = result[0];

        await redis.set(cacheKey , JSON.stringify({ listings , totalPages }) , "EX" , 600);

        return res.render('listings/listings' , { searchQuery : city , type : type , price : price , sort : sort , title : `Stays in ${city}` , listings , currentPage : page , totalPages });
    }
    
})

lists.get('/update/host' , isLoggedIn, async( req , res , next)=>{
    try{
        if( req.user.ROLE !== 'host'){
        await db.execute('UPDATE USERS SET ROLE = ? WHERE ID = ?' , ['host' , req.user.ID] );
        req.flash("success" , "Welcome to Stayora Hosting! You're ready to list your first stay.");
        return res.redirect('/');
    };
    }catch( err ){
        return next( err );
    };
});

// to view a particular listed property , always write dynamic routes at last after static routes to avoid conflicts
lists.get('/:id' , async(req , res , next )=>{
    try {
        const propertyId = req.params.id;
        const cacheKey = `property:${propertyId}`;

        // Step 1: Check if this property's data is already saved in Redis cache
        const cachedData = await redis.get(cacheKey);

        if (cachedData) {
            const parsedData = JSON.parse(cachedData);

            return res.render('listings/show', {
                title: parsedData.property.title,
                property: parsedData.property,
                host: parsedData.host,
                propertyImages: parsedData.propertyImages,
                propertyAmenities: parsedData.propertyAmenities,
                rooms: parsedData.rooms,
                reviews: parsedData.reviews,
                avgRating: parsedData.avgRating
            });
        }

        // Step 2: Fetch property details from MySQL
        const propertyResult = await db.execute(
            `SELECT * FROM properties WHERE ID = ? AND verification_status = 'approved'`,
            [propertyId]
        );
        const propertyRows = propertyResult[0];

        if (propertyRows.length === 0) {
            req.flash("error", "Property not found.");
            return res.redirect("/listings");
        }

        const property = propertyRows[0];

        // Step 3: Fetch host details using property.HOST_ID
        const hostResult = await db.execute(
            `SELECT NAME, avatar_url, is_host_verified FROM users WHERE ID = ?`,
            [property.HOST_ID]
        );
        const hostRows = hostResult[0];
        let host = null;
        if (hostRows.length > 0) {
            host = hostRows[0];
        } else {
            host = { NAME: "Stayora Host", avatar_url: null, is_host_verified: 0 };
        }

        // Step 4: Fetch all gallery images of this property
        const propertyImagesResult = await db.execute(
            `SELECT IMAGE_URL FROM property_images WHERE property_id = ?`,
            [propertyId]
        );
        const propertyImages = propertyImagesResult[0];

        // Step 5: Fetch all amenities of this property
        const propertyAmenitiesResult = await db.execute(
            `SELECT amenities.NAME
             FROM property_amenities
             JOIN amenities ON property_amenities.AMENITY_ID = amenities.ID
             WHERE property_amenities.property_id = ?`,
            [propertyId]
        );
        const propertyAmenities = propertyAmenitiesResult[0];

        // Step 6: Fetch all rooms of this property (sorted from lowest to highest price)
        const roomsResult = await db.execute(
            `SELECT * FROM rooms WHERE property_id = ? ORDER BY PRICE_PER_NIGHT ASC`,
            [propertyId]
        );
        const rooms = roomsResult[0];

        // Step 7: Fetch all images of rooms belonging to this property
        const roomImagesResult = await db.execute(
            `SELECT room_images.ROOM_ID, room_images.IMAGE_URL
             FROM room_images
             JOIN rooms ON room_images.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?`,
            [propertyId]
        );
        const roomImages = roomImagesResult[0];

        // Step 8: Fetch all amenities of rooms belonging to this property
        const roomAmenitiesResult = await db.execute(
            `SELECT room_amenities.ROOM_ID, amenities.NAME
             FROM room_amenities
             JOIN amenities ON room_amenities.AMENITY_ID = amenities.ID
             JOIN rooms ON room_amenities.ROOM_ID = rooms.ID
             WHERE rooms.property_id = ?`,
            [propertyId]
        );
        const roomAmenities = roomAmenitiesResult[0];

        // Step 9: Attach each room's images and amenities inside that room object
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

        // Step 10: Fetch all reviews and reviewer details for this property
        const reviewsResult = await db.execute(
            `SELECT review.ID, review.RATING, review.COMMENT, users.NAME AS reviewer_name, users.avatar_url AS reviewer_avatar
             FROM review
             JOIN users ON review.USER_ID = users.ID
             WHERE review.property_id = ?`,
            [propertyId]
        );
        const reviews = reviewsResult[0];

        // Step 11: Calculate average rating from all reviews
        let totalRating = 0;
        for (let reviewItem of reviews) {
            totalRating = totalRating + reviewItem.RATING;
        }

        let avgRating = 0;
        if (reviews.length > 0) {
            avgRating = (totalRating / reviews.length).toFixed(1);
        } else {
            avgRating = 0;
        }

        // Step 12: Save all fetched data in Redis cache for 10 minutes (600 seconds)
        const dataToCache = {
            property: property,
            host: host,
            propertyImages: propertyImages,
            propertyAmenities: propertyAmenities,
            rooms: rooms,
            reviews: reviews,
            avgRating: avgRating
        };
        await redis.set(cacheKey, JSON.stringify(dataToCache), "EX", 600);

        // Step 13: Render the single property detail page
        return res.render('listings/show', {
            title: property.title,
            property: property,
            host: host,
            propertyImages: propertyImages,
            propertyAmenities: propertyAmenities,
            rooms: rooms,
            reviews: reviews,
            avgRating: avgRating
        });
    } catch (err) {
        return next(err);
    }
});

//error handling middleware for any unexpected errors in lists route
lists.use(( err , req , res , next)=>{
    req.flash("error" ,"Some unexpected error occured,Please Try Again!");
    return res.redirect('/');
});




export default lists;