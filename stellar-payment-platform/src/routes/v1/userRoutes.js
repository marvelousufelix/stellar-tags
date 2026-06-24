const express = require('express');
const { StrKey } = require('@stellar/stellar-sdk');
const { poolGet, poolRun, poolAll, normalizeNameTag } = require('../../db');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

  if (!username || !address) {
    return res.status(400).json({ error: 'Missing required fields: username and address are both required.' });
  }

  if (!StrKey.isValidEd25519PublicKey(address)) {
    const error = new Error('Invalid Stellar Public Key format.');
    error.statusCode = 400;
    return next(error);
  }

  // Convert to lowercase for case-insensitive storage
  const normalizedUsername = username.toLowerCase();

  try {
    const row = await poolGet(
      'SELECT username FROM username_registry WHERE address = ?',
      [address],
    );

    if (row) {
      const conflictError = new Error('Address already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }

    await poolRun(
      'INSERT INTO username_registry (username, address, created_at) VALUES (?, ?, ?)',
      [normalizedUsername, address, new Date().toISOString()],
    );

    return res.status(201).json({ ok: true, username: normalizedUsername, address, federation_address: `${normalizedUsername}*${process.env.DOMAIN || 'localhost'}` });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      const conflictError = new Error('Username already registered');
      conflictError.statusCode = 409;
      return next(conflictError);
    }
    const registrationError = new Error('Failed to save registration');
    registrationError.statusCode = 500;
    return next(registrationError);
  }
});

router.get('/lookup', async (req, res, next) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

  if (!address && !search) {
    const error = new Error("Missing required parameter: provide 'address' for exact lookup or 'search' for paginated search");
    error.statusCode = 400;
    return next(error);
  }

  // Exact lookup by address — original behaviour, returns a single record
  if (address) {
    try {
      const row = await poolGet(
        'SELECT username FROM username_registry WHERE address = ?',
        [address],
      );

      if (!row) {
        const notFoundError = new Error('Username not found for this address');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      return res.json({ username: row.username, address });
    } catch {
      const dbError = new Error('Database lookup failed');
      dbError.statusCode = 500;
      return next(dbError);
    }
  }

  // Paginated search by partial username or address
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const pattern = `%${search}%`;

  try {
    const countRow = await poolGet(
      'SELECT COUNT(*) AS total FROM username_registry WHERE username LIKE ? OR address LIKE ?',
      [pattern, pattern],
    );
    const totalCount = countRow.total;
    const totalPages = Math.ceil(totalCount / limit);

    const rows = await poolAll(
      'SELECT username, address, created_at FROM username_registry WHERE username LIKE ? OR address LIKE ? LIMIT ? OFFSET ?',
      [pattern, pattern, limit, offset],
    );

    return res.json({ data: rows, totalCount, totalPages, currentPage: page });
  } catch {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

router.get('/users', async (req, res, next) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const search = typeof req.query.search === 'string' ? `%${req.query.search}%` : null;
  const offset = (page - 1) * limit;

  const where = search ? 'WHERE username LIKE ? OR address LIKE ?' : '';
  const params = search ? [search, search] : [];

  try {
    const countRow = await poolGet(`SELECT COUNT(*) AS total FROM username_registry ${where}`, params);
    const totalCount = countRow.total;
    const totalPages = Math.ceil(totalCount / limit);

    const rows = await poolAll(
      `SELECT username, address, created_at FROM username_registry ${where} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows, totalCount, totalPages, currentPage: page });
  } catch {
    const dbError = new Error('Database error');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

module.exports = router;
