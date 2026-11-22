import express from "express";

const pageRouter = express.Router();

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

export default pageRouter;
