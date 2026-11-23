<div align="center">

  <h1>🏨 Stayora</h1>

  <h3>A Modern, Resilient Hospitality & Accommodation Booking Platform</h3>

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
    <strong>Stayora</strong> is a full-stack hospitality marketplace engineered to connect travelers with verified property hosts. Built with an 11-table MySQL relational schema, Redis session & query caching with automatic invalidation, race-condition-safe transactional room bookings, a complete Host Dashboard with Property & Room CRUD, Cloudinary multi-image uploads, strict RBAC & IDOR/BOLA protection, Zod + regex validation, Google OAuth 2.0, and transactional email automation.
  </p>

</div>

---

## 📌 Architectural Highlights

- **Clean Hospitality Relational Model:** 11-table MySQL schema with foreign keys, relational integrity across users, properties, rooms, photo galleries, amenities, reviews, bookings, and payments.
- **Complete Host Dashboard & Property/Room CRUD:** Full property management (`/host/dashboard`, create, view more, edit, delete) and nested room management inside each property (`/host/listings/:propertyId/rooms/*`), with transactional MySQL writes, automatic syncing of property summary stats (`total_rooms`, `max_guests`, minimum `price_per_night`), active-booking deletion guards, and safe foreign-key cleanup of past reviewed bookings.
- **Race-Condition-Safe Booking Engine:** End-to-end room reservation flow (`/bookings/new/:roomId`) powered by MySQL ACID transactions (`beginTransaction` / `commit` / `rollback`), pessimistic row-level locking (`SELECT ... FOR UPDATE`), real-time date-overlap availability calculation (`TOTAL_ROOMS - bookedCount`), backend price calculation, and host self-booking prevention.
- **Property Discovery & Detail Experience:** Paginated stays catalog (`/listings`) with city autocomplete, property type filters, price brackets, sorting (`Low to High`, `High to Low`, `Top Rated`), and full stay detail views (`/listings/:id`) showcasing photo galleries, verified host badges, property & room amenities, room tiers, and star-rated guest reviews.
- **High-Performance Redis Layer & Cache Invalidation:** Redis-backed session persistence (`ioredis` + `connect-redis`), temporary OTP/reset-token storage, 10-minute TTL caching for paginated `/listings` search/filter queries (`listingsBy*`) and property detail pages (`property:${id}`), plus automatic cache invalidation whenever a host updates or deletes a property or room.
- **Layered RBAC & IDOR / BOLA Protection:**
  - Centralized middleware guards in `middlewares/auth.js` (`isLoggedIn`, `isHost`, `isAdmin`) applied at the router level before file uploads or handlers execute.
  - Strict object-level ownership checks (`WHERE ID = ? AND HOST_ID = req.user.ID`) on every host property and room query to block cross-host IDOR/BOLA tampering.
  - Role-upgrade guard on `/listings/update/host` preventing `admin` accounts from being downgraded.
- **End-to-End Zod & Regex Validation:** Backend Zod schemas (`utils/validator.js`) with granular regex rules covering authentication, password recovery, property creation/editing (`newListingSchema`, `editListingSchema`), and room CRUD (`roomSchema`), including HTML-tag blocking, 6-digit Indian pincode enforcement, coordinate bounds, UUID amenity verification, and category filtering.
- **Secure Authentication & Recovery Pipeline:**
  - Local credentials with 12-round `bcrypt` salting and SHA-256 hashed 6-digit email OTP verification in Redis.
  - Google OAuth 2.0 social sign-in via Passport.js.
  - Password recovery with SHA-256 hashed 32-byte Redis tokens (10-min TTL), email enumeration protection, and post-reset security alert emails.
  - Hybrid rate limiting (Express Rate Limiter + Redis-backed IP & email attempt counters for login, OTP resend, and password reset).
