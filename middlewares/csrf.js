import crypto from "crypto";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function timingSafeMatch(a, b) {
    if (typeof a !== "string" || typeof b !== "string") {
        return false;
    }
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function isSameOriginHeaderValid(req) {
    const expectedHost = req.get("host");
    if (!expectedHost) {
        return false;
    }

    const origin = req.get("origin");
    if (origin) {
        try {
            return new URL(origin).host === expectedHost;
        } catch {
            return false;
        }
    }

    const referer = req.get("referer");
    if (referer) {
        try {
            return new URL(referer).host === expectedHost;
        } catch {
            return false;
        }
    }

    // No Origin or Referer header (e.g., direct API/curl/same-origin non-referrer clients)
    // CSRF token check still strictly protects the request.
    return true;
}

export function ensureCsrfToken(req) {
    if (!req.session) {
        return "";
    }
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }
    return req.session.csrfToken;
}

export function rotateCsrfToken(req) {
    if (!req.session) {
        return "";
    }
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    return req.session.csrfToken;
}

function rejectCsrf(req, res) {
    if (req.accepts("html")) {
        return res.status(403).render("pages/error", {
            title: "403 Forbidden",
            statusCode: 403,
            heading: "Security verification failed",
            message: "Your session or security token was invalid or expired. Please go back, refresh the page, and try again.",
        });
    }
    return res.status(403).json({ error: "Invalid or missing CSRF token." });
}

// Verifies CSRF token after body (including multipart via multer) is parsed
export function verifyCsrfToken(req, res, next) {
    if (SAFE_METHODS.has(req.method)) {
        return next();
    }

    if (!isSameOriginHeaderValid(req)) {
        return rejectCsrf(req, res);
    }

    const sessionToken = req.session?.csrfToken;
    const submittedToken =
        (req.body && typeof req.body._csrf === "string" && req.body._csrf) ||
        req.get("x-csrf-token") ||
        "";

    if (!sessionToken || !timingSafeMatch(submittedToken, sessionToken)) {
        return rejectCsrf(req, res);
    }

    return next();
}

// Only these exact host upload routes legitimately accept multipart/form-data via Multer
const MULTIPART_CSRF_DEFERRED_ROUTES = [
    { method: "POST", pattern: /^\/host\/listings\/?$/ },
    { method: "PUT", pattern: /^\/host\/listings\/[^/]+\/?$/ },
    { method: "POST", pattern: /^\/host\/listings\/[^/]+\/rooms\/?$/ },
    { method: "PUT", pattern: /^\/host\/listings\/[^/]+\/rooms\/[^/]+\/?$/ },
];

function isAllowedMultipartDeferredRoute(req) {
    return MULTIPART_CSRF_DEFERRED_ROUTES.some(
        (rule) => rule.method === req.method && rule.pattern.test(req.path)
    );
}

// Global CSRF middleware mounted after sessionMiddleware & passport.session()
export function csrfProtection(req, res, next) {
    const token = ensureCsrfToken(req);
    res.locals.csrfToken = token;

    if (SAFE_METHODS.has(req.method)) {
        return next();
    }

    // Always verify Origin/Referer before any body/file parsing
    if (!isSameOriginHeaderValid(req)) {
        return rejectCsrf(req, res);
    }

    // Defer _csrf body verification ONLY on allowlisted Multer routes (which run verifyCsrfToken right after Multer)
    if (req.is("multipart/form-data") && isAllowedMultipartDeferredRoute(req)) {
        return next();
    }

    return verifyCsrfToken(req, res, next);
}
