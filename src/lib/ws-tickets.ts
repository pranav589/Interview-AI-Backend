import { v4 as uuidv4 } from "uuid";

interface WSTicket {
  userId: string;
  expiresAt: number;
}

const tickets = new Map<string, WSTicket>();

export function createTicket(userId: string): string {
  const ticket = uuidv4();
  const expiresAt = Date.now() + 30 * 1000; // 30 seconds
  tickets.set(ticket, { userId, expiresAt });
  return ticket;
}

export function validateTicket(ticket: string): string | null {
  const data = tickets.get(ticket);
  if (!data) return null;

  tickets.delete(ticket); // Single-use

  if (data.expiresAt < Date.now()) {
    return null;
  }

  return data.userId;
}

// Cleanup interval every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [ticket, data] of tickets.entries()) {
    if (data.expiresAt < now) {
      tickets.delete(ticket);
    }
  }
}, 60 * 1000);