- **Active Cloudinary Media Pipeline:** Multer memory storage (`config/multer.js`) with strict MIME-type filtering (`JPEG`, `PNG`, `WEBP`, `AVIF`) and 5 MB per-file limits, streaming cover, property gallery (up to 6), and room photos (up to 4) directly to Cloudinary (`utils/cloudinaryUpload.js`), paired with CSP-safe client-side `FileReader` previews.
- **Security Hardening:** Parameterized SQL queries throughout, auto-escaped EJS templates, `helmet` HTTP headers (custom CSP keeping `script-src 'self'`), safe internal redirect routing (preventing open redirects on upload errors), `httpOnly` session cookies, `method-override`, and flash notifications.

---

## 🗄️ Hospitality Database Architecture (11 Relational Tables)

| Table | Purpose |
|---|---|
| `USERS` | Stores guests, hosts, and administrator profiles, credentials, host verification flags, and OAuth identifiers. |
| `PROPERTIES` | Core stay catalogue (`hotel`, `resort`, `hostel`, `guesthouse`, `villa`, `apartment`) with geolocation, pricing, availability & verification status, policies, and descriptions. |
| `PROPERTY_IMAGES` | High-resolution property showcase galleries and exterior photographs. |
| `ROOMS` | Room categories, guest capacities, total room inventory counts (`TOTAL_ROOMS`), and nightly pricing tiers. |
| `ROOM_IMAGES` | Interior room photographs and gallery thumbnails. |
| `BOOKINGS` | Reservation lifecycles tracking check-in, check-out, guest count, total amount, and status (`pending`, `confirmed`, `cancelled`, `completed`). |
| `REVIEW` | Verified guest ratings, stay feedback, and property reviews linked to completed bookings. |
| `AMENITIES` | Master catalogue of property-level (`property`) and room-level (`room`) amenities. |
| `PROPERTY_AMENITIES` | Junction table mapping property-wide amenities (`property_id` → `properties.ID`). |
| `ROOM_AMENITIES` | Junction table mapping room-specific amenities (`ROOM_ID` → `rooms.ID`). |
| `PAYMENTS` | Transaction logs, currency management, payment gateways, and settlement receipts. |

---

## 🛠️ Technology Stack

### Frontend & Client Experience
- **Templating:** EJS (Embedded JavaScript) with `express-ejs-layouts`
- **Design System:** Clean Apple-inspired mobile-first UI with **Inter** / SF Pro typography across the editorial homepage, auth flows, stays discovery, property detail pages, booking checkout, and host dashboard
- **Client Scripts:** CSP-compliant external Vanilla JavaScript (`navbar.js`, `signupValidate.js`, `resendOTP.js`, `bookingPrice.js`, `hostNewListing.js`, `hostProperty.js`, `hostRoomForm.js`)

### Backend Engineering
- **Runtime:** Node.js (v20+, ES Modules)
- **Framework:** Express.js (v5.x) with `method-override` and `uuid`
- **Validation Engine:** **Zod** schema validation + **Regex** pattern enforcement
- **Authentication:** Passport.js (`passport-local`, `passport-google-oauth20`), `bcrypt`
- **Session Store:** `express-session`, `connect-redis`, `ioredis`
- **Security & Protection:** `helmet`, `express-rate-limit`, `connect-flash`
- **Storage & CDN:** `multer`, `cloudinary`
- **Email Engine:** `nodemailer`
- **Seeding & Mock Data:** `@faker-js/faker`

### Data Storage & In-Memory Layer
- **Relational DB:** MySQL 8.x (`mysql2` connection pool with ACID transactions & row locking)
- **Cache & TTL Store:** Redis (`ioredis`)

---

## 📂 Project Directory Structure

