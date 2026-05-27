#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";
import {
  migrate,
  insertKeyword, listKeywords, getKeyword, deleteKeyword,
  insertZone, listZones,
  insertCheck, insertPoint, getHistory, getLastCheckPoints, getPreviousCheck,
} from "./db.js";
import { generateGrid, parseDensity } from "./grid.js";
import { checkPoint, checkVolume, qualifyIntent, DELAY_MS, sleep, type BusinessType } from "./dataforseo.js";

// ── Auth ──────────────────────────────────────────────────────────────────────

const INTERNAL_SECRET = process.env.RANGE_INTERNAL_SECRET ?? "";

const requireAuth: MiddlewareHandler = async (c, next) => {
  if (INTERNAL_SECRET) {
    const secret = c.req.header("x-internal-secret");
    if (secret !== INTERNAL_SECRET) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  // x-workspace-id from silverbackbase-mcp (or "local" for self-hosted)
  (c as any).set("workspaceId", c.req.header("x-workspace-id") ?? "local");
  await next();
};

function getWid(c: any): string {
  return (c.get as (k: string) => string | null)("workspaceId") ?? "local";
}

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE", "OPTIONS"] }));

app.use("*", async (c, next) => {
  const start   = Date.now();
  const traceId = c.req.header("x-trace-id") ?? "local";
  await next();
  process.stdout.write(JSON.stringify({
    service:     "range",
    trace_id:    traceId,
    method:      c.req.method,
    path:        new URL(c.req.url).pathname,
    status:      c.res.status,
    duration_ms: Date.now() - start,
    timestamp:   new Date().toISOString(),
  }) + "\n");
});

app.get("/health", (c) => c.json({ ok: true, service: "range" }));

// ── Keywords ──────────────────────────────────────────────────────────────────

app.post("/keywords", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid body" }, 400);

  if (body.mode === "coverage" && (!body.center_lat || !body.center_lng)) {
    return c.json({ error: "center_lat et center_lng sont requis en mode coverage." }, 400);
  }

  const id = await insertKeyword({
    workspaceId,
    accountId:    String(body.account_id),
    keywordBase:  String(body.keyword_base),
    pageUrl:      body.page_url ?? null,
    targetDomain: String(body.target_domain),
    mode:         body.mode as "coverage" | "territory",
    centerLabel:  body.center_label ?? null,
    centerLat:    body.center_lat ?? null,
    centerLng:    body.center_lng ?? null,
    radiusKm:     body.radius_km ?? null,
    gridDensity:  body.grid_density ?? "5x5",
  });

  const msg = body.mode === "territory"
    ? `Keyword #${id} ajouté en mode territory. Appeler range_add_zone pour ajouter les villes cibles.`
    : `Keyword #${id} ajouté en mode coverage. Grille ${body.grid_density ?? "5x5"} · ${body.radius_km ?? 5}km autour de ${body.center_label ?? `${body.center_lat},${body.center_lng}`}.`;

  return c.json({ keyword_id: id, mode: body.mode, message: msg });
});

app.get("/keywords", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const accountId   = c.req.query("account_id") || undefined;
  const keywords = await listKeywords(workspaceId, accountId);
  return c.json(keywords);
});

app.get("/keywords/:id", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const id = parseInt(c.req.param("id"), 10);
  const kw = await getKeyword(workspaceId, id);
  if (!kw) return c.json({ error: "Keyword not found" }, 404);
  return c.json(kw);
});

app.delete("/keywords/:id", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const id = parseInt(c.req.param("id"), 10);
  const kw = await getKeyword(workspaceId, id);
  if (!kw) return c.json({ error: "Keyword not found" }, 404);
  await deleteKeyword(workspaceId, id);
  return c.json({ ok: true, keyword_id: id, keyword: kw.keyword_base });
});

// ── Zones ─────────────────────────────────────────────────────────────────────

app.post("/keywords/:id/zones", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const id = parseInt(c.req.param("id"), 10);
  const kw = await getKeyword(workspaceId, id);
  if (!kw) return c.json({ error: "Keyword not found" }, 404);
  if (kw.mode !== "territory") return c.json({ error: "range_add_zone est réservé au mode territory." }, 400);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid body" }, 400);

  const override = body.keyword_override ?? `${kw.keyword_base} ${body.label}`;
  const zoneId   = await insertZone({
    keywordId:       id,
    label:           String(body.label),
    lat:             Number(body.lat),
    lng:             Number(body.lng),
    keywordOverride: String(override),
  });

  return c.json({ zone_id: zoneId, label: body.label, keyword: override });
});

// ── Check Now ─────────────────────────────────────────────────────────────────

