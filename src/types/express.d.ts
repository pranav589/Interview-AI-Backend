import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  role: 'user' | 'admin';
  isEmailVerified: boolean;
  hasResume: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
