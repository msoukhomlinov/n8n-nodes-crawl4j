#!/usr/bin/env node
'use strict';

/*
 * Post-install integrity check for n8n-nodes-crawl4ai-plus.
 *
 * In n8n queue mode, multiple worker processes can share a single `.n8n/nodes`
 * volume. The npm install into that shared directory can race, leaving one of
 * this package's nested runtime dependencies truncated — the package directory
 * exists but its entry-point file is missing. That corruption otherwise stays
 * hidden until n8n later tries to load this package, surfacing as an opaque,
 * deep `Cannot find module '.../node_modules/.../<entry>.js'` and a confusing
 * `Unrecognized node type` error.
 *
 * Note: `axios` was itself removed as a dependency of this package (v5.8.0) — it
 * dragged in the deepest, highest-risk transitive chain (form-data,
 * follow-redirects, proxy-from-env), which was the original trigger of issue
 * #27. HTTP now goes through n8n's own this.helpers.httpRequest, which ships
 * with every n8n install and needs no nested copy under this package, so the
 * deepest part of this corruption vector is gone at the source.
 *
 * Note: `keyv` was itself removed as a dependency of this package (v5.9.0) —
 * `domainModeCache.js` now uses `keyv-file` directly instead of wrapping it in
 * a `keyv` instance, removing a keyv major-version split (v4 vs. v5) against
 * other packages sharing this tree (#32).
 *
 * This script fully loads (require()s, not just resolves) each remaining runtime
 * dependency immediately at install time, so the failure is caught early with a
 * clear, actionable message rather than deferred to n8n startup. Requiring —
 * rather than only resolving — matters because `require.resolve()` verifies only
 * that a module's own entry file exists; it never executes the module, so it
 * cannot detect corruption in that module's OWN transitive dependencies. Fully
 * requiring each dep pulls in its whole graph, so a truncated nested file
 * anywhere under one of these three packages throws here and is caught, not just
 * corruption of the three entry files. The remaining three deps have shallower
 * trees than axios did, but the mechanism is kept unchanged as defense in depth.
 *
 * Plain CommonJS with no build step and no dependency on `dist/` or any
 * devDependency — it must run from a freshly-extracted npm tarball via
 * `node scripts/verify-install.js`.
 */

var REQUIRED_DEPENDENCIES = ['zod', 'libphonenumber-js', 'keyv-file'];

var failed = [];

for (var i = 0; i < REQUIRED_DEPENDENCIES.length; i++) {
	var name = REQUIRED_DEPENDENCIES[i];
	try {
		require(name);
	} catch (err) {
		// require() throws when the dependency (or anything in its own transitive
		// dependency graph) is missing or has a truncated entry file. Catch it here
		// so this script never crashes with a raw stack trace — fold it into the
		// single clear message printed below.
		failed.push(name);
	}
}

if (failed.length === 0) {
	// All dependencies present — stay silent so normal installs add no noise.
	process.exit(0);
}

var repairCommand =
	'cd ' + __dirname.replace(/[\\/]scripts$/, '') +
	' && npm install --no-save --legacy-peer-deps ' +
	failed.join(' ');

var lines = [
	'',
	'n8n-nodes-crawl4ai-plus: nested dependency install is corrupted or incomplete.',
	'',
	'These runtime dependencies could not be resolved:',
	'  - ' + failed.join('\n  - '),
	'',
	'This usually means the nested dependency install was left truncated (the',
	'package directory exists but its entry-point file is missing). It is a known',
	'failure mode of n8n queue-mode / shared-volume installs, where multiple worker',
	'processes race during npm extraction into a single shared `.n8n/nodes` volume.',
	'',
	'To repair, reinstall the affected dependencies scoped to this package:',
	'',
	'  ' + repairCommand,
	'',
	'See the "Troubleshooting" section of this package README, or issue #27',
	'(https://github.com/msoukhomlinov/n8n-nodes-crawl4ai-plus/issues/27), for details.',
	'',
];

process.stderr.write(lines.join('\n') + '\n');
process.exit(1);
