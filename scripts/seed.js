import "dotenv/config";
import { faker } from "@faker-js/faker";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";
import db from "../config/db.js";

const TOTAL_PROPERTIES = 2000;
const TOTAL_HOSTS = 40;
const TOTAL_GUESTS = 60;
const TOTAL_REVIEWS = 3000;
const CHUNK_SIZE = 500;

const DESTINATIONS = [
    { city: "Goa", state: "Goa", pincode: "403001", lat: 15.2993, lng: 74.124, areas: ["Calangute", "Anjuna", "Assagao", "Candolim", "Palolem", "Vagator"] },
    { city: "Udaipur", state: "Rajasthan", pincode: "313001", lat: 24.5854, lng: 73.7125, areas: ["Lake Pichola", "Fateh Sagar", "Old City", "Ambamata", "Badi Lake"] },
    { city: "Jaipur", state: "Rajasthan", pincode: "302001", lat: 26.9124, lng: 75.7873, areas: ["Amer Road", "C-Scheme", "Malviya Nagar", "Bani Park", "Civil Lines"] },
    { city: "Manali", state: "Himachal Pradesh", pincode: "175131", lat: 32.2432, lng: 77.1892, areas: ["Old Manali", "Vashisht", "Solang Valley", "Naggar Road", "Aleo"] },
    { city: "Shimla", state: "Himachal Pradesh", pincode: "171001", lat: 31.1048, lng: 77.1734, areas: ["Mall Road", "Mashobra", "Kufri", "Chotta Shimla", "Summer Hill"] },
    { city: "Rishikesh", state: "Uttarakhand", pincode: "249201", lat: 30.0869, lng: 78.2676, areas: ["Tapovan", "Laxman Jhula", "Shivpuri", "Swarg Ashram", "Neelkanth Road"] },
    { city: "Mussoorie", state: "Uttarakhand", pincode: "248179", lat: 30.4598, lng: 78.0644, areas: ["Landour", "Mall Road", "Happy Valley", "Kempty Road", "Barlowganj"] },
    { city: "Munnar", state: "Kerala", pincode: "685612", lat: 10.0889, lng: 77.0595, areas: ["Chinnakanal", "Devikulam", "Pallivasal", "Anachal", "Mattupetty"] },
    { city: "Kochi", state: "Kerala", pincode: "682001", lat: 9.9312, lng: 76.2673, areas: ["Fort Kochi", "Marine Drive", "Mattancherry", "Kakkanad", "Vypeen"] },
    { city: "Coorg", state: "Karnataka", pincode: "571201", lat: 12.3375, lng: 75.8069, areas: ["Madikeri", "Virajpet", "Kushalnagar", "Pollibetta", "Suntikoppa"] },
    { city: "Bengaluru", state: "Karnataka", pincode: "560001", lat: 12.9716, lng: 77.5946, areas: ["Indiranagar", "Koramangala", "Whitefield", "Lavelle Road", "HSR Layout"] },
    { city: "Mumbai", state: "Maharashtra", pincode: "400001", lat: 19.076, lng: 72.8777, areas: ["Bandra West", "Colaba", "Juhu", "Lower Parel", "Powai", "Worli"] },
    { city: "Lonavala", state: "Maharashtra", pincode: "410401", lat: 18.7557, lng: 73.4091, areas: ["Tungarli", "Khandala", "Pawna Lake", "Aamby Valley Road", "Valvan"] },
    { city: "Alibaug", state: "Maharashtra", pincode: "402201", lat: 18.6414, lng: 72.8722, areas: ["Mandwa", "Kihim Beach", "Awas", "Nagaon", "Sasawane"] },
    { city: "New Delhi", state: "Delhi", pincode: "110001", lat: 28.6139, lng: 77.209, areas: ["Hauz Khas", "Connaught Place", "Aerocity", "Vasant Vihar", "Saket"] },
    { city: "Pondicherry", state: "Puducherry", pincode: "605001", lat: 11.9416, lng: 79.8083, areas: ["White Town", "Auroville", "Promenade Beach", "Serenity Beach", "Heritage Town"] },
    { city: "Ooty", state: "Tamil Nadu", pincode: "643001", lat: 11.4102, lng: 76.695, areas: ["Coonoor Road", "Lovedale", "Fern Hill", "Avalanche", "Charing Cross"] },
    { city: "Darjeeling", state: "West Bengal", pincode: "734101", lat: 27.041, lng: 88.2663, areas: ["Chowrasta", "Lebong", "Ghoom", "Observatory Hill", "Kurseong Road"] },
    { city: "Gangtok", state: "Sikkim", pincode: "737101", lat: 27.3389, lng: 88.6065, areas: ["MG Marg", "Tadong", "Ranka", "Deorali", "Burtuk"] },
    { city: "Srinagar", state: "Jammu and Kashmir", pincode: "190001", lat: 34.0837, lng: 74.7973, areas: ["Dal Lake", "Nigeen Lake", "Rajbagh", "Boulevard Road", "Nishat"] },
    { city: "Leh", state: "Ladakh", pincode: "194101", lat: 34.1526, lng: 77.5771, areas: ["Changspa", "Shanti Stupa Road", "Main Bazaar", "Shey", "Stok"] },
    { city: "Hyderabad", state: "Telangana", pincode: "500001", lat: 17.385, lng: 78.4867, areas: ["Jubilee Hills", "Banjara Hills", "Gachibowli", "HITEC City", "Begumpet"] },
    { city: "Varanasi", state: "Uttar Pradesh", pincode: "221001", lat: 25.3176, lng: 82.9739, areas: ["Assi Ghat", "Dashashwamedh", "Cantonment", "Sigra", "Lanka"] },
    { city: "Agra", state: "Uttar Pradesh", pincode: "282001", lat: 27.1767, lng: 78.0081, areas: ["Taj Ganj", "Fatehabad Road", "Civil Lines", "Sikandra", "Sadar Bazaar"] },
];

