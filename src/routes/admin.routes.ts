import { Request, Response, Router } from "express";
import { requireRole } from "../middleware/requireRole";
import requireAuth from "../middleware/requireAuth";
import { User } from "../models/user.model";
import { asyncHandler } from "../lib/asyncHandler";

const router = Router();

router.get(
  "/users",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req: Request, res: Response) => {
    const users = await User.find(
      {},
      {
        email: 1,
        role: 1,
        isEmailVerified: 1,
        createdAt: 1,
      },
    ).sort({ createdAt: -1 });

    const result = users.map((u) => {
      return {
        id: u.id,
        email: u.email,
        role: u.role,
        isEmailVerified: u.isEmailVerified,
        createdAt: u.createdAt,
      };
    });
    return res.json({ users: result });
  }),
);

export default router;
