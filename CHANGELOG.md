# Changelog — @silverbackbase/range

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