```text
Stayora/
├── config/                    # Service initializations & cloud integrations
│   ├── cloudinary.js          # Cloudinary SDK configuration
│   ├── db.js                  # MySQL connection pool configuration
│   ├── multer.js              # Multer memory storage with MIME filter & 5 MB limit
│   ├── passport.js            # Local & Google OAuth authentication strategies
│   ├── redis.js               # Redis client & cache settings
│   └── session.js             # Express-session & RedisStore integration
├── middlewares/               # Shared Express middlewares
│   └── auth.js                # Auth & RBAC guards (isLoggedIn, isHost, isGuest, isAdmin)
├── routes/                    # Modular Express route handlers
│   ├── authentication.js      # Auth (Signup, Login, OTP, OAuth, Password Recovery)
│   ├── listings.js            # Stays discovery, filters, detail view, Redis caching & host upgrade
│   ├── booking.js             # Room booking form & transactional reservation engine
│   ├── host.js                # Protected Host Dashboard, Property CRUD, Room CRUD & cache invalidation
│   ├── guest.js               # Protected Guest trips & reviews router (in progress)
│   ├── admin.js               # Protected Admin portal & verification router (in progress)
│   └── pages.js               # Company, Support & Legal pages (/about, /contact, /help, /privacy, /terms)
├── scripts/                   # Utility & database scripts
│   └── seed.js                # Seeds 2,000 properties, rooms, users & 3,000 reviews
├── utils/                     # Reusable utilities and validators
│   ├── cloudinaryUpload.js    # Streams Multer buffers to Cloudinary CDN
│   ├── mailer.js              # Transactional email templates & nodemailer transporter
│   ├── reset-pass.js          # Password strength validation helper
│   └── validator.js           # Zod & regex schemas for auth, properties, and rooms
├── public/                    # Static assets
│   ├── css/                   # Apple-like stylesheets (navbar, home, listings, show, booking, host, pages, auth, footer)
│   ├── images/                # Editorial homepage imagery (hero & spotlight assets)
│   └── js/                    # External CSP-safe scripts (navbar, signupValidate, resendOTP, bookingPrice, host*)
├── views/                     # EJS template views
│   ├── auth/                  # Auth views (login, signup, enter-otp, forgot-password, reset-password)
│   ├── bookings/              # Room checkout view (new.ejs)
│   ├── host/                  # Host Dashboard views (dashboard, new, show, edit, rooms/new, rooms/edit)
│   ├── layouts/               # Master layout (boilerplate.ejs)
│   ├── listings/              # Stays catalog & property detail views (listings.ejs, show.ejs)
│   ├── pages/                 # Editorial info & legal views (about, categories, contact, help, privacy, terms)
│   ├── partials/              # Reusable components (navbar.ejs, footer.ejs)
│   └── index.ejs              # Editorial landing page
├── .env.example               # Example environment configuration
├── .gitignore                 # Git ignore patterns (node_modules, .env)
├── server.js                  # Application entry point & middleware pipeline
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
APP_URL=http://localhost:8080
SESSION_SECRET=your_super_secret_session_key

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

# Nodemailer Service (Gmail App Password)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_16_digit_app_password

# Cloudinary Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### 4. Seed Sample Data (Optional)
Populate your MySQL database with 2,000 properties across 24 Indian destinations, 101 users (admin, hosts, guests), 24 amenities, room tiers, and 3,000 completed bookings & reviews:
```bash
node scripts/seed.js
```

### 5. Run the Application
```bash
# Development mode with hot-reloading
npx nodemon server.js

# Production start
node server.js
```
Open **`http://localhost:8080`** (or your configured `PORT`) in your browser.

---

## 🚦 API & Route Specifications

### Core, Company & Legal Pages (`/`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Renders the Stayora editorial landing page (`views/index.ejs`). |
| `GET` | `/about` | Renders About Stayora, vision, and Founder & CEO profile. |
| `GET` | `/contact` | Renders Contact Us page with support phone and email details. |
| `GET` | `/help` | Renders Help Centre with support categories and FAQ accordion. |
| `GET` | `/privacy` | Renders Privacy Policy page. |
| `GET` | `/terms` | Renders Terms & Conditions page. |

