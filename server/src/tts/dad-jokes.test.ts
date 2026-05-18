import { describe, it, expect } from 'vitest';
import { DAD_JOKES, getRandomJoke } from './dad-jokes.js';

describe('Dad Jokes', () => {
  describe('DAD_JOKES', () => {
    it('contains at least 20 jokes', () => {
      expect(DAD_JOKES.length).toBeGreaterThanOrEqual(20);
    });

    it('all jokes are non-empty strings', () => {
      for (const joke of DAD_JOKES) {
        expect(typeof joke).toBe('string');
        expect(joke.trim().length).toBeGreaterThan(0);
      }
    });

    it('jokes are reasonably short (under 150 characters for voice preview)', () => {
      for (const joke of DAD_JOKES) {
        expect(joke.length).toBeLessThan(150);
      }
    });

    it('jokes end with punctuation', () => {
      for (const joke of DAD_JOKES) {
        const lastChar = joke.trim().slice(-1);
        expect(['!', '?', '.']).toContain(lastChar);
      }
    });
  });

  describe('getRandomJoke', () => {
    it('returns a string from the DAD_JOKES array', () => {
      const joke = getRandomJoke();
      expect(DAD_JOKES).toContain(joke);
    });

    it('returns different jokes on multiple calls (probabilistic)', () => {
      // Call multiple times and check we get at least 2 different results
      const jokes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        jokes.add(getRandomJoke());
      }
      // With 25 jokes and 50 calls, we should almost certainly get multiple different ones
      expect(jokes.size).toBeGreaterThan(1);
    });
  });
});
