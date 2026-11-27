<div align="center">

  <h1>🏨 Stayora</h1>

  <h3>A Modern, Resilient &amp; Security-Hardened Hospitality Booking Platform</h3>

  <p>
    Discover curated stays, villas, vacation rentals, boutique hotels, and unforgettable hospitality experiences.
  </p>

  <p>
    <img src="https://img.shields.io/badge/Status-In%20Active%20Development-orange?style=for-the-badge">
    <img src="https://img.shields.io/badge/Domain-Hospitality%20%26%20Travel-6B46C1?style=for-the-badge">
    <img src="https://img.shields.io/badge/Node.js-20%2B-green?style=for-the-badge&logo=node.js">
    <img src="https://img.shields.io/badge/Express-5.x-black?style=for-the-badge&logo=express">
    <img src="https://img.shields.io/badge/MySQL-8.x-blue?style=for-the-badge&logo=mysql">
    <img src="https://img.shields.io/badge/Redis-6.x-red?style=for-the-badge&logo=redis">
    <img src="https://img.shields.io/badge/Validation-Zod-3E67B1?style=for-the-badge&logo=zod">
    <img src="https://img.shields.io/badge/Media-Cloudinary-3448C5?style=for-the-badge&logo=cloudinary">
  </p>

  <p>
    <strong>Stayora</strong> is a full-stack hospitality marketplace engineered to connect travelers, property hosts, and platform administrators. Built with an 11-table MySQL relational schema, Redis session &amp; O(1) versioned query caching, race-condition-safe transactional room bookings with peak nightly occupancy checks, a <strong>My Bookings</strong> dashboard with policy-snapshotted cancellations, auto check-out completion sync &amp; verified guest reviews, a complete Host Portal (Property &amp; Room CRUD, automatic re-moderation on edits, and a <strong>Guest Bookings &amp; Revenue</strong> dashboard), an Admin Moderation Portal (Approve / Reject / Host Verification with strict separation of duties and automated emails), Popular Destinations &amp; Category discovery pages, Cloudinary multi-image uploads with binary magic-byte validation, login-time synchronizer-token CSRF protection, strict RBAC &amp; IDOR/BOLA protection, atomic Redis Lua rate limiters, Zod + regex validation, and verified Google OAuth 2.0.
  </p>

</div>

---

## 📌 Architectural Highlights

- **Clean Hospitality Relational Model:** 11-table MySQL schema with foreign keys and relational integrity across `users`, `properties`, `rooms`, photo galleries, `amenities`, `review` (with `UNIQUE KEY (BOOKING_ID)` &amp; `CHECK (RATING BETWEEN 1 AND 5)`), `bookings`, and `payments` — including `bookings.cancellation_policy` snapshots and `users.session_version` for instant cross-device session revocation.
- **Complete Host Portal — Property/Room CRUD &amp; Guest Bookings (`/host`):** Full property management (`/host/dashboard`, create, view more, edit, delete), nested room management (`/host/listings/:propertyId/rooms/*`), and a dedicated **Guest Bookings** management console (`/host/bookings`) featuring auto check-out completion sync, 4 KPI cards (All, Upcoming &amp; Ongoing, Completed, **Earned Revenue** excluding cancellations), segmented status tabs, IDOR-safe property filter dropdown, guest contact details (name, email, phone), booking references, and deterministic 10-per-page pagination. All property/room writes use transactional MySQL queries, pessimistic `FOR UPDATE` locks, automatic property stat syncing, post-approval re-moderation, active-booking guards, and Apple-like frosted-glass confirmation modals.
- **Admin Moderation Portal &amp; Separation of Duties (`/admin`):** Role-protected moderation panel (`/admin/dashboard`) with KPI summary cards, segmented `All` / `Pending` / `Approved` / `Rejected` tabs, 12-per-page pagination, full property/room review pages (`/admin/listings/:propertyId`), **Approve** (blocked if 0 bookable rooms exist, with automated host notification email), Apple-like **Reject / Delist** modal with Zod-validated reasons &amp; active-booking warning alerts, and atomic **Verified Host** badge toggling (`users.is_host_verified`). Admin accounts follow strict separation of duties — blocked from bookings, reviews, host upgrades, and Google OAuth auto-linking.
- **Race-Condition-Safe Booking Engine &amp; Confirmation Emails (`/bookings`):** End-to-end room reservation flow (`/bookings/new/:roomId`) powered by MySQL ACID transactions, pessimistic row-level locking (`SELECT ... FOR UPDATE`), **peak nightly occupancy** calculation across `[checkIn, checkOut)` (avoiding false sold-out blocks on sequential stays), strict calendar-date &amp; stay-horizon bounds (max 60 nights, max 365 days advance, max 15 active bookings per user), same-day check-in cutoff enforcement, double-submit protection (client + server), `bookings.cancellation_policy` snapshotting, backend price calculation, host self-booking prevention, and non-blocking confirmation emails (`utils/mailer.js`).
- **My Bookings, Policy-Snapshotted Cancellations &amp; Verified Guest Reviews (`/guest/dashboard`):** Accessible to guests and hosts (`isLoggedIn` + `isGuest`). Features live MySQL reads, timezone-consistent auto check-out completion sync (`confirmed` → `completed`), live `Ongoing` stay detection, 4 KPI cards, segmented tabs, 10-per-page pagination, and a frosted-glass cancellation modal powered by `utils/cancellationPolicy.js` (Flexible 24h, Free 48h, 4-tier Moderate 5d/3d/48h, and Strict 7d slabs). Completed stays unlock a **1-time Verified Review Modal** (1–5 star picker + 10–1000 char comment) protected by Zod validation, rate limiting, ownership + `completed`-only checks, DB `UNIQUE KEY (BOOKING_ID)` race protection, and instant property/listings cache refresh.
- **Property, Category &amp; Popular Destinations Discovery:** Unified, hang-proof, HPP-safe stays catalog (`/listings`) with city autocomplete, persistent property type/price/sort filters, URL-encoded pagination, **Popular Destinations** showcase (`/destinations` — top cities by stay count with starting `₹` prices), **Category Discovery** (`/categories`), and full stay detail views (`/listings/:id`) showcasing photo galleries, verified host badges, amenities, room tiers, and newest-first star-rated reviews.
- **High-Performance Redis Layer &amp; O(1) Cache Invalidation:** Redis-backed session persistence (`ioredis` + `connect-redis`), OTP/reset-token storage, 10-minute TTL caching for `/listings`, `/categories` (`categories:all`), `/destinations` (`destinations:popular`), and `/listings/:id` (`property:${id}`), using an **O(1) version counter** (`stayora:listings:version`) instead of blocking `KEYS *` scans — automatically invalidated across all host CRUD, admin moderation, and guest review mutations, and never caching empty queries to prevent cache-bombing DoS.

