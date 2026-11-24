import { z } from "zod";

// Password rules (max 72 bytes to prevent bcrypt silent truncation and CPU DoS)
const passwordRules = z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(72, "Password cannot exceed 72 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[@$!%*?&#]/, "Password must contain at least one special character (@$!%*?&#)");

// Signup validation
export const signupSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Name should contain minimum 2 characters")
        .max(100, "Name cannot exceed 100 characters")
        .regex(/^[^<>]+$/, "Name cannot contain < or > characters"),
    email: z
        .string()
        .toLowerCase()
        .trim()
        .max(254, "Email is too long")
        .email("Enter a valid email, example - user@domain.com"),
    password: passwordRules,
});

// Reset password validation
export const resetPassword = z.object({
    password: passwordRules,
});

// Login validation
export const loginCheck = z.object({
    email: z
        .string()
        .toLowerCase()
        .trim()
        .max(254, "Email is too long")
        .email("Enter a valid email, example - user@domain.com"),
    password: z.string().min(1, "Invalid password").max(72, "Invalid password"),
});

// OTP verification validation
export const otpValidator = z.object({
    email: z
        .string()
        .toLowerCase()
        .trim()
        .max(254, "Email is too long")
        .email("Some error occurred, please sign up again"),
    otp: z
        .string()
        .trim()
        .regex(/^[0-9]{6}$/, "OTP must be a 6-digit number"),
});

// Email-only validation (forgot password / resend OTP)
export const emailValidator = z.object({
    email: z
        .string()
        .toLowerCase()
        .trim()
        .max(254, "Email is too long")
        .email("Enter a valid email, example - user@domain.com"),
});

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Strict allowed cancellation policies (prevents misleading free-text policies)
export const ALLOWED_CANCELLATION_POLICIES = [
    "Flexible — Free cancellation up to 24 hours before check-in",
    "Moderate — 100% refund up to 5 days, 60% up to 3 days, 50% up to 48 hours before check-in",
    "Strict — 50% refund up to 7 days before check-in",
];

