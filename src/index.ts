import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  insertKeyword, listKeywords, getKeyword, deleteKeyword,
  insertZone, listZones,
  insertCheck, insertPoint, getHistory, getLastCheckPoints, getPreviousCheck,
} from "./db.js";
import { generateGrid, parseDensity } from "./grid.js";
import { checkPoint, checkVolume, qualifyIntent, DELAY_MS, sleep, type BusinessType } from "./dataforseo.js";

const server = new McpServer({
  name: "range",
  version: "0.1.0",
});

// ── range_add_keyword ─────────────────────────────────────────────────────────

server.tool(
  "range_add_keyword",
  "Ajoute un mot-clé à tracker. Mode 'coverage' = boutique (geo-grid autour d'un point, keyword sans ville). Mode 'territory' = prestataire itinérant (liste de villes, keyword avec ville). Appeler range_add_zone ensuite pour le mode territory.",
  {
    account_id:    z.string().describe("Identifiant du compte client (ex: 'at2o')"),
    keyword_base:  z.string().describe("Mot-clé de base sans ville (ex: 'désenfumage', 'coiffeur')"),
    target_domain: z.string().describe("Domaine à tracker dans les résultats (ex: 'at2o-incendie.fr')"),
    page_url:      z.string().optional().describe("URL de la page cible (ex: 'https://at2o-incendie.fr/services/desenfumage')"),
    mode:          z.enum(["coverage", "territory"]).describe("'coverage' = boutique geo-grid | 'territory' = SAB liste de villes"),
    // coverage fields
    center_label:  z.string().optional().describe("[coverage] Nom de la ville centre (ex: 'Schiltigheim')"),
    center_lat:    z.number().optional().describe("[coverage] Latitude du centre"),
    center_lng:    z.number().optional().describe("[coverage] Longitude du centre"),
    radius_km:     z.number().optional().default(5).describe("[coverage] Rayon en km (défaut: 5)"),
    grid_density:  z.enum(["3x3", "5x5", "7x7"]).optional().default("5x5").describe("[coverage] Densité de la grille (défaut: 5x5)"),
  },
  async (args) => {
    if (args.mode === "coverage" && (!args.center_lat || !args.center_lng)) {
      return { content: [{ type: "text", text: "Erreur : center_lat et center_lng sont requis en mode coverage." }], isError: true };
    }

    const id = insertKeyword({
      account_id:    args.account_id,
      keyword_base:  args.keyword_base,
      page_url:      args.page_url,
      target_domain: args.target_domain,
      mode:          args.mode,
      center_label:  args.center_label,
      center_lat:    args.center_lat,
      center_lng:    args.center_lng,
      radius_km:     args.radius_km,
      grid_density:  args.grid_density,
    });

    const msg = args.mode === "territory"
      ? `Keyword #${id} ajouté en mode territory. Appeler range_add_zone pour ajouter les villes cibles.`
      : `Keyword #${id} ajouté en mode coverage. Grille ${args.grid_density} · ${args.radius_km}km autour de ${args.center_label ?? `${args.center_lat},${args.center_lng}`}.`;

    return { content: [{ type: "text", text: msg }], structuredContent: { keyword_id: id, mode: args.mode } };
  }
);

// ── range_add_zone ────────────────────────────────────────────────────────────

