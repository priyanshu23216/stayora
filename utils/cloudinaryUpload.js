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
