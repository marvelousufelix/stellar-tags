const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5000;


app.use(cors());
app.use(express.json());

const USER_DATABASE = {
  'client*localhost': 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ',
  'lekan*localhost': 'GAPUQZH3WZUXHEMUGZN5ZYU4D4GHCFEMOGUINU6MF345GBD2QXNYYIEQ',
};

const DEFAULT_FEDERATION_DOMAIN = 'localhost';

const normalizeNameTag = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '';
  }

  return trimmed.includes('*') ? trimmed : `${trimmed}*${DEFAULT_FEDERATION_DOMAIN}`;
};

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'registrations.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS username_registry (
      username TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
  );
});

app.get('/federation', (req, res, next) => {
  const nameTag = normalizeNameTag(req.query.q);

  if (!nameTag) {
    const error = new Error("Missing 'q' parameter");
    error.statusCode = 400;
    return next(error);
  }

  db.get(
    'SELECT address FROM username_registry WHERE username = ?',
    [nameTag],
    (error, row) => {
      if (error) {
        const dbError = new Error('Database lookup failed');
        dbError.statusCode = 500;
        return next(dbError);
      }

      const address = row?.address || USER_DATABASE[nameTag];
      if (!address) {
        const notFoundError = new Error('Name tag not found');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      return res.json({
        stellar_address: address,
        account_id: address,
        memo_type: 'text',
        memo: 'PlatformPayment',
      });
    },
  );
});

app.post('/register', (req, res, next) => {
  const username = normalizeNameTag(req.body.username);
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';

  if (!username || !address) {
    const error = new Error('username and address are required');
    error.statusCode = 400;
    return next(error);
  }

  db.get(
    'SELECT username FROM username_registry WHERE address = ?',
    [address],
    (lookupError, row) => {
      if (lookupError) {
        const dbError = new Error('Database lookup failed');
        dbError.statusCode = 500;
        return next(dbError);
      }

      if (row) {
        const conflictError = new Error('Address already registered');
        conflictError.statusCode = 409;
        return next(conflictError);
      }

      db.run(
        'INSERT INTO username_registry (username, address, created_at) VALUES (?, ?, ?)',
        [username, address, new Date().toISOString()],
        (error) => {
          if (error) {
            if (error.message && error.message.includes('UNIQUE')) {
              const conflictError = new Error('Username already registered');
              conflictError.statusCode = 409;
              return next(conflictError);
            }

            const dbError = new Error('Failed to save registration');
            dbError.statusCode = 500;
            return next(dbError);
          }

          return res.json({ ok: true, username, address });
        },
      );
    },
  );
});

app.get('/lookup', (req, res, next) => {
  const address = typeof req.query.address === 'string' ? req.query.address.trim() : '';

  if (!address) {
    const error = new Error("Missing 'address' parameter");
    error.statusCode = 400;
    return next(error);
  }

  db.get(
    'SELECT username FROM username_registry WHERE address = ?',
    [address],
    (error, row) => {
      if (error) {
        const dbError = new Error('Database lookup failed');
        dbError.statusCode = 500;
        return next(dbError);
      }

      if (!row) {
        const notFoundError = new Error('Username not found for this address');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      return res.json({ username: row.username, address });
    },
  );
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Global error handling middleware
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorMessage = err.message || 'Internal server error';
  
  return res.status(statusCode).json({
    success: false,
    error: errorMessage,
    statusCode: statusCode
  });
});

if (require.main === module) {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server successfully initialized on port ${PORT}`);
    });

    // This catches any weird cloud port errors and prevents a hard crash
    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.error(`Port ${PORT} is in use, forcing shutdown so Railway can restart cleanly.`);
            process.exit(1);
        }
    });
}
