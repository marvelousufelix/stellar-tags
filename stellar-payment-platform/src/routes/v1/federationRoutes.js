const express = require('express');
const { poolGet, USER_DATABASE, normalizeNameTag, etagCache } = require('../../db');

const router = express.Router();

// ---------------------------------------------------------------------------
// #81 — SEP-0002: Handle type=id Federation Queries
// ---------------------------------------------------------------------------
router.get('/federation', etagCache, async (req, res, next) => {
  // Extract q (query) and type parameters from the request
  const { q, type } = req.query;
  const queryValue = typeof q === 'string' ? q.trim() : '';

  // Validate that q parameter exists
  if (!queryValue) {
    const error = new Error("Missing 'q' parameter");
    error.statusCode = 400;
    return next(error);
  }

  try {
    let row;
    let queryName;

    // Branch logic based on type parameter (SEP-0002 compliance)
    if (type === 'id') {
      // Reverse lookup: search by Stellar address
      // Convert to lowercase for case-insensitive lookup
      const addressLower = queryValue.toLowerCase();
      row = await poolGet(
        'SELECT username, address FROM username_registry WHERE LOWER(address) = ?',
        [addressLower]
      );

      if (!row) {
        const notFoundError = new Error('Address not found');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      // Return federation response for address lookup
      return res.json({
        stellar_address: `${row.username}*${process.env.DOMAIN || 'localhost'}`,
        account_id: row.address,
        memo_type: 'text',
        memo: 'PlatformPayment'
      });
    } else if (type === 'name' || !type) {
      // Default: lookup by username (backward compatible)
      // Normalize the name tag (e.g., "alice*localhost")
      const nameTag = normalizeNameTag(queryValue);
      queryName = nameTag.toLowerCase();

      row = await poolGet(
        'SELECT address FROM username_registry WHERE username = ?',
        [queryName]
      );

      // Fallback to hardcoded USER_DATABASE for backward compatibility
      const address = row?.address || USER_DATABASE[queryName];

      if (!address) {
        const notFoundError = new Error('Name tag not found');
        notFoundError.statusCode = 404;
        return next(notFoundError);
      }

      return res.json({
        stellar_address: address,
        account_id: address,
        memo_type: 'text',
        memo: 'PlatformPayment'
      });
    } else {
      // Unsupported type parameter
      return res.status(400).json({
        error: "Unsupported query type. Supported types: 'id', 'name'"
      });
    }
  } catch {
    const dbError = new Error('Database lookup failed');
    dbError.statusCode = 500;
    return next(dbError);
  }
});

module.exports = router;
