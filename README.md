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
    <strong>Stayora</strong> is a production-grade, full-stack hospitality marketplace engineered to bridge the gap between discerning travelers and verified property hosts. Featuring an enterprise-grade 11-table relational database architecture, distributed Redis session caching, strict Zod and regular expression schema sanitization, multi-provider authentication, and transactional email automation.
  </p>

</div>

---

## 📌 Architectural Highlights

- **Clean Hospitality Relational Model:** 11-table MySQL schema with foreign keys, cascading integrity rules, and explicit entity relationships across users, properties, room tiers, reviews, and bookings.
- **Enterprise Input Validation:** Dual-layer defense with client-side real-time validation and backend **Zod** schemas alongside granular **Regular Expressions (Regex)** for password security (minimum 8 characters, capital & lowercase letters, numbers, and special characters) and email sanitization.
- **High-Performance In-Memory Tier:** In-memory session persistence and temporary state caching via `ioredis` and `connect-redis` with automatic TTL (Time-To-Live) management.
- **Secure Authentication Pipeline:**
  - Local credentials with 12-round `bcrypt` salting.
  - Google OAuth 2.0 social sign-in via Passport.js.
  - Cryptographic token generation and email OTP verification.
  - Hybrid rate limiting (Express Rate Limiter + custom Redis-backed attempt counters for brute-force mitigation).
- **Transactional Communications:** Automated OTP verification emails via `nodemailer`, with HTML email templates ready in `utils/mailer.js` for booking confirmations, cancellations, and password recovery.
- **Media Management:** Cloudinary CDN (`config/cloudinary.js`) and Multer (`config/multer.js`) configured for upcoming multi-image uploads across properties and rooms.
- **Security Hardening:** Layered defense with `helmet` HTTP headers (default CSP `script-src 'self'` blocks inline `<script>` tags in EJS—keep client JS in `public/js/`), `express-rate-limit`, secure session cookies, and flash notifications.

---

## 🚧 Hospitality Database Architecture (11 Relational Tables)

| Table | Purpose |
|---|---|
| `USERS` | Stores guests, hosts, and administrator profiles, credentials, and OAuth identifiers. |
| `PROPERTIES` | Core stay catalogue (hotels, villas, apartments, cabins) with geolocation, pricing, and descriptions. |
| `PROPERTY_IMAGES` | High-resolution property showcase galleries and exterior photographs. |
| `ROOMS` | Unit categories, guest capacities, bed arrangements, and nightly pricing tiers. |
| `ROOM_IMAGES` | Interior room photographs and virtual tour assets. |
| `BOOKINGS` | Reservation lifecycles tracking check-in, check-out, guest count, and reservation status. |
| `REVIEW` | Verified guest ratings, stay feedback, cleanliness scores, and host reviews. |
| `AMENITIES` | Master catalogue of amenities (WiFi, Pool, Dedicated Workspace, Kitchen, etc.). |
| `PROPERTY_AMENITIES` | Junction table mapping property-wide amenities (`property_id` ➔ `properties.id`). |
| `ROOM_AMENITIES` | Junction table mapping room-specific amenities (`room_id` ➔ `rooms.id`). |
| `PAYMENTS` | Transaction logs, currency management, payment gateways, and settlement receipts. |

---

## 🛠️ Technology Stack

### Frontend & Client Experience
- **Templating:** EJS (Embedded JavaScript) with `express-ejs-layouts`
- **Design System:** Airbnb-inspired hospitality UI tokens (Plus Jakarta Sans typography, clean glassmorphic sticky navigation)
- **Client Scripts:** Vanilla JavaScript (ES6+) for interactive UI components and client-side form validation (`signupValidate.js`, `resendOTP.js`)

### Backend Engineering
- **Runtime:** Node.js (v20+, ES Modules)
- **Framework:** Express.js (v5.x)
- **Validation Engine:** **Zod** schema validation + **Regex** pattern enforcement
- **Authentication:** Passport.js (`passport-local`, `passport-google-oauth20`), `bcrypt`
- **Session Store:** `express-session`, `connect-redis`, `ioredis`
- **Security & Protection:** `helmet`, `express-rate-limit`, `connect-flash`
- **Storage & CDN:** `multer`, `cloudinary`
- **Email Engine:** `nodemailer`

### Data Storage & In-Memory Layer
- **Relational DB:** MySQL 8.x (`mysql2`)
- **Cache & TTL Store:** Redis (`ioredis`)

---

## 📂 Project Directory Structure

