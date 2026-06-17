import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";
import { createModuleLogger } from "../lib/logger";

const logger = createModuleLogger("cloudinary-provider");

const hasCredentials = !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);

if (hasCredentials) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  logger.info("Cloudinary provider initialized successfully");
} else {
  logger.warn("Cloudinary credentials missing. Video uploads will fail.");
}

export const uploadInterviewVideo = (fileBuffer: Buffer, filename: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!hasCredentials) {
      return reject(new Error("Cloudinary credentials are not configured."));
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        public_id: filename.replace(/\.[^/.]+$/, ""), // strip extension
        folder: "interviews",
      },
      (error, result) => {
        if (error) {
          logger.error(error, "Cloudinary upload failed");
          return reject(error);
        }
        if (!result) {
          return reject(new Error("No result returned from Cloudinary upload"));
        }
        logger.info(`Video uploaded to Cloudinary: ${result.secure_url}`);
        resolve(result.secure_url);
      }
    );

    uploadStream.end(fileBuffer);
  });
};
