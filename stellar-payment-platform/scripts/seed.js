const { faker } = require('@faker-js/faker');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { StrKey } = require('@stellar/stellar-sdk');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'registrations.db');
const DEFAULT_FEDERATION_DOMAIN = 'localhost';
const SEED_COUNT = 50;

// Ensure data directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

const attachAsyncDbMethods = (db) => {
  if (typeof db.get === 'function') {
    db.getAsync = promisify(db.get.bind(db));
  }
  if (typeof db.run === 'function') {
    db.runAsync = promisify(db.run.bind(db));
  }
  if (typeof db.all === 'function') {
    db.allAsync = promisify(db.all.bind(db));
  }
  return db;
};

attachAsyncDbMethods(db);

// Generate a valid Stellar public key
const generateStellarPublicKey = () => {
  // Generate a random 32-byte seed and convert to Ed25519 public key
  const seed = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = Math.floor(Math.random() * 256);
  }
  return StrKey.encodeEd25519PublicKey(seed);
};

// Generate a realistic username
const generateUsername = () => {
  const firstName = faker.person.firstName().toLowerCase();
  const lastName = faker.person.lastName().toLowerCase();
  const number = faker.number.int({ min: 1, max: 9999 });
  return `${firstName}.${lastName}${number}`;
};

// Normalize username to include domain
const normalizeNameTag = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return '';
  }
  return trimmed.includes('*') ? trimmed : `${trimmed}*${DEFAULT_FEDERATION_DOMAIN}`;
};

const seedDatabase = async () => {
  try {
    console.log('Starting database seeding...');
    
    // Create table if not exists
    await db.runAsync(
      `CREATE TABLE IF NOT EXISTS username_registry (
        username TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    );
    
    console.log(`Generating ${SEED_COUNT} mock entries...`);
    
    let inserted = 0;
    let skipped = 0;
    
    for (let i = 0; i < SEED_COUNT; i++) {
      const username = normalizeNameTag(generateUsername());
      const address = generateStellarPublicKey();
      const createdAt = faker.date.past({ years: 1 }).toISOString();
      
      try {
        await db.runAsync(
          'INSERT INTO username_registry (username, address, created_at) VALUES (?, ?, ?)',
          [username, address, createdAt]
        );
        inserted++;
        console.log(`✓ Inserted: ${username} -> ${address}`);
      } catch (error) {
        if (error.message && error.message.includes('UNIQUE')) {
          skipped++;
          console.log(`⊘ Skipped (duplicate): ${username}`);
        } else {
          console.error(`✗ Error inserting ${username}:`, error.message);
        }
      }
    }
    
    console.log('\n=== Seeding Complete ===');
    console.log(`Total entries generated: ${SEED_COUNT}`);
    console.log(`Successfully inserted: ${inserted}`);
    console.log(`Skipped (duplicates): ${skipped}`);
    
    // Show total count in database
    const countResult = await db.getAsync('SELECT COUNT(*) as count FROM username_registry');
    console.log(`Total entries in database: ${countResult.count}`);
    
  } catch (error) {
    console.error('Fatal error during seeding:', error);
    process.exit(1);
  } finally {
    db.close();
  }
};

seedDatabase();