app.post("/keywords/:id/check", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const id = parseInt(c.req.param("id"), 10);
  const kw = await getKeyword(workspaceId, id);
  if (!kw) return c.json({ error: "Keyword not found" }, 404);

  const points: Array<{ lat: number; lng: number; zone_label: string | null; keyword: string }> = [];

  if (kw.mode === "coverage") {
    const density = parseDensity(kw.grid_density ?? "5x5");
    const grid    = generateGrid(Number(kw.center_lat), Number(kw.center_lng), Number(kw.radius_km ?? 5), density);
    for (const p of grid) points.push({ ...p, zone_label: null, keyword: String(kw.keyword_base) });
  } else {
    const zones = await listZones(id);
    if (zones.length === 0) return c.json({ error: "Aucune zone configurée. Ajouter des villes avec range_add_zone." }, 400);
    for (const z of zones) points.push({ lat: Number(z.lat), lng: Number(z.lng), zone_label: String(z.label), keyword: String(z.keyword_override) });
  }

  const results = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const r = await checkPoint(p.keyword, p.lat, p.lng, String(kw.target_domain), p.zone_label);
    results.push(r);
    if (i < points.length - 1) await sleep(DELAY_MS);
  }

  const found     = results.filter(r => r.organic_position !== null);
  const positions = found.map(r => r.organic_position as number);
  const avg       = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null;
  const best      = positions.length > 0 ? Math.min(...positions) : null;
  const worst     = positions.length > 0 ? Math.max(...positions) : null;
  const top3      = results.filter(r => r.in_top3).length;
  const top10     = results.filter(r => r.in_top10).length;
  const lpCount   = results.filter(r => r.local_pack_position !== null).length;
  const bestZone  = best !== null ? (results.find(r => r.organic_position === best)?.zone_label ?? null) : null;

  const checkId = await insertCheck({
    keywordId:       id,
    pointsTotal:     results.length,
    pointsFound:     found.length,
    avgPosition:     avg,
    bestPosition:    best,
    worstPosition:   worst,
    top3Count:       top3,
    top10Count:      top10,
    localPackCount:  lpCount,
    bestZoneLabel:   bestZone,
  });

  for (const r of results) {
    await insertPoint({
      checkId,
      lat:                r.lat,
      lng:                r.lng,
      zoneLabel:          r.zone_label,
      organicPosition:    r.organic_position,
      localPackPosition:  r.local_pack_position,
      inTop3:             r.in_top3,
      inTop10:            r.in_top10,
    });
  }

  const prev     = await getPreviousCheck(workspaceId, id);
  const deltaAvg = avg !== null && prev?.avg_position != null
    ? +(avg - Number(prev.avg_position)).toFixed(1)
    : null;

  return c.json({
    keyword_id:       id,
    keyword_base:     kw.keyword_base,
    mode:             kw.mode,
    checked_at:       new Date().toISOString(),
    points_total:     results.length,
    points_found:     found.length,
    avg_position:     avg ? +avg.toFixed(1) : null,
    best_position:    best,
    worst_position:   worst,
    top3_count:       top3,
    top10_count:      top10,
    local_pack_count: lpCount,
    best_zone:        bestZone,
    delta_avg:        deltaAvg,
    points:           results,
  });
});

// ── History & Grid ────────────────────────────────────────────────────────────

app.get("/keywords/:id/history", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const id    = parseInt(c.req.param("id"), 10);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "6", 10), 24);
  const kw    = await getKeyword(workspaceId, id);
  if (!kw) return c.json({ error: "Keyword not found" }, 404);
  const history = await getHistory(workspaceId, id, limit);
  return c.json({ keyword_id: id, keyword: kw.keyword_base, history });
});

app.get("/keywords/:id/grid", requireAuth, async (c) => {
  const workspaceId = getWid(c);
  const id = parseInt(c.req.param("id"), 10);
  const kw = await getKeyword(workspaceId, id);
  if (!kw) return c.json({ error: "Keyword not found" }, 404);
  const points = await getLastCheckPoints(workspaceId, id);
  return c.json({ keyword_id: id, keyword: kw.keyword_base, points });
});

// ── DataForSEO utilities ──────────────────────────────────────────────────────

app.post("/volume", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.keywords || !Array.isArray(body.keywords)) {
    return c.json({ error: "keywords array required" }, 400);
  }
  const volumes = await checkVolume(body.keywords as string[]);
  return c.json({ volumes });
});

app.post("/intent", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.keywords || !Array.isArray(body.keywords)) {
    return c.json({ error: "keywords array required" }, 400);
  }
  const businessType = (body.business_type ?? "service") as BusinessType;
  const results = [];
  for (let i = 0; i < body.keywords.length; i++) {
    const r = await qualifyIntent(String(body.keywords[i]), businessType);
    results.push(r);
    if (i < body.keywords.length - 1) await sleep(DELAY_MS);
  }
  return c.json({ results });
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3000", 10);

await migrate();

serve({ fetch: app.fetch, port, hostname: "::" }, () => {
  console.log(JSON.stringify({
    service:   "range",
    event:     "started",
    port,
    timestamp: new Date().toISOString(),
  }));
});
