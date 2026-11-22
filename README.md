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
  </p>

  <p>
    <strong>Stayora</strong> is a production-grade, full-stack hospitality marketplace engineered to bridge the gap between discerning travelers and verified property hosts. Featuring an enterprise-grade 11-table relational database architecture, distributed Redis session & query caching, race-condition-safe transactional room bookings with MySQL row-level locking, role-based access control, strict Zod & regex sanitization, multi-provider authentication, password recovery, and transactional email automation.
  </p>

</div>

---

## 📌 Architectural Highlights

- **Clean Hospitality Relational Model:** 11-table MySQL schema with foreign keys, cascading integrity rules, and explicit entity relationships across users, properties, room tiers, amenities, reviews, bookings, and payments.
- **Race-Condition-Safe Booking Engine:** End-to-end room reservation flow (`/bookings/new/:roomId`) powered by MySQL ACID transactions (`beginTransaction` / `commit` / `rollback`), pessimistic row-level locking (`SELECT ... FOR UPDATE`), real-time date-overlap availability calculation (`TOTAL_ROOMS - bookedCount`), backend price calculation, and host self-booking prevention.
- **Property Discovery & Detail Experience:** Paginated stays catalog (`/listings`) with city autocomplete, property type filters, price brackets, sorting (`Low to High`, `High to Low`, `Top Rated`), and full individual stay detail views (`/listings/:id`) showcasing Airbnb-style photo galleries, verified host badges, property & room amenities, room tiers, and star-rated guest reviews.
- **High-Performance In-Memory Tier:** Redis-backed session persistence (`ioredis` + `connect-redis`), temporary OTP/reset-token storage, and 10-minute TTL caching for both paginated search/filter queries and individual property detail pages (`property:${id}`).
- **Role-Based Access Control (RBAC):** Centralized authentication & authorization guards (`middlewares/auth.js`: `isLoggedIn`, `isHost`, `isGuest`, `isAdmin`) protecting modular `/bookings`, `/host`, `/guest`, and `/admin` routers.
- **Enterprise Input Validation:** Dual-layer defense with client-side validation and backend **Zod** schemas alongside granular **Regular Expressions (Regex)** for password security (minimum 8 characters, capital & lowercase letters, numbers, and special characters) and email sanitization.
- **Secure Authentication & Recovery Pipeline:**
  - Local credentials with 12-round `bcrypt` salting.
  - Google OAuth 2.0 social sign-in via Passport.js.
  - Cryptographic OTP generation (SHA-256 hashed in Redis) for email verification.
  - End-to-end password recovery with SHA-256 hashed 32-byte Redis tokens, email enumeration protection, and post-reset security alert emails.
  - Hybrid rate limiting (Express Rate Limiter + custom Redis-backed IP & email attempt counters for login, OTP resend, and password reset).
- **Transactional Communications:** Active `nodemailer` flows for signup OTP verification, password reset links, and password-change security alerts, plus pre-built HTML email templates in `utils/mailer.js` for booking confirmations and cancellations.
- **Media Management:** Cloudinary CDN (`config/cloudinary.js`) and Multer (`config/multer.js`) configured for upcoming multi-image uploads across properties and rooms.
- **Security Hardening:** Layered defense with `helmet` HTTP headers (custom CSP allowing `images.unsplash.com`, `res.cloudinary.com`, and Google Fonts while keeping `script-src 'self'`), `express-rate-limit`, `httpOnly` session cookies, `method-override`, and flash notifications.

---

## 🚧 Hospitality Database Architecture (11 Relational Tables)

