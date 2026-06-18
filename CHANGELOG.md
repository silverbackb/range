# Changelog — @silverbackbase/range

## [0.2.5] — 2026-06-18

### Amélioré
- Skill `range-setup` : nouvelle règle "SERP à dominante locale" dans la section de qualification des mots-clés. Avant de choisir le mode (`coverage` vs `territory`), vérifier si la SERP est dominée par le pack local. Un pack local écrasant rend le mode `territory` quasi invisible — le mode `coverage` est alors prioritaire.
- Skill `range-sbb` : étape 0 ajoutée dans le workflow "configurer un nouveau keyword" — lecture de la composition SERP avant de choisir le mode, avec arbre de décision en 4 cas (pack + organiques, pack dominant seul, pas de pack, SERP générique).

---

## [0.2.4] — 2026-06-02

### Corrigé
- Skill `range-setup` : frontmatter YAML manquant (`name` + `description`). Sans lui, le loader prenait le titre H1 (« Skill — /range-setup ») comme description → skill mal déclenché. Ajout d'une description riche avec triggers explicites et désambiguïsation vs `range-sbb` (setup/config ≠ consultation).

---

## [0.1.0] — 2026-05-27

### Initial release

**10 MCP tools:**

- `range_add_keyword` — Add a keyword to track (coverage geo-grid or territory city list)
- `range_add_zone` — Add a target city to a territory keyword
- `range_list_keywords` — List tracked keywords with last known position and delta
- `range_check_now` — Trigger a live DataForSEO position check
- `range_get_summary` — Synthetic view of all keywords for an account
- `range_get_history` — Historical check data with delta per check
- `range_get_grid` — Point-by-point detail of the last check (🟢🟡🔴)
- `range_delete_keyword` — Soft delete a tracked keyword (history preserved)
- `range_check_volume` — Monthly search volume for keyword×city combinations
- `range_qualify_intent` — SERP intent analysis (product vs service vs mixed) for 4 business types

**Two tracking modes:**
- `coverage` — Physical store: geo-grid around an address, measures Google Maps / Local Pack visibility
- `territory` — Service area business (SAB): one city per point, measures organic SERP visibility

**Storage:** SQLite at `~/.range/range.db` — zero configuration, data persists across sessions.
