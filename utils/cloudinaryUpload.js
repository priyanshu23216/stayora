import cloudinary from "../config/cloudinary.js";

/**
 * Uploads a single Multer memory-storage file buffer to Cloudinary.
 * @param {Buffer} fileBuffer
 * @param {string} folder
 * @returns {Promise<{ url: string, publicId: string }>}
 */
export function uploadBufferToCloudinary(fileBuffer, folder = "stayora/properties") {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: "image",
                transformation: [{ quality: "auto", fetch_format: "auto" }],
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                return resolve({
                    url: result.secure_url,
                    publicId: result.public_id,
                });
            }
        );
        stream.end(fileBuffer);
    });
}

/**
 * Best-effort cleanup for uploaded Cloudinary images (e.g., on DB rollback or delete).
 * @param {string[]} publicIds
 */
export async function destroyCloudinaryAssets(publicIds) {
    if (!Array.isArray(publicIds) || publicIds.length === 0) {
        return;
    }
    await Promise.allSettled(
        publicIds
            .filter((id) => typeof id === "string" && id.length > 0)
            .map((publicId) => cloudinary.uploader.destroy(publicId, { resource_type: "image" }))
    );
}
