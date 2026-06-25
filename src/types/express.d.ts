import { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  role: 'user' | 'admin' | 'employer' | 'candidate';
  isEmailVerified: boolean;
  hasResume: boolean;
  subscriptionTier: 'free' | 'pro' | 'enterprise';
  credits: number;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
