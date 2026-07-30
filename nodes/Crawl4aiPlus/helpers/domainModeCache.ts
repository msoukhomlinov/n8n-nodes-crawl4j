import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KeyvFile } from 'keyv-file';

// Bump SCHEMA_VERSION when the shape of DomainCacheSchema changes in a
// non-backward-compatible way. Entries with a different schemaVersion are
// treated as cache misses, forcing a fresh Standard attempt.
const SCHEMA_VERSION = 1 as const;

// Read the package version once at module load. Stored alongside cache
// entries for diagnostic purposes ONLY — it does NOT invalidate entries.
// Allows operators to spot stale entries written by older node versions
// when inspecting the cache file.
// Runtime path: dist/nodes/Crawl4aiPlus/helpers/ → ../../../../ = package root.
// fs.readFileSync used instead of a static import to avoid the dist-path mismatch
// that a relative require('../../../package.json') would cause at runtime.
let NODE_PACKAGE_VERSION = 'unknown';
try {
	const raw = fs.readFileSync(path.join(__dirname, '../../../../package.json'), 'utf8');
	NODE_PACKAGE_VERSION = (JSON.parse(raw) as { version: string }).version;
} catch {
	// informational only — ignore if not resolvable
}

export interface DomainCacheSchema {
	schemaVersion: typeof SCHEMA_VERSION;
	nodePackageVersion: string;
	mode: 'antiBotCloudflare';
}

const DEFAULT_CACHE_PATH = path.join(os.homedir(), '.n8n', 'crawl4ai-mode-cache.json');

function resolvePath(configuredPath: string): string {
	if (!configuredPath || !configuredPath.trim()) return DEFAULT_CACHE_PATH;
	// Accept both forward-slash (Unix/placeholder) and backslash (Windows) after ~
	return configuredPath.trim().replace(/^~(?=[/\\]|$)/, os.homedir());
}

// Singleton KeyvFile instances keyed by resolved file path.
// KeyvFile reads the cache file synchronously in its constructor and keeps
// its own in-memory Map; multiple instances against the same file would each
// load the file at construction time and could see stale views of each other's
// writes. One instance per path avoids both the redundant disk read and
// inconsistent in-memory state.
// Used directly (not wrapped in a `keyv` Keyv instance) — KeyvFile already
// implements get/set/delete with native TTL support. The removed `keyv`
// wrapper was previously constructed fresh on every call and registered an
// `error` listener on this singleton each time, leaking one listener per
// cache operation for the life of the process. See #32.
const storeInstances = new Map<string, KeyvFile>();

function getStore(configuredPath: string): KeyvFile {
	const filePath = resolvePath(configuredPath);
	if (!storeInstances.has(filePath)) {
		const store = new KeyvFile({ filename: filePath });
		// KeyvFile is an EventEmitter (implements keyv's KeyvStoreAdapter interface),
		// which conventionally emits 'error' for background I/O failures. Node
		// terminates the process on an 'error' event with zero listeners, which
		// would defeat every try/catch in this file's "never break a crawl"
		// contract — attach a no-op listener so any future emission is swallowed
		// instead of crashing, matching this module's existing best-effort design.
		store.on('error', () => {});
		storeInstances.set(filePath, store);
	}
	return storeInstances.get(filePath)!;
}

// Strip leading www. so example.com and www.example.com share one cache entry.
export function normalizeHostname(hostname: string): string {
	return hostname.replace(/^www\./, '');
}

export async function getCachedMode(
	configuredPath: string,
	domain: string,
): Promise<'antiBotCloudflare' | null> {
	try {
		const store = getStore(configuredPath);
		const entry = await store.get<DomainCacheSchema>(normalizeHostname(domain));
		if (!entry) return null;
		// Forward-compatibility guard: treat unknown schema versions as cache miss.
		// nodePackageVersion is informational only — never used to invalidate.
		if (entry.schemaVersion !== SCHEMA_VERSION) return null;
		return entry.mode;
	} catch {
		return null;
	}
}

/**
 * Remove cached mode for one or more domains.
 * Called when Anti-Bot mode itself fails so the domain does not get permanently
 * locked into Anti-Bot on every subsequent run.
 */
export async function deleteCachedMode(
	configuredPath: string,
	domains: string | string[],
): Promise<void> {
	try {
		const store = getStore(configuredPath);
		const normalizedDomains = [
			...new Set((Array.isArray(domains) ? domains : [domains]).map(normalizeHostname)),
		];
		await Promise.all(normalizedDomains.map((d) => store.delete(d)));
	} catch {
		// Best-effort — a cache delete failure must never break a crawl
	}
}

/**
 * Store the crawl mode for one or more domains (pass both requested + redirected
 * FQDNs after a redirect so either hostname hits the cache next time).
 * All hostnames are www-normalised before storage.
 * keyv-file calls clearExpire() on every set(), so explicit post-write purge
 * is not needed — TTL cleanup is handled natively.
 */
export async function setCachedMode(
	configuredPath: string,
	domains: string | string[],
	mode: 'antiBotCloudflare',
	ttlDays: number,
): Promise<void> {
	try {
		const store = getStore(configuredPath);
		const value: DomainCacheSchema = {
			schemaVersion: SCHEMA_VERSION,
			nodePackageVersion: NODE_PACKAGE_VERSION,
			mode,
		};
		const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
		const normalizedDomains = [
			...new Set((Array.isArray(domains) ? domains : [domains]).map(normalizeHostname)),
		];
		await Promise.all(normalizedDomains.map((d) => store.set(d, value, ttlMs)));
	} catch {
		// Best-effort — a cache write failure must never break a crawl
	}
}
