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
        let page = parseInt(req.query.page);
        if(!page || page < 0){
            page = 1;
        }
        const limit = 12; // no of rows to be fetched at one time from MySQL and just display that on listings page
        const offset = ( page - 1 ) * limit; // no of start rows to be skipped
        const [listings] = await db.execute(`SELECT * FROM properties WHERE city = ? AND verification_status = 'approved' ORDER BY price_per_night , ID LIMIT ? OFFSET ?`,[city, String(limit), String(offset)]
);
    }
    res.render('listings/listings');
})

lists.get('/update/host' , isLoggedIn, async( req , res , next)=>{
    try{
        if( req.user.ROLE !== 'host'){
        await db.execute('ALTER UPDATE USERS ROLE = ? WHERE ID = ?' , ['host' , req.users.ID] );
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