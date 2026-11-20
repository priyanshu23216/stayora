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
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night ASC , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "High to Low" ){
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "Top Rated" ){
            result = await db.execute(`SELECT properties.* FROM properties LEFT JOIN review ON properties.ID = review.property_id ${condition} GROUP BY properties.ID ORDER BY AVG(review.RATING) DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else {
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night ASC , properties.ID LIMIT ? OFFSET ?` , values );
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
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night ASC , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "High to Low" ){
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else if ( sort === "Top Rated" ){
            result = await db.execute(`SELECT properties.* FROM properties LEFT JOIN review ON properties.ID = review.property_id ${condition} GROUP BY properties.ID ORDER BY AVG(review.RATING) DESC , properties.ID LIMIT ? OFFSET ?` , values );
        } else {
            result = await db.execute(`SELECT * FROM properties ${condition} ORDER BY properties.price_per_night ASC , properties.ID LIMIT ? OFFSET ?` , values );
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

//error handling middleware for any unexpected errors in lists route
lists.use(( err , req , res , next)=>{
    res.send("Some unexpected error occured .Please Try Again!");
});


export default lists;