| Table | Purpose |
|---|---|
| `USERS` | Stores guests, hosts, and administrator profiles, credentials, host verification flags, and OAuth identifiers. |
| `PROPERTIES` | Core stay catalogue (hotels, resorts, hostels, guesthouses, villas, apartments) with geolocation, pricing, availability & verification status, policies, and descriptions. |
| `PROPERTY_IMAGES` | High-resolution property showcase galleries and exterior photographs. |
| `ROOMS` | Unit categories, guest capacities, total room inventory counts, and nightly pricing tiers. |
| `ROOM_IMAGES` | Interior room photographs and gallery thumbnails. |
| `BOOKINGS` | Reservation lifecycles tracking check-in, check-out, guest count, total amount, and status (`pending`, `confirmed`, `cancelled`, `completed`). |
| `REVIEW` | Verified guest ratings, stay feedback, and property reviews linked to completed bookings. |
| `AMENITIES` | Master catalogue of property-level and room-level amenities (Wi-Fi, Pool, Dedicated Workspace, Kitchenette, etc.). |
| `PROPERTY_AMENITIES` | Junction table mapping property-wide amenities (`property_id` -> `properties.ID`). |
| `ROOM_AMENITIES` | Junction table mapping room-specific amenities (`ROOM_ID` -> `rooms.ID`). |
| `PAYMENTS` | Transaction logs, currency management, payment gateways, and settlement receipts. |

---

## 🛠️ Technology Stack

### Frontend & Client Experience
- **Templating:** EJS (Embedded JavaScript) with `express-ejs-layouts`
- **Design System:** Clean Apple-inspired mobile-first hospitality UI with **Inter** typography, editorial landing page, Airbnb-style property detail pages, mobile-first booking checkout, and responsive sticky navigation
- **Client Scripts:** Vanilla JavaScript (ES6+) for navigation, form validation, OTP resend timers, and live booking price calculation (`navbar.js`, `signupValidate.js`, `resendOTP.js`, `bookingPrice.js`)

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
├── config/                 # Service initializations & cloud integrations
│   ├── cloudinary.js       # Cloudinary asset storage config
│   ├── db.js               # MySQL connection pool configuration
│   ├── multer.js           # Multer memory storage configuration for uploads
│   ├── passport.js         # Local & Google OAuth authentication strategies
│   ├── redis.js            # Redis client & cache settings
│   └── session.js          # Express-session & RedisStore integration
├── middlewares/            # Shared Express middlewares
│   └── auth.js             # Role-based guards (isLoggedIn, isHost, isGuest, isAdmin)
├── routes/                 # Modular Express route handlers
│   ├── authentication.js   # Auth (Signup, Login, OTP, OAuth, Password Recovery)
│   ├── listings.js         # Stays discovery, filters, detail view, Redis caching & host upgrade
│   ├── booking.js          # Room booking form & transactional reservation engine
│   ├── host.js             # Protected Host dashboard & management router
│   ├── guest.js            # Protected Guest dashboard & bookings router
│   ├── admin.js            # Protected Admin portal & verification router
│   └── pages.js            # Company, Support & Legal pages (/about, /contact, /help, /privacy, /terms)
├── scripts/                # Utility & database scripts
│   └── seed.js             # Seeds 2,000 properties, rooms, users & 3,000 reviews
├── utils/                  # Reusable utilities and validators
│   ├── mailer.js           # Transactional email templates & nodemailer transporter
│   ├── reset-pass.js       # Password strength validation script
│   └── validator.js        # Zod schemas & Regex rules for auth & recovery
├── public/                 # Static assets
│   ├── css/                # Stylesheets (navbar, home, listings, show, booking, pages, auth, footer)
│   ├── images/             # Editorial homepage imagery (hero & spotlight assets)
│   └── js/                 # Client-side scripts (navbar, signupValidate, resendOTP, bookingPrice)
├── views/                  # EJS template views
│   ├── auth/               # Authentication views (login, signup, enter-otp, forgot-password, reset-password)
│   ├── bookings/           # Room checkout view (new.ejs)
│   ├── layouts/            # Master layout (boilerplate.ejs)
│   ├── listings/           # Stays catalog & property detail views (listings.ejs, show.ejs)
│   ├── pages/              # Editorial info & legal views (about, contact, help, privacy, terms)
│   ├── partials/           # Reusable components (navbar.ejs, footer.ejs)
│   └── index.ejs           # Editorial landing page
├── .env.example            # Example environment configuration
├── .gitignore              # Git ignore patterns (node_modules, .env)
├── server.js               # Application entry point & middleware pipeline
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
Open **`http://localhost:8080`** in your browser.