server.tool(
  "range_add_zone",
  "Ajoute une ville cible à un keyword en mode territory. Le keyword_override est généré automatiquement si non fourni (keyword_base + ' ' + label).",
  {
    keyword_id:       z.number().describe("ID du keyword (retourné par range_add_keyword)"),
    label:            z.string().describe("Nom de la ville (ex: 'Colmar')"),
    lat:              z.number().describe("Latitude du centre-ville"),
    lng:              z.number().describe("Longitude du centre-ville"),
    keyword_override: z.string().optional().describe("Keyword complet si différent de 'base + ville' (ex: 'désenfumage Colmar centre')"),
  },
  async (args) => {
    const kw = getKeyword(args.keyword_id);
    if (!kw) return { content: [{ type: "text", text: `Keyword #${args.keyword_id} introuvable.` }], isError: true };
    if (kw.mode !== "territory") return { content: [{ type: "text", text: "range_add_zone est réservé au mode territory." }], isError: true };

    const override = args.keyword_override ?? `${kw.keyword_base} ${args.label}`;
    const id = insertZone({ keyword_id: args.keyword_id, label: args.label, lat: args.lat, lng: args.lng, keyword_override: override });

    return { content: [{ type: "text", text: `Zone '${args.label}' ajoutée (#${id}). Keyword qui sera checké : "${override}".` }] };
  }
);

// ── range_list_keywords ───────────────────────────────────────────────────────

server.tool(
  "range_list_keywords",
  "Liste tous les mots-clés trackés pour un compte client avec leur dernière position connue et le delta.",
  {
    account_id: z.string().describe("Identifiant du compte client"),
  },
  async (args) => {
    const keywords = listKeywords(args.account_id);

    if (keywords.length === 0) {
      return { content: [{ type: "text", text: `Aucun keyword tracké pour le compte '${args.account_id}'.` }] };
    }

    const lines = keywords.map((kw: any) => {
      const pos    = kw.last_avg_position ? `moy ${Number(kw.last_avg_position).toFixed(1)}` : "jamais checké";
      const best   = kw.last_best_position ? ` · best #${kw.last_best_position}` : "";
      const top3   = kw.last_top3_count != null ? ` · top3: ${kw.last_top3_count}/${kw.last_points_total}` : "";
      const zones  = kw.mode === "territory" ? ` · ${kw.zone_count} villes` : ` · ${kw.grid_density} ${kw.radius_km}km`;
      const last   = kw.last_checked ? ` · ${kw.last_checked.slice(0, 10)}` : "";
      return `#${kw.id} [${kw.mode}] "${kw.keyword_base}"${zones} → ${pos}${best}${top3}${last}`;
    });

    const text = `Keywords de '${args.account_id}' (${keywords.length}) :\n${lines.join("\n")}`;
    return { content: [{ type: "text", text }], structuredContent: { keywords } };
  }
);

// ── range_check_now ───────────────────────────────────────────────────────────

