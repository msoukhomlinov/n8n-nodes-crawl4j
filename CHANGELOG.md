# Changelog

## [5.10.0] - 2026-07-30

### Fixed
- `getJobStatus` polled `GET /job/{task_id}`, an endpoint that has never existed on Crawl4AI's Docker API — the real endpoints have always been `GET /crawl/job/{task_id}` and `GET /llm/job/{task_id}` (separate per job type, confirmed against Crawl4AI's server source back to v0.8.5). Added a required **Job Type** field (Crawl Job / LLM Job) to Get Job Status so the operation calls the correct path; `Submit Crawl Job`/`Submit LLM Job` output now includes a `jobType` field to chain straight into it.
- Removed the **LLM Generated Pattern** mode from Regex Extractor. It called `POST /generate_pattern`, which is not and has never been a Crawl4AI Docker REST endpoint — `generate_pattern` only exists as a Python SDK classmethod (`RegexExtractionStrategy.generate_pattern`), which this REST-API-only package cannot reach. Every use of this mode has always failed with a 404. Built-in, custom, and both presets are unaffected.

### Added
- **Submit LLM Job**: optional JSON Schema field, mapped to `/llm/job`'s `schema` parameter for structured extraction. This is now the only working path for schema-based LLM extraction against a Crawl4AI v0.9.0+ Docker server — see Compatibility notes below.
- `parseApiError` now recognises Crawl4AI's untrusted-request-rejection message (`"... is not permitted ... from an untrusted request"` / `"... may not be constructed from an untrusted request"`) and returns an actionable explanation instead of a generic "bad request" message.

