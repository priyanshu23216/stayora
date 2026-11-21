// Shared authentication & role-based authorization middlewares

export const isLoggedIn = (req, res, next) => {
    if (!req.user) {
        req.flash("error", "Please log in first.");
        return res.redirect("/authenticate/login");
    }
    return next();
};

export const isHost = (req, res, next) => {
    if (req.user.ROLE !== "host") {
        req.flash("error", "Access denied. Host account required.");
        return res.redirect("/");
    }
    return next();
};

export const isGuest = (req, res, next) => {
    // Hosts can also browse/book stays as guests; restrict to "guest" only if needed
    if (req.user.ROLE !== "guest" && req.user.ROLE !== "host") {
        req.flash("error", "Access denied.");
        return res.redirect("/");
    }
    return next();
};

export const isAdmin = (req, res, next) => {
    if (req.user.ROLE !== "admin") {
        req.flash("error", "Access denied. Admin privileges required.");
        return res.redirect("/");
    }
    return next();
};
