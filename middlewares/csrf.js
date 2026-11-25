// CSRF (Cross-Site Request Forgery) Protection Middleware
// Protects all POST, PUT, PATCH, and DELETE routes from fake cross-site requests.

import crypto from "crypto";

// Helper 1: Compare two strings safely (prevents timing attacks)
function isTokenMatching(tokenFromForm, tokenInSession) {
    if (typeof tokenFromForm !== "string" || typeof tokenInSession !== "string") {
        return false;
    }

    const bufferA = Buffer.from(tokenFromForm, "utf8");
    const bufferB = Buffer.from(tokenInSession, "utf8");

    // timingSafeEqual requires both buffers to have the exact same length
    if (bufferA.length !== bufferB.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufferA, bufferB);
}

// Helper 2: Check that the request came from our own website (not from evil.com)
function isSameWebsiteRequest(req) {
    // Example serverHost: "localhost:3000" or "stayora.com"
    const rawHost = req.get("host");
    if (!rawHost) {
        return false;
    }

    const allowedHosts = new Set([rawHost.toLowerCase()]);

    // When deployed behind a trusted reverse proxy (Render/Railway/Nginx/Cloudflare),
    // also match X-Forwarded-Host so legitimate users are never blocked with wrong-origin.
    if (req.app && req.app.get("trust proxy")) {
        const forwardedHost = req.get("x-forwarded-host");
        if (forwardedHost) {
            const firstForwarded = forwardedHost.split(",")[0].trim().toLowerCase();
            if (firstForwarded) {
                allowedHosts.add(firstForwarded);
            }
        }
    }

    const matchesAllowedHost = (parsedUrl) => {
        const normalizedHost = parsedUrl.host.toLowerCase();
        const explicitPortHost = `${parsedUrl.hostname.toLowerCase()}:${parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80")}`;
        return allowedHosts.has(normalizedHost) || allowedHosts.has(explicitPortHost);
    };

    // Step A: Check the browser's Origin header (sent automatically on POST/PUT/PATCH/DELETE)
    const originHeader = req.get("origin");
    if (originHeader) {
        try {
            const originUrl = new URL(originHeader);
            return matchesAllowedHost(originUrl);
        } catch (err) {
            // Invalid origin like "null" (e.g. from sandboxed iframe) -> block it
            return false;
        }
    }

    // Step B: If Origin header is missing, check the Referer header as a backup
    const refererHeader = req.get("referer");
    if (refererHeader) {
        try {
            const refererUrl = new URL(refererHeader);
            return matchesAllowedHost(refererUrl);
        } catch (err) {
            return false;
        }
    }

    // Step C: If neither header is sent, allow for now (CSRF token check will still verify logged-in users)
    return true;
}

// Helper 3: Create a secret CSRF token inside Redis session ONLY when a user authenticates
export function ensureCsrfToken(req) {
    // Never create a session or CSRF token for unlogged-in visitors
    if (!req.session || !req.user) {
        return "";
    }

    // If this logged-in user does not have a CSRF token yet, create a random 64-char hex token
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    }

    return req.session.csrfToken;
}