server.tool(
  "range_check_now",
  "Déclenche un check de position via DataForSEO pour un keyword tracké. Facturable (appels API). Prend 1-3 minutes selon le nombre de points.",
  {
    keyword_id: z.number().describe("ID du keyword à checker"),
  },
  async (args) => {
    const kw = getKeyword(args.keyword_id);
    if (!kw) return { content: [{ type: "text", text: `Keyword #${args.keyword_id} introuvable.` }], isError: true };

    const points: Array<{ lat: number; lng: number; zone_label: string | null; keyword: string }> = [];

    if (kw.mode === "coverage") {
      const density = parseDensity(kw.grid_density ?? "5x5");
      const grid    = generateGrid(kw.center_lat, kw.center_lng, kw.radius_km, density);
      for (const p of grid) points.push({ ...p, zone_label: null, keyword: kw.keyword_base });
    } else {
      const zones = listZones(args.keyword_id);
      if (zones.length === 0) {
        return { content: [{ type: "text", text: `Aucune zone configurée pour le keyword #${args.keyword_id}. Ajouter des villes avec range_add_zone.` }], isError: true };
      }
      for (const z of zones) points.push({ lat: z.lat, lng: z.lng, zone_label: z.label, keyword: z.keyword_override });
    }

    const results = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const r = await checkPoint(p.keyword, p.lat, p.lng, kw.target_domain, p.zone_label);
      results.push(r);
      if (i < points.length - 1) await sleep(DELAY_MS);
    }

    // Compute summary
    const found     = results.filter(r => r.organic_position !== null);
    const positions = found.map(r => r.organic_position as number);
    const avg       = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null;
    const best      = positions.length > 0 ? Math.min(...positions) : null;
    const worst     = positions.length > 0 ? Math.max(...positions) : null;
    const top3      = results.filter(r => r.in_top3).length;
    const top10     = results.filter(r => r.in_top10).length;
    const lpCount   = results.filter(r => r.local_pack_position !== null).length;
    const bestZone  = best !== null ? (results.find(r => r.organic_position === best)?.zone_label ?? null) : null;

    const checkId = insertCheck({
      keyword_id:       args.keyword_id,
      points_total:     results.length,
      points_found:     found.length,
      avg_position:     avg,
      best_position:    best,
      worst_position:   worst,
      top3_count:       top3,
      top10_count:      top10,
      local_pack_count: lpCount,
      best_zone_label:  bestZone,
    });

    for (const r of results) {
      insertPoint({
        check_id:           checkId,
        lat:                r.lat,
        lng:                r.lng,
        zone_label:         r.zone_label,
        organic_position:   r.organic_position,
        local_pack_position: r.local_pack_position,
        in_top3:            r.in_top3 ? 1 : 0,
        in_top10:           r.in_top10 ? 1 : 0,
      });
    }

    // Delta vs previous check
    const prev      = getPreviousCheck(args.keyword_id);
    const deltaAvg  = avg !== null && prev?.avg_position != null ? +(avg - prev.avg_position).toFixed(1) : null;
    const deltaSign = deltaAvg === null ? "" : deltaAvg > 0 ? `+${deltaAvg}` : `${deltaAvg}`;

    const summary = {
      keyword_id:    args.keyword_id,
      keyword_base:  kw.keyword_base,
      mode:          kw.mode,
      checked_at:    new Date().toISOString(),
      points_total:  results.length,
      points_found:  found.length,
      avg_position:  avg ? +avg.toFixed(1) : null,
      best_position: best,
      worst_position: worst,
      top3_count:    top3,
      top10_count:   top10,
      local_pack_count: lpCount,
      best_zone:     bestZone,
      delta_avg:     deltaAvg,
      points:        results,
    };

    const lines = [
      `✓ Check terminé — "${kw.keyword_base}" (${kw.mode})`,
      `  ${results.length} points · trouvé: ${found.length} · avg: ${avg?.toFixed(1) ?? "—"} ${deltaSign ? `(${deltaSign})` : ""} · best: ${best ? `#${best}` : "—"}`,
      `  top3: ${top3}/${results.length} · top10: ${top10}/${results.length} · local pack: ${lpCount}/${results.length}`,
    ];
    if (bestZone) lines.push(`  Meilleure zone : ${bestZone}`);

    return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: summary };
  }
);

// ── range_get_summary ─────────────────────────────────────────────────────────

server.tool(
  "range_get_summary",
  "Vue synthétique de la visibilité locale d'un compte — tous les keywords avec leur dernière position, delta vs check précédent, et top3/top10 coverage.",
  {
    account_id: z.string().describe("Identifiant du compte client"),
  },
  async (args) => {
    const keywords = listKeywords(args.account_id);
    if (keywords.length === 0) {
      return { content: [{ type: "text", text: `Aucun keyword tracké pour '${args.account_id}'.` }] };
    }

    const rows = keywords.map((kw: any) => {
      const avg  = kw.last_avg_position ? Number(kw.last_avg_position).toFixed(1) : "—";
      const best = kw.last_best_position ? `#${kw.last_best_position}` : "—";
      const t3   = kw.last_points_total ? `${kw.last_top3_count ?? 0}/${kw.last_points_total}` : "—";
      const t10  = kw.last_points_total ? `${kw.last_top3_count != null ? kw.last_points_total - (kw.last_points_total - (kw.last_top3_count ?? 0)) : "—"}` : "—";
      const date = kw.last_checked ? kw.last_checked.slice(0, 10) : "jamais";
      return { id: kw.id, keyword: kw.keyword_base, mode: kw.mode, avg, best, top3: t3, last_checked: date };
    });

    const text = `Synthèse Range — compte '${args.account_id}'\n\n` +
      rows.map((r: any) => `#${r.id} [${r.mode}] "${r.keyword}" — avg: ${r.avg} · best: ${r.best} · top3: ${r.top3} · ${r.last_checked}`).join("\n");

    return { content: [{ type: "text", text }], structuredContent: { account_id: args.account_id, keywords: rows } };
  }
);