```text
Stayora/
├── config/                 # Service initializations & cloud integrations
│   ├── cloudinary.js       # Cloudinary asset storage config
│   ├── db.js               # MySQL connection pool configuration
│   ├── multer.js           # Multer storage configuration for uploads
│   ├── passport.js         # Local & Google OAuth authentication strategies
│   ├── redis.js            # Redis client & cache settings
│   └── session.js          # Express-session & RedisStore integration
├── routes/                 # Modular Express route handlers
│   └── authentication.js   # Authentication (Signup, Login, OTP, OAuth, Recovery)
├── utils/                  # Reusable utilities and validators
│   ├── mailer.js           # Transactional email templates & nodemailer transporter
│   └── validator.js        # Zod schemas & Regex rules for signup, login, and reset
├── public/                 # Static assets
│   ├── css/                # Hospitality design system (navbar.css, footer.css, etc.)
│   └── js/                 # Client-side scripts (signupValidate.js, resendOTP.js)
├── views/                  # EJS template views
│   ├── layouts/            # Master layout (boilerplate.ejs)
│   ├── partials/           # Reusable components (navbar.ejs, footer.ejs)
│   ├── enter-otp.ejs       # OTP verification view
│   ├── forgot-password.ejs # Password recovery view
│   ├── index.ejs           # Landing page
│   ├── login.ejs           # Sign-in view
│   └── signup.ejs          # Registration view
├── .env.example            # Example environment configuration
├── .gitignore              # Git ignore patterns (node_modules, .env)
├── app.js                  # Application entry point & middleware pipeline
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

### 4. Run the Application
```bash
# Development mode with hot-reloading
npx nodemon app.js

# Production start
node app.js
```
Open **`http://localhost:8080`** in your browser.

---

## 🚦 Hospitality API & Route Specifications

### Authentication & Account Recovery (`/authenticate`)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/authenticate/login` | Renders user sign-in portal. |
| `POST` | `/authenticate/login/verify` | Authenticates credentials with local strategy & Redis rate-limiting. |
| `GET` | `/authenticate/signup` | Renders guest/host registration form. |
| `POST` | `/authenticate/signup/add` | Validates input via Zod schema & regex, sends OTP, and caches state in Redis. |
| `POST` | `/authenticate/signup/verify-otp` | Compares OTP, creates user record in MySQL, and establishes session. |
| `POST` | `/authenticate/signup/resend-otp` | Resends a fresh 6-digit OTP with Redis rate-limiting (max 3 per 15 min). |
| `GET` | `/authenticate/google` | Triggers Google OAuth 2.0 consent flow. |
| `GET` | `/authenticate/google/callback` | OAuth callback endpoint exchanging tokens for user profile. |
| `GET` | `/authenticate/forgot-password` | Renders password recovery form. |
| `POST` | `/authenticate/forgot-password/submit` | *(Planned)* Form target in `forgot-password.ejs` for reset links (route pending in `authentication.js`). |
| `GET` | `/authenticate/logout` | Terminates Passport session and purges cookies. |

---

## 📈 Hospitality Engineering Roadmap

- [x] Comprehensive 11-table relational database architecture with `PROPERTIES`, `ROOMS`, and foreign key cascade rules
- [x] Redis-backed session store using `connect-redis` + `ioredis`
- [x] Local authentication with 12-round `bcrypt` salting
- [x] Google OAuth 2.0 integration
- [x] Enterprise input validation using **Zod** and strict **Regex** patterns (client + server side)
- [x] Security hardening: `helmet` HTTP headers, Redis/Express rate limiters, and `httpOnly` cookies
- [x] Transactional email automation using `nodemailer`
- [x] Airbnb-inspired responsive hospitality navbar & global footer partials
- [ ] Host listing portal: Multi-step stay creation & pricing manager
- [ ] Room category inventory management with Cloudinary multi-image uploads
- [ ] Real-time date-range availability check engine (`CHECK_IN` / `CHECK_OUT`)
- [ ] Payment gateway integration (Stripe / Razorpay)
- [ ] Verified guest review and rating system
- [ ] Admin management portal and host verification workflow

---

<div align="center">

  <p>
    <strong>Stayora</strong> - Your Stay, Simplified.
  </p>

  <p>
    © 2026 Stayora. All rights reserved.
  </p>

  <p>
    <strong>Founder and Developer</strong>-<a href="https://github.com/priyanshu23216" target="_blank"><strong>Priyanshu Singh</strong></a>
  </p>

</div>
