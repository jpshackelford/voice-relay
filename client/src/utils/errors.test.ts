import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getUserFriendlyMessage,
  parseApiError,
  apiCall,
  getStatusDescription,
  type ApiError,
} from './errors';

describe('errors utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUserFriendlyMessage', () => {
    it('returns friendly message for known error strings', () => {
      expect(getUserFriendlyMessage('Authentication required'))
        .toBe('Please log in to continue.');
      
      expect(getUserFriendlyMessage('Invalid or expired token'))
        .toBe('Your session has expired. Please log in again.');
      
      expect(getUserFriendlyMessage('Access denied'))
        .toBe("You don't have permission to access this resource.");
      
      expect(getUserFriendlyMessage('Workspace not found'))
        .toBe("This workspace doesn't exist or has been deleted.");
    });

    it('returns original string for unknown errors', () => {
      expect(getUserFriendlyMessage('Some unknown error'))
        .toBe('Some unknown error');
    });

    it('handles ApiError objects with known errors', () => {
      const error: ApiError = {
        error: 'Invalid device token',
        code: 'DEVICE_TOKEN_INVALID',
      };
      
      expect(getUserFriendlyMessage(error))
        .toBe('Your device needs to be re-registered.');
    });

    it('handles ApiError objects with unknown errors', () => {
      const error: ApiError = {
        error: 'Something unexpected happened',
      };
      
      expect(getUserFriendlyMessage(error))
        .toBe('Something unexpected happened');
    });

    it('handles Error objects with known messages', () => {
      const error = new Error('Access denied to workspace');
      
      expect(getUserFriendlyMessage(error))
        .toBe("You don't have access to this workspace.");
    });

    it('handles network errors - Failed to fetch', () => {
      const error = new Error('Failed to fetch');
      
      expect(getUserFriendlyMessage(error))
        .toBe('Unable to connect to the server. Please check your internet connection.');
    });

    it('handles network errors - NetworkError', () => {
      const error = new Error('NetworkError');
      error.name = 'NetworkError';
      
      expect(getUserFriendlyMessage(error))
        .toBe('Network error. Please check your connection and try again.');
    });

    it('handles network errors - ECONNREFUSED', () => {
      const error = new Error('connect ECONNREFUSED');
      
      expect(getUserFriendlyMessage(error))
        .toBe('Server is not responding. Please try again later.');
    });

    it('handles network errors - timeout', () => {
      const error = new Error('Request timeout');
      
      expect(getUserFriendlyMessage(error))
        .toBe('Request timed out. Please try again.');
    });

    it('handles Error objects with empty message', () => {
      const error = new Error();
      
      expect(getUserFriendlyMessage(error))
        .toBe('An unexpected error occurred.');
    });

    it('handles ApiError without error property', () => {
      const error = {} as ApiError;
      
      expect(getUserFriendlyMessage(error))
        .toBe('An unexpected error occurred. Please try again.');
    });
  });

  describe('parseApiError', () => {
    it('returns null for successful responses', async () => {
      const response = new Response(null, { status: 200 });
      
      const error = await parseApiError(response);
      
      expect(error).toBeNull();
    });

    it('parses JSON error response', async () => {
      const response = new Response(
        JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }),
        { status: 404 }
      );
      
      const error = await parseApiError(response);
      
      expect(error).toEqual({
        error: 'Not found',
        code: 'NOT_FOUND',
        details: undefined,
      });
    });

    it('handles non-JSON error response', async () => {
      const response = new Response('Internal Server Error', { 
        status: 500,
        statusText: 'Internal Server Error'
      });
      
      const error = await parseApiError(response);
      
      expect(error).toEqual({
        error: 'HTTP 500: Internal Server Error',
      });
    });

    it('handles empty error response', async () => {
      const response = new Response(JSON.stringify({}), { status: 400 });
      
      const error = await parseApiError(response);
      
      expect(error?.error).toBe('HTTP 400');
    });
  });

  describe('apiCall', () => {
    it('returns data for successful response', async () => {
      const mockData = { id: 1, name: 'Test' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await apiCall<typeof mockData>('/api/test');

      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith('/api/test', {
        credentials: 'include',
      });
    });

    it('passes through request options', async () => {
      const mockData = { success: true };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      await apiCall('/api/test', {
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
        headers: { 'Content-Type': 'application/json' },
      });

      expect(fetch).toHaveBeenCalledWith('/api/test', {
        credentials: 'include',
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
        headers: { 'Content-Type': 'application/json' },
      });
    });

    it('throws user-friendly error on API error', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Authentication required' }),
      });

      await expect(apiCall('/api/test')).rejects.toThrow(
        'Please log in to continue.'
      );
    });

    it('throws user-friendly error on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

      await expect(apiCall('/api/test')).rejects.toThrow(
        'Unable to connect to the server. Please check your internet connection.'
      );
    });

    it('handles non-Error thrown values', async () => {
      global.fetch = vi.fn().mockRejectedValue('string error');

      await expect(apiCall('/api/test')).rejects.toThrow(
        'An unexpected error occurred.'
      );
    });
  });

  describe('getStatusDescription', () => {
    it('returns correct descriptions for common status codes', () => {
      expect(getStatusDescription(400)).toBe('Invalid request');
      expect(getStatusDescription(401)).toBe('Authentication required');
      expect(getStatusDescription(403)).toBe('Access denied');
      expect(getStatusDescription(404)).toBe('Not found');
      expect(getStatusDescription(409)).toBe('Conflict');
      expect(getStatusDescription(422)).toBe('Validation error');
      expect(getStatusDescription(429)).toBe('Too many requests');
      expect(getStatusDescription(500)).toBe('Server error');
      expect(getStatusDescription(502)).toBe('Server unavailable');
      expect(getStatusDescription(503)).toBe('Service unavailable');
    });

    it('returns generic error for unknown status codes', () => {
      expect(getStatusDescription(418)).toBe('Error 418');
      expect(getStatusDescription(999)).toBe('Error 999');
    });
  });
});