// ── range_get_history ─────────────────────────────────────────────────────────

server.tool(
  "range_get_history",
  "Retourne l'historique des checks pour un keyword — évolution de la position moyenne, top3 coverage, et delta check par check.",
  {
    keyword_id: z.number().describe("ID du keyword"),
    limit:      z.number().optional().default(6).describe("Nombre de checks à retourner (défaut: 6)"),
  },
  async (args) => {
    const kw = getKeyword(args.keyword_id);
    if (!kw) return { content: [{ type: "text", text: `Keyword #${args.keyword_id} introuvable.` }], isError: true };

    const history = getHistory(args.keyword_id, args.limit);
    if (history.length === 0) {
      return { content: [{ type: "text", text: `Aucun historique pour "${kw.keyword_base}". Lancer range_check_now d'abord.` }] };
    }

    const lines = history.map((h: any, i: number) => {
      const prev   = history[i + 1];
      const delta  = h.avg_position != null && prev?.avg_position != null
        ? +(h.avg_position - prev.avg_position).toFixed(1) : null;
      const sign   = delta === null ? "" : delta > 0 ? ` (+${delta})` : ` (${delta})`;
      return `${h.checked_at.slice(0, 10)} — avg: ${h.avg_position?.toFixed(1) ?? "—"}${sign} · best: ${h.best_position ? `#${h.best_position}` : "—"} · top3: ${h.top3_count}/${h.points_total}`;
    });

    const text = `Historique "${kw.keyword_base}" (${history.length} checks) :\n${lines.join("\n")}`;
    return { content: [{ type: "text", text }], structuredContent: { keyword_id: args.keyword_id, keyword: kw.keyword_base, history } };
  }
);

// ── range_get_grid ────────────────────────────────────────────────────────────

server.tool(
  "range_get_grid",
  "Retourne le détail du dernier check point par point — utile pour voir quelles villes (territory) ou zones (coverage) sont présentes ou absentes.",
  {
    keyword_id: z.number().describe("ID du keyword"),
  },
  async (args) => {
    const kw = getKeyword(args.keyword_id);
    if (!kw) return { content: [{ type: "text", text: `Keyword #${args.keyword_id} introuvable.` }], isError: true };

    const points = getLastCheckPoints(args.keyword_id);
    if (points.length === 0) {
      return { content: [{ type: "text", text: `Aucun check effectué pour "${kw.keyword_base}".` }] };
    }

    const lines = points.map((p: any) => {
      const label = p.zone_label ?? `${p.lat},${p.lng}`;
      const org   = p.organic_position ? (p.organic_position <= 3 ? `🟢 #${p.organic_position}` : p.organic_position <= 10 ? `🟡 #${p.organic_position}` : `🔴 #${p.organic_position}`) : "⚫ absent";
      const lp    = p.local_pack_position ? ` | 📍 maps #${p.local_pack_position}` : "";
      return `  ${label.padEnd(20)} ${org}${lp}`;
    });

    const text = `Dernier check "${kw.keyword_base}" :\n${lines.join("\n")}`;
    return { content: [{ type: "text", text }], structuredContent: { keyword_id: args.keyword_id, keyword: kw.keyword_base, points } };
  }
);

// ── range_delete_keyword ──────────────────────────────────────────────────────

