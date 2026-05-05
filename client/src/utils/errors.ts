/**
 * Error handling utilities for user-friendly error messages.
 */

/**
 * API error response shape
 */
export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Known error codes and their user-friendly messages
 */
const ERROR_MESSAGES: Record<string, string> = {
  'Authentication required': 'Please log in to continue.',
  'Invalid or expired token': 'Your session has expired. Please log in again.',
  'User not found': 'Your account was not found. Please log in again.',
  'Access denied': 'You don\'t have permission to access this resource.',
  'Access denied to workspace': 'You don\'t have access to this workspace.',
  'Workspace not found': 'This workspace doesn\'t exist or has been deleted.',
  'Session not found': 'This conversation session no longer exists.',
  'Device not found': 'This device is no longer registered.',
  'Invalid device token': 'Your device needs to be re-registered.',
  'Invalid join code': 'This join code is invalid or expired.',
  'Slug already taken': 'This workspace URL is already in use. Please choose another.',
  'Invalid workspace name': 'Please enter a valid workspace name (1-100 characters).',
  'Invalid slug format': 'Workspace URLs can only contain letters, numbers, and hyphens.',
  'Only owner can update workspace': 'Only the workspace owner can make this change.',
  'Only owner can delete workspace': 'Only the workspace owner can delete this workspace.',
  'Cannot remove workspace owner': 'The workspace owner cannot be removed.',
  'deviceId required': 'Device ID is required for this action.',
  'deviceToken required': 'Device token is required for validation.',
  'Name is required': 'Please enter a name.',
  'Join code is required': 'Please enter a join code.',
};

/**
 * Network error messages
 */
const NETWORK_ERROR_MESSAGES: Record<string, string> = {
  'Failed to fetch': 'Unable to connect to the server. Please check your internet connection.',
  'NetworkError': 'Network error. Please check your connection and try again.',
  'ECONNREFUSED': 'Server is not responding. Please try again later.',
  'timeout': 'Request timed out. Please try again.',
};

/**
 * Get a user-friendly error message from an API error response.
 */
export function getUserFriendlyMessage(error: ApiError | string | Error): string {
  // Handle string errors
  if (typeof error === 'string') {
    return ERROR_MESSAGES[error] || error;
  }

  // Handle Error objects (network errors)
  if (error instanceof Error) {
    const errorName = error.name || '';
    const errorMessage = error.message || '';
    
    // Check for network-related errors
    for (const [key, message] of Object.entries(NETWORK_ERROR_MESSAGES)) {
      if (errorMessage.includes(key) || errorName.includes(key)) {
        return message;
      }
    }
    
    return ERROR_MESSAGES[errorMessage] || errorMessage || 'An unexpected error occurred.';
  }

  // Handle API error objects
  if (error.error) {
    return ERROR_MESSAGES[error.error] || error.error;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Parse an API response and extract error info.
 * Returns null if response is OK.
 */
export async function parseApiError(response: Response): Promise<ApiError | null> {
  if (response.ok) return null;

  try {
    const data = await response.json();
    return {
      error: data.error || `HTTP ${response.status}`,
      code: data.code,
      details: data.details,
    };
  } catch {
    return {
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  }
}

/**
 * Wrapper for API calls with error handling.
 * Throws user-friendly error on failure.
 */
export async function apiCall<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(url, {
      credentials: 'include', // Include cookies for auth
      ...options,
    });

    const error = await parseApiError(response);
    if (error) {
      throw new Error(getUserFriendlyMessage(error));
    }

    return response.json() as Promise<T>;
  } catch (e) {
    if (e instanceof Error) {
      // If it's already a user-friendly error from parseApiError, re-throw
      if (Object.values(ERROR_MESSAGES).includes(e.message)) {
        throw e;
      }
      throw new Error(getUserFriendlyMessage(e));
    }
    throw new Error('An unexpected error occurred.');
  }
}

/**
 * HTTP status code descriptions
 */
export function getStatusDescription(status: number): string {
  switch (status) {
    case 400: return 'Invalid request';
    case 401: return 'Authentication required';
    case 403: return 'Access denied';
    case 404: return 'Not found';
    case 409: return 'Conflict';
    case 422: return 'Validation error';
    case 429: return 'Too many requests';
    case 500: return 'Server error';
    case 502: return 'Server unavailable';
    case 503: return 'Service unavailable';
    default: return `Error ${status}`;
  }
}
