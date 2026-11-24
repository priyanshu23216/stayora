// Validates image binary signatures (magic bytes) so spoofed MIME types are rejected before Cloudinary upload

export function isValidImageBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
        return false;
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return true;
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return true;
    }

    // WEBP: "RIFF" .... "WEBP"
    if (
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
        return true;
    }

    // AVIF: ISO Base Media File Format with "ftyp" at bytes 4..8 and "avif"/"avis"/"mif1" brand
    if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
        const brand = buffer.subarray(8, 12).toString("ascii");
        if (brand === "avif" || brand === "avis" || brand === "mif1") {
            return true;
        }
    }

    return false;
}

export function validateUploadedImages(files) {
    for (const file of files) {
        if (!file || !isValidImageBuffer(file.buffer)) {
            return false;
        }
    }
    return true;
}
