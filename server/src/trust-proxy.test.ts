import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

/**
 * Tests for Express trust proxy configuration.
 * 
 * Background: When Express runs behind a reverse proxy (Apache, nginx), the proxy
 * adds the X-Forwarded-For header containing the client's real IP address. Without
 * trust proxy enabled, Express ignores this header and express-rate-limit throws
 * a ValidationError.
 * 
 * The fix: app.set('trust proxy', 1) tells Express to trust one proxy hop.
 * 
 * Reference: https://expressjs.com/en/guide/behind-proxies.html
 */
describe('Express Trust Proxy Configuration', () => {
  describe('trust proxy setting', () => {
    it('should use IP from X-Forwarded-For when trust proxy is enabled', async () => {
      const app = express();
      app.set('trust proxy', 1);
      
      let resolvedIp: string | undefined;
      
      app.get('/test', (req, res) => {
        resolvedIp = req.ip;
        res.json({ ip: req.ip });
      });
      
      // Single IP in X-Forwarded-For (typical Apache proxy scenario)
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
      
      // With trust proxy = 1, Express should use the IP from X-Forwarded-For
      expect(resolvedIp).toBe('203.0.113.50');
    });

    it('should ignore X-Forwarded-For when trust proxy is not set', async () => {
      const app = express();
      // trust proxy is false by default
      
      let resolvedIp: string | undefined;
      
      app.get('/test', (req, res) => {
        resolvedIp = req.ip;
        res.json({ ip: req.ip });
      });
      
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
      
      // Without trust proxy, Express should use the socket address (localhost in tests)
      expect(resolvedIp).not.toBe('203.0.113.50');
    });
  });

  describe('express-rate-limit with trust proxy', () => {
    it('should not throw ValidationError when trust proxy is enabled', async () => {
      const app = express();
      app.set('trust proxy', 1);
      
      const limiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 10,
        standardHeaders: true,
        legacyHeaders: false,
        // No validate.xForwardedForHeader override needed when trust proxy is set
      });
      
      app.get('/test', limiter, (req, res) => {
        res.json({ success: true });
      });
      
      // This should NOT throw ValidationError about X-Forwarded-For
      const response = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
      
      expect(response.body.success).toBe(true);
    });

    it('should rate limit by client IP from X-Forwarded-For', async () => {
      const app = express();
      app.set('trust proxy', 1);
      
      const limiter = rateLimit({
        windowMs: 60 * 1000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
      });
      
      app.get('/test', limiter, (req, res) => {
        res.json({ success: true });
      });
      
      // First IP - should get 2 requests
      await request(app).get('/test').set('X-Forwarded-For', '192.168.1.1').expect(200);
      await request(app).get('/test').set('X-Forwarded-For', '192.168.1.1').expect(200);
      // Third request should be rate limited
      await request(app).get('/test').set('X-Forwarded-For', '192.168.1.1').expect(429);
      
      // Different IP should still work
      await request(app).get('/test').set('X-Forwarded-For', '192.168.1.2').expect(200);
    });
  });

  describe('typical proxy scenario', () => {
    it('should handle single-proxy setup (Apache -> Node)', async () => {
      const app = express();
      app.set('trust proxy', 1);
      
      let clientIp: string | undefined;
      
      app.get('/test', (req, res) => {
        clientIp = req.ip;
        res.json({ ip: req.ip });
      });
      
      // Apache adds the client's IP to X-Forwarded-For
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(200);
      
      expect(clientIp).toBe('203.0.113.50');
    });

    it('should handle multiple IPs by trusting one hop from right', async () => {
      const app = express();
      app.set('trust proxy', 1);
      
      let clientIp: string | undefined;
      
      app.get('/test', (req, res) => {
        clientIp = req.ip;
        res.json({ ip: req.ip });
      });
      
      // Simulate: client (203.0.113.50) -> untrusted proxy (10.0.0.1) -> Apache -> Node
      // X-Forwarded-For: 203.0.113.50, 10.0.0.1
      // With trust proxy = 1, we trust one proxy (Apache), so we get the IP
      // that was added by the last trusted proxy (10.0.0.1 in this case)
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '203.0.113.50, 10.0.0.1')
        .expect(200);
      
      // Express counts from the right: with trust proxy = 1, it takes the first
      // entry from the right, which is 10.0.0.1 (the IP the trusted proxy received)
      expect(clientIp).toBe('10.0.0.1');
    });
  });
});
