import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SuccessIndicator, getObservationStatus } from './SuccessIndicator';

describe('SuccessIndicator', () => {
  describe('rendering', () => {
    it('renders green checkmark for success status', () => {
      render(<SuccessIndicator status="success" />);
      const indicator = screen.getByTitle('Success');
      expect(indicator).toBeDefined();
      expect(indicator.className).toContain('success-indicator');
      expect(indicator.className).toContain('success');
      expect(indicator.textContent).toBe('✓');
    });

    it('renders yellow clock for timeout status', () => {
      render(<SuccessIndicator status="timeout" />);
      const indicator = screen.getByTitle('Timeout');
      expect(indicator).toBeDefined();
      expect(indicator.className).toContain('success-indicator');
      expect(indicator.className).toContain('timeout');
      expect(indicator.textContent).toBe('⏱');
    });

    it('renders cross for error status', () => {
      render(<SuccessIndicator status="error" />);
      const indicator = screen.getByTitle('Error');
      expect(indicator).toBeDefined();
      expect(indicator.className).toContain('success-indicator');
      expect(indicator.className).toContain('error');
      expect(indicator.textContent).toBe('✗');
    });

    it('renders pending ellipsis for pending status (issue #265)', () => {
      // In-flight actions (no observation yet) must be visually distinguishable
      // from silent successes. Previously this rendered nothing.
      render(<SuccessIndicator status="pending" />);
      const indicator = screen.getByTitle('Pending');
      expect(indicator).toBeDefined();
      expect(indicator.className).toContain('success-indicator');
      expect(indicator.className).toContain('pending');
      expect(indicator.textContent).toBe('⋯');
    });
  });
});

describe('getObservationStatus', () => {
  describe('success cases', () => {
    it('returns success for exit_code 0', () => {
      expect(getObservationStatus(0)).toBe('success');
    });
  });

  describe('timeout cases', () => {
    it('returns timeout for exit_code -1', () => {
      expect(getObservationStatus(-1)).toBe('timeout');
    });

    it('returns timeout when isTimeout is true', () => {
      expect(getObservationStatus(0, false, true)).toBe('timeout');
    });

    it('returns timeout when isTimeout is true even with success exit code', () => {
      expect(getObservationStatus(0, false, true)).toBe('timeout');
    });
  });

  describe('error cases', () => {
    it('returns error when isError is true', () => {
      expect(getObservationStatus(undefined, true)).toBe('error');
    });

    it('returns error for non-zero exit codes', () => {
      expect(getObservationStatus(1)).toBe('error');
      expect(getObservationStatus(127)).toBe('error');
      expect(getObservationStatus(255)).toBe('error');
    });
  });

  describe('pending cases', () => {
    it('returns pending when no exit code is provided', () => {
      expect(getObservationStatus(undefined)).toBe('pending');
    });

    it('returns pending when exit code is undefined and no error flags', () => {
      expect(getObservationStatus(undefined, false, false)).toBe('pending');
    });
  });
});