server.tool(
  "range_delete_keyword",
  "Désactive un keyword tracké (soft delete — l'historique est conservé).",
  {
    keyword_id: z.number().describe("ID du keyword à désactiver"),
  },
  async (args) => {
    const kw = getKeyword(args.keyword_id);
    if (!kw) return { content: [{ type: "text", text: `Keyword #${args.keyword_id} introuvable.` }], isError: true };
    deleteKeyword(args.keyword_id);
    return { content: [{ type: "text", text: `Keyword #${args.keyword_id} "${kw.keyword_base}" désactivé.` }] };
  }
);

// ── range_check_volume ────────────────────────────────────────────────────────

server.tool(
  "range_check_volume",
  "Vérifie le volume de recherche mensuel pour une liste de combinaisons keyword+ville. Utiliser avant de créer des pages locales pour valider qu'il y a du trafic potentiel.",
  {
    keywords: z.array(z.string()).describe("Liste de keywords à checker (ex: ['désenfumage Colmar', 'désenfumage Sélestat'])"),
  },
  async (args) => {
    const volumes = await checkVolume(args.keywords);

    const lines = args.keywords.map(kw => {
      const vol = volumes[kw];
      const label = vol === null ? "— (non détecté)" : vol === 0 ? "0 /mois" : `${vol} /mois`;
      const rec   = vol === null || vol === 0
        ? "→ pas de page dédiée (mentionner dans page régionale)"
        : vol < 10  ? "→ page optionnelle"
        : vol < 100 ? "→ page recommandée"
        : "→ page prioritaire";
      return `  "${kw}" : ${label}  ${rec}`;
    });

    const text = `Volumes de recherche France :\n${lines.join("\n")}`;
    return { content: [{ type: "text", text }], structuredContent: { volumes } };
  }
);

// ── range_qualify_intent ──────────────────────────────────────────────────────

server.tool(
  "range_qualify_intent",
  "Analyse la composition du SERP Google pour un keyword et détermine si l'intention est pertinente pour le type de business. Utiliser avant de configurer un keyword, ou lors d'un reporting pour valider qu'une bonne position génère bien des prospects.",
  {
    keywords:      z.array(z.string()).min(1).max(10).describe("Liste de keywords à qualifier (max 10)."),
    business_type: z.enum(["service", "retail", "food", "professional"]).default("service").describe(
      "'service' = prestataire itinérant (plombier, installateur…) — e-commerce = red flag. " +
      "'retail' = commerce physique (magasin) — e-commerce = concurrence normale, local pack = essentiel. " +
      "'food' = restauration (restaurant, bar, boulangerie) — local pack + agrégateurs (TripAdvisor) = normaux. " +
      "'professional' = professionnel libéral (avocat, médecin, comptable) — agrégateurs (Doctolib, PagesJaunes) = normaux."
    ),
  },
  async (args) => {
    const bType = args.business_type as BusinessType;
    const results = [];
    for (let i = 0; i < args.keywords.length; i++) {
      const r = await qualifyIntent(args.keywords[i], bType);
      results.push(r);
      if (i < args.keywords.length - 1) await sleep(DELAY_MS);
    }

    const lines = results.map(r => {
      const icon = r.intent === "product" ? "🛒" : r.intent === "service" ? "🔧" : "⚖️";
      const conf = r.confidence === "high" ? "★★★" : r.confidence === "medium" ? "★★☆" : "★☆☆";
      return [
        `${icon} "${r.keyword}" — ${r.intent.toUpperCase()} (${conf})`,
        `   scores: produit ${r.product_score} · service ${r.service_score}`,
        `   signaux: shopping=${r.signals.has_shopping} · local_pack=${r.signals.has_local_pack} · ecomm_domains=${r.signals.ecommerce_domains.length} · prix=${r.signals.prices_displayed} · paa_install=${r.signals.paa_about_installation}`,
        `   → ${r.recommendation}`,
      ].join("\n");
    });

    const text = `Qualification d'intention SERP :\n\n${lines.join("\n\n")}`;
    return { content: [{ type: "text", text }], structuredContent: { results } };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
