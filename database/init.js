'use strict';
// Uses Node's built-in SQLite driver (node:sqlite, Node >= 22.13): no native compilation needed on Windows.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db = null;

function initDatabase() {
  if (db) return db;
  config.ensureDirs();
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  db.exec('PRAGMA user_version = 1;');
  return db;
}

const getDb = () => db || initDatabase();

function close() { if (db) { db.close(); db = null; } }

module.exports = { initDatabase, getDb, close };

if (require.main === module && process.argv.includes('--run')) {
  initDatabase();
  console.log('Database initialised at', config.dbPath);
}
