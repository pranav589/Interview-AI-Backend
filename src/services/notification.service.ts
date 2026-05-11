import { Notification } from "../models/notification.model";
import { notifyUser } from "../lib/socket";

export class NotificationService {
  async createNotification(data: {
    userId: string;
    type: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    link?: string;
  }) {
    const notification = await Notification.create(data);
    
    // Push real-time notification
    notifyUser(data.userId, {
      type: "notification:new",
      data: notification
    });
    
    return notification;
  }
}

export const notificationService = new NotificationService();
