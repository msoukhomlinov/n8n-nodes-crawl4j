declare const require: {
	resolve(id: string): string;
	(id: string): unknown;
};

/**
 * Load-time nested-dependency integrity guard.
 *
 * This module has no exports — its entire job is a side-effecting check that
 * runs once at module-evaluation time. Node caches require()/import results, so
 * importing it from all four of this package's n8n entry points (the three
 * `*.node.ts` files and the credential file) only actually executes the check
 * on whichever n8n happens to load first.
 *
 * WHY THIS EXISTS (and why the postinstall script is not enough): n8n's in-app
 * "Install a community node" UI runs `npm install --ignore-scripts=true`, so
 * this package's `postinstall` (scripts/verify-install.js) NEVER runs for that
 * install path — the exact path issue #27 is about. n8n's loader also requires
 * the whole package in one try/catch: if requiring ANY single declared node or
 * credential file throws (because it, or anything it transitively imports, hits
 * a corrupted `zod`/`libphonenumber-js`), the ENTIRE package fails to
 * register and an unrelated node type shows as "Unrecognized node type" with a
 * deep, opaque `MODULE_NOT_FOUND` as the only clue.
 *
 * Importing this module FIRST in every entry file guarantees our clear
 * diagnostic fires before any import that could transitively reach the
 * corrupted dependency — converting that opaque failure into an actionable
 * message in n8n's own startup logs. (With `module: "commonjs"`, tsc emits the
 * import as the first `require()` call in the compiled file, preserving order.)
 *
 * This does NOT catch corruption earlier than n8n's next load attempt for the
 * `--ignore-scripts` path — there is no way to intercept mid-install when
 * scripts are disabled. It simply makes the failure diagnosable directly from
 * n8n's logs, immediately, instead of leaving a raw stack trace.
 *
 * Note: `axios` was itself removed as a dependency of this package (v5.8.0) —
 * it dragged in the deepest, highest-risk transitive chain (`form-data`,
 * `follow-redirects`, `proxy-from-env`), which was the original trigger of
 * issue #27. HTTP now goes through n8n's own `this.helpers.httpRequest`, which
 * ships with every n8n install and needs no nested copy under this package, so
 * the deepest part of this corruption vector is gone at the source.
 *
 * Note: `keyv` was itself removed as a dependency of this package (v5.9.0) —
 * `domainModeCache.ts` now uses `keyv-file` directly instead of wrapping it in
 * a `keyv` instance (`KeyvFile` already has native get/set/delete/TTL
 * support). This also removes a keyv major-version split (v4 vs. v5) against
 * other packages sharing this tree (#32).
 *
 * The check fully `require()`s each remaining dependency (not just
 * `require.resolve()`s its path) on purpose: `require.resolve()` confirms only
 * that a package's own entry file exists, without executing it, so it cannot see
 * corruption in that package's OWN transitive dependencies. Fully requiring each
 * dep pulls in its whole graph, so a truncated nested file anywhere under one of
 * these three packages (not just the three entry files) is caught here too. The
 * remaining three deps have shallower trees than axios did, but the mechanism is
 * kept unchanged as defense in depth — it costs nothing extra and catches at
 * least as much as `require.resolve()` would.
 */
const REQUIRED_DEPENDENCIES = ['zod', 'libphonenumber-js', 'keyv-file'] as const;

const missing: string[] = [];

for (const name of REQUIRED_DEPENDENCIES) {
	try {
		require(name);
	} catch {
		// require() throws when the dependency — or anything in its own transitive
		// dependency graph — is missing or its entry-point file is truncated.
		// Collect it for one clear message.
		missing.push(name);
	}
}

if (missing.length > 0) {
	throw new Error(
		'n8n-nodes-crawl4ai-plus: nested dependency install is corrupted or incomplete. ' +
			`These runtime dependencies could not be resolved: ${missing.join(', ')}. ` +
			'This usually means the nested dependency install was left truncated (the ' +
			'package directory exists but its entry-point file is missing) — a known ' +
			'failure mode of n8n queue-mode / shared-volume installs, where multiple ' +
			'worker processes race during npm extraction into one shared `.n8n/nodes` ' +
			'volume (issue #27). To repair, reinstall the affected dependencies scoped ' +
			"to this package's own directory (inside the container/volume where n8n " +
			'resolves community nodes from): ' +
			`\`cd <path-to-this-package> && npm install --no-save --legacy-peer-deps ${missing.join(' ')}\`, ` +
			'then restart n8n. See the "Troubleshooting" section of this package README, ' +
			'or issue #27 (https://github.com/msoukhomlinov/n8n-nodes-crawl4ai-plus/issues/27), ' +
			'for details.',
	);
}

export {};
