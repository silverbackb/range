import Database from "better-sqlite3";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

const DB_DIR  = join(homedir(), ".range");
const DB_PATH = join(DB_DIR, "range.db");

mkdirSync(DB_DIR, { recursive: true });

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS tracked_keywords (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    TEXT NOT NULL,
    keyword_base  TEXT NOT NULL,
    page_url      TEXT,
    target_domain TEXT NOT NULL,
    mode          TEXT NOT NULL CHECK(mode IN ('coverage', 'territory')),
    -- coverage
    center_label  TEXT,
    center_lat    REAL,
    center_lng    REAL,
    radius_km     REAL,
    grid_density  TEXT DEFAULT '5x5',
    -- metadata
    active        INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tracked_zones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword_id       INTEGER NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
    label            TEXT NOT NULL,
    lat              REAL NOT NULL,
    lng              REAL NOT NULL,
    keyword_override TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rank_checks (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword_id            INTEGER NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
    checked_at            TEXT DEFAULT (datetime('now')),
    points_total          INTEGER NOT NULL DEFAULT 0,
    points_found          INTEGER NOT NULL DEFAULT 0,
    avg_position          REAL,
    best_position         INTEGER,
    worst_position        INTEGER,
    top3_count            INTEGER DEFAULT 0,
    top10_count           INTEGER DEFAULT 0,
    local_pack_count      INTEGER DEFAULT 0,
    best_zone_label       TEXT
  );

  CREATE TABLE IF NOT EXISTS rank_points (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    check_id             INTEGER NOT NULL REFERENCES rank_checks(id) ON DELETE CASCADE,
    lat                  REAL NOT NULL,
    lng                  REAL NOT NULL,
    zone_label           TEXT,
    organic_position     INTEGER,
    local_pack_position  INTEGER,
    in_top3              INTEGER DEFAULT 0,
    in_top10             INTEGER DEFAULT 0
  );
`);

// ── Keyword queries ───────────────────────────────────────────────────────────

export function insertKeyword(params: {
  account_id: string;
  keyword_base: string;
  page_url?: string;
  target_domain: string;
  mode: "coverage" | "territory";
  center_label?: string;
  center_lat?: number;
  center_lng?: number;
  radius_km?: number;
  grid_density?: string;
}): number {
  const stmt = db.prepare(`
    INSERT INTO tracked_keywords
      (account_id, keyword_base, page_url, target_domain, mode,
       center_label, center_lat, center_lng, radius_km, grid_density)
    VALUES
      (@account_id, @keyword_base, @page_url, @target_domain, @mode,
       @center_label, @center_lat, @center_lng, @radius_km, @grid_density)
  `);
  return Number((stmt.run(params)).lastInsertRowid);
}

export function listKeywords(account_id: string) {
  return db.prepare(`
    SELECT k.*,
      (SELECT COUNT(*) FROM tracked_zones WHERE keyword_id = k.id) AS zone_count,
      (SELECT checked_at FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_checked,
      (SELECT avg_position FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_avg_position,
      (SELECT best_position FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_best_position,
      (SELECT top3_count FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_top3_count,
      (SELECT points_total FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_points_total
    FROM tracked_keywords k
    WHERE k.account_id = ? AND k.active = 1
    ORDER BY k.created_at DESC
  `).all(account_id);
}

export function getKeyword(id: number) {
  return db.prepare("SELECT * FROM tracked_keywords WHERE id = ?").get(id) as any;
}

export function deleteKeyword(id: number) {
  db.prepare("UPDATE tracked_keywords SET active = 0 WHERE id = ?").run(id);
}

// ── Zone queries ──────────────────────────────────────────────────────────────

export function insertZone(params: {
  keyword_id: number;
  label: string;
  lat: number;
  lng: number;
  keyword_override: string;
}): number {
  const stmt = db.prepare(`
    INSERT INTO tracked_zones (keyword_id, label, lat, lng, keyword_override)
    VALUES (@keyword_id, @label, @lat, @lng, @keyword_override)
  `);
  return Number(stmt.run(params).lastInsertRowid);
}

export function listZones(keyword_id: number) {
  return db.prepare("SELECT * FROM tracked_zones WHERE keyword_id = ?").all(keyword_id) as any[];
}

// ── Check queries ─────────────────────────────────────────────────────────────

export function insertCheck(params: {
  keyword_id: number;
  points_total: number;
  points_found: number;
  avg_position: number | null;
  best_position: number | null;
  worst_position: number | null;
  top3_count: number;
  top10_count: number;
  local_pack_count: number;
  best_zone_label: string | null;
}): number {
  const stmt = db.prepare(`
    INSERT INTO rank_checks
      (keyword_id, points_total, points_found, avg_position, best_position,
       worst_position, top3_count, top10_count, local_pack_count, best_zone_label)
    VALUES
      (@keyword_id, @points_total, @points_found, @avg_position, @best_position,
       @worst_position, @top3_count, @top10_count, @local_pack_count, @best_zone_label)
  `);
  return Number(stmt.run(params).lastInsertRowid);
}

export function insertPoint(params: {
  check_id: number;
  lat: number;
  lng: number;
  zone_label: string | null;
  organic_position: number | null;
  local_pack_position: number | null;
  in_top3: number;
  in_top10: number;
}) {
  db.prepare(`
    INSERT INTO rank_points
      (check_id, lat, lng, zone_label, organic_position, local_pack_position, in_top3, in_top10)
    VALUES
      (@check_id, @lat, @lng, @zone_label, @organic_position, @local_pack_position, @in_top3, @in_top10)
  `).run(params);
}

export function getHistory(keyword_id: number, limit = 12) {
  return db.prepare(`
    SELECT * FROM rank_checks
    WHERE keyword_id = ?
    ORDER BY checked_at DESC
    LIMIT ?
  `).all(keyword_id, limit) as any[];
}

export function getLastCheckPoints(keyword_id: number) {
  return db.prepare(`
    SELECT p.* FROM rank_points p
    JOIN rank_checks c ON p.check_id = c.id
    WHERE c.keyword_id = ?
    ORDER BY c.checked_at DESC, p.id ASC
    LIMIT 100
  `).all(keyword_id) as any[];
}

export function getPreviousCheck(keyword_id: number) {
  return db.prepare(`
    SELECT * FROM rank_checks
    WHERE keyword_id = ?
    ORDER BY checked_at DESC
    LIMIT 1 OFFSET 1
  `).get(keyword_id) as any;
}
