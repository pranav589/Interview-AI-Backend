import { Router } from "express";
import requireAuth from "../middleware/requireAuth";
import * as notificationController from "../controllers/user/notification.controller";

const router = Router();

router.use(requireAuth);

router.get("/", notificationController.getNotifications);
router.patch("/read-all", notificationController.markAllAsRead);
router.patch("/:id/read", notificationController.markAsRead);
router.delete("/", notificationController.clearNotifications);

export default router;
