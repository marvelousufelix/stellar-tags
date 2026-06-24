'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
}));

jest.mock('sqlite3', () => ({
  verbose: () => ({
    Database: jest.fn().mockImplementation((_path, cb) => {
      const db = {
        run: jest.fn(function (...args) {
          const fn = args.find((a) => typeof a === 'function');
          if (fn) fn.call({ lastID: 0, changes: 0 }, null);
        }),
        close: jest.fn((cb) => cb && cb()),
      };
      if (cb) cb(null);
      return db;
    }),
  }),
}));

jest.mock('generic-pool', () => ({
  createPool: jest.fn(() => ({
    acquire: jest.fn().mockResolvedValue({
      run: jest.fn(function (...args) {
        const fn = args.find((a) => typeof a === 'function');
        if (fn) fn.call({ lastID: 1, changes: 1 }, null);
      }),
    }),
    release: jest.fn(),
    drain: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('maintenanceMode middleware', () => {
  let maintenanceMode;
  let req;
  let res;
  let next;

  beforeAll(() => {
    ({ maintenanceMode } = require('./server'));
  });

  beforeEach(() => {
    delete process.env.MAINTENANCE_MODE;
    req = { path: '/federation' };
    res = {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    delete process.env.MAINTENANCE_MODE;
  });

  test('passes through when MAINTENANCE_MODE is not set', () => {
    maintenanceMode(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('passes through when MAINTENANCE_MODE is "false"', () => {
    process.env.MAINTENANCE_MODE = 'false';
    maintenanceMode(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 503 + Retry-After + JSON body for non-health routes', () => {
    process.env.MAINTENANCE_MODE = 'true';
    maintenanceMode(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '3600');
    expect(res.json).toHaveBeenCalledWith({
      detail: 'Service temporarily unavailable. Please try again later.',
    });
  });

  test('intercepts /register when maintenance is on', () => {
    process.env.MAINTENANCE_MODE = 'true';
    req.path = '/register';
    maintenanceMode(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('/health passes through when maintenance is on', () => {
    process.env.MAINTENANCE_MODE = 'true';
    req.path = '/health';
    maintenanceMode(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
