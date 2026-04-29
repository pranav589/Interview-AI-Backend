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
    TWO_FACTOR_SETUP_INIT: "Two factor setup initiated",
    TWO_FACTOR_ENABLED: "Two Factor Enabled Successfully",
    TWO_FACTOR_REQUIRED_FIRST: "Two factor setup is required first",
    REFRESH_TOKEN_NOT_FOUND: "Refresh token not found",
    NOT_AUTHENTICATED: "Not authenticated.",
    TOKEN_INVALIDATED: "Token invalidated",
    TOKEN_EXPIRED: "Token expired",
    RESET_PASSWORD_SUBJECT: "Reset your password",
    RESET_LINK_SENT: "If an account with this email exists, we will send you a reset link",
    INVALID_OR_EXPIRED_TOKEN: "Invalid or expired token",
    GOOGLE_AUTH_MISSING_CODE: "Missing code in callback",
    GOOGLE_AUTH_ID_TOKEN_MISSING: "id_token not present",
    GOOGLE_EMAIL_NOT_VERIFIED: "Google email account is not verified",
    GOOGLE_CONFIG_MISSING: "Google client id or client secret is not present",
    LOGIN_SUCCESS: "Login successful",
    LOGOUT_SUCCESS: "Logged out successful",
    EMAIL_VERIFIED: "Email verified successfully",
    PASSWORD_RESET_SENT: "Password reset link sent to your email",
    RESET_SUCCESS: "Password reset successful",
    REGISTER_SUCCESS: "User registered successfully",
    TOKEN_REFRESHED: "Token refreshed",
    TOKEN_MISSING: "Token missing",
    EMAIL_ALREADY_VERIFIED: "Email is already verified",
    EMAIL_VERIFIED_NOW: "Email is verified!!",
    INVALID_REFRESH_TOKEN: "Invalid refresh token",
    WS_TICKET_GENERATED: "WS ticket generated",
    INVALID_EMAIL: "Invalid email format",
    RESET_TOKEN_REQUIRED: "Reset token is required",
    PASSWORD_MIN_LENGTH: "Password must be at least 6 characters",
  },
  USER: {
    NOT_FOUND: "User not found",
    ONBOARDING_SUCCESS: "Onboarding completed successfully",
    RESUME_EXTRACT_ERROR: "Could not extract text from PDF. Please ensure it's not an image-only PDF.",
    RESUME_UPLOAD_SUCCESS: "Resume uploaded and processed successfully",
    RESUME_INVALID_TYPE: "Only PDF files are allowed",
    RESUME_TOO_LARGE: "File size must be less than 5MB",
    SETTINGS_UPDATE_SUCCESS: "Settings updated successfully",
    PROFILE_FETCHED: "Profile fetched successfully",
    UNEXPECTED_FIELD: "Unexpected file field.",
  },
  INTERVIEW: {
    INVALID_DATA: "Invalid interview data",
    NOT_FOUND: "Interview not found",
    CREATED: "Interview created successfully",
    FEEDBACK_GENERATED: "Feedback generated successfully",
    INVALID_QUERY: "Invalid query parameters",
    FETCHED_SUCCESS: "Interviews fetched successfully",
    DETAILS_FETCHED: "Interview details fetched successfully",
    STATS_FETCHED: "Interview statistics fetched successfully",
    INVALID_FEEDBACK_REQUEST: "Invalid feedback request",
    SCORE_HISTORY_FETCHED: "Score history fetched successfully",
    FEEDBACK_NOT_FOUND: "Interview record not found",
    HISTORY_NOT_FOUND: "No interview history found for feedback generation",
    INVALID_ID_FORMAT: "Invalid interview ID format",
  },
  ADMIN: {
    USERS_FETCHED: "Users fetched successfully",
  },
  SYSTEM: {
    ERROR: "Something went very wrong!",
    INTERNAL_SERVER_ERROR: "Internal server error occurred",
    NOT_AUTHENTICATED: "User is not authenticated",
    NOT_AUTHORIZED: "User is not authorized to access this.",
    FEATURE_FLAGS_FETCHED: "Feature flags fetched successfully",
    FEATURE_FLAGS_ERROR: "Error fetching feature flags",
  },
  AI: {
    UNAVAILABLE: "AI service temporarily unavailable.",
    ANALYSIS_UNAVAILABLE: "AI analysis service temporarily unavailable.",
    ORCHESTRATOR_NOT_READY: "AI orchestrator is not initialized. Please retry in a moment.",
  },
  SOCKET: {
    INVALID_PAYLOAD: "Invalid payload",
    CONCURRENT_SESSION: "Concurrent session detected",
  },
  RATE_LIMIT: {
    DEFAULT: "Too many requests from this IP, please try again after 15 minutes",
    AUTH: "Too many login attempts. Please try again after 15 minutes.",
    INTERVIEW: "Interview session limit reached. Please try again later.",
  },
  SUBSCRIPTION: {
    DATA_MISSING: "User subscription data missing",
    INSUFFICIENT_CREDITS: "Insufficient credits. Please upgrade your plan.",
    UPGRADE_REQUIRED: "Subscription upgrade required to access this feature",
  },
} as const;

export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS];