const PROPERTY_TYPES = ["hotel", "resort", "hostel", "guesthouse", "villa", "apartment"];

const TITLE_PREFIXES = {
    hotel: ["The Grand", "Hotel", "Stayora Boutique", "Royal", "Meridian", "Crown", "Regency", "Imperial", "Saffron", "Ivory"],
    resort: ["Azure", "Palm Grove", "Serenity", "Horizon", "Emerald", "Solstice", "Lagoon", "Mist Valley", "Whispering Pines", "Suncrest"],
    hostel: ["Nomad", "Wanderer", "Backpacker", "Trailhead", "Zostel-Style", "Social", "Campfire", "Roam", "Driftwood", "Bunkhouse"],
    guesthouse: ["Heritage", "Courtyard", "Veranda", "Quiet", "Sunlit", "Cedar", "Willow", "Garden", "Stone", "Banyan"],
    villa: ["Villa", "Casa", "Cliffside Villa", "The Glass", "Infinity Villa", "Coastal Villa", "Sanctuary Villa", "Terrace Villa", "Aurelia Villa", "Solis Villa"],
    apartment: ["The Loft at", "Skyline Residence", "Minimalist Suite", "Urban Retreat", "Studio Loft", "The Penthouse", "Atrium Residence", "Parkview Apartment", "Central Loft", "Harbor Flat"],
};

const TITLE_SUFFIXES = {
    hotel: ["Suites", "Residency", "Palace", "Heights", "Inn", "Grand", "Plaza", "House"],
    resort: ["Resort & Spa", "Retreat", "Sanctuary", "Eco Resort", "Bay Resort", "Estate", "Pavilion"],
    hostel: ["Hostel", "Commons", "Basecamp", "Hub", "Collective", "House"],
    guesthouse: ["Guesthouse", "Homestay", "Manor", "Cottage", "Lodge", "Bungalow"],
    villa: ["Retreat", "Estate", "Pavilion", "Residence", "Escape", "Haven"],
    apartment: ["Residences", "Suites", "Living", "Quarters", "Terraces", "Flats"],
};