---

## 🛡️ Security Architecture & Hardening

Stayora implements **Defense in Depth** across every layer of the request pipeline:

### 1. CSRF, Cross-Origin & Session Cookie Protection (`middlewares/csrf.js`, `config/session.js`, `server.js`)
- **Zero Session & Zero CSRF Token Creation on `GET`:** Unauthenticated `GET` requests (including `/favicon.ico` and `/.well-known` probes) never create a Redis session or cookie (`saveUninitialized: false`, conditional flash reads), preventing Redis session-flooding DoS. Even for logged-in users, `GET` requests **never generate** CSRF tokens — `csrfProtection` only reads an existing `req.session.csrfToken` into `res.locals.csrfToken`.
- **Login-Time Synchronizer Token Pattern:** A 256-bit cryptographically random CSRF token (`crypto.randomBytes(32)`) is generated **once inside the Redis session when authentication succeeds** (`POST /authenticate/login/verify`, `POST /authenticate/signup/verify-otp`, and `GET /authenticate/google/callback`), embedded via `<input type="hidden" name="_csrf">` across all state-changing EJS forms, and verified with `crypto.timingSafeEqual` on every authenticated `POST`, `PUT`, `PATCH`, and `DELETE` request.
- **Origin / Referer Verification & Proxy Hardening:** Pre-auth `POST` routes (login, signup, OTP, forgot/reset password) enforce same-origin (`Origin` / `Referer` host === server `Host`) without false `_csrf` lockouts; all authenticated mutations enforce **both** `Origin`/`Referer` and `_csrf`. Supports `X-Forwarded-Host` (strictly when `TRUST_PROXY=1` or `NODE_ENV=production`) and explicit `:80`/`:443` ports while rejecting cross-origin and `Origin: null` requests (`403 Forbidden`).
- **Browser-Safe `Referrer-Policy`:** Configures Helmet with `Referrer-Policy: strict-origin-when-cross-origin` (instead of Helmet's `no-referrer` default) so browsers send the real `Origin` on same-site `POST` forms while stripping paths/tokens on cross-origin navigations and HTTPS→HTTP downgrades.
- **Multipart Bypass Prevention:** `multipart/form-data` CSRF deferral is strictly restricted to an explicit allowlist of the 4 Multer host upload routes (which run `verifyCsrfToken` immediately after Multer); all other routes reject multipart requests without a valid CSRF token (`403 Forbidden`).
- **Strict Session Cookies:** Custom cookie name (`stayora.sid`), `httpOnly: true`, `sameSite: "lax"`, `secure: true` in production, 7-day expiry, `trust proxy` support, and startup `SESSION_SECRET` minimum-length enforcement.
- **Safe HTTP Methods Only:** All state-mutating actions (`POST /listings/update/host`, `POST /authenticate/logout`, approve/reject/delete/cancel) require `POST` / `PUT` / `PATCH` / `DELETE` — zero state changes on `GET`.

### 2. Authentication, OTP & Session Security (`routes/authentication.js`, `config/passport.js`)
- **OTP Brute-Force Lockout & Cleanup:** IP + email rate limiting on `/signup/verify-otp` and `/signup/resend-otp`; **5 failed guesses** immediately invalidate and delete the OTP in Redis; timing-safe SHA-256 hash comparison; all pending Redis keys are consumed and deleted upon successful registration.
- **Instant Cross-Device Session Revocation:** `users.session_version` is embedded in Passport serialization and verified on every request in `deserializeUser`. Password resets atomically increment `session_version`, immediately invalidating all previously logged-in sessions.
- **Hardened Local & Google OAuth 2.0:** 12-round `bcrypt` hashing with strict 72-byte password cap (preventing bcrypt silent truncation and CPU DoS), `IS_VERIFIED` check, uniform login error messaging, verified Google email enforcement (`email_verified === true`), blocking silent OAuth auto-linking for `admin` accounts, and optional `FOUNDER_EMAIL` Jarvis-style admin welcome toast.
- **Timing-Safe Password Recovery:** 32-byte SHA-256 hashed Redis reset tokens (10-min TTL) with asynchronous email dispatch to eliminate SMTP response-time user enumeration.
- **Atomic Redis Lua Rate Limiters (`utils/redisHelpers.js`):** All auth, OTP, booking, review, and host upload rate limiters execute an atomic Lua `INCR` + `EXPIRE` script so crashes can never leave permanent lockout keys; login counters are keyed per `(IP + email)` and cleared on successful login to prevent remote account-lockout DoS.

### 3. Access Control, Headers, Input Validation & Crash-Proof Error Handling
- **Layered RBAC, Separation of Duties, IDOR/BOLA & UUID Guards (`middlewares/auth.js`):** Router-level `isLoggedIn`, `isGuest`, `isHost`, `isAdmin` guards (strictly blocking `admin` accounts from `/bookings/*`, `/guest/*`, `/host/*`, and host upgrades, with `Admin View Only` UI cues), strict UUID validation on all dynamic route params, and ownership checks (`AND HOST_ID = ?` / `AND USER_ID = ?`) verified **before** Multer buffers uploaded files into RAM.
- **Binary Magic-Byte Image Validation (`utils/imageValidation.js`):** Inspects raw file headers (JPEG, PNG, WEBP, AVIF) in addition to Multer MIME filtering and 5 MB limits, enforces total photo caps (12 gallery / 8 room), and cleans up orphaned Cloudinary assets on upload failure or DB rollback (`destroyCloudinaryAssets`).
- **End-to-End Zod & Regex Schemas (`utils/validator.js`):** Strict schemas with max lengths, enum-locked cancellation policies, strict non-rollover `YYYY-MM-DD` date checks (`bookingSchema`), verified review validation (`reviewSchema`: 1–5 integer stars + 10–1000 char comment), and angle-bracket filtering.
- **Helmet Security Headers, CSP & Payload Limits (`server.js`):** Enforces strict CSP (`default-src 'self'`, `script-src 'self'`, `script-src-attr 'none'`, `frame-ancestors 'self'`, allowlisted `img-src`/`style-src`/`font-src`, production-only `upgrade-insecure-requests`), `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `COOP: same-origin`, `CORP: same-origin`, `100 KB` JSON &amp; URL-encoded payload caps, and global rate limiting (`600 req / 15 min / IP`).
- **XSS, Email HTML Injection, SQL Injection & Safe Error Pages:** 100% parameterized `mysql2` prepared statements (with lowercase `users` table naming for Linux MySQL compatibility), auto-escaped EJS views, `escapeHtml()` + subject header sanitization across all outbound emails (`utils/mailer.js`), early template-local initialization before rate limiting &amp; body parsing, and branded `400` / `403` / `404` / `413` / `429` / `500` error pages (`views/pages/error.ejs`) that never crash layouts or leak stack traces.

---

## 🗄️ Hospitality Database Architecture (11 Relational Tables)

| Table | Purpose |
|---|---|
| `users` | Stores guests, hosts, and administrator profiles, credentials, `IS_VERIFIED`, `is_host_verified`, `session_version` (for session revocation), and OAuth identifiers. |
| `properties` | Core stay catalogue (`hotel`, `resort`, `hostel`, `guesthouse`, `villa`, `apartment`) with geolocation, pricing, availability &amp; verification status, `verified_by_admin_user_id`, `verified_at`, `rejection_reason`, policies, and descriptions. |
| `property_images` | High-resolution property showcase galleries and exterior photographs. |
| `rooms` | Room categories, guest capacities, total room inventory counts (`TOTAL_ROOMS`), and nightly pricing tiers. |
| `room_images` | Interior room photographs and gallery thumbnails. |
| `bookings` | Reservation lifecycles tracking check-in, check-out, guest count, total amount, snapshotted `cancellation_policy`, and status (`pending`, `confirmed`, `cancelled`, `completed`). |
| `review` | Verified guest ratings, stay feedback, and property reviews linked to completed bookings. |
| `amenities` | Master catalogue of property-level (`property`) and room-level (`room`) amenities. |
| `property_amenities` | Junction table mapping property-wide amenities (`property_id` → `properties.ID`). |
| `room_amenities` | Junction table mapping room-specific amenities (`ROOM_ID` → `rooms.ID`). |
| `payments` | Transaction logs, currency management, payment gateways, and settlement receipts (schema ready for payment gateway integration). |

---

## 🛠️ Technology Stack

### Frontend & Client Experience
- **Templating:** EJS (Embedded JavaScript) with `express-ejs-layouts`
- **Design System:** Clean Apple-inspired mobile-first UI with **Inter** / SF Pro typography, frosted-glass modals, segmented filter controls, and responsive sticky navigation across homepage, auth flows, discovery, checkout, My Bookings dashboard, host dashboard, admin portal, and branded error pages
- **Client Scripts:** CSP-compliant external Vanilla JavaScript (`navbar.js`, `signupValidate.js`, `resetPassValidate.js`, `resendOTP.js`, `bookingPrice.js`, `guestBookings.js`, `hostBookings.js`, `hostNewListing.js`, `hostProperty.js`, `hostRoomForm.js`, `adminReview.js`)

### Backend Engineering
- **Runtime:** Node.js (v20+, ES Modules)
- **Framework:** Express.js (v5.x) with `method-override` and `uuid`
- **Validation Engine:** **Zod** schema validation + **Regex** pattern enforcement
- **Authentication:** Passport.js (`passport-local`, `passport-google-oauth20`), `bcrypt`
- **Session Store:** `express-session`, `connect-redis`, `ioredis`
- **Security & Protection:** Custom Synchronizer-Token CSRF middleware (`middlewares/csrf.js`), `helmet`, `express-rate-limit`, atomic Redis Lua limiters, binary magic-byte image checks, `connect-flash`
- **Storage & CDN:** `multer`, `cloudinary`
- **Email Engine:** Resend HTTPS API (with HTML escaping &amp; header sanitization)
- **Seeding & Mock Data:** `@faker-js/faker`

### Data Storage & In-Memory Layer
- **Relational DB:** MySQL 8.x (`mysql2` connection pool with ACID transactions &amp; row locking)
- **Cache & TTL Store:** Redis (`ioredis`)

---

## 📂 Project Directory Structure

```text
Stayora/
├── config/                    # Service initializations & cloud integrations
│   ├── cloudinary.js          # Cloudinary SDK configuration
│   ├── db.js                  # MySQL connection pool configuration
│   ├── multer.js              # Multer memory storage with MIME filter & 5 MB limit
│   ├── passport.js            # Local & verified Google OAuth strategies + session_version check
│   ├── redis.js               # Redis client & cache settings
│   └── session.js             # Express-session (stayora.sid, SameSite=Lax, HttpOnly) & RedisStore
├── middlewares/               # Shared Express middlewares
│   ├── auth.js                # Auth, RBAC guards (isLoggedIn, isHost, isGuest, isAdmin) & UUID helper
│   └── csrf.js                # Synchronizer-token CSRF, Origin/Referer check & multipart allowlist
├── routes/                    # Modular Express route handlers
│   ├── authentication.js      # Auth (Signup, OTP lockout, Login, OAuth, Password Recovery, POST Logout)
│   ├── listings.js            # Unified hang-proof stays discovery, O(1) cache & POST host upgrade
│   ├── booking.js             # Room checkout, ACID peak-occupancy engine & policy snapshotting
│   ├── host.js                # Protected Host Dashboard, Guest Bookings (/host/bookings), Property/Room CRUD & re-moderation
│   ├── admin.js               # Protected Admin Dashboard, Approve/Reject moderation & atomic host verify
│   ├── guest.js               # Protected My Bookings dashboard, auto check-out sync, transactional cancel & verified reviews
│   └── pages.js               # Popular Destinations (/destinations), Categories (/categories) & Company/Support/Legal pages
├── scripts/                   # Utility & database scripts
│   ├── migrate-security.js    # Idempotent migration adding bookings.cancellation_policy & users.session_version
│   └── seed.js                # Seeds 2,000 properties, rooms, users & 3,000 reviews (blocked in production)
├── utils/                     # Reusable utilities and validators
│   ├── cancellationPolicy.js  # Safe date/timestamp helpers & multi-tier refund eligibility engine
│   ├── cloudinaryUpload.js    # Streams Multer buffers to Cloudinary CDN + rollback cleanup helper
│   ├── imageValidation.js     # Binary magic-byte validator for JPEG, PNG, WEBP & AVIF buffers
│   ├── mailer.js              # HTML-escaped transactional emails (OTP, booking, cancellation, moderation, alerts)
│   ├── redisHelpers.js        # Atomic Lua INCR+EXPIRE rate limiter & O(1) listings/categories/destinations cache invalidation
│   └── validator.js           # Zod & regex schemas for auth, bookings, reviews, properties, rooms & admin
├── public/                    # Static assets
│   ├── css/                   # Apple-like stylesheets (navbar, home, listings, show, booking, guest, host, admin, pages, auth, footer)
│   ├── images/                # Editorial homepage imagery (hero & spotlight assets)
│   └── js/                    # External CSP-safe scripts (navbar, signupValidate, resetPassValidate, resendOTP, bookingPrice, guestBookings, hostBookings, host*, adminReview)
├── views/                     # EJS template views (all state-changing forms include hidden _csrf tokens)
│   ├── admin/                 # Admin Portal views (dashboard.ejs, show.ejs)
│   ├── auth/                  # Auth views (login, signup, enter-otp, forgot-password, reset-password)
│   ├── bookings/              # Room checkout view (new.ejs)
│   ├── guest/                 # My Bookings view (dashboard.ejs) with Cancel & Verified Review Modals
│   ├── host/                  # Host Portal views (dashboard, bookings, new, show, edit, rooms/new, rooms/edit)
│   ├── layouts/               # Master layout (boilerplate.ejs)
│   ├── listings/              # Stays catalog & property detail views (listings.ejs, show.ejs)
│   ├── pages/                 # Editorial info, discovery, legal & error views (about, categories, contact, destinations, error, help, privacy, terms)
│   ├── partials/              # Reusable components (navbar.ejs, footer.ejs)
│   └── index.ejs              # Editorial landing page
├── .env.example               # Example environment configuration
├── .gitignore                 # Git ignore patterns (node_modules, .env)
├── server.js                  # Application entry point, security middleware pipeline & 404/500 handlers
├── package.json
└── README.md
```

---

## ⚙️ Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20 or higher)
- [MySQL Server](https://www.mysql.com/) (v8.0+)
- [Redis Server](https://redis.io/) (Local or cloud instance)

### 1. Clone the repository
```bash
git clone https://github.com/priyanshu23216/stayora.git
cd stayora
```

### 2. Install dependencies
```bash
npm install
```

### 3. Setup Environment Variables
Create a `.env` file in the root directory by copying from `.env.example`:
```bash
cp .env.example .env
```

Configure your credentials inside `.env`:
```env
PORT=8080
NODE_ENV=development
TRUST_PROXY=0
APP_URL=http://localhost:8080
SESSION_SECRET=your_super_secret_session_key_min_16_chars

# Optional founder greeting email
FOUNDER_EMAIL=

# MySQL Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=STAYORA

# Redis Configuration
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Google OAuth 2.0 Credentials
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:8080/authenticate/google/callback

# Resend Transactional Email API
RESEND_API_KEY=re_your_resend_api_key
EMAIL_FROM=Stayora <noreply@bookstayora.in>
SUPPORT_EMAIL=support@bookstayora.in

# Cloudinary Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 4. Run Security Schema Migration
Ensure the `bookings.cancellation_policy` and `users.session_version` columns exist (safe &amp; idempotent):
```bash
node scripts/migrate-security.js
```

### 5. Seed Sample Data (Optional — Development Only)
Populate your MySQL database with 2,000 properties across 24 Indian destinations, 101 users (1 admin: `admin@stayora.dev`, 40 hosts, 60 guests — shared seed password `Stayora@123`), 24 amenities, room tiers, and 3,000 completed bookings &amp; reviews. *(Refuses to run when `NODE_ENV=production`.)*
```bash
node scripts/seed.js
```

### 6. Run the Application
```bash
# Development mode with hot-reloading
npx nodemon server.js

# Production start
node server.js
```
Open **`http://localhost:8080`** (or your configured `PORT`) in your browser.

---

## 🚦 API & Route Specifications

> All authenticated state-changing `POST`, `PUT`, `PATCH`, and `DELETE` endpoints verify **both** matching `Origin`/`Referer` === `Host` **and** a valid Redis-backed session CSRF token (`_csrf` form field or `X-CSRF-Token` header). Pre-auth `POST` endpoints (login, signup, OTP, password recovery) verify `Origin`/`Referer` === `Host`. `GET` requests never mutate state and never generate sessions or CSRF tokens.

### Core, Categories, Company & Legal Pages (`/`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Renders the Stayora editorial landing page (`views/index.ejs`). |
| `GET` | `/destinations` | Renders Popular Destinations showcase (`views/pages/destinations.ejs`) backed by 10-minute Redis caching (`destinations:popular`), automatically invalidated on property/room CRUD, moderation, and review updates. |
| `GET` | `/categories` | Renders property categories showcase backed by 10-minute Redis caching (`categories:all`). |
| `GET` | `/about` | Renders About Stayora, vision, and Founder &amp; CEO profile. |
| `GET` | `/contact` | Renders Contact Us page with support phone and email details. |
| `GET` | `/help` | Renders Help Centre with support categories and FAQ accordion. |
| `GET` | `/privacy` | Renders Privacy Policy page. |
| `GET` | `/terms` | Renders Terms &amp; Conditions page. |

### Stays Discovery, Details & Host Onboarding (`/listings`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/listings` | Displays paginated approved stays (12 per page) with any combination of `city`, `type`, `price`, `sort` (`Low to High`, `High to Low`, `Top Rated`), and `page` params. HPP-safe, bounds-clamped, backed by O(1) versioned Redis caching (`listings:v*`). |
| `GET` | `/listings/update/host` | Read-only redirect route (`isLoggedIn`). Never mutates DB on `GET`; prompts logged-out visitors to log in or redirects existing hosts/admins safely. |
| `POST` | `/listings/update/host` | Protected (`isLoggedIn` + CSRF). Upgrades a `guest` account's `ROLE` to `host` (blocks `admin` downgrade) and redirects to `/host/dashboard`. |
| `GET` | `/listings/:id` | UUID-validated property detail page (`views/listings/show.ejs`) with host details, photo gallery, amenities, room tiers, star-rated reviews, and 10-minute Redis caching (`property:${id}`). |

### Host Dashboard, Property & Room CRUD (`/host`)
All `/host/*` routes are protected by `isLoggedIn` + `isHost` RBAC middleware, enforce `HOST_ID = req.user.ID` ownership checks (before Multer file buffering), and rate-limit uploads.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/host/dashboard` | Displays all properties listed by the logged-in host (newest first) with status badges, upcoming guest bookings badge, and `+ New Listing` CTA. |
| `GET` | `/host/bookings` | Displays all guest reservations across the logged-in host's properties with auto check-out completion sync, 4 KPI cards (All, Upcoming &amp; Ongoing, Completed, Earned Revenue), segmented status tabs, IDOR-safe property filter dropdown, guest contact details, policy snapshots, and 10-per-page pagination. |
| `GET` | `/host/listings/new` | Renders the multipart form to create a new property with property-level amenities. |
| `POST` | `/host/listings` | Rate-limited, CSRF-verified, Zod-validated (`newListingSchema`), binary magic-byte checked, streams cover &amp; gallery images to Cloudinary (with rollback cleanup), inserts property + images + amenities (`verification_status = 'pending'`). |
| `GET` | `/host/listings/:propertyId` | **View More** page showing full property details, rejection reason banner (if rejected), gallery, amenities, Edit/Delete actions, and all nested rooms. |
| `GET` | `/host/listings/:propertyId/edit` | Renders the pre-filled multipart edit form for a host's property. |
| `PUT` | `/host/listings/:propertyId` | Ownership checked pre-Multer, CSRF-verified, validates `editListingSchema` + magic bytes + 12-image gallery cap, re-syncs room stats, resets `verification_status` to `'pending'` on material content edits or rejected listings, and bumps O(1) Redis cache version. |
| `DELETE` | `/host/listings/:propertyId` | Locks rooms `FOR UPDATE`; blocks deletion if active upcoming bookings exist (`CHECK_OUT_DATE >= CURDATE()`); otherwise deletes child records and property in a transaction and invalidates cache. |
| `GET` | `/host/listings/:propertyId/rooms/new` | Renders the multipart form to add a new room type with room-level amenities. |
| `POST` | `/host/listings/:propertyId/rooms` | Ownership checked pre-Multer, CSRF-verified, validates `roomSchema` + magic bytes, uploads up to 4 room photos, auto-syncs `properties` stats, and invalidates cache. |
| `GET` | `/host/listings/:propertyId/rooms/:roomId/edit` | Renders the pre-filled multipart edit form for a specific room. |
| `PUT` | `/host/listings/:propertyId/rooms/:roomId` | Locks room `FOR UPDATE`, blocks reducing `TOTAL_ROOMS` or `CAPACITY` below active upcoming bookings, enforces 8-image room cap, updates room + amenities, re-syncs stats, and invalidates cache. |
| `DELETE` | `/host/listings/:propertyId/rooms/:roomId` | Locks room `FOR UPDATE`, blocks deletion if active upcoming bookings exist, safely removes linked records in a single transaction connection, re-syncs `properties` stats (marking unavailable if 0 rooms remain), and invalidates cache. |

### Admin Moderation Portal (`/admin`)
All `/admin/*` routes are protected by `isLoggedIn` + `isAdmin` RBAC middleware and UUID param validation.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/dashboard` | Displays 4 KPI summary cards (`Pending Review`, `Approved Stays`, `Rejected Stays`, `Total Bookings`), segmented tabs (`All`, `Pending`, `Approved`, `Rejected`), and 12-per-page pagination. |
| `GET` | `/admin/listings/:propertyId` | Full moderation review page showing photos, description, specs, host details with verified badge toggle, and all nested rooms. |
| `PATCH` | `/admin/listings/:propertyId/approve` | Verifies at least 1 bookable room exists, marks property `approved`, records admin ID &amp; timestamp, invalidates property + O(1) listings caches, and emails the host (`sendPropertyApprovedEmail`). |
| `PATCH` | `/admin/listings/:propertyId/reject` | Validates `rejectionReason` (`rejectPropertySchema`), marks property `rejected`, warns admin if upcoming guest bookings exist, invalidates caches, and emails the host (`sendPropertyRejectedEmail`). |
| `PATCH` | `/admin/hosts/:hostId/verify` | Atomically toggles `users.is_host_verified` (`1` ↔ `0`) in SQL and clears that host's cached property detail pages. |

### Room Booking Engine (`/bookings`)
All `/bookings/*` routes are protected by `isLoggedIn` + `isGuest` (accessible to guests and hosts) and UUID validation.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/bookings/new/:roomId` | Validates room &amp; property status, prevents host self-booking, and renders the booking checkout page (`views/bookings/new.ejs`) with live price calculation &amp; double-submit lock. |
| `POST` | `/bookings/new/:roomId` | Rate-limited, CSRF-verified, Zod-validated (`bookingSchema`, max 60 nights, max 365 days advance, max 15 active bookings/user, 2-min duplicate-submit guard). Executes MySQL transaction with `SELECT ... FOR UPDATE`, computes **peak nightly occupancy**, snapshots `cancellation_policy`, commits booking, sends confirmation email, and redirects to `/guest/dashboard`. |

### My Bookings & Cancellations (`/guest`)
All `/guest/*` routes are protected by `isLoggedIn` + `isGuest` (guests &amp; hosts only; admin accounts blocked) and enforce `USER_ID = req.user.ID` ownership checks.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/guest/dashboard` | Auto-syncs past confirmed stays to `completed` (using consistent local timestamps), fetches KPI summary cards, segmented tabs, 10-per-page paginated bookings, `Ongoing` stay detection, and refund eligibility using each booking's snapshotted policy. |
| `PATCH` | `/guest/bookings/:bookingId/cancel` | UUID-validated &amp; CSRF-verified. Locks booking `FOR UPDATE` (`USER_ID = req.user.ID`), verifies `now < checkIn`, calculates exact refund % and `₹` amount from the snapshotted policy, atomically marks `cancelled`, releases room inventory immediately, and sends an itemized cancellation email. |
| `POST` | `/guest/bookings/:bookingId/review` | Rate-limited (10/15 min), CSRF-verified, UUID &amp; Zod-validated (`reviewSchema`: 1–5 stars + 10–1000 char comment). Enforces booking ownership (`USER_ID = req.user.ID`), `completed`-only status, 1 final review per booking (`UNIQUE KEY`), saves to `review`, and invalidates property &amp; listings caches immediately. |

### Authentication & Account Recovery (`/authenticate`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/authenticate/login` | Renders user sign-in portal (zero session/CSRF token created on `GET`). |
| `POST` | `/authenticate/login/verify` | Origin/Referer verified; authenticates via local strategy with atomic Redis IP &amp; `(IP + email)` rate limiting (cleared on success), generates `req.session.csrfToken` once on login, and triggers optional Jarvis founder toast (`FOUNDER_EMAIL`). |
| `GET` | `/authenticate/signup` | Renders guest registration form with scoped client-side validation (`signupValidate.js`). |
| `POST` | `/authenticate/signup/add` | Rate-limited &amp; Origin/Referer verified; validates via `signupSchema` (max 72-byte password), sends 6-digit OTP (10-min TTL), and caches pending signup in Redis. |
| `POST` | `/authenticate/signup/verify-otp` | IP rate-limited &amp; Origin/Referer verified; timing-safe SHA-256 OTP check with **5-attempt lockout** (invalidates OTP in Redis), consumes/deletes all OTP Redis keys, creates verified user, establishes session, and generates `req.session.csrfToken`. |
| `POST` | `/authenticate/signup/resend-otp` | IP + email rate-limited (max 3/15 min), Zod-validated &amp; Origin/Referer verified; generates fresh OTP and resets failed-attempt counter. |
| `GET` | `/authenticate/google` | Triggers Google OAuth 2.0 consent flow. |
| `GET` | `/authenticate/google/callback` | Verifies Google email (`email_verified === true`), blocks silent admin auto-linking, establishes session, and generates `req.session.csrfToken`. |
| `GET` | `/authenticate/forgot-password` | Renders password recovery request form. |
| `POST` | `/authenticate/forgot-password/submit` | Atomic IP + email rate-limited &amp; Origin/Referer verified; generates SHA-256 hashed 32-byte Redis token (10-min TTL) and dispatches email asynchronously (preventing timing enumeration). |
| `GET` | `/authenticate/forgot-password/:token` | Rate-limited; validates 64-hex token format &amp; Redis TTL and renders reset-password form (or redirects cleanly to `/authenticate/forgot-password`). |
| `POST` | `/authenticate/reset-password/:token` | Rate-limited &amp; Origin/Referer verified; updates `bcrypt` hash, **increments `users.session_version`** to revoke all active sessions, deletes reset token, and emails a security alert. |
| `POST` | `/authenticate/logout` | Origin/Referer + CSRF-token verified; logs out via Passport 0.7 (regenerating &amp; clearing the old Redis session) and flashes confirmation. |

---

## 📈 Hospitality Engineering Roadmap

- [x] Comprehensive 11-table relational database architecture with foreign key integrity, booking policy snapshots, and `session_version` tracking
- [x] Redis-backed session store (`connect-redis` + `ioredis`) with `stayora.sid`, `HttpOnly`, and `SameSite: "lax"` cookies
- [x] Synchronizer-token CSRF protection (`middlewares/csrf.js`) with zero `GET` session/token generation, login-time token issuance, `Origin`/`Referer` + proxy `X-Forwarded-Host` verification, `Referrer-Policy: strict-origin-when-cross-origin`, and strict multipart route allowlist
- [x] Crash-proof `400` / `403` / `404` / `413` / `429` / `500` error handling with early template-local initialization, `100 KB` payload limits, and stress-tested concurrency &amp; race-condition resilience
- [x] Local authentication with 12-round `bcrypt` (72-byte cap), timing-safe OTP verification with 5-attempt lockout, and Redis cleanup
- [x] Verified Google OAuth 2.0 integration with admin auto-link protection
- [x] End-to-end password recovery with SHA-256 hashed Redis tokens, async email dispatch, cross-device session invalidation, and security alert emails
- [x] Atomic Redis Lua rate limiters &amp; O(1) versioned listings cache invalidation (zero blocking `KEYS *`)
- [x] Zod + Regex validation schemas across auth, bookings, properties, rooms, and admin moderation
- [x] Binary magic-byte image validation (`utils/imageValidation.js`), Cloudinary CDN pipeline, total photo caps, and rollback asset cleanup
- [x] HTML-escaped transactional emails (`utils/mailer.js`) with subject header sanitization
- [x] Unified, hang-proof, HPP-safe stays discovery (`/listings`) with persistent filters &amp; URL-encoded pagination
- [x] Real-time peak-nightly-occupancy booking engine (`/bookings/new/:roomId`) with MySQL ACID transactions, `FOR UPDATE` locking, stay-length bounds, and double-submit protection
- [x] CSRF-protected Guest-to-Host role upgrade flow (`POST /listings/update/host`) with admin downgrade guard
- [x] Host dashboard (`/host/dashboard`) &amp; Property/Room CRUD with post-approval re-moderation and active-booking protection
- [x] Admin moderation portal (`/admin/dashboard`) with 0-room approval guard, Zod-validated rejection reasons, atomic Verified Host badge toggling, and strict admin separation of duties
- [x] My Bookings dashboard (`/guest/dashboard`) with policy-snapshotted cancellations, `FOR UPDATE` atomic cancel, and auto check-out sync
- [x] Host bookings management (`/host/bookings`) with KPI revenue tracking, auto check-out sync, status tabs, IDOR-safe property filter, guest contacts, and deterministic pagination
- [x] Verified guest review and rating submission system (`POST /guest/bookings/:bookingId/review`) with completed-stay enforcement, 1-review-per-booking guarantee, Apple-style star modal, and instant cache refresh
- [x] Popular Destinations showcase (`/destinations`) with 10-minute Redis caching (`destinations:popular`) and automatic invalidation across all property, room, moderation &amp; review updates
- [x] Production-guarded seeding script (`scripts/seed.js`) &amp; idempotent security migration script (`scripts/migrate-security.js`)
- [ ] Payment gateway integration (Razorpay / Stripe with signed webhook verification &amp; pending hold TTL)
- [ ] Soft-deletes (`deleted_at`) &amp; immutable `admin_audit_logs` table

---

<div align="center">

  <p>
    <strong>Stayora</strong> - Your Stay, Simplified.
  </p>

  <p>
    © 2026 Stayora. All rights reserved.
  </p>

  <p>
    <strong>Founder and Developer</strong> - <a href="https://github.com/priyanshu23216" target="_blank"><strong>Priyanshu Singh</strong></a>
  </p>

</div>
