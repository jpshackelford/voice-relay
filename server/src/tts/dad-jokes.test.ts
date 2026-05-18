import { describe, it, expect } from 'vitest';
import { DAD_JOKES, getRandomJoke } from './dad-jokes.js';

describe('dad-jokes', () => {
  describe('DAD_JOKES', () => {
    it('should have at least 20 jokes', () => {
      expect(DAD_JOKES.length).toBeGreaterThanOrEqual(20);
    });

    it('should contain only non-empty strings', () => {
      DAD_JOKES.forEach((joke, index) => {
        expect(typeof joke).toBe('string');
        expect(joke.trim().length).toBeGreaterThan(0);
      });
    });

    it('should contain jokes that are reasonably short (under 200 characters)', () => {
      DAD_JOKES.forEach((joke, index) => {
        expect(joke.length).toBeLessThan(200);
      });
    });

    it('should not have duplicate jokes', () => {
      const uniqueJokes = new Set(DAD_JOKES);
      expect(uniqueJokes.size).toBe(DAD_JOKES.length);
    });
  });

  describe('getRandomJoke', () => {
    it('should return a string', () => {
      const joke = getRandomJoke();
      expect(typeof joke).toBe('string');
    });

    it('should return a joke from the DAD_JOKES array', () => {
      const joke = getRandomJoke();
      expect(DAD_JOKES).toContain(joke);
    });

    it('should return different jokes over multiple calls (statistical test)', () => {
      const jokes = new Set<string>();
      // With 25 jokes and 50 calls, we should see multiple different jokes
      for (let i = 0; i < 50; i++) {
        jokes.add(getRandomJoke());
      }
      // We should get at least a few different jokes
      expect(jokes.size).toBeGreaterThan(1);
    });
  });
});