### Compatibility — Crawl4AI v0.9.0+ Docker API hardening
Crawl4AI v0.9.0 made the Docker API server secure-by-default (verified directly against `unclecode/crawl4ai`'s `deploy/docker/` source, not just release notes). Two changes affect this package, both enforced server-side with no client-side workaround:
- Authentication is on by default (server binds loopback unless `CRAWL4AI_API_TOKEN` is set). This package's existing Token Authentication credential already sends the required `Authorization: Bearer` header — no code change needed, only server-side + credential configuration.
- Every `/crawl` (and `/crawl/job`) request body is now validated as untrusted: Crawl4AI rejects `js_code`, `cookies`, `headers`, `proxy`/`proxy_config`, `extra_args`, `init_scripts`, `user_data_dir`, `cdp_url`, `deep_crawl_strategy`, `magic`, `simulate_user`, and any embedded `LLMExtractionStrategy` with HTTP 400. This breaks **Ask Question**, **Extract Data**, **LLM Extractor**, and any operation using Magic Mode, Simulate User, Stealth, cookies, custom headers, a proxy, or deep-crawl scopes, when run against Crawl4AI v0.9.0+. This is a deliberate upstream security boundary (it blocks the same request shape regardless of caller), not a defect in this package. Full functionality requires Crawl4AI v0.8.9 or earlier; see README's "Crawl4AI Version Compatibility" section for the full breakdown of what still works on v0.9.0+.

## [5.9.0] - 2026-07-30

### Fixed
- Removed `keyv` as a dependency entirely (#32). `domainModeCache.ts` previously wrapped `keyv-file` in a `keyv` instance purely for its `get`/`set`/`delete` API surface, but `keyv-file` already implements that same interface natively (including TTL), so the wrapper was unnecessary. In shared n8n community-node `node_modules` trees, this package's direct `keyv@^5.6.0` pin sat on one side of a live keyv major-version split against other packages/community-nodes pinning `keyv@4` (e.g. `cacheable-request`, `flat-cache`), which made npm's dependency resolution during install/update more fragile than a fully-aligned tree needs to be. Removing the dependency removes this package's contribution to that split.
- The removed `keyv` wrapper was also constructed fresh on every single cache read/write (`getCachedMode`/`deleteCachedMode`/`setCachedMode` each called `buildKeyv()`), and `keyv`'s constructor registers an `error` listener on the underlying store every time it's built. Since the underlying `KeyvFile` store instance is a long-lived singleton (one per resolved cache-file path, shared across every call), this leaked one `error` listener per cache operation onto that singleton for the lifetime of the n8n process — past Node's default limit of 10 listeners this would print `MaxListenersExceededWarning` and grow unbounded. Calling `KeyvFile`'s own methods directly removes the per-call wrapper (and the leak) entirely.
- `REQUIRED_DEPENDENCIES` in both `scripts/verify-install.js` and `nodes/shared/verifyNestedDependencies.ts` narrowed to `['zod', 'libphonenumber-js', 'keyv-file']` (`keyv` dropped, three remain).

### Changed
- `keyv@5.6.0` defaults to a `keyv:`-prefixed namespace on every key, so existing on-disk domain-mode cache entries written by prior versions are stored under keys like `keyv:example.com`. The new code reads the bare `example.com` key directly, so old entries are simply never looked up again (a clean cache miss, not an error) — no crash, no manual migration needed. The cache is a soft, self-healing optimisation (Anti-Bot mode detection), not persisted data with any correctness requirement, and stale `keyv:`-prefixed entries are inert and will expire via their original TTL.

## [5.8.0] - 2026-07-09

### Fixed
- Removed `axios` as a dependency entirely, root-causing the corruption vector behind #27. HTTP now runs through n8n's own `this.helpers.httpRequest` — which ships with every n8n install and needs no nested copy under this package — instead of a bundled `axios`. `axios` dragged in the deepest, highest-risk transitive chain (`form-data`, `follow-redirects`), the exact tree the install-race truncation in #27 hit, so eliminating it removes that vector at the source rather than only detecting corruption in it after the fact (as the 5.6.6/5.7.0 integrity checks did). Error handling, timeouts, streaming (`/crawl/stream`), and Bearer/Basic auth are preserved; axios-shaped errors are now detected by duck-typing (`httpRequest` still throws raw `AxiosError` objects), so no behaviour changes for callers.
- The install-integrity guard's `REQUIRED_DEPENDENCIES` list narrowed to `['zod', 'libphonenumber-js', 'keyv', 'keyv-file']` (`axios` dropped, four remain) in both `scripts/verify-install.js` and `nodes/shared/verifyNestedDependencies.ts`. The full-`require()`-not-`require.resolve()` mechanism is unchanged, kept as defense in depth for the four remaining deps.

### Changed
- Relaxed the `n8n-workflow` peerDependency from `>=1.60.0` to `*`. Peer dependencies are checked against the host's already-resolved version and are never installed, so a version floor did no protective work here and only risked unnecessary friction on future n8n major versions.

## [5.7.0] - 2026-07-09

### Fixed
- Closed a gap in the 5.6.6 integrity checks: installing via n8n's in-app "Install a community node" UI could still fail with a raw, opaque `ENOENT: no such file or directory, open '.../node_modules/axios/node_modules/form-data/lib/form_data.js'` and "The specified package could not be loaded", instead of the clear diagnostic 5.6.6 was meant to produce. Both 5.6.6 checks used `require.resolve(name)` on the five direct runtime dependencies (`axios`, `zod`, `libphonenumber-js`, `keyv`, `keyv-file`), but `require.resolve()` only verifies that a package's OWN entry file exists — it never executes the package, so it cannot detect corruption in that package's own transitive dependencies. `axios` internally `require`s `form-data` (a transitive dependency, not one of the five), so the same install-race truncation that #27 is about hit `form-data` under `axios` and slipped straight past a resolve-only check.
- Both `scripts/verify-install.js` (postinstall) and `nodes/shared/verifyNestedDependencies.ts` (load-time guard) now fully `require()` each of the five dependencies instead of merely resolving their paths. Requiring `axios` transitively requires and executes `form-data` (and the rest of each dependency's graph), so a missing or truncated nested file anywhere in those trees throws immediately and is folded into the same clear "nested dependency install is corrupted — reinstall this package's deps" message, rather than surfacing as an opaque `ENOENT`/`MODULE_NOT_FOUND` deep inside `node_modules`. Corruption is now caught anywhere under the five packages, not just in their five top-level entry files.

## [5.6.6] - 2026-07-09

### Added
- Two complementary integrity checks that convert the deep, opaque `MODULE_NOT_FOUND` from a corrupted nested-dependency install (`axios`, `zod`, `libphonenumber-js`, `keyv`, `keyv-file`) into a clear, actionable "nested dependency install is corrupted — reinstall this package's deps" message (#27):
  - `postinstall` integrity check (`scripts/verify-install.js`) resolves each runtime dependency at install time and fails the install immediately. Covers manual `npm`/`pnpm` installs of this package, CI, and Docker image bakes — any path where install scripts actually run.
  - Load-time guard (`nodes/shared/verifyNestedDependencies.ts`) imported first in all four package entry points (the three nodes and the credential). This covers the case the `postinstall` script cannot: n8n's own in-app "Install a community node" UI runs `npm install --ignore-scripts=true`, so `postinstall` never runs for that install path. Because n8n's loader requires the whole package in one try/catch, a corrupted dependency reached by any single entry file otherwise fails the entire package registration with an opaque error and an unrelated "Unrecognized node type". The guard runs before any import that could reach the corrupted dependency, so our clear diagnostic is what n8n logs. It does not catch corruption earlier than n8n's next load attempt for the `--ignore-scripts` path (there is no way to intercept mid-install when scripts are disabled) — it converts the opaque `MODULE_NOT_FOUND` at n8n startup into an immediate clear diagnostic at n8n startup.

## [5.6.5] - 2026-07-09

### Added
- Documented queue-mode / shared-volume nested-dependency corruption (`axios`, `zod`, `libphonenumber-js`) in README Troubleshooting section, with repair steps (#27)

## [5.6.4] - 2026-07-09

### Fixed
- AI Tools node could not resolve LangChain's `DynamicStructuredTool` or `zod` at execution time on pnpm-strict-isolated n8n installs (v2.29.x+) — `zod` is a production `dependency` here so there was no registration-time crash, but `ai-tools/runtime.ts` resolved both only via filesystem `require.resolve()` against `ANCHOR_CANDIDATES`, which cannot reach n8n's own module tree from a pnpm-isolated community-node location, so the deferred `Proxy` threw as soon as a connected AI tool ran. (#25)
- Added a positive n8n-owned-tree anchor (`requireFromCachedTree`) that finds an already-cached module belonging to `@n8n/n8n-nodes-langchain` — the only package trusted as an anchor for both `DynamicStructuredTool` and `zod`, since community nodes never bundle it and it's the exact package whose `normalizeToolSchema` performs the `instanceof ZodType` check — and resolves the dependency from that module's location. Ties the resolved copy to n8n's real dependency graph by package identity; no fallback to other cached packages (e.g. `n8n-workflow`, `@langchain/classic`) is used, since those can carry a different `zod`/`@langchain/core` version and would silently bake a wrong-identity schema into the tool with no later chance to correct it — resolution fails clean instead.
- `DynamicStructuredTool` now tries the n8n-owned-tree anchor *before* the filesystem anchor (not after) — if npm auto-installs this package's declared `@langchain/core` peerDependency as a private local copy, the filesystem anchor would otherwise resolve and memoize that copy first, a different class identity than n8n's own. The filesystem anchor also now rejects any match resolved through a pnpm virtual store (`.pnpm`) — under pnpm, `require.resolve()` dereferences straight to `.pnpm`'s content-addressable store, a path that never contains this package's own name even for its own isolated peer copy, so a plain name-based self-exclusion check couldn't catch it — as well as any match nested inside this package's own `node_modules` (non-pnpm managers).

## [5.6.3] - 2026-05-14

### Fixed
- `extractData` Smart URL Selection regression introduced in 5.6.2: `jsCode` + `delayBeforeReturnHtml` hardening was scoped to the seed crawl only, so the subsequent LLM URL-selection, explore mini-crawls, and final extraction crawls reverted to the unhardened config. On LiteSpeed/WP-Rocket sites every sub-page returned 1-char markdown, and every downstream extraction (`extractOrgName`, `extractAboutOrg`, `extractCustom`, `extractLocations`, `extractEmails` LLM annotation) received empty input and returned `null` or empty arrays even though the seed crawl looked successful.
- Hardening (`jsCode` + minimum 3 s `delayBeforeReturnHtml`) now applies to all crawls inside `executeSmartUrlCrawl` — every sub-page of a LiteSpeed/Yoast site exhibits the same pattern and needs the same fix.
- `waitUntil` `'commit'` → `'load'` rewrite remains seed-only via `hardenedSeedConfig` — Anti-Bot mode's `waitUntil: 'commit'` Cloudflare-redirect safeguard still reaches the actual target pages.

## [5.6.2] - 2026-05-14

### Fixed
- `extractData` Smart URL Selection: seed crawl now extracts content and links from sites that use deferred-JS plugins (LiteSpeed Cache "Delay JS Until Interaction", WP-Rocket Delay JavaScript Execution, Perfmatters Script Delay, Flying Scripts) and from sites that emit malformed nested `<noscript>` blocks (Yoast SEO + GTM combination). Previously these returned 1-char markdown and zero links, then surfaced as "Smart URL selection: no same-domain links found on seed page" regardless of Standard or Anti-Bot mode.
- Hardening is scoped to the seed crawl only — downstream URL-selection, explore, and final-target crawls keep the original config so Anti-Bot mode's `waitUntil: 'commit'` Cloudflare-redirect safeguard, and any user-provided `js_code`/`delay_before_return_html` settings, reach the actual target pages unchanged.
- Seed crawl `waitUntil` upgraded from `'commit'` to `'load'` so the DOM is fully parsed before link extraction runs.
- Seed crawl `delay_before_return_html` raised to at least 3 s so deferred-JS plugins have time to load and execute their scripts after our trigger.
- Seed crawl `js_code` now (1) calls `litespeed_load_delayed_js_force()` if present, (2) dispatches `mouseover`/`click`/`keydown`/`wheel`/`touchstart`/`scroll` on `window` to trigger any other delay-JS plugin's loader, (3) waits 1.5 s for scripts to mutate the DOM, (4) removes all `<noscript>` elements from the DOM before Crawl4AI captures the HTML — Yoast/GTM nested noscript otherwise tricks the server-side lxml parser into swallowing the entire `<body>`.

## [5.6.1] - 2026-05-03

### Fixed
- `extractData` Auto mode: domain now cached as `antiBotCloudflare` immediately on blocking detection (standard crawl fail), not only after a successful Anti-Bot crawl — ensures subsequent runs skip the wasted standard attempt even if the first Anti-Bot attempt also fails
- `extractData` Auto mode: added random 20–30 s delay between blocking detection and Anti-Bot retry to reduce fingerprinting pressure
- `extractData` Anti-Bot mode: changed `waitUntil` from `'load'` to `'commit'` — Cloudflare redirect chains (e.g. `/` → 301 → `/Home`) trigger a Playwright CDP race where `load`/`domcontentloaded` events are missed entirely, causing indefinite 110 s hangs; `commit` fires on first response bytes and is unaffected
- `extractData` Auto mode: when Anti-Bot also fails, detection-time cache entry is now deleted so the domain is not permanently locked into Anti-Bot mode on subsequent runs

## [5.6.0] - 2026-05-03

### Added
- `extractData`: new **Auto** option for Crawl Mode — tries Standard first and automatically retries with Anti-Bot on failure
- Per-domain mode cache (file-backed via `keyv` + `keyv-file`) stores successful Anti-Bot decisions; future runs for the same domain skip straight to Anti-Bot
- Hostname normalisation — `example.com` and `www.example.com` share a single cache entry, so toggling between bare and www-prefixed URLs reuses the same cached decision
- Redirect-aware caching — when the server redirects (e.g. `example.com` → `www.example.com`), both the requested and final hostnames are stored under the normalised key so either form hits the cache on subsequent runs
- Cache values use a versioned schema (`schemaVersion`, `nodePackageVersion`, `mode`) so future shape changes can invalidate stale entries safely without losing cache state on every package upgrade
- Credentials: `Auto Crawl: Cache File Path` (default `~/.n8n/crawl4ai-mode-cache.json`) and `Auto Crawl: Cache TTL (Days)` (default 30) fields

### Dependencies
- Added `keyv` and `keyv-file` as runtime dependencies

### Fixed
- Anti-Bot mode description in `extractData` Crawl Mode dropdown corrected from "120 s timeout" to "110 s timeout" (matches actual `pageTimeout` value)

## [5.5.0] - 2026-05-03

### Added
- **Undetected browser type** — all Simple node operations and Advanced node now expose `Undetected (Anti-Bot)` as a Browser Type option. Uses Crawl4AI's `UndetectedAdapter` with deep browser patches to bypass Cloudflare Bot Management, DataDome, and PerimeterX.
- **Headless Mode toggle** — all Simple node operations now expose a `Headless Mode` boolean option (default: true). Setting it to false runs the browser visibly, which is significantly harder for bot-detection fingerprinting to identify as automation.
- **Granular anti-bot options** (Simple node — Get Page Content, Ask Question, CSS Extractor): Added Enable Stealth Mode, Magic Mode, Simulate User, Override Navigator, and Page Timeout options alongside the existing Bypass Bot Detection shortcut.
- **extractData Anti-Bot mode** — new `Crawl Mode` option replaces the full Options collection on Extract Data. `Standard` mode uses 60 s timeout + simulate user. `Anti-Bot (Cloudflare)` mode activates patchright channel, stealth, magic mode, headless off, 110 s timeout, `wait_until: load`, and consent popup removal in a single toggle.
- **Chrome Channel field** (Advanced node — Browser & Session collection): New `Chrome Channel` dropdown exposes `patchright` as a selectable option for all 15 Advanced node operations.

### Fixed
- **Bypass Bot Detection now activates patchright** — all Simple node operations with `stealthMode` now also set `chrome_channel: patchright` and raise `page_timeout` to 110 s. Previously stealth/magic mode was enabled but the browser fingerprint remained detectable by Cloudflare without patchright.
- **Anti-Bot timeout set below axios wall** — `page_timeout` capped at 110 s (under axios's 120 s connection timeout) so Crawl4AI server returns a clean error instead of the request being cut by the HTTP client.

## [5.4.1] - 2026-05-03

### Fixed
- All nodes: URLs without a protocol (e.g. `www.example.com`) are now automatically normalized to `https://` instead of throwing a validation error.

## [5.4.0] - 2026-05-02

### Added

- **extractData / locations primary/additional split** — locations output restructured from a flat array to `{ primary: [], additional: [] }`. LLM classifies each location with `isPrimary` (HQ/head office = primary; branches, campuses, showrooms = additional). A single location found is always treated as primary regardless of LLM output.
- **extractData / location additionalNotes enriched** — when multiple locations exist, LLM now adds a brief distinguishing note per location (e.g. "City campus; main suburban campus is in Chadstone").
- **extractData / parallel LLM calls** — org name, about org, email annotation, locations, and custom extractions now fire in parallel via `Promise.all`, reducing wall time for multi-extraction runs to the duration of the slowest single call.
- **extractData / per-page text budget** — replaced hardcoded 20 k/15 k char truncation with a 60 k-char budget distributed evenly across all crawled pages. Multi-page crawls now include every page in combined-text calls instead of silently dropping pages beyond the first ~3.

### Fixed

- **Smart URL selection — www-redirect** — `extractLinksFromSeedResult` now accepts links from `result.redirected_url` hostname plus the www↔non-www variant of the seed hostname. Sites that redirect `example.com` → `www.example.com` no longer fail with "no same-domain links found".
- **Smart URL selection — verbose error** — "no same-domain links found" error now includes input vs actual hostname, internal/external link counts, markdown length, and a context-specific hint (redirect detected / JS rendering needed / bot detection suspected).
- **Smart URL selection — seed redirect captured in output** — `_smartUrlSelection` block now includes `seedRedirectedUrl` when the seed URL redirected. Top-level `url` field uses the seed URL (user's input); `redirectedUrl` reflects the final destination.
- **extractData output — canonical URL with Smart URL selection** — `url` in output now always reflects the user's input URL (seed), not the first result URL from the LLM-selected page set.
- **extractData output — statusCode paired with seed URL** — when Smart URL selection is active, `statusCode` now reflects the seed crawl's HTTP status (kept paired with the reported `url`), falling back to the first result's status code if seed status is unavailable.

## [5.3.0] - 2026-05-02

### Changed

- **extractData** — replaced `extractionType` picklist with six independent boolean toggles: Official Org Name, Phone Numbers, Email Addresses, Locations, About Organisation, and Custom (LLM). Multiple types can be selected simultaneously; results are combined in one output object.
- **extractData emails** — email addresses now return as `[{email, suggestedName?}]` objects instead of a flat string array. When LLM credentials are configured, each email is annotated with the associated person name or office label.
- **extractData locations** — enabling Locations now always includes global phone numbers and email addresses alongside per-location contact details.

### Added

- **extractData / About Organisation** — new boolean toggle generates a concise ≤60-word organisation description using LLM. Pre-canned prompt uses plain Australian English; fully editable.
- **extractData / Official Org Name** — new boolean toggle extracts the official registered or trading name with a confidence rating.
- **extractData / Custom (LLM)** — simplified custom LLM extraction: provide a field name and a prompt; result is stored at `data[fieldName]`.

### Removed

- **extractData / Financial Data** extraction type removed.
- **extractData / LLM Validation** option removed (contact validation now absorbed into email name suggestion).
- **extractData / Include Location Details** option removed (selecting Locations now always includes per-location and global contacts).
- **extractData / Include Phones** option removed (phones always included when Locations is enabled).

## [5.2.0] - 2026-05-01

### Added
- **URL denylist filtering** (Get Page Content — Follow Links/Full Site scope): New "Denylist Paths" option blocks specified paths or URL patterns from being crawled in multi-page modes. Supports exact paths and `*` wildcards; one entry per line.
- **URL denylist filtering** (Crawl Multiple URLs — Discover and Manual modes): "Denylist Paths" option added to Discovery Strategy collection. In discover mode the denylist is enforced server-side via the FilterChain's URLPatternFilter. In manual mode, URLs are filtered client-side before the API call; blocked URLs are reported in `_safetyFilter` on the first output item.
- **Suspicious URL detection** (Discover Links): New "Flag Suspicious URLs" option (with companion "Suspicious URL Patterns" field) annotates output links with `suspicious: true/false` and `suspicionReason` when a link matches a user-defined pattern. Available in both split and grouped output formats; `suspiciousCount` summary added to grouped output.
- **Smart URL Selection** (Extract Data operation): New opt-in toggle that uses LLM to pre-select the most relevant pages before crawling. Crawls the seed page first, extracts all same-domain links, then asks the LLM to pick direct URLs and explore-hint sections. Explore hints trigger targeted mini-crawls to discover deeper candidate pages. Results are capped at Max Pages. Feature is hidden for Single Page scope and requires LLM credentials when enabled on Contact Info or Financial Data extraction types. Adds `_smartUrlSelection` metadata block to output showing seed URL, candidates found, LLM picks, final URLs crawled, and any warnings.
- **Explore Depth** option: Controls how many levels deep explore-hint sections are crawled (1-3, default 1).
- **Include Location Details** (Extract Data — Contact Info): New opt-in toggle that runs the location extraction pipeline on the same crawl results. When enabled, `data` becomes `{ emails[], locations[] }` where each location record has name, full address, per-location phone, and any location-specific emails found in the same contact block. Site-wide emails remain in the top-level `emails` array.
- **Per-location emails** in location extraction LLM schema: LLM now extracts `emails` found adjacent to each address (same contact block). Applied to both the standalone Locations & Addresses extraction type and the new Include Location Details mode.

### Changed
- **Extract Data UI**: Max Pages, Include Phones, LLM Validation, and Smart URL Selection promoted from Options collection to always-visible main UI.

### Fixed
- **Location extraction grounding check**: Replaced exact-substring match with a token-window sliding scan. LLM snippets with framing prose ("Our address is … Australia") or markdown formatting (`**bold**`) no longer fail grounding. Any consecutive run of ≥60% of snippet tokens (≥20 chars) present in the source counts as grounded, while genuinely hallucinated content still fails.
- **Include Location Details output**: `phones[]` was silently dropped when `includeLocationDetails` was enabled. Output is now `{ emails[], phones[], locations[] }` in full parity with the non-location-details branch.
- **Location name suffix**: LLM now constrained to generic suffixes (Office, Location, Branch) when deriving names from city/suburb — prevents industry-specific terms such as "Facility" or "Site" appearing in derived names.
- **Max Pages boundary**: Fixed `maxPages || undefined` coercing an explicit `0` to the default 10; changed to `maxPages ?? undefined`.

## 5.1.5 (2026-05-01)

### Fixed
- `extractData` Locations & Addresses: LLM few-shot example for "no phone found" case now omits the phone field entirely — previously used `"(not stated)"` as the value, teaching the model to output that literal string
- `extractData` Contact Info: LLM validation notice now clearly states the feature is optional (only needed when LLM Validation option is enabled)
- `cssExtractor`: renamed internal variable `items_extracted` to camelCase `itemsExtracted`; fixed 4-space/tab indentation inconsistency in location helper functions
- All four simple node operations (`Get Page Content`, `Ask Question`, `Extract Data`, `Extract with CSS Selectors`): `metrics.cacheStatus` replaced by `metrics.cacheHits` / `metrics.cacheMisses` — aggregated across all crawled pages; only explicit `hit`/`miss` statuses counted (bypass/disabled modes no longer misclassified as misses)
- All four simple node operations: `statusCode` field added to output (HTTP status of the primary URL); previously absent from all simple node outputs despite being present in the advanced node

### Added
- All four simple node operations (`Get Page Content`, `Ask Question`, `Extract Data`, `Extract with CSS Selectors`) now expose **Avoid Ads** and **Avoid CSS** options (Crawl4AI v0.8.5 `CrawlerRunConfig` params) — block ad-related and CSS network requests during crawl for faster, cleaner text extraction
- All four simple node operations now expose **Wait Until** (networkidle / load / domcontentloaded / commit) and **Delay Before Return (Ms)** options for reliable scraping of AJAX-rendered and JS-heavy sites

## 5.1.4 (2026-04-30)

### Changed
- **Crawl4AI v0.8.5 compatibility**: `BestFirstCrawlStrategy` renamed to `BestFirstCrawlingStrategy` — Crawl4AI 0.8.5 introduced a deserialization allowlist (security fix for RCE vector); the old name is now explicitly rejected; this fix applies to both the Simple node locations extraction and the Advanced node deep crawl strategy picker
- **New options (Advanced node Crawl Settings)**: `Avoid Ads` and `Avoid CSS` — new `CrawlerRunConfig` params introduced in v0.8.5 to block ad-related and CSS network requests during crawl; improves speed and reduces noise for text-only extraction use cases
- Package description updated to reference Crawl4AI v0.8.5

### Fixed
- `extractData` Locations & Addresses: structured address output — `address` field replaced with `address1` (street number + name), `address2` (unit/level/floor/suite), `city`, `state`, `postcode`, `country`, and `additionalNotes`; JSON-LD extraction splits `streetAddress` into `address1`/`address2` automatically; LLM schema and instruction updated with examples using new fields
- `extractData` Locations & Addresses: multi-page crawls now use `BestFirstCrawlStrategy` with `KeywordRelevanceScorer` instead of `BFSDeepCrawlStrategy` — Crawl4AI ranks and prioritises location-relevant pages during the crawl itself using 44 expanded location keywords; eliminates the need for post-crawl page scoring
- `extractData` Locations & Addresses: location keyword list expanded to 44 terms covering branch types, address components, and find-us phrases (`stockist`, `distributor`, `pharmacy`, `showroom`, `warehouse`, `impressum`, `imprint`, `find us`, `get in touch`, `where to buy`, `zip code`, etc.)
- `extractData` Locations & Addresses: duplicate location deduplication using Union-Find fingerprinting — addresses referring to the same building (e.g. "Level 2/343 Lt Collins St", "Level 2, Suites 214/215, 343 Little Collins Street", "Level 2, 343 Little Collins Street") now collapse to a single best-quality result; fingerprint uses postcode + street number as primary key, city + street number as secondary, with transitivity so partial addresses (no postcode) still merge with full entries sharing the same city and street number; when merging, highest-confidence json-ld entry wins, phone numbers are inherited from any group member

## 5.1.3 (2026-04-30)

### Fixed
- `extractData` Locations & Addresses: three-layer extraction pipeline — JSON-LD/schema.org structured data extracted first (zero LLM cost, deterministic) from `LocalBusiness`, `Organization`, `Place`, and nested `PostalAddress` schema types; LLM extraction runs per-page as fallback/supplement on location-relevant pages only; results merged with JSON-LD winning on conflict
- `extractData` Locations & Addresses: smart page scoring selects which pages to send to LLM — URL keywords (`contact`, `locations`, `where-to-buy`, `offices`, `worldwide`, `impressum`, etc.) and content keywords (`street`, `branch`, `postcode`, etc.) rank pages by location likelihood; top 8 sent, up to 5 more in fallback pass — eliminates empty results when 2 relevant pages are diluted among 30 product pages
- `extractData` Locations & Addresses: LLM instruction includes source page URL as context (e.g. "where-to-buy" pages now correctly yield distributor addresses) plus two few-shot examples and a confidence rubric for higher extraction accuracy
- `extractData` Locations & Addresses: `sourceSnippet` field added to LLM schema — each extracted location must provide the verbatim text it was drawn from; snippet is verified against page content to catch and discard hallucinated addresses; locations with no snippet are rejected outright
- `extractData` Locations & Addresses: address canonicalization before dedup expands abbreviations (`St`→`Street`, `Rd`→`Road`, `Ave`→`Avenue`, etc.) so variants of the same address are correctly merged; `confidence` and `source` (`json-ld` or `llm`) fields now included in each location result
- `extractData` Locations & Addresses: JSON-LD walker now traverses `hasPOS`/`location`/`containsPlace` as both arrays and single objects (schema.org emits both); top-level array-form JSON-LD script blocks are now correctly unwrapped before processing
- **Note:** this approach makes up to 8+5 LLM calls per operation on multi-page crawls (one per relevant page). Expect higher LLM usage vs. the previous single-blob approach, in exchange for substantially better recall and no hallucinations

## 5.1.2 (2026-04-30)

### Fixed
- LiteLLM/custom provider now auto-prefixes `openai/` when Base URL is set, matching OpenAI-compatible proxy protocol
- `llmExtractor` now surfaces LLM errors instead of silently returning error JSON as data
- Credentials "Custom Provider" field renamed to "Model ID" with description clarifying that Crawl4AI's LiteLLM SDK strips provider prefixes before calling the proxy
- `askQuestion` answer field no longer returns LLM fallback message when later page chunks found the answer
- `metrics.crawlTime` now populated — was always null because `server_processing_time_s` lives on the API response wrapper, not per-result; now promoted onto each result before returning
- `metrics` no longer emits null-valued keys
- New fields surfaced across all nodes: `metrics.cacheStatus`, `metrics.memoryDeltaMb`, `metrics.peakMemoryMb`, `redirectedUrl` (conditional), `jsExecutionResult` (conditional), `downloadedFiles` (conditional)
- `extractData` Contact Info: replaced phone regex with `libphonenumber-js` for accurate detection and E.164 deduplication; removed social media (noise); removed address detection (now handled by Locations & Addresses type); Default Country Code option (default AU) for local number parsing; optional LLM Validation pass to clean false positives using the configured LLM
- `extractData` Locations & Addresses: new LLM-based extraction type that identifies all physical locations (offices, branches, stores) with unique names, full addresses, city, country, and optional per-location phone numbers; deduplicates across multi-page crawls by normalised address
- Crawl Scope tooltips (Follow Links / Full Site) now explicitly state that only same-domain pages are crawled; external links are always excluded
- URL validation now fails fast at node level for empty, malformed, or non-http/https URLs (e.g. `thttps://`) with a clear error message before any crawl is attempted; applies to all four simple node operations
- Failed crawl results now include `errorMessage` from Crawl4AI in all simple node operations (`getPageContent`, `askQuestion`, `extractData`, `cssExtractor`)
- `errorMessage` on failure is now cleaned of Python tracebacks, code context blocks, and Playwright call logs — only the meaningful error reason is shown
- All four simple node operations now have a **Bypass Bot Detection** option (Options → Bypass Bot Detection) that enables all four Crawl4AI anti-bot flags (`enable_stealth`, `magic`, `simulate_user`, `override_navigator`); use when a site returns 403 or blocks headless Chrome
- All four simple node operations now have a **Browser Type** option (Options → Browser Type) to switch between Chromium, Firefox, and WebKit; Firefox has a different TLS fingerprint to Chromium and bypasses bot-detection systems that block headless Chrome
- All four simple node operations now have a **Browser Profile** option (Options → Browser Profile) with 10 real-browser presets (Chrome Windows/macOS/Android/Linux, Edge Windows, Firefox Windows/macOS, Safari macOS/iOS, Googlebot) plus a Custom option that reveals a `Key: Value` textarea; Advanced node gains the same picker in Browser & Session; profile headers are merged with any explicit headers (explicit values override profile)

## 5.1.1 (2026-04-30)

### Fixed
- LLM operations crash with HTTP 500: `LLMConfig` rejects `api_base` — correct field is `base_url`. Affected `askQuestion`, `extractData`, `llmExtractor`, and LLM-backed extraction when using Ollama or custom provider.

## 5.1.0

See git history.
