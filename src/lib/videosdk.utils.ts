import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Generate a JWT token for VideoSDK.live
 * Documentation: https://docs.videosdk.live/docs/realtime-communication/sdk-reference/prebuilt/guide/authentication
 */
export const generateVideoSDKToken = () => {
  const apiKey = env.VIDEOSDK_API_KEY;
  const secret = env.VIDEOSDK_API_SECRET;

  const options = { expiresIn: "120m", algorithm: "HS256" as const };
  const payload = {
    apikey: apiKey,
    permissions: ["allow_join", "allow_mod"],
    version: 2,
  };

  return jwt.sign(payload, secret, options as any);
};

/**
 * Create a new room using VideoSDK REST API
 */
export const createVideoSDKRoom = async (token: string) => {
  const response = await fetch("https://api.videosdk.live/v2/rooms", {
    method: "POST",
    headers: {
      "Authorization": token,
      "Content-Type": "application/json",
    },
  });

  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(data.message || "Failed to create VideoSDK room");
  }

  return data.roomId;
};