const PRICE_RANGES = {
    hostel: [650, 2200],
    guesthouse: [1600, 5200],
    apartment: [2800, 9500],
    hotel: [3200, 14500],
    resort: [6500, 26000],
    villa: [8500, 42000],
};

const ROOM_TEMPLATES = {
    hotel: [
        { type: "Superior Queen Room", cap: 2, mult: 1.0, desc: "Thoughtfully designed room with crisp linens, blackout curtains, and city or garden views." },
        { type: "Deluxe King Room", cap: 2, mult: 1.3, desc: "Spacious king room featuring a dedicated work nook, lounge seating, and rain shower." },
        { type: "Executive Suite", cap: 4, mult: 1.85, desc: "Separate living area, panoramic windows, premium bath amenities, and priority check-in." },
    ],
    resort: [
        { type: "Garden Pavilion Room", cap: 2, mult: 1.0, desc: "Surrounded by lush landscaping with a private sit-out veranda and natural light." },
        { type: "Poolside Luxury Suite", cap: 3, mult: 1.4, desc: "Direct deck access to the infinity pool with soaking tub and plush daybed." },
        { type: "Signature Ocean/Valley Villa", cap: 4, mult: 2.1, desc: "Standalone luxury suite with private plunge pool, sun loungers, and butler service." },
    ],
    hostel: [
        { type: "6-Bed Mixed Dorm", cap: 1, mult: 1.0, desc: "Clean bunk with privacy curtain, reading lamp, power socket, and personal locker." },
        { type: "4-Bed Female Dorm", cap: 1, mult: 1.15, desc: "Bright, quiet female-only dorm with en-suite bathroom and balcony access." },
        { type: "Private En-Suite Room", cap: 2, mult: 2.2, desc: "All the community vibe of a hostel with the comfort of your own private room." },
    ],
    guesthouse: [
        { type: "Standard Cozy Room", cap: 2, mult: 1.0, desc: "Warm, home-style room with handcrafted wood accents and peaceful surroundings." },
        { type: "Balcony Heritage Room", cap: 3, mult: 1.35, desc: "Airy room opening onto a shaded veranda overlooking the courtyard." },
        { type: "Family Attic Suite", cap: 4, mult: 1.75, desc: "Generous layout with extra bedding, dining corner, and scenic views." },
    ],
    villa: [
        { type: "Master Pool-View Suite", cap: 2, mult: 1.0, desc: "Floor-to-ceiling glass suite with walk-in closet and direct terrace access." },
        { type: "2-Bedroom Garden Wing", cap: 4, mult: 1.45, desc: "Private wing with two en-suite bedrooms, lounge patio, and kitchenette." },
        { type: "Entire Private Villa", cap: 8, mult: 2.2, desc: "Exclusive access to the full architectural villa, private pool, and chef kitchen." },
    ],
    apartment: [
        { type: "Minimalist Studio Suite", cap: 2, mult: 1.0, desc: "Open-plan designer studio with full kitchenette, high-speed Wi-Fi, and smart TV." },
        { type: "1-Bedroom Designer Loft", cap: 3, mult: 1.35, desc: "Sunlit loft with separate bedroom, dining island, washer, and skyline balcony." },
        { type: "2-Bedroom Penthouse Flat", cap: 5, mult: 1.9, desc: "Corner penthouse apartment with wrap-around terrace and dedicated workspace." },
    ],
};