### Stays Discovery, Details & Host Onboarding (`/listings`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/listings` | Displays paginated approved stays (12 per page) with optional `city`, `type`, `price`, `sort` (`Low to High`, `High to Low`, `Top Rated`), and `page` query params, backed by 10-minute Redis caching. |
| `GET` | `/listings/update/host` | Protected (`isLoggedIn`). Upgrades a `guest` account's `ROLE` to `host` (blocks `admin` downgrade) and redirects to `/host/dashboard`. |
| `GET` | `/listings/:id` | Renders the full property detail page (`views/listings/show.ejs`) with host details, photo gallery, property & room amenities, room tiers, star-rated reviews, and 10-minute Redis caching. |

### Host Dashboard, Property & Room CRUD (`/host`)
All `/host/*` routes are protected by `isLoggedIn` + `isHost` RBAC middleware and enforce `HOST_ID = req.user.ID` ownership checks.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/host/dashboard` | Displays all properties listed by the logged-in host (newest first) with status badges and `+ New Listing` CTA. |
| `GET` | `/host/listings/new` | Renders the multipart form to create a new property with property-level amenities. |
| `POST` | `/host/listings` | Validates input via `newListingSchema` (Zod + regex), uploads cover & gallery images to Cloudinary, inserts property + images + amenities in a transaction (`verification_status = 'pending'`), and redirects to the property management page. |
| `GET` | `/host/listings/:propertyId` | **View More** page showing full property details, gallery, amenities, Edit/Delete actions, and all nested rooms with `+ Add Room`, `Edit`, and `Delete`. |
| `GET` | `/host/listings/:propertyId/edit` | Renders the pre-filled multipart edit form for a host's property. |
| `PUT` | `/host/listings/:propertyId` | Validates via `editListingSchema`, uploads optional new photos, updates property + amenities in a transaction, and clears `property:*` and `listingsBy*` Redis caches. |
| `DELETE` | `/host/listings/:propertyId` | Blocks deletion if active (`pending`/`confirmed`) bookings exist; otherwise deletes child records and property in a transaction and clears Redis caches. |
| `GET` | `/host/listings/:propertyId/rooms/new` | Renders the multipart form to add a new room type with room-level amenities. |
| `POST` | `/host/listings/:propertyId/rooms` | Validates via `roomSchema`, uploads up to 4 room photos to Cloudinary, inserts room + images + amenities, auto-syncs `properties` stats, and clears Redis caches. |
| `GET` | `/host/listings/:propertyId/rooms/:roomId/edit` | Renders the pre-filled multipart edit form for a specific room. |
| `PUT` | `/host/listings/:propertyId/rooms/:roomId` | Validates via `roomSchema`, uploads optional new photos, updates room + amenities, re-syncs `properties` stats, and clears Redis caches. |
| `DELETE` | `/host/listings/:propertyId/rooms/:roomId` | Blocks deletion if active bookings exist; safely removes linked past reviews/bookings, room images/amenities, and room in a transaction, re-syncs `properties` stats, and clears Redis caches. |

### Room Booking Engine (`/bookings`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/bookings/new/:roomId` | Protected (`isLoggedIn`). Validates room & property status, prevents host self-booking, and renders the mobile-first booking checkout page (`views/bookings/new.ejs`) with live price calculation. |
| `POST` | `/bookings/new/:roomId` | Protected (`isLoggedIn`). Validates dates & guest capacity, executes a MySQL transaction with `SELECT ... FOR UPDATE` row locking, checks overlapping bookings against `TOTAL_ROOMS`, computes total price on the backend, and inserts a confirmed booking. |

### Role-Protected Dashboard Routers
| Mount Path | Middleware Guards | Purpose |
|---|---|---|
| `/host/*` | `isLoggedIn`, `isHost` | Host dashboard, property & room CRUD (`routes/host.js`). |
| `/guest/*` | `isLoggedIn` | Logged-in user trips, bookings & reviews (`routes/guest.js`). |
| `/admin/*` | `isLoggedIn`, `isAdmin` | Admin verification & platform management (`routes/admin.js`). |

