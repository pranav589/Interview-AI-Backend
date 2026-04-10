export const SUBSCRIPTION_TIERS = {
  FREE: "free",
  PRO: "pro",
  ENTERPRISE: "enterprise",
} as const;

export const DEFAULT_FREE_CREDITS = 3;

export const INTERVIEW_TYPES = [
  "behavioral",
  "technical",
  "system-design",
] as const;

export const DIFFICULTY_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
] as const;

export const MESSAGES = {
  AUTH: {
    INVALID_DATA: "Invalid data!",
    EMAIL_EXISTS: "Email already exists. Please try with a different email",
    VERIFY_EMAIL_SUBJECT: "Verify your email",
    USER_NOT_FOUND: "User not found",
    INVALID_CREDENTIALS: "Invalid email or password",
    VERIFY_REQUIRED: "Please verify your email before login.",
    TWO_FACTOR_REQUIRED: "Two factor authentication code required",
    TWO_FACTOR_INVALID: "Invalid two factor code",
    TWO_FACTOR_MISCONFIGURED: "Two factor misconfigured for this account",
    REFRESH_TOKEN_NOT_FOUND: "Refresh token not found",
    NOT_AUTHENTICATED: "Not authenticated.",
    TOKEN_INVALIDATED: "Token invalidated",
    RESET_PASSWORD_SUBJECT: "Reset your password",
    RESET_LINK_SENT: "If an account with this email exists, we will send you a reset link",
    INVALID_OR_EXPIRED_TOKEN: "Invalid or expired token",
    GOOGLE_AUTH_MISSING_CODE: "Missing code in callback",
    GOOGLE_AUTH_ID_TOKEN_MISSING: "id_token not present",
    GOOGLE_EMAIL_NOT_VERIFIED: "Google email account is not verified",
    LOGIN_SUCCESS: "Login successful",
    LOGOUT_SUCCESS: "Logged out successful",
    EMAIL_VERIFIED: "Email verified successfully",
    PASSWORD_RESET_SENT: "Password reset link sent to your email",
    RESET_SUCCESS: "Password reset successful",
  },
  USER: {
    NOT_FOUND: "User not found",
    ONBOARDING_SUCCESS: "Onboarding completed successfully",
    RESUME_EXTRACT_ERROR: "Could not extract text from PDF. Please ensure it's not an image-only PDF.",
    RESUME_UPLOAD_SUCCESS: "Resume uploaded and processed successfully",
    SETTINGS_UPDATE_SUCCESS: "Settings updated successfully",
  },
  INTERVIEW: {
    INVALID_DATA: "Invalid data!",
    NOT_FOUND: "Interview not found",
    CREATED: "Interview created",
    FEEDBACK_GENERATED: "Feedback generated successfully",
  },
  SUBSCRIPTION: {
    DATA_MISSING: "Subscription data missing",
    INSUFFICIENT_CREDITS: "You have reached your monthly interview limit. Upgrade to Pro for unlimited access.",
    PRO_ONLY_FEATURE: "Technical and System Design interviews are only available for Pro users.",
    UPGRADE_REQUIRED: "This feature requires a higher subscription tier.",
  },
  SYSTEM: {
    ERROR: "Something went very wrong!",
    INTERNAL_SERVER_ERROR: "Internal server error occurred",
  },
  RATE_LIMIT: {
    DEFAULT: "Too many requests from this IP, please try again after 15 minutes",
    AUTH: "Too many login attempts. Please try again after 15 minutes.",
    INTERVIEW: "Interview session limit reached. Please try again later.",
  },
} as const;

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS];
