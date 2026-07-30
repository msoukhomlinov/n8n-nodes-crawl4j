# Crawl4AI Plus for n8n

> **Enhanced fork** targeting Crawl4AI v0.8.x–v0.9.x (see [Crawl4AI Version Compatibility](#crawl4ai-version-compatibility)) with a progressive-disclosure two-node architecture: a Simple node (4 operations) for general users and an Advanced node (15 operations) for power users.

## Project History & Attribution

This is a maintained fork with enhanced features for Crawl4AI 0.8.0.

### Fork Chain
- **Original author**: [Heictor Hsiao](https://github.com/golfamigo) - [golfamigo/n8n-nodes-crawl4j](https://github.com/golfamigo/n8n-nodes-crawl4j)
- **First maintainer**: [Matias Lopez](https://github.com/qmatiaslopez) - [qmatiaslopez/n8n-nodes-crawl4j](https://github.com/qmatiaslopez/n8n-nodes-crawl4j)
- **Current maintainer**: [Max Soukhomlinov](https://github.com/msoukhomlinov) - [msoukhomlinov/n8n-nodes-crawl4ai-plus](https://github.com/msoukhomlinov/n8n-nodes-crawl4ai-plus)

All credit for the original implementation goes to **Heictor Hsiao** and **Matias Lopez**.

> **v5.0.0 is a breaking change** — the 3-node architecture (BasicCrawler, ContentExtractor, SmartExtract) has been replaced with 2 new nodes. Existing workflows will need rebuilding. See [CHANGELOG.md](CHANGELOG.md) for full details.

---

## Features

### Crawl4AI Plus — Simple Node (4 operations)

Designed for general users with smart defaults and minimal configuration:

- **Get Page Content** — Crawl a URL and get markdown (single page, follow links, or full site via crawl scope)
- **Ask Question** — Ask a question about a page using LLM extraction
- **Extract Data** — Extract contact info, financial data, or custom structured data (regex presets + LLM)
- **CSS Extractor** — Extract structured data using CSS selectors

### Crawl4AI Plus Advanced — Advanced Node (15 operations in 3 groups)

Full API control via 3 standardized collections (Browser & Session, Crawl Settings, Output & Filtering):

**Crawling**
- **Crawl URL** — Single URL with full browser/crawler/output configuration
- **Crawl Multiple URLs** — Manual list or recursive discovery (BFS/DFS/BestFirst strategies)
- **Stream Crawl** — Streaming via `/crawl/stream` for large URL sets
- **Process Raw HTML** — Process pre-fetched HTML without a network request
- **Discover Links** — Extract, filter, and score links (internal/external, include/exclude patterns)

**Extraction**
- **LLM Extractor** — AI-powered structured extraction with schema support
- **CSS Extractor** — Structured extraction using `JsonCssExtractionStrategy`
- **JSON Extractor** — Extract JSON from direct URLs, script tags, or JSON-LD
- **Regex Extractor** — Pattern-based extraction with built-in or custom patterns
- **Cosine Similarity** — Semantic clustering (requires `unclecode/crawl4ai:all` Docker image)
- **SEO Metadata** — Meta tags, Open Graph, Twitter Cards, JSON-LD, robots, hreflang

**Jobs & Monitoring**
- **Submit Crawl Job** — Async crawl via `/crawl/job` with webhook support
- **Submit LLM Job** — Async LLM extraction via `/llm/job` (question-answering, or structured extraction with an optional JSON schema)
- **Get Job Status** — Poll `/crawl/job/{task_id}` or `/llm/job/{task_id}` for results, depending on which job type was submitted
- **Health Check** — Server health and endpoint stats

---

## Requirements

- **n8n**: 1.79.1 or higher
- **Crawl4AI Docker**: 0.8.0–0.8.9 for full feature support; 0.9.0+ works with reduced functionality (see [Crawl4AI Version Compatibility](#crawl4ai-version-compatibility))
  - Standard operations: `unclecode/crawl4ai:latest`
  - Cosine Similarity Extractor: `unclecode/crawl4ai:all` (includes sentence-transformers)

---

## Crawl4AI Version Compatibility

Crawl4AI **v0.9.0** made the Docker API server secure-by-default. Two changes affect this package directly, and there is no client-side workaround for either — both are enforced server-side by design:

1. **Authentication is on by default.** The server binds to `127.0.0.1` unless `CRAWL4AI_API_TOKEN` is set on the container. To reach it from n8n, set that env var and use **Token Authentication** in this package's credentials with a matching Bearer token.
2. **Untrusted (network) request bodies are restricted.** The server now rejects, with HTTP 400, any request that sets `js_code`, `cookies`, `headers`, `proxy`/`proxy_config`, `extra_args`, `init_scripts`, `user_data_dir`, `cdp_url`, `deep_crawl_strategy`, `magic`, `simulate_user`, or that embeds an `LLMExtractionStrategy` object. This is a deliberate security boundary in Crawl4AI itself (it also blocks its own Python SDK's `/crawl` request path when called over HTTP) — not a bug in this package.

**Practical impact on this package**, running against Crawl4AI **v0.9.0+**:

| Still works | Broken (HTTP 400 from Crawl4AI) |
|---|---|
| Get Page Content, CSS/JSON/Regex/SEO Extractor, Discover Links, Health Check (no JS/session/anti-bot options set) | **Ask Question**, **Extract Data**, **LLM Extractor** — all embed `LLMExtractionStrategy` directly in the crawl request |
| Submit Crawl Job / Submit LLM Job for simple configs | Any operation with **Magic Mode**, **Simulate User**, **Stealth**, cookies, custom headers, a proxy, or a **Crawl Scope** of Follow Links/Full Site that sets `deep_crawl_strategy` |
| **Submit LLM Job** with the optional JSON Schema field (question-answering or structured extraction via `/llm/job`, which is exempt from the restriction above) | — |

If you rely on the broken features, run Crawl4AI **v0.8.9 or earlier** (last version before the hardening). Otherwise, non-session, non-LLM-embedded operations continue to work on the latest Crawl4AI.

---

## Installation

### Via n8n UI (recommended)

1. Go to **Settings → Community Nodes**
2. Click **Install a community node**
3. Enter `n8n-nodes-crawl4ai-plus`
4. Restart n8n

### From source (development)

```bash
# Install with pnpm (required — npm/yarn not supported)
pnpm install
pnpm build
```

Then restart your n8n instance. The nodes are declared in `package.json → "n8n" → "nodes"` and loaded from `dist/`.

---

## Setup

### Credentials

1. **Settings → Credentials → New → Crawl4AI API**
2. Configure:
   - **Docker URL** — URL of your Crawl4AI container (default: `http://crawl4ai:11235`)
   - **Authentication** — Defaults to **No Authentication**, correct for a Crawl4AI **v0.8.x** quickstart deployment. Crawl4AI **v0.9.0+** requires authentication by default — set `CRAWL4AI_API_TOKEN` on the Crawl4AI container and switch this to **Token Authentication** with the same value. See [Crawl4AI Version Compatibility](#crawl4ai-version-compatibility).
   - **LLM Settings** — Enable and configure a provider for AI-powered operations:
     - OpenAI, Anthropic, Groq, Ollama, or custom LiteLLM endpoint

### Simple Node

1. Add **Crawl4AI Plus** to your workflow
2. Select an operation (Get Page Content, Ask Question, Extract Data, or CSS Extractor)
3. Configure the URL and required fields
4. Optional settings are in a single flat Options collection

### Advanced Node

1. Add **Crawl4AI Plus Advanced** to your workflow
2. Select an operation from one of the 3 groups (Crawling, Extraction, Jobs & Monitoring)
3. Configure the URL/required fields
4. Fine-tune via 3 standardized collections: Browser & Session, Crawl Settings, Output & Filtering
5. LLM-based operations use the provider configured in credentials

---

## Troubleshooting

### "Cannot find module" errors on queue-mode / shared-volume installs

**Symptom:** n8n fails to load this package on startup with an error like:

```text
Failed to load package "n8n-nodes-crawl4ai-plus"
Error: Cannot find module '/home/node/.n8n/nodes/node_modules/n8n-nodes-crawl4ai-plus/node_modules/libphonenumber-js/index.cjs.js'
```

followed by `Unrecognized node type: n8n-nodes-crawl4ai-plus.crawl4aiPlus`.

**Cause:** In n8n **queue mode** with multiple workers sharing a single `.n8n/nodes` volume, the npm install into that shared directory can be interrupted by a race between the main process and worker processes touching the same `node_modules` tree concurrently on container start. This can leave one of this package's nested dependencies (`zod`, `libphonenumber-js`, or `keyv-file`) truncated — the package directory exists but is missing its actual entry-point file. Because n8n only runs npm install once per package and doesn't re-check already-"present" node_modules on restart, this corruption persists across restarts until manually repaired.

**Fix:** Reinstall the affected dependency scoped to this package's directory, inside the container/volume where n8n resolves community nodes from:

```bash
cd <path-to-.n8n>/nodes/node_modules/n8n-nodes-crawl4ai-plus
npm install --no-save --legacy-peer-deps zod libphonenumber-js keyv-file
```

Pin exact versions if you want to match what was originally installed — check this package's own `node_modules/.package-lock.json` for the resolved versions, or pass `zod@<version>` etc. explicitly. Then restart n8n.

As of v5.6.6, two integrity checks surface this corruption with a clear message (including the repair command above) rather than the opaque error above. A `postinstall` check runs `require.resolve()` on each of these dependencies and fails the install immediately if any is missing — this covers manual `npm`/`pnpm` installs, CI, and Docker image bakes. In addition, a load-time guard imported first by every node and credential in this package surfaces the same clear error immediately in n8n's own startup logs even when n8n's installer runs with `--ignore-scripts` (as the in-app "Install a community node" UI does, so `postinstall` never runs). The corruption is then diagnosable directly from n8n's logs without needing to run anything manually first.

As of v5.8.0, this package goes further and removes `axios` as a dependency entirely — HTTP now runs through n8n's own `this.helpers.httpRequest`, which ships with every n8n install and needs no nested copy under this package. This is the durable fix: `axios` dragged in the deepest, highest-risk transitive chain (`form-data`, `follow-redirects`), which was the original trigger of #27, so eliminating it removes that corruption vector at the source rather than only detecting corruption in it after the fact. The integrity checks above remain in place for the four remaining dependencies.

See [#27](https://github.com/msoukhomlinov/n8n-nodes-crawl4ai-plus/issues/27) for the original report and environment details.

---

## Configuration Reference

### Browser Options

| Option | Description |
|---|---|
| Browser Type | Chromium (default), Firefox, or Webkit |
| Headless Mode | Run browser without a visible window |
| Enable JavaScript | Enable JS execution (required for dynamic pages) |
| Enable Stealth Mode | Hides webdriver properties to bypass bot detection |
| Extra Browser Arguments | Command-line flags passed to the browser process |
| Init Scripts | JavaScript injected before page load (stealth setup) |
| Viewport Width / Height | Browser viewport dimensions |
| Timeout (MS) | Maximum page load wait time |
| User Agent | Override the browser user agent string |

### Session & Authentication

| Option | Description |
|---|---|
| Storage State (JSON) | Browser state (cookies, localStorage) as JSON — works on n8n Cloud |
| Cookies | Structured cookie entries for authentication |
| Session ID | Reuse a named browser context across requests |
| Use Managed Browser | Connect to an existing managed browser instance |
| Use Persistent Context | Persist browser profile to disk (self-hosted only) |
| User Data Directory | Path to the browser profile directory |

### Crawler Options

| Option | Description |
|---|---|
| Cache Mode | ENABLED, BYPASS, DISABLED, READ\_ONLY, or WRITE\_ONLY |
| CSS Selector | Pre-filter page content before extraction |
| JavaScript Code | Execute custom JS on the page before extracting |
| Wait For | CSS selector or JS expression to wait for before extracting |
| Check Robots.txt | Respect the site's robots.txt rules |
| Word Count Threshold | Minimum word count for a content block to be included |
| Exclude External Links | Strip external links from results |
| Preserve HTTPS for Internal Links | Normalise internal link protocols |

### Deep Crawl Options (Crawl Multiple URLs — Discover mode)

| Option | Description |
|---|---|
| Seed URL | Starting URL for recursive discovery |
| Discovery Query | Keywords that guide which links to follow (required for BestFirst) |
| Strategy | BestFirst (recommended), BFS, or DFS |
| Max Depth | Maximum link depth to follow |
| Max Pages | Maximum number of pages to crawl |
| Score Threshold | Minimum relevance score for BestFirst |

### Output Options

| Option | Description |
|---|---|
| Include HTML | Include raw HTML in `content.html` |
| Include Links | Include `links.internal` and `links.external` arrays |
| Include Media | Include images, videos, and audio metadata |
| Screenshot | Capture a screenshot (base64) |
| PDF | Generate a PDF (base64) |
| SSL Certificate | Extract SSL certificate details |

### Output Shape

All operations return a consistent output object:

```json
{
  "domain": "example.com",
  "url": "https://example.com/page",
  "fetchedAt": "2026-02-18T10:00:00.000Z",
  "success": true,
  "statusCode": 200,
  "content": {
    "markdownRaw": "...",
    "markdownFit": "..."
  },
  "extracted": {
    "strategy": "JsonCssExtractionStrategy",
    "json": { ... }
  },
  "links": {
    "internal": [{ "href": "...", "text": "..." }],
    "external": []
  },
  "metrics": {
    "durationMs": 1240
  }
}
```

### Async Job Workflow

For large or long-running crawls, use the async pattern:

1. **Submit Crawl Job** or **Submit LLM Job** → returns `taskId` and `jobType` (`crawl` or `llm`)
2. **Get Job Status** (poll with `taskId`, and set **Job Type** to match how it was submitted — crawl and LLM jobs are polled via separate endpoints) → returns `status: pending | processing | completed | failed`
3. When `completed`, result fields are returned directly at top level alongside `taskId` and `status`

Webhook callbacks are supported in both Submit Crawl Job and Submit LLM Job for push-based notification when the job finishes.

---

## Project Structure

```
nodes/
  ├── shared/                                 # Shared code used by both nodes
  │   ├── apiClient.ts                        # Crawl4aiClient — all HTTP calls
  │   ├── utils.ts                            # Config builders, LLM helpers, validation
  │   ├── interfaces.ts                       # TypeScript types
  │   ├── formatters.ts                       # formatCrawlResult, formatExtractionResult
  │   └── descriptions/                       # Reusable n8n UI field definitions
  │       ├── index.ts                        # Barrel export
  │       ├── common.fields.ts                # urlField, urlsField, cacheModeField, etc.
  │       ├── browserSession.fields.ts        # getBrowserSessionFields()
  │       ├── crawlSettings.fields.ts         # getCrawlSettingsFields()
  │       └── outputFiltering.fields.ts       # getOutputFilteringFields()
  │
  ├── Crawl4aiPlus/                           # Simple node (4 operations)
  │   ├── Crawl4aiPlus.node.ts
  │   ├── crawl4aiplus.svg
  │   ├── actions/
  │   │   ├── operations.ts
  │   │   ├── router.ts
  │   │   ├── getPageContent.operation.ts
  │   │   ├── askQuestion.operation.ts
  │   │   ├── extractData.operation.ts
  │   │   └── cssExtractor.operation.ts
  │   └── helpers/
  │       ├── utils.ts                        # getSimpleDefaults, executeCrawl, deduplicateResults
  │       └── formatters.ts                   # Simple node formatters
  │
  └── Crawl4aiPlusAdvanced/                   # Advanced node (15 operations, 3 groups)
      ├── Crawl4aiPlusAdvanced.node.ts
      ├── crawl4aiplus.svg
      ├── actions/
      │   ├── operations.ts                   # 15 operations with groupName for UI grouping
      │   ├── router.ts
      │   ├── crawlUrl.operation.ts           # ─┐
      │   ├── crawlMultipleUrls.operation.ts  # │ Crawling group
      │   ├── crawlStream.operation.ts        # │
      │   ├── processRawHtml.operation.ts     # │
      │   ├── discoverLinks.operation.ts      # ─┘
      │   ├── llmExtractor.operation.ts       # ─┐
      │   ├── cssExtractor.operation.ts       # │
      │   ├── jsonExtractor.operation.ts      # │ Extraction group
      │   ├── regexExtractor.operation.ts     # │
      │   ├── cosineExtractor.operation.ts    # │
      │   ├── seoExtractor.operation.ts       # ─┘
      │   ├── submitCrawlJob.operation.ts     # ─┐
      │   ├── submitLlmJob.operation.ts       # │ Jobs & Monitoring group
      │   ├── getJobStatus.operation.ts       # │
      │   └── healthCheck.operation.ts        # ─┘
      └── helpers/
          ├── interfaces.ts                   # Re-exports shared types
          └── formatters.ts                   # Re-exports shared + formatJobSubmission()

credentials/
  └── Crawl4aiApi.credentials.ts             # Docker URL, auth, LLM provider config
```

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed version history and breaking changes.

## License

MIT