// New property listing form validation
export const newListingSchema = z.object({
    title: z
        .string()
        .trim()
        .min(3, "Property title must be at least 3 characters long.")
        .max(120, "Property title cannot exceed 120 characters.")
        .regex(/^[A-Za-z0-9\s,&'().-]+$/, "Property title contains invalid characters."),

    propertyType: z.enum(
        ["hotel", "resort", "hostel", "guesthouse", "villa", "apartment"],
        { message: "Please select a valid property type." }
    ),

    description: z
        .string()
        .trim()
        .min(10, "Description must be at least 10 characters long.")
        .max(2000, "Description cannot exceed 2000 characters.")
        .regex(/^[^<>]+$/, "Description cannot contain < or > characters."),

    pricePerNight: z.coerce
        .number({ message: "Price per night must be a valid number." })
        .min(100, "Price per night must be at least ₹100.")
        .max(500000, "Price per night cannot exceed ₹5,00,000."),

    bathrooms: z.coerce
        .number({ message: "Bathrooms must be a number." })
        .int("Bathrooms must be a whole number.")
        .min(1, "At least 1 bathroom is required.")
        .max(50, "Bathrooms cannot exceed 50."),

    totalRooms: z.coerce
        .number({ message: "Total rooms must be a number." })
        .int("Total rooms must be a whole number.")
        .min(1, "At least 1 room is required.")
        .max(500, "Total rooms cannot exceed 500."),

    maxGuests: z.coerce
        .number({ message: "Max guests must be a number." })
        .int("Max guests must be a whole number.")
        .min(1, "At least 1 guest is required.")
        .max(100, "Max guests cannot exceed 100."),

    location: z
        .string()
        .trim()
        .min(3, "Area or street address must be at least 3 characters.")
        .max(150, "Area or street address is too long.")
        .regex(/^[A-Za-z0-9\s,./'#-]+$/, "Address contains invalid characters."),

    city: z
        .string()
        .trim()
        .min(2, "City name must be at least 2 characters.")
        .max(60, "City name is too long.")
        .regex(/^[A-Za-z\s.-]+$/, "City name can only contain letters and spaces."),

    state: z
        .string()
        .trim()
        .min(2, "State name must be at least 2 characters.")
        .max(60, "State name is too long.")
        .regex(/^[A-Za-z\s.-]+$/, "State name can only contain letters and spaces."),

    pincode: z
        .string()
        .trim()
        .regex(/^[1-9][0-9]{5}$/, "Pincode must be a valid 6-digit Indian pincode."),

    latitude: z
        .string()
        .trim()
        .optional()
        .default("")
        .refine(
            (val) => val === "" || /^-?([0-8]?\d(\.\d+)?|90(\.0+)?)$/.test(val),
            "Latitude must be a valid number between -90 and 90."
        ),

    longitude: z
        .string()
        .trim()
        .optional()
        .default("")
        .refine(
            (val) => val === "" || /^-?((1[0-7]\d|[0-9]?\d)(\.\d+)?|180(\.0+)?)$/.test(val),
            "Longitude must be a valid number between -180 and 180."
        ),

    checkInTime: z
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Please enter a valid check-in time."),

    checkOutTime: z
        .string()
        .trim()
        .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Please enter a valid check-out time."),

    cancellationPolicy: z.enum(ALLOWED_CANCELLATION_POLICIES, {
        message: "Please select a valid cancellation policy.",
    }),

    amenities: z
        .union([
            z.string().regex(uuidRegex, "Invalid amenity selected."),
            z.array(z.string().regex(uuidRegex, "Invalid amenity selected.")),
        ])
        .optional(),
});

// Edit property form validation
export const editListingSchema = newListingSchema.extend({
    availabilityStatus: z.enum(
        ["available", "reserved", "unavailable"],
        { message: "Please select a valid availability status." }
    ),
});

// Add/edit room form validation
export const roomSchema = z.object({
    roomType: z
        .string()
        .trim()
        .min(3, "Room name must be at least 3 characters long.")
        .max(100, "Room name cannot exceed 100 characters.")
        .regex(/^[A-Za-z0-9\s,&'()/-]+$/, "Room name contains invalid characters."),

    description: z
        .string()
        .trim()
        .min(10, "Room description must be at least 10 characters long.")
        .max(1500, "Room description cannot exceed 1500 characters.")
        .regex(/^[^<>]+$/, "Room description cannot contain < or > characters."),

    capacity: z.coerce
        .number({ message: "Max guests per room must be a number." })
        .int("Max guests per room must be a whole number.")
        .min(1, "At least 1 guest per room is required.")
        .max(20, "Max guests per room cannot exceed 20."),

    totalRooms: z.coerce
        .number({ message: "Number of rooms must be a number." })
        .int("Number of rooms must be a whole number.")
        .min(1, "At least 1 room unit is required.")
        .max(200, "Number of rooms cannot exceed 200."),

    pricePerNight: z.coerce
        .number({ message: "Price per night must be a valid number." })
        .min(100, "Price per night must be at least ₹100.")
        .max(500000, "Price per night cannot exceed ₹5,00,000."),

    amenities: z
        .union([
            z.string().regex(uuidRegex, "Invalid room amenity selected."),
            z.array(z.string().regex(uuidRegex, "Invalid room amenity selected.")),
        ])
        .optional(),
});

// Strict YYYY-MM-DD calendar date check (rejects rollover dates like 2026-02-30)
function isStrictIsoDate(val) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        return false;
    }
    const [y, m, d] = val.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
    );
}

// Booking creation form validation
export const bookingSchema = z.object({
    checkIn: z
        .string()
        .trim()
        .refine(isStrictIsoDate, "Please enter a valid check-in date (YYYY-MM-DD)."),
    checkOut: z
        .string()
        .trim()
        .refine(isStrictIsoDate, "Please enter a valid check-out date (YYYY-MM-DD)."),
    guests: z
        .union([z.string().trim().regex(/^\d+$/, "Guests must be a valid whole number."), z.number().int()])
        .transform((v) => Number(v))
        .refine((n) => Number.isInteger(n) && n >= 1 && n <= 100, "Guests must be between 1 and 100."),
});

// Admin rejection reason validation
export const rejectPropertySchema = z.object({
    rejectionReason: z
        .string()
        .trim()
        .min(5, "Please provide a clear rejection reason (at least 5 characters).")
        .max(500, "Rejection reason cannot exceed 500 characters.")
        .regex(/^[^<>]+$/, "Rejection reason cannot contain < or > characters."),
});

// Admin host verify optional propertyId redirect validation
export const hostVerifySchema = z.object({
    propertyId: z
        .string()
        .trim()
        .regex(uuidRegex, "Invalid property ID.")
        .optional(),
});
