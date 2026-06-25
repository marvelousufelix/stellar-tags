/* eslint-env jest */
'use strict';

// Ensure we use a specific mock database path for integration tests to avoid interfering with any real database
const path = require('path');
process.env.DB_PATH = path.join(__dirname, 'data', 'mock-integration-registrations.db');

// Mock cleanup-cron so background cron doesn't interfere during tests
jest.mock('./src/cleanup-cron', () => ({ scheduleCleanupJob: jest.fn() }));

// Mock @stellar/stellar-sdk to prevent Jest from trying to parse ESM dependencies in node_modules
jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: { Server: jest.fn() },
  StrKey: { isValidEd25519PublicKey: jest.fn(() => true) },
}));

const request = require('supertest');
const { app, poolRun, dbPool, db } = require('./server');

describe('API Integration Lifecycle Suite', () => {
  const user1 = {
    username: 'integration_user*localhost',
    address: 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ',
  };

  const user2 = {
    // Duplicate username
    username: 'integration_user*localhost',
    // Different valid Stellar address so it doesn't fail on "Address already registered"
    address: 'GBDQD3WTQ6W2VQ2W4V74UZ5WYF6B72GZ6EHD7I3L3WYH357Y4K5H3E4W',
  };

  beforeAll(async () => {
    // Ensure the table exists before attempting to delete rows
    await poolRun(
      `CREATE TABLE IF NOT EXISTS username_registry (
        username TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      [],
    );
    // Clear mock database rows automatically before running
    await poolRun('DELETE FROM username_registry', []);
  });

  afterAll(async () => {
    // Clear mock database rows automatically after running
    await poolRun('DELETE FROM username_registry', []);

    // Gracefully shut down pool connections
    if (dbPool) {
      await dbPool.drain();
      await dbPool.clear();
    }
    if (db && typeof db.close === 'function') {
      await new Promise((resolve) => db.close(() => resolve()));
    }

    // Remove the mock database file created during tests
    try {
      const fs = require('fs');
      if (fs.existsSync(process.env.DB_PATH)) {
        fs.unlinkSync(process.env.DB_PATH);
      }
    } catch (_err) {
      // Ignore cleanup errors
    }
  });

  test('Full lifecycle: register a user, query the user, and attempt to register a duplicate username', async () => {
    // 1. Register a user hitting /api/v1/register
    const registerRes = await request(app)
      .post('/api/v1/register')
      .send({
        username: user1.username,
        address: user1.address,
      });

    expect(registerRes.status).toBe(201);
    expect(registerRes.body).toMatchObject({
      ok: true,
      username: user1.username.toLowerCase(),
      address: user1.address,
    });

    // 2. Query the user via /api/v1/lookup
    const queryRes = await request(app)
      .get(`/api/v1/lookup?address=${user1.address}`);

    expect(queryRes.status).toBe(200);
    expect(queryRes.body).toMatchObject({
      username: user1.username.toLowerCase(),
      address: user1.address,
    });

    // Also query the user via search parameter on /api/v1/lookup
    const searchRes = await request(app)
      .get(`/api/v1/lookup?search=integration_user`);

    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: user1.username.toLowerCase(),
          address: user1.address,
        }),
      ]),
    );

    // Also query the user via /api/v1/federation
    const fedRes = await request(app)
      .get(`/api/v1/federation?q=${user1.username}&type=name`);

    expect(fedRes.status).toBe(200);
    expect(fedRes.body).toMatchObject({
      stellar_address: user1.address,
      account_id: user1.address,
    });

    // 3. Attempt to register a duplicate username hitting /api/v1/register
    const duplicateRes = await request(app)
      .post('/api/v1/register')
      .send({
        username: user2.username,
        address: user2.address,
      });

    // Assess expected JSON status returns (409 Conflict for duplicate username)
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body).toMatchObject({
      success: false,
      error: 'Username already registered',
      statusCode: 409,
    });
  });
});