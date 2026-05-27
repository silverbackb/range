import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required — set it in env vars");

export const sql = postgres(DATABASE_URL, { max: 10 });

// ── Migration ─────────────────────────────────────────────────────────────────

export async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS tracked_keywords (
      id            SERIAL PRIMARY KEY,
      workspace_id  TEXT NOT NULL DEFAULT 'local',
      account_id    TEXT NOT NULL,
      keyword_base  TEXT NOT NULL,
      page_url      TEXT,
      target_domain TEXT NOT NULL,
      mode          TEXT NOT NULL CHECK (mode IN ('coverage', 'territory')),
      center_label  TEXT,
      center_lat    DOUBLE PRECISION,
      center_lng    DOUBLE PRECISION,
      radius_km     DOUBLE PRECISION,
      grid_density  TEXT DEFAULT '5x5',
      active        BOOLEAN DEFAULT TRUE,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS tracked_zones (
      id               SERIAL PRIMARY KEY,
      keyword_id       INTEGER NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
      label            TEXT NOT NULL,
      lat              DOUBLE PRECISION NOT NULL,
      lng              DOUBLE PRECISION NOT NULL,
      keyword_override TEXT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS rank_checks (
      id               SERIAL PRIMARY KEY,
      keyword_id       INTEGER NOT NULL REFERENCES tracked_keywords(id) ON DELETE CASCADE,
      checked_at       TIMESTAMPTZ DEFAULT NOW(),
      points_total     INTEGER NOT NULL DEFAULT 0,
      points_found     INTEGER NOT NULL DEFAULT 0,
      avg_position     DOUBLE PRECISION,
      best_position    INTEGER,
      worst_position   INTEGER,
      top3_count       INTEGER DEFAULT 0,
      top10_count      INTEGER DEFAULT 0,
      local_pack_count INTEGER DEFAULT 0,
      best_zone_label  TEXT
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS rank_points (
      id                   SERIAL PRIMARY KEY,
      check_id             INTEGER NOT NULL REFERENCES rank_checks(id) ON DELETE CASCADE,
      lat                  DOUBLE PRECISION NOT NULL,
      lng                  DOUBLE PRECISION NOT NULL,
      zone_label           TEXT,
      organic_position     INTEGER,
      local_pack_position  INTEGER,
      in_top3              BOOLEAN DEFAULT FALSE,
      in_top10             BOOLEAN DEFAULT FALSE
    )
  `;
  console.log(JSON.stringify({ service: "range", event: "migrated", timestamp: new Date().toISOString() }));
}

// ── Keyword queries ───────────────────────────────────────────────────────────

export async function insertKeyword(params: {
  workspaceId: string;
  accountId: string;
  keywordBase: string;
  pageUrl?: string | null;
  targetDomain: string;
  mode: "coverage" | "territory";
  centerLabel?: string | null;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusKm?: number | null;
  gridDensity?: string | null;
}): Promise<number> {
  const rows = await sql`
    INSERT INTO tracked_keywords
      (workspace_id, account_id, keyword_base, page_url, target_domain, mode,
       center_label, center_lat, center_lng, radius_km, grid_density)
    VALUES
      (${params.workspaceId}, ${params.accountId}, ${params.keywordBase},
       ${params.pageUrl ?? null}, ${params.targetDomain}, ${params.mode},
       ${params.centerLabel ?? null}, ${params.centerLat ?? null}, ${params.centerLng ?? null},
       ${params.radiusKm ?? null}, ${params.gridDensity ?? "5x5"})
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function listKeywords(workspaceId: string, accountId: string) {
  return sql`
    SELECT k.*,
      (SELECT COUNT(*) FROM tracked_zones WHERE keyword_id = k.id)::int AS zone_count,
      (SELECT checked_at FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_checked,
      (SELECT avg_position FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_avg_position,
      (SELECT best_position FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_best_position,
      (SELECT top3_count FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_top3_count,
      (SELECT points_total FROM rank_checks WHERE keyword_id = k.id ORDER BY checked_at DESC LIMIT 1) AS last_points_total
    FROM tracked_keywords k
    WHERE k.workspace_id = ${workspaceId} AND k.account_id = ${accountId} AND k.active = TRUE
    ORDER BY k.created_at DESC
  `;
}

export async function getKeyword(workspaceId: string, id: number) {
  const rows = await sql`
    SELECT * FROM tracked_keywords
    WHERE id = ${id} AND workspace_id = ${workspaceId} AND active = TRUE
  `;
  return rows[0] ?? null;
}

export async function deleteKeyword(workspaceId: string, id: number) {
  await sql`
    UPDATE tracked_keywords SET active = FALSE
    WHERE id = ${id} AND workspace_id = ${workspaceId}
  `;
}

// ── Zone queries ──────────────────────────────────────────────────────────────

export async function insertZone(params: {
  keywordId: number;
  label: string;
  lat: number;
  lng: number;
  keywordOverride: string;
}): Promise<number> {
  const rows = await sql`
    INSERT INTO tracked_zones (keyword_id, label, lat, lng, keyword_override)
    VALUES (${params.keywordId}, ${params.label}, ${params.lat}, ${params.lng}, ${params.keywordOverride})
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function listZones(keywordId: number) {
  return sql`SELECT * FROM tracked_zones WHERE keyword_id = ${keywordId}`;
}

// ── Check queries ─────────────────────────────────────────────────────────────

export async function insertCheck(params: {
  keywordId: number;
  pointsTotal: number;
  pointsFound: number;
  avgPosition: number | null;
  bestPosition: number | null;
  worstPosition: number | null;
  top3Count: number;
  top10Count: number;
  localPackCount: number;
  bestZoneLabel: string | null;
}): Promise<number> {
  const rows = await sql`
    INSERT INTO rank_checks
      (keyword_id, points_total, points_found, avg_position, best_position,
       worst_position, top3_count, top10_count, local_pack_count, best_zone_label)
    VALUES
      (${params.keywordId}, ${params.pointsTotal}, ${params.pointsFound},
       ${params.avgPosition}, ${params.bestPosition}, ${params.worstPosition},
       ${params.top3Count}, ${params.top10Count}, ${params.localPackCount}, ${params.bestZoneLabel})
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function insertPoint(params: {
  checkId: number;
  lat: number;
  lng: number;
  zoneLabel: string | null;
  organicPosition: number | null;
  localPackPosition: number | null;
  inTop3: boolean;
  inTop10: boolean;
}) {
  await sql`
    INSERT INTO rank_points
      (check_id, lat, lng, zone_label, organic_position, local_pack_position, in_top3, in_top10)
    VALUES
      (${params.checkId}, ${params.lat}, ${params.lng}, ${params.zoneLabel},
       ${params.organicPosition}, ${params.localPackPosition}, ${params.inTop3}, ${params.inTop10})
  `;
}

export async function getHistory(workspaceId: string, keywordId: number, limit = 12) {
  return sql`
    SELECT c.* FROM rank_checks c
    JOIN tracked_keywords k ON c.keyword_id = k.id
    WHERE c.keyword_id = ${keywordId} AND k.workspace_id = ${workspaceId}
    ORDER BY c.checked_at DESC
    LIMIT ${limit}
  `;
}

export async function getLastCheckPoints(workspaceId: string, keywordId: number) {
  const checks = await sql`
    SELECT c.id FROM rank_checks c
    JOIN tracked_keywords k ON c.keyword_id = k.id
    WHERE c.keyword_id = ${keywordId} AND k.workspace_id = ${workspaceId}
    ORDER BY c.checked_at DESC
    LIMIT 1
  `;
  if (checks.length === 0) return [];
  const checkId = checks[0].id;
  return sql`
    SELECT p.* FROM rank_points p
    WHERE p.check_id = ${checkId}
    ORDER BY p.id ASC
    LIMIT 100
  `;
}

export async function getPreviousCheck(workspaceId: string, keywordId: number) {
  const rows = await sql`
    SELECT c.* FROM rank_checks c
    JOIN tracked_keywords k ON c.keyword_id = k.id
    WHERE c.keyword_id = ${keywordId} AND k.workspace_id = ${workspaceId}
    ORDER BY c.checked_at DESC
    LIMIT 1 OFFSET 1
  `;
  return rows[0] ?? null;
}
