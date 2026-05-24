import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { JoinRequestRepository } from './join-request-repository.js';
import { migration as usersMigration } from '../storage/migrations/002_users.js';
import { migration as userGithubInstallationMigration } from '../storage/migrations/014_user_github_installation.js';
import { migration as workspacesMigration } from '../storage/migrations/003_workspaces.js';
import { migration as joinRequestsMigration } from '../storage/migrations/009_join_requests.js';

describe('JoinRequestRepository', () => {
  let db: Database.Database;
  let repo: JoinRequestRepository;
  let ownerId: string;
  let userId: string;
  let workspaceId: string;

  beforeEach(() => {
    // Create in-memory database
    db = new Database(':memory:');
    
    // Apply required migrations
    db.exec(usersMigration.up);
    db.exec(userGithubInstallationMigration.up);
    db.exec(workspacesMigration.up);
    db.exec(joinRequestsMigration.up);
    
    // Create test user (owner)
    ownerId = 'owner-1';
    db.prepare(`
      INSERT INTO users (id, github_id, username, display_name, avatar_url, created_at, last_login_at)
      VALUES (?, 'gh-owner-1', 'owner', 'Owner User', 'https://example.com/owner.png', datetime('now'), datetime('now'))
    `).run(ownerId);
    
    // Create test user (requester)
    userId = 'user-1';
    db.prepare(`
      INSERT INTO users (id, github_id, username, display_name, avatar_url, created_at, last_login_at)
      VALUES (?, 'gh-user-1', 'requester', 'Requester User', 'https://example.com/requester.png', datetime('now'), datetime('now'))
    `).run(userId);
    
    // Create test workspace
    workspaceId = 'workspace-1';
    db.prepare(`
      INSERT INTO workspaces (id, owner_id, name, slug, join_code)
      VALUES (?, ?, 'Test Workspace', 'test-workspace', 'JOIN123')
    `).run(workspaceId, ownerId);
    
    repo = new JoinRequestRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create', () => {
    it('should create a new join request', () => {
      const request = repo.create(workspaceId, userId);
      
      expect(request).toBeDefined();
      expect(request.id).toBeDefined();
      expect(request.workspaceId).toBe(workspaceId);
      expect(request.userId).toBe(userId);
      expect(request.status).toBe('pending');
      expect(request.createdAt).toBeDefined();
      expect(request.resolvedAt).toBeNull();
      expect(request.resolvedBy).toBeNull();
    });

    it('should return existing pending request if one exists', () => {
      const first = repo.create(workspaceId, userId);
      const second = repo.create(workspaceId, userId);
      
      expect(first.id).toBe(second.id);
    });

    it('should create new request if previous was approved', () => {
      const first = repo.create(workspaceId, userId);
      repo.approve(first.id, ownerId);
      
      const second = repo.create(workspaceId, userId);
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('pending');
    });

    it('should create new request if previous was denied', () => {
      const first = repo.create(workspaceId, userId);
      repo.deny(first.id, ownerId);
      
      const second = repo.create(workspaceId, userId);
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('pending');
    });
  });

  describe('findById', () => {
    it('should find a request by ID', () => {
      const created = repo.create(workspaceId, userId);
      const found = repo.findById(created.id);
      
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should return null for non-existent ID', () => {
      const found = repo.findById('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findPendingByUserAndWorkspace', () => {
    it('should find pending request for user and workspace', () => {
      const created = repo.create(workspaceId, userId);
      const found = repo.findPendingByUserAndWorkspace(userId, workspaceId);
      
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it('should return null for non-pending request', () => {
      const created = repo.create(workspaceId, userId);
      repo.approve(created.id, ownerId);
      
      const found = repo.findPendingByUserAndWorkspace(userId, workspaceId);
      expect(found).toBeNull();
    });
  });

  describe('findPendingByWorkspace', () => {
    it('should return all pending requests with user info', () => {
      repo.create(workspaceId, userId);
      
      const pending = repo.findPendingByWorkspace(workspaceId);
      
      expect(pending).toHaveLength(1);
      expect(pending[0].user.id).toBe(userId);
      expect(pending[0].user.username).toBe('requester');
      expect(pending[0].user.displayName).toBe('Requester User');
      expect(pending[0].user.avatarUrl).toBe('https://example.com/requester.png');
    });

    it('should not include non-pending requests', () => {
      const request = repo.create(workspaceId, userId);
      repo.approve(request.id, ownerId);
      
      const pending = repo.findPendingByWorkspace(workspaceId);
      expect(pending).toHaveLength(0);
    });

    it('should return empty array for workspace with no requests', () => {
      const pending = repo.findPendingByWorkspace(workspaceId);
      expect(pending).toHaveLength(0);
    });
  });

  describe('approve', () => {
    it('should approve a pending request', () => {
      const request = repo.create(workspaceId, userId);
      const approved = repo.approve(request.id, ownerId);
      
      expect(approved).toBeDefined();
      expect(approved?.status).toBe('approved');
      expect(approved?.resolvedAt).toBeDefined();
      expect(approved?.resolvedBy).toBe(ownerId);
    });

    it('should return null for non-existent request', () => {
      const result = repo.approve('non-existent', ownerId);
      expect(result).toBeNull();
    });

    it('should return null for already approved request', () => {
      const request = repo.create(workspaceId, userId);
      repo.approve(request.id, ownerId);
      
      const result = repo.approve(request.id, ownerId);
      expect(result).toBeNull();
    });

    it('should return null for denied request', () => {
      const request = repo.create(workspaceId, userId);
      repo.deny(request.id, ownerId);
      
      const result = repo.approve(request.id, ownerId);
      expect(result).toBeNull();
    });
  });

  describe('deny', () => {
    it('should deny a pending request', () => {
      const request = repo.create(workspaceId, userId);
      const denied = repo.deny(request.id, ownerId);
      
      expect(denied).toBeDefined();
      expect(denied?.status).toBe('denied');
      expect(denied?.resolvedAt).toBeDefined();
      expect(denied?.resolvedBy).toBe(ownerId);
    });

    it('should return null for non-existent request', () => {
      const result = repo.deny('non-existent', ownerId);
      expect(result).toBeNull();
    });

    it('should return null for already denied request', () => {
      const request = repo.create(workspaceId, userId);
      repo.deny(request.id, ownerId);
      
      const result = repo.deny(request.id, ownerId);
      expect(result).toBeNull();
    });
  });

  describe('cancel', () => {
    it('should cancel own pending request', () => {
      const request = repo.create(workspaceId, userId);
      const result = repo.cancel(request.id, userId);
      
      expect(result).toBe(true);
      
      const found = repo.findById(request.id);
      expect(found).toBeNull();
    });

    it('should not cancel request from different user', () => {
      const request = repo.create(workspaceId, userId);
      const result = repo.cancel(request.id, ownerId);
      
      expect(result).toBe(false);
      
      const found = repo.findById(request.id);
      expect(found).toBeDefined();
    });

    it('should not cancel non-pending request', () => {
      const request = repo.create(workspaceId, userId);
      repo.approve(request.id, ownerId);
      
      const result = repo.cancel(request.id, userId);
      expect(result).toBe(false);
    });

    it('should return false for non-existent request', () => {
      const result = repo.cancel('non-existent', userId);
      expect(result).toBe(false);
    });
  });

  describe('expire', () => {
    it('should expire a pending request', () => {
      const request = repo.create(workspaceId, userId);
      const expired = repo.expire(request.id);
      
      expect(expired).toBeDefined();
      expect(expired?.status).toBe('expired');
      expect(expired?.resolvedAt).toBeDefined();
      expect(expired?.resolvedBy).toBeNull();
    });

    it('should return null for already expired request', () => {
      const request = repo.create(workspaceId, userId);
      repo.expire(request.id);
      
      const result = repo.expire(request.id);
      expect(result).toBeNull();
    });
  });

  describe('isExpired', () => {
    it('should return false for new request', () => {
      const request = repo.create(workspaceId, userId);
      expect(repo.isExpired(request)).toBe(false);
    });

    it('should return true for old request', () => {
      // Create request with old timestamp
      const id = 'old-request';
      const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      
      db.prepare(`
        INSERT INTO workspace_join_requests (id, workspace_id, user_id, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(id, workspaceId, userId, oldTime);
      
      const request = repo.findById(id);
      expect(request).toBeDefined();
      expect(repo.isExpired(request!)).toBe(true);
    });

    it('should respect custom expiration time', () => {
      // Create a slightly old request (1 minute ago)
      const id = 'slightly-old-request';
      const slightlyOld = new Date(Date.now() - 1 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO workspace_join_requests (id, workspace_id, user_id, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(id, workspaceId, userId, slightlyOld);
      
      const request = repo.findById(id);
      expect(request).toBeDefined();
      expect(repo.isExpired(request!, 0.5)).toBe(true); // 0.5 minutes = expired (it's 1 min old)
      expect(repo.isExpired(request!, 60)).toBe(false); // 60 minutes = not expired
    });
  });

  describe('expireOldRequests', () => {
    it('should expire old pending requests for workspace', () => {
      // Create old request
      const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO workspace_join_requests (id, workspace_id, user_id, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run('old-request', workspaceId, userId, oldTime);
      
      const count = repo.expireOldRequests(workspaceId);
      expect(count).toBe(1);
      
      const request = repo.findById('old-request');
      expect(request?.status).toBe('expired');
    });

    it('should not expire recent requests', () => {
      repo.create(workspaceId, userId);
      
      const count = repo.expireOldRequests(workspaceId);
      expect(count).toBe(0);
    });

    it('should expire all old requests when workspaceId not provided', () => {
      // Create old request
      const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO workspace_join_requests (id, workspace_id, user_id, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run('old-request', workspaceId, userId, oldTime);
      
      const count = repo.expireOldRequests();
      expect(count).toBe(1);
    });
  });
});