const unsplash = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1000&q=80`;

const PROPERTY_IMAGES = {
    hotel: [
        "photo-1566073771259-6a8506099945", "photo-1542314831-068cd1dbfeeb", "photo-1551882547-ff40c63fe5fa",
        "photo-1520250497591-112f2f40a3f4", "photo-1564501049412-61c2a3083791", "photo-1455587734955-081b22074882",
        "photo-1517840901100-8179e982acb7", "photo-1568084680786-a84f91d1153c", "photo-1584132967334-10e028bd69f7",
        "photo-1596436889106-be35e843f974", "photo-1549294413-26f195200c16", "photo-1578683010236-d716f9a3f461",
        "photo-1561501900-3701fa6a0864", "photo-1563911302283-d2bc129e7570", "photo-1445019980597-93fa8acb246c",
        "photo-1529290130-4ca3753253ae", "photo-1506059612708-99d6c258160e", "photo-1590073242678-70ee3fc28e8e",
        "photo-1587985064135-0366536eab42", "photo-1562790351-d273a961e0e9",
    ].map(unsplash),
    resort: [
        "photo-1582719508461-905c673771fd", "photo-1571896349842-33c89424de2d", "photo-1540541338287-41700207dee6",
        "photo-1571003123894-1f0594d2b5d9", "photo-1610641818989-c2051b5e2cfd", "photo-1537996194471-e657df975ab4",
        "photo-1573843981267-be1999ff37cd", "photo-1584132915807-fd1f5fbc078f", "photo-1519046904884-53103b34b206",
        "photo-1596178065887-1198b6148b2b", "photo-1544161515-4ab6ce6db874", "photo-1570213489059-0aac6626cade",
        "photo-1561501878-aabd62634533", "photo-1439130490301-25e322d88054", "photo-1510414842594-a61c69b5ae57",
        "photo-1507525428034-b723cf961d3e", "photo-1602002418082-a4443e081dd1",
    ].map(unsplash),
    hostel: [
        "photo-1555854877-bab0e564b8d5", "photo-1596394516093-501ba68a0ba6", "photo-1522771739844-6a9f6d5f14af",
        "photo-1623625434462-e5e42318ae49", "photo-1513694203232-719a280e022f", "photo-1505693416388-ac5ce068fe85",
        "photo-1595576508898-0ad5c879a061", "photo-1540518614846-7eded433c457", "photo-1586023492125-27b2c045efd7",
        "photo-1524758631624-e2822e304c36", "photo-1519710164239-da123dc03ef4", "photo-1554995207-c18c203602cb",
        "photo-1538688525198-9b88f6f53126", "photo-1505692952047-1a78307da8f2", "photo-1505691723518-36a5ac3be353",
    ].map(unsplash),
    guesthouse: [
        "photo-1505691938895-1758d7feb511", "photo-1449844908441-8829872d2607", "photo-1510798831971-661eb04b3739",
        "photo-1499793983690-e29da59ef1c2", "photo-1600585154340-be6161a56a0c", "photo-1518780664697-55e3ad937233",
        "photo-1542718610-a1d656d1884c", "photo-1470770841072-f978cf4d019e", "photo-1464146072230-91cabc968266",
        "photo-1568605114967-8130f3a36994", "photo-1570129477492-45c003edd2be", "photo-1588880331179-bc9b93a8cb5e",
        "photo-1598228723793-52759bba239c", "photo-1564013799919-ab600027ffc6", "photo-1572120360610-d971b9d7767c",
        "photo-1523217582562-09d0def993a6", "photo-1502005229762-cf1b2da7c5d6", "photo-1475855581690-80accde3ae2b",
    ].map(unsplash),
    villa: [
        "photo-1613490493576-7fde63acd811", "photo-1600596542815-ffad4c1539a9", "photo-1512917774080-9991f1c4c750",
        "photo-1600607687939-ce8a6c25118c", "photo-1580587771525-78b9dba3b914", "photo-1600585154526-990dced4db0d",
        "photo-1600566753376-12c8ab7fb75b", "photo-1600573472592-401b489a3cdc", "photo-1613977257363-707ba9348227",
        "photo-1576013551627-0cc20b96c2a7", "photo-1605276374104-dee2a0ed3cd6", "photo-1600047509807-ba8f99d2cdde",
        "photo-1600585152220-90363fe7e115", "photo-1600566753190-17f0baa2a6c3", "photo-1600607687644-c7171b42498f",
        "photo-1599427303058-f04cbcf4756f", "photo-1582268611958-ebfd161ef9cf",
    ].map(unsplash),
    apartment: [
        "photo-1502672260266-1c1ef2d93688", "photo-1522708323590-d24dbb6b0267", "photo-1560448204-e02f11c3d0e2",
        "photo-1493809842364-78817add7ffb", "photo-1536376072261-38c75010e6c9", "photo-1560185007-cde436f6a4d0",
        "photo-1560185127-6ed189bf02f4", "photo-1560448075-bb485b067938", "photo-1484154218962-a197022b5858",
        "photo-1556912172-45b7abe8b7e1", "photo-1567767292278-a4f21aa2d36e", "photo-1512918728675-ed5a9ecdebfd",
        "photo-1502672023488-70e25813eb80", "photo-1533779283484-8ad4940aa3a8", "photo-1560184897-ae75f418493e",
        "photo-1560185008-b033106af5c3",
    ].map(unsplash),
};

const ROOM_IMAGE_POOL = [
    "photo-1611892440504-42a792e24d32", "photo-1590490360182-c33d57733427", "photo-1618773928121-c32242e63f39",
    "photo-1591088398332-8a7791972843", "photo-1582719478250-c89cae4dc85b", "photo-1560185893-a55cbc8c57e8",
    "photo-1566665797739-1674de7a421a", "photo-1616594039964-ae9021a400a0", "photo-1598928506311-c55ded91a20c",
    "photo-1617325247661-675ab4b64ae2", "photo-1560448205-4d9b3e6bb6db", "photo-1505693314120-0d443867891c",
    "photo-1560185009-5bf9f2849488", "photo-1586105251261-72a756497a11", "photo-1576675784201-0e142b423952",
    "photo-1595526114035-0d45ed16cfbf", "photo-1631049307264-da0ec9d70304", "photo-1631049552057-403cdb8f0658",
    "photo-1618221195710-dd6b41faaea6", "photo-1616486338812-3dadae4b4ace",
].map(unsplash);

const MASTER_AMENITIES = [
    // Property-level
    { name: "Free Wi-Fi", category: "property" },
    { name: "Swimming Pool", category: "property" },
    { name: "Free Parking", category: "property" },
    { name: "Fitness Center", category: "property" },
    { name: "Spa & Wellness", category: "property" },
    { name: "On-site Restaurant", category: "property" },
    { name: "24/7 Front Desk", category: "property" },
    { name: "Airport Shuttle", category: "property" },
    { name: "Pet Friendly", category: "property" },
    { name: "Garden & Terrace", category: "property" },
    { name: "Room Service", category: "property" },
    { name: "EV Charging", category: "property" },
    { name: "Power Backup", category: "property" },
    { name: "Security & CCTV", category: "property" },
    // Room-level
    { name: "Air Conditioning", category: "room" },
    { name: "Smart TV", category: "room" },
    { name: "Private Balcony", category: "room" },
    { name: "Mini Bar", category: "room" },
    { name: "Coffee & Tea Maker", category: "room" },
    { name: "Dedicated Workspace", category: "room" },
    { name: "Rain Shower", category: "room" },
    { name: "Bathtub", category: "room" },
    { name: "In-Room Safe", category: "room" },
    { name: "Kitchenette", category: "room" },
];

const CANCELLATION_POLICIES = [
    "Free cancellation up to 48 hours before check-in. 50% refund thereafter.",
    "Flexible: Full refund for cancellations made at least 24 hours before arrival.",
    "Moderate: Free cancellation up to 5 days before check-in.",
    "Strict: 50% refund up to 7 days prior to check-in; non-refundable afterwards.",
];

const REVIEW_COMMENTS = [
    "Spotless rooms, calm interiors, and super attentive hosts. Would gladly return!",
    "Exactly like the photos. Transparent pricing and seamless check-in made our weekend effortless.",
    "Loved the natural light, quiet neighborhood, and comfortable beds. Great value for money.",
    "Wonderful hospitality from start to finish. Breakfast and Wi-Fi were both top-notch.",
    "Beautiful architecture and peaceful vibe. A little outside the main rush, which we loved.",
    "Clean, well-maintained property with responsive staff and thoughtful little touches.",
    "Great location and smooth booking experience. Minor parking delay on arrival, otherwise perfect.",
    "One of the best stays we have booked this year—cozy, modern, and genuinely welcoming.",
];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickUnique(arr, count) {
    const copy = [...arr];
    const picked = [];
    const n = Math.min(count, copy.length);
    for (let i = 0; i < n; i++) {
        const idx = Math.floor(Math.random() * copy.length);
        picked.push(copy.splice(idx, 1)[0]);
    }
    return picked;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatDate(d) {
    return d.toISOString().slice(0, 10);
}

async function batchInsert(conn, sql, rows) {
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        await conn.query(sql, [chunk]);
    }
}

async function seed() {
    if (process.env.NODE_ENV === "production") {
        console.error("Refusing to run seed script in production environment.");
        process.exit(1);
    }
    const start = Date.now();
    const conn = await db.getConnection();

    try {
        console.log("1/8 Updating PROPERTY_TYPE enum to include 'villa' and 'apartment'...");
        await conn.query(`
            ALTER TABLE properties
            MODIFY COLUMN PROPERTY_TYPE
            ENUM('hotel','resort','hostel','guesthouse','villa','apartment') NOT NULL
        `);

        await conn.beginTransaction();

        // 2. Users (1 admin, 40 hosts, 60 guests)
        console.log("2/8 Seeding users...");
        const sharedHash = await bcrypt.hash("Stayora@123", 10);
        const adminId = uuidv4();
        const hostIds = [];
        const guestIds = [];
        const userRows = [
            [adminId, "Stayora Admin", "admin@stayora.dev", sharedHash, "admin", 1, "9800000001", null, 1],
        ];

        for (let i = 1; i <= TOTAL_HOSTS; i++) {
            const id = uuidv4();
            hostIds.push(id);
            userRows.push([
                id,
                faker.person.fullName(),
                `host${i}.${faker.string.alphanumeric(4).toLowerCase()}@stayora.dev`,
                sharedHash,
                "host",
                1,
                `98${randInt(10000000, 99999999)}`,
                null,
                1,
            ]);
        }

        for (let i = 1; i <= TOTAL_GUESTS; i++) {
            const id = uuidv4();
            guestIds.push(id);
            userRows.push([
                id,
                faker.person.fullName(),
                `guest${i}.${faker.string.alphanumeric(4).toLowerCase()}@stayora.dev`,
                sharedHash,
                "guest",
                1,
                `97${randInt(10000000, 99999999)}`,
                null,
                0,
            ]);
        }

        await batchInsert(
            conn,
            "INSERT IGNORE INTO users (ID, NAME, EMAIL, PASSWORD, ROLE, IS_VERIFIED, phone, avatar_url, is_host_verified) VALUES ?",
            userRows
        );

        // 3. Master Amenities
        console.log("3/8 Seeding amenities...");
        const amenityRows = MASTER_AMENITIES.map((a) => [uuidv4(), a.name, a.category]);
        await batchInsert(
            conn,
            "INSERT IGNORE INTO amenities (ID, NAME, CATEGORY) VALUES ?",
            amenityRows
        );

        const [savedAmenities] = await conn.query("SELECT ID, CATEGORY FROM amenities");
        const propertyAmenityIds = savedAmenities.filter((a) => a.CATEGORY === "property").map((a) => a.ID);
        const roomAmenityIds = savedAmenities.filter((a) => a.CATEGORY === "room").map((a) => a.ID);

        // 4. Properties, Property Images, Property Amenities, Rooms, Room Images, Room Amenities
        console.log(`4/8 Generating ${TOTAL_PROPERTIES} properties and related records...`);
        const propertyRows = [];
        const propertyImageRows = [];
        const propertyAmenityRows = [];
        const roomRows = [];
        const roomImageRows = [];
        const roomAmenityRows = [];
        const roomLookup = []; // for bookings & reviews

        const verifiedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

        for (let i = 0; i < TOTAL_PROPERTIES; i++) {
            const propId = uuidv4();
            const type = PROPERTY_TYPES[i % PROPERTY_TYPES.length];
            const dest = pick(DESTINATIONS);
            const area = pick(dest.areas);

            const title = `${pick(TITLE_PREFIXES[type])} ${area} ${pick(TITLE_SUFFIXES[type])}`;
            const [minPrice, maxPrice] = PRICE_RANGES[type];
            const basePrice = Math.round(randInt(minPrice, maxPrice) / 50) * 50;

            const templates = ROOM_TEMPLATES[type];
            const roomCountForProp = randInt(2, 3);
            const chosenTemplates = templates.slice(0, roomCountForProp);

            let totalRoomsSum = 0;
            let maxGuestsForProp = 1;

            for (const tmpl of chosenTemplates) {
                const roomId = uuidv4();
                const roomUnits = type === "villa" ? randInt(1, 3) : randInt(2, 10);
                const roomPrice = Math.round((basePrice * tmpl.mult) / 50) * 50;
                totalRoomsSum += roomUnits;
                if (tmpl.cap > maxGuestsForProp) maxGuestsForProp = tmpl.cap;

                roomRows.push([
                    roomId,
                    propId,
                    tmpl.type,
                    tmpl.desc,
                    tmpl.cap,
                    roomUnits,
                    roomPrice,
                ]);

                // 2 images per room
                const rImgs = pickUnique(ROOM_IMAGE_POOL, 2);
                for (const url of rImgs) {
                    roomImageRows.push([uuidv4(), roomId, url]);
                }

                // 4 unique room amenities per room
                const rAmens = pickUnique(roomAmenityIds, 4);
                for (const amenId of rAmens) {
                    roomAmenityRows.push([uuidv4(), roomId, amenId]);
                }

                roomLookup.push({ roomId, propId, cap: tmpl.cap, price: roomPrice });
            }

            const imgPool = PROPERTY_IMAGES[type];
            const typeIdx = Math.floor(i / PROPERTY_TYPES.length);
            const coverIdx = typeIdx % imgPool.length;
            const coverImage = imgPool[coverIdx];
            for (let g = 1; g <= 3; g++) {
                propertyImageRows.push([uuidv4(), propId, imgPool[(coverIdx + g * 3) % imgPool.length]]);
            }

            const pAmens = pickUnique(propertyAmenityIds, 5);
            for (const amenId of pAmens) {
                propertyAmenityRows.push([uuidv4(), propId, amenId]);
            }

            const r = Math.random();
            const verificationStatus = r < 0.95 ? "approved" : r < 0.99 ? "pending" : "rejected";
            const avR = Math.random();
            const availabilityStatus = avR < 0.92 ? "available" : avR < 0.97 ? "reserved" : "unavailable";

            const lat = Number((dest.lat + (Math.random() - 0.5) * 0.08).toFixed(7));
            const lng = Number((dest.lng + (Math.random() - 0.5) * 0.08).toFixed(7));
            const bathrooms = type === "villa" ? randInt(2, 5) : randInt(1, 3);
            const description = `Experience a serene stay at ${title} in ${area}, ${dest.city}. Thoughtfully curated for comfort with bright interiors, verified amenities, and easy access to local landmarks in ${dest.state}.`;

            propertyRows.push([
                propId,
                title,
                description,
                coverImage,
                type,
                bathrooms,
                basePrice,
                `${area}, ${dest.city}`,
                dest.city,
                dest.state,
                dest.pincode,
                lat,
                lng,
                availabilityStatus,
                verificationStatus,
                totalRoomsSum,
                maxGuestsForProp,
                "13:00:00",
                "11:00:00",
                pick(CANCELLATION_POLICIES),
                pick(hostIds),
                verificationStatus === "approved" ? adminId : null,
                verificationStatus === "approved" ? verifiedAt : null,
            ]);
        }

        console.log(`5/8 Inserting ${propertyRows.length} properties, ${propertyImageRows.length} property images, ${propertyAmenityRows.length} property amenities...`);
        await batchInsert(
            conn,
            `INSERT INTO properties (
                ID, title, description, image, PROPERTY_TYPE, BATHROOMS, price_per_night,
                location, city, state, pincode, latitude, longitude,
                AVAILABILITY_STATUS, verification_status, total_rooms, max_guests,
                check_in_time, check_out_time, cancellation_policy, HOST_ID,
                verified_by_admin_user_id, verified_at
            ) VALUES ?`,
            propertyRows
        );
        await batchInsert(conn, "INSERT INTO property_images (ID, property_id, IMAGE_URL) VALUES ?", propertyImageRows);
        await batchInsert(conn, "INSERT INTO property_amenities (ID, property_id, AMENITY_ID) VALUES ?", propertyAmenityRows);

        console.log(`6/8 Inserting ${roomRows.length} rooms, ${roomImageRows.length} room images, ${roomAmenityRows.length} room amenities...`);
        await batchInsert(
            conn,
            "INSERT INTO rooms (ID, property_id, ROOM_TYPE, DESCRIPTION, CAPACITY, TOTAL_ROOMS, PRICE_PER_NIGHT) VALUES ?",
            roomRows
        );
        await batchInsert(conn, "INSERT INTO room_images (ID, ROOM_ID, IMAGE_URL) VALUES ?", roomImageRows);
        await batchInsert(conn, "INSERT INTO room_amenities (ID, ROOM_ID, AMENITY_ID) VALUES ?", roomAmenityRows);

        // 7. Completed Bookings & Reviews
        console.log(`7/8 Inserting ${TOTAL_REVIEWS} completed bookings & reviews...`);
        const bookingRows = [];
        const reviewRows = [];
        const weightedRatings = [3, 4, 4, 4, 5, 5, 5, 5];

        for (let i = 0; i < TOTAL_REVIEWS; i++) {
            const target = pick(roomLookup);
            const guestId = pick(guestIds);
            const bookingId = uuidv4();

            const nights = randInt(1, 5);
            const daysAgo = randInt(10, 300);
            const checkIn = new Date(Date.now() - daysAgo * 86400000);
            const checkOut = new Date(checkIn.getTime() + nights * 86400000);
            const guests = randInt(1, target.cap);
            const totalAmount = target.price * nights;

            bookingRows.push([
                bookingId,
                guestId,
                target.roomId,
                formatDate(checkIn),
                formatDate(checkOut),
                guests,
                totalAmount,
                "completed",
            ]);

            reviewRows.push([
                uuidv4(),
                guestId,
                target.propId,
                bookingId,
                pick(weightedRatings),
                pick(REVIEW_COMMENTS),
            ]);
        }

        await batchInsert(
            conn,
            "INSERT INTO bookings (ID, USER_ID, ROOM_ID, CHECK_IN_DATE, CHECK_OUT_DATE, GUESTS, TOTAL_AMOUNT, STATUS) VALUES ?",
            bookingRows
        );
        await batchInsert(
            conn,
            "INSERT INTO review (ID, USER_ID, property_id, BOOKING_ID, RATING, COMMENT) VALUES ?",
            reviewRows
        );

        await conn.commit();
        console.log(`8/8 Done in ${((Date.now() - start) / 1000).toFixed(2)}s!`);
    } catch (err) {
        await conn.rollback();
        console.error("Seeding failed, rolled back:", err);
        process.exitCode = 1;
    } finally {
        conn.release();
        await db.end();
    }
}

seed();
