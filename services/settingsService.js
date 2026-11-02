'use strict';
const { getDb } = require('../database/init');
const config = require('../config');

function get(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM application_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function set(key, value) {
  getDb().prepare(`INSERT INTO application_settings(key, value, updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, String(value), new Date().toISOString());
}
// The actor is a self-declared alias. ForenSight does not verify real-world identity.
const getActor = () => get('investigator_alias', config.defaultActor);
const getContactSheetMax = () => Math.min(config.limits.maxContactSheetFrames, Number(get('contact_sheet_max_frames', config.limits.maxContactSheetFrames)) || config.limits.maxContactSheetFrames);

module.exports = { get, set, getActor, getContactSheetMax };