### Authentication & Account Recovery (`/authenticate`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/authenticate/login` | Renders user sign-in portal. |
| `POST` | `/authenticate/login/verify` | Authenticates credentials with local strategy & Redis IP/email rate-limiting. |
| `GET` | `/authenticate/signup` | Renders guest registration form. |
| `POST` | `/authenticate/signup/add` | Validates input via Zod & regex, sends 6-digit OTP, and caches pending signup in Redis. |
| `POST` | `/authenticate/signup/verify-otp` | Verifies hashed OTP, creates user record in MySQL, and establishes session. |
| `POST` | `/authenticate/signup/resend-otp` | Resends a fresh 6-digit OTP with Redis rate-limiting (max 3 per 15 min). |
| `GET` | `/authenticate/google` | Triggers Google OAuth 2.0 consent flow. |
| `GET` | `/authenticate/google/callback` | OAuth callback endpoint exchanging tokens for user profile. |
| `GET` | `/authenticate/forgot-password` | Renders password recovery request form. |
| `POST` | `/authenticate/forgot-password/submit` | Rate-limited (IP + email); generates a SHA-256 hashed 32-byte Redis reset token (10-min TTL) and emails a reset link (with enumeration protection & OAuth account handling). |
| `GET` | `/authenticate/forgot-password/:token` | Validates the reset token in Redis and renders the new password form. |
| `POST` | `/authenticate/reset-password/:token` | Validates new password via Zod, updates bcrypt hash in MySQL, clears Redis keys, and sends a security alert email. |
| `GET` | `/authenticate/logout` | Terminates Passport session and logs out the user. |

---

## 📈 Hospitality Engineering Roadmap

- [x] Comprehensive 11-table relational database architecture with `PROPERTIES`, `ROOMS`, `BOOKINGS`, and foreign key integrity rules
- [x] Redis-backed session store using `connect-redis` + `ioredis`
- [x] Local authentication with 12-round `bcrypt` salting & email OTP verification
- [x] Google OAuth 2.0 integration
- [x] End-to-end password recovery with SHA-256 hashed Redis tokens and security alert emails
- [x] Zod + Regex validation schemas across auth, properties, and rooms (client + server side)
- [x] Security hardening: `helmet` CSP headers, Redis/Express rate limiters, `httpOnly` cookies, RBAC, IDOR/BOLA ownership checks, and safe internal redirects
- [x] Transactional email automation using `nodemailer`
- [x] Responsive Apple-like UI across homepage, auth flows (including password reset), listings, checkout, host dashboard, and legal pages
- [x] Redis-cached property discovery catalog (`/listings`) with city search, multi-filter, sorting, pagination, and automatic cache invalidation (`property:*` & `listingsBy*`)
- [x] Individual property detail view (`/listings/:id`) with galleries, verified host info, amenities, room tiers, star-rated reviews & Redis caching
- [x] Real-time date-range availability check & booking engine (`/bookings/new/:roomId`) with MySQL ACID transactions & `FOR UPDATE` row-level locking
- [x] Guest-to-Host role upgrade flow (`/listings/update/host`) with admin downgrade guard
- [x] Host dashboard (`/host/dashboard`) & complete Property CRUD with Cloudinary multipart uploads
- [x] Nested Room CRUD inside `/host/listings/:propertyId` with Cloudinary uploads, auto-synced property stats, active-booking protection, and FK-safe deletion
- [x] Automated MySQL seeding script (`scripts/seed.js`) with 2,000 properties and 3,000 reviews across 24 destinations
- [ ] Host bookings management (`/host/bookings`)
- [ ] Guest dashboard (`/guest/dashboard`) for viewing & managing bookings
- [ ] Verified guest review and rating submission system
- [ ] Admin management portal (`/admin/dashboard`) and host/property verification workflow
- [ ] Payment gateway integration (Stripe / Razorpay)

---

<div align="center">

  <p>
    <strong>Stayora</strong> — Your Stay, Simplified.
  </p>

  <p>
    © 2026 Stayora. All rights reserved.
  </p>

  <p>
    <strong>Founder and Developer</strong> — <a href="https://github.com/priyanshu23216" target="_blank"><strong>Priyanshu Singh</strong></a>
  </p>

</div>
