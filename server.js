import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import methodOverride from "method-override";
import expressLayouts from "express-ejs-layouts";
import sessionMiddleware from "./config/session.js";
import flash from "connect-flash";
import helmet from "helmet";

import db from "./config/db.js";
import redis from "./config/redis.js";
import passport from "./config/passport.js";
import users from "./routes/authentication.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layouts/boilerplate.ejs");

app.use(helmet()); // to protect from XSS attacks and other vulnerabilities
app.use(express.static(path.join(__dirname, "public")));// to serve static files from the public directory
app.use(express.urlencoded({ extended: true }));// to parse incoming request bodies
app.use(express.json());// to parse incoming request bodies
app.use(methodOverride("_method"));// to override HTTP methods as forms only support GET and POST methods, this middleware allows us to use PUT and DELETE methods by adding a query parameter _method to the request URL.
app.use(sessionMiddleware);// to manage user sessions and store session data in Redis database for better performance and scalability
app.use(passport.initialize());// to initialize passport middleware for authentication
app.use(passport.session());// to connect passport with express-session middleware and manage user sessions
app.use(flash()); // to display flash messages to users after certain actions, such as successful login , Logout or signup

app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    next();
});

app.use('/authenticate', users);

app.get("/", (req, res) => {
    res.render("index", { title: "Home" });
});

app.listen(process.env.PORT, () => {
    console.log(`Server is listening on port ${process.env.PORT}`);
});