---

## 🚦 Hospitality API & Route Specifications

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
| `GET` | `/listings/update/host` | Protected (`isLoggedIn`) endpoint that upgrades a guest account's `ROLE` to `host`. |
| `GET` | `/listings/:id` | Renders the full property detail page (`views/listings/show.ejs`) with host details, photo gallery, property & room amenities, room tiers, star-rated reviews, and 10-minute Redis caching. |

### Room Booking Engine (`/bookings`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/bookings/new/:roomId` | Protected (`isLoggedIn`). Validates room & property status, prevents host self-booking, and renders the mobile-first booking checkout page (`views/bookings/new.ejs`) with live price calculation. |
| `POST` | `/bookings/new/:roomId` | Protected (`isLoggedIn`). Validates dates & guest capacity, executes a MySQL transaction with `SELECT ... FOR UPDATE` row locking, checks overlapping bookings against `TOTAL_ROOMS`, computes total price on the backend, and inserts a confirmed booking. |

### Role-Protected Dashboard Routers (Modular & Guarded)
| Mount Path | Middleware Guards | Purpose |
|---|---|---|
| `/host/*` | `isLoggedIn`, `isHost` | Host dashboard, property & room management (`routes/host.js`). |
| `/guest/*` | `isLoggedIn`, `isGuest` | Guest dashboard & booking history (`routes/guest.js`). |
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

- [x] Comprehensive 11-table relational database architecture with `PROPERTIES`, `ROOMS`, `BOOKINGS`, and foreign key cascade rules
- [x] Redis-backed session store using `connect-redis` + `ioredis`
- [x] Local authentication with 12-round `bcrypt` salting & email OTP verification
- [x] Google OAuth 2.0 integration
- [x] End-to-end password recovery with SHA-256 hashed Redis tokens and security alert emails
- [x] Enterprise input validation using **Zod** and strict **Regex** patterns (client + server side)
- [x] Security hardening: customized `helmet` CSP headers, Redis/Express rate limiters, and `httpOnly` cookies
- [x] Transactional email automation using `nodemailer`
- [x] Responsive hospitality navbar, editorial homepage & global footer with Company/Support/Legal pages (`/about`, `/contact`, `/help`, `/privacy`, `/terms`)
- [x] Redis-cached property discovery catalog (`/listings`) with city search, multi-filter, sorting, and pagination
- [x] Individual property detail view (`/listings/:id`) with galleries, verified host info, amenities, room tiers, star-rated reviews & Redis caching
- [x] Real-time date-range availability check & booking engine (`/bookings/new/:roomId`) with MySQL ACID transactions & `FOR UPDATE` row-level locking
- [x] Shared RBAC middleware (`middlewares/auth.js`) and modular `/host`, `/guest`, and `/admin` routers
- [x] Guest-to-Host role upgrade flow (`/listings/update/host`)
- [x] Automated MySQL seeding script (`scripts/seed.js`) with 2,000 properties and 3,000 reviews across 24 destinations
- [ ] Guest dashboard (`/guest/dashboard`) for viewing & managing bookings
- [ ] Host dashboard (`/host/dashboard`) & multi-step stay creation / pricing manager
- [ ] Room category inventory management with Cloudinary multi-image uploads
- [ ] Payment gateway integration (Stripe / Razorpay)
- [ ] Verified guest review and rating submission system
- [ ] Admin management portal (`/admin/dashboard`) and host/property verification workflow

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
