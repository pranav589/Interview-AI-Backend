import nodemailer from "nodemailer";
import { env } from "../config/env";

export async function sendEmail(to: string, subject: string, body: string) {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false, // true for port 465
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to,
    subject,
    html: body,
  });
}
