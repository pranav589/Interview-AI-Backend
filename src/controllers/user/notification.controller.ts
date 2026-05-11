import { Request, Response } from "express";
import { asyncHandler } from "../../lib/asyncHandler";
import { Notification } from "../../models/notification.model";
import { NotFoundError } from "../../lib/errors";
import { notifyUser } from "../../lib/socket";

export const getNotifications = asyncHandler(async (req: Request, res: Response) => {
  const notifications = await Notification.find({ userId: (req as any).user.id })
    .sort({ createdAt: -1 })
    .limit(50);
    
  return res.json({
    success: true,
    message: "Notifications fetched",
    data: notifications
  });
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: (req as any).user.id },
    { isRead: true },
    { new: true }
  );
  
  if (!notification) throw new NotFoundError("Notification not found");
  
  // Push real-time update to other tabs
  notifyUser((req as any).user.id, {
    type: "notification:read",
    data: { id: req.params.id }
  });
  
  return res.json({
    success: true,
    message: "Notification marked as read",
    data: notification
  });
});

export const markAllAsRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany(
    { userId: (req as any).user.id, isRead: false },
    { isRead: true }
  );
  
  // Push real-time update to other tabs
  notifyUser((req as any).user.id, {
    type: "notification:read-all"
  });
  
  return res.json({
    success: true,
    message: "All notifications marked as read"
  });
});

export const clearNotifications = asyncHandler(async (req: Request, res: Response) => {
  await Notification.deleteMany({ userId: (req as any).user.id });
  
  // Push real-time update to other tabs
  notifyUser((req as any).user.id, {
    type: "notification:clear"
  });
  
  return res.json({
    success: true,
    message: "Notifications cleared"
  });
});
