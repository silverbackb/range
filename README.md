# @silverbackbase/range

MCP server for **Range** — local SEO rank tracking for service area businesses (SAB) and physical stores.

Part of the [SilverBackBase](https://silverbackbase.com) primitive toolset for marketing AI agents.

## What it does

Range tracks keyword positions in Google organic results and Google Maps (Local Pack) across geographic zones. It stores the full history locally and exposes structured data to any agent client.

Two tracking modes:

| Mode | For | Keyword | Points |
|------|-----|---------|--------|
| `territory` | Service area businesses (plumber, installer, fire safety…) | With city ("fire extinguisher check Colmar") | 1 per city |
| `coverage` | Physical stores (hair salon, restaurant, shop…) | Without city ("hair salon") | Geo-grid around the address |

## MCP tools

| Tool | Invocation | Description |
|------|-----------|-------------|
| `range_add_keyword` | user | Add a keyword to track |
| `range_add_zone` | user | Add a city to a territory keyword |
| `range_list_keywords` | model | List tracked keywords + last position |
| `range_check_now` | user | Trigger a live DataForSEO check (billed) |
| `range_get_summary` | model | Synthetic view of an account |
| `range_get_history` | model | Historical checks with delta |
| `range_get_grid` | model | Point-by-point detail of last check |
| `range_delete_keyword` | user | Soft delete a keyword (history preserved) |
| `range_check_volume` | model | Monthly search volume for keyword×city |
| `range_qualify_intent` | model | SERP intent: product / service / mixed |

## Requirements

- Node.js ≥ 20
- A [DataForSEO](https://dataforseo.com) account (for `range_check_now`, `range_check_volume`, `range_qualify_intent`)

## Install in Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "range": {
      "command": "npx",
      "args": ["-y", "@silverbackbase/range"],
      "env": {
        "DATAFORSEO_USERNAME": "your-email@example.com",
        "DATAFORSEO_PASSWORD": "your-dataforseo-password"
      }
    }
  }
}
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATAFORSEO_USERNAME` | — | DataForSEO account email |
| `DATAFORSEO_PASSWORD` | — | DataForSEO API password |

## Data storage

Range stores all keywords, zones, and check history in SQLite at `~/.range/range.db`. Zero configuration — the directory is created automatically on first run.

## DataForSEO cost estimates

**Coverage (geo-grid):**
| Density | Points | Cost/check |
|---------|--------|-----------|
| 3×3 | ~5 pts | ~$0.01 |
| 5×5 | ~13 pts | ~$0.03 |
| 7×7 | ~29 pts | ~$0.06 |

**Territory (city list):**
| Cities | Cost/check |
|--------|-----------|
| 5 | ~$0.01 |
| 8 | ~$0.02 |
| 12 | ~$0.02 |

## License

Business Source License 1.1 — self-hosting for internal use is permitted; reselling as a managed service is not.  
See [LICENSE](./LICENSE).

## Part of SilverBackBase

Range chains with other primitives:
- **Trail** — correlate rank improvements with actual lead volume
- **Root** — position data as context in monthly client reports