// Helper 4: Send a clean 403 Forbidden response when CSRF check fails
function sendCsrfError(req, res, reason) {
    console.warn(
        `CSRF blocked [${reason}] -> ${req.method} ${req.originalUrl} (origin=${req.get("origin") || "none"}, host=${req.get("host") || "none"})`
    );

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

// Helper 5: Pre-authentication POST routes that verify Origin === Host only (no _csrf token check)
const PRE_AUTH_POST_PATTERNS = [
    /^\/authenticate\/login\/verify\/?$/,
    /^\/authenticate\/signup\/add\/?$/,
    /^\/authenticate\/signup\/verify-otp\/?$/,
    /^\/authenticate\/signup\/resend-otp\/?$/,
    /^\/authenticate\/forgot-password\/submit\/?$/,
    /^\/authenticate\/reset-password\/[^/]+\/?$/,
];

function isPreAuthPostRoute(req) {
    if (req.method !== "POST") {
        return false;
    }
    return PRE_AUTH_POST_PATTERNS.some((pattern) => pattern.test(req.path));
}

// Helper 6: Check if this route is one of the 4 host image upload routes (which use Multer)
// Only these 4 routes parse req.body._csrf AFTER Multer runs.
function isHostImageUploadRoute(req) {
    const path = req.path;

    // 1. POST /host/listings (create new property with images)
    if (req.method === "POST" && /^\/host\/listings\/?$/.test(path)) {
        return true;
    }
    // 2. PUT /host/listings/:propertyId (edit property with images)
    if (req.method === "PUT" && /^\/host\/listings\/[^/]+\/?$/.test(path)) {
        return true;
    }
    // 3. POST /host/listings/:propertyId/rooms (add room with images)
    if (req.method === "POST" && /^\/host\/listings\/[^/]+\/rooms\/?$/.test(path)) {
        return true;
    }
    // 4. PUT /host/listings/:propertyId/rooms/:roomId (edit room with images)
    if (req.method === "PUT" && /^\/host\/listings\/[^/]+\/rooms\/[^/]+\/?$/.test(path)) {
        return true;
    }

    return false;
}

// Middleware A: Verify CSRF token (used globally for normal forms, and right after Multer for image forms)
export function verifyCsrfToken(req, res, next) {
    // GET, HEAD, OPTIONS are read-only requests -> skip CSRF check
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }

    // Step 1: Make sure request came from our own website (Origin/Referer === Host)
    if (!isSameWebsiteRequest(req)) {
        return sendCsrfError(req, res, "wrong-origin");
    }

    // Step 2: Login/signup/password-reset POSTs and unauthenticated visitors only need Origin === Host
    if (!req.user || isPreAuthPostRoute(req)) {
        return next();
    }

    // Step 3: Read the secret token saved in Redis session
    const tokenInSession = req.session ? req.session.csrfToken : "";

    // Step 4: Read the hidden _csrf token sent by the HTML form (or X-CSRF-Token header)
    let tokenFromForm = "";
    if (req.body && typeof req.body._csrf === "string") {
        tokenFromForm = req.body._csrf;
    } else if (req.get("x-csrf-token")) {
        tokenFromForm = req.get("x-csrf-token");
    }

    // Step 5: Match both tokens -> if missing or wrong, block the request with 403!
    if (!tokenInSession || !isTokenMatching(tokenFromForm, tokenInSession)) {
        return sendCsrfError(req, res, "invalid-csrf-token");
    }

    // Both tokens matched -> genuine user request!
    return next();
}

// Middleware B: Main global CSRF middleware mounted in server.js
export function csrfProtection(req, res, next) {
    // Step 1: Expose existing CSRF token to EJS views without ever generating one on GET requests
    if (req.user && req.session && req.session.csrfToken) {
        res.locals.csrfToken = req.session.csrfToken;
    } else {
        res.locals.csrfToken = "";
    }

    // Step 2: Allow safe read-only methods (GET, HEAD, OPTIONS) directly
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
        return next();
    }

    // Step 3: For POST/PUT/PATCH/DELETE, check Origin/Referer first (blocks cross-site attacks early)
    if (!isSameWebsiteRequest(req)) {
        return sendCsrfError(req, res, "wrong-origin");
    }

    // Step 4: For image upload forms (multipart/form-data), req.body is empty until Multer parses it.
    // Let ONLY the 4 allowed host upload routes pass here; those routes call verifyCsrfToken right after Multer.
    if (req.is("multipart/form-data") && isHostImageUploadRoute(req)) {
        return next();
    }

    // Step 5: For all other POST/PUT/PATCH/DELETE requests, verify the CSRF token right now
    return verifyCsrfToken(req, res, next);
}
