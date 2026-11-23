import multer from "multer";

const storage = multer.memoryStorage();

const ALLOWED_TYPES = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/avif",
];

// Only allow image files to be uploaded
const fileFilter = (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
        return cb(null, true);
    }
    const err = new Error("Only JPEG, PNG, WEBP, and AVIF image files are allowed.");
    err.code = "INVALID_FILE_TYPE";
    return cb(err, false);
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5 MB max per file
    },
});

export default upload;
