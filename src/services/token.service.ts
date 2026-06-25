import jwt from "jsonwebtoken";
import { env } from "../config/env";

export function createAccessToken(
  userId: string,
  role: "user" | "admin" | "employer" | "candidate",
  tokenVersion: number
) {
  const payload = {
    sub: userId,
    role,
    tokenVersion,
  };

  const exp = role === "candidate" ? "30m" : "15m";

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: exp,
  });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as {
    sub: string;
    role: "user" | "admin" | "employer" | "candidate";
    tokenVersion: number;
  };
}

export function createRefreshToken(userId: string, tokenVersion: number) {
  const payload = {
    sub: userId,
    tokenVersion,
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  });
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as {
    sub: string;
    tokenVersion: number;
  };
}
