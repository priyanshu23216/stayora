// Checks the actual first bytes ("magic bytes") of an uploaded file buffer.
// Why? A hacker can rename an HTML/script file to "photo.jpg" and fake the MIME type header,
// but real JPEG, PNG, WEBP, and AVIF images always start with specific signature bytes.

export function isValidImageBuffer(buffer) {
    // File must be a real Buffer with at least 12 bytes
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return false;
    }

    // 1. Check JPEG signature: starts with FF D8 FF
    const isJpeg =
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff;
    if (isJpeg) {
        return true;
    }

    // 2. Check PNG signature: starts with 89 50 4E 47 0D 0A 1A 0A
    const isPng =
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a;
    if (isPng) {
        return true;
    }

    // 3. Check WEBP signature: bytes 0-3 = "RIFF" and bytes 8-11 = "WEBP"
    const isWebp =
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (isWebp) {
        return true;
    }

    // 4. Check AVIF signature: bytes 4-7 = "ftyp" and bytes 8-11 = "avif" / "avis" / "mif1"
    const ftypHeader = buffer.subarray(4, 8).toString("ascii");
    const avifBrand = buffer.subarray(8, 12).toString("ascii");
    if (ftypHeader === "ftyp") {
        if (avifBrand === "avif" || avifBrand === "avis" || avifBrand === "mif1") {
            return true;
        }
    }

    // Did not match any allowed image format -> reject!
    return false;
}

// Check an array of uploaded Multer files
export function validateUploadedImages(files) {
    for (let file of files) {
        if (!file || !isValidImageBuffer(file.buffer)) {
            return false;
        }
    }
    return true;
}
