import { IDataObject } from 'n8n-workflow';

// Credentials interface
export interface Crawl4aiApiCredentials {
	// Docker REST API settings
	dockerUrl?: string;
	authenticationType?: 'none' | 'token' | 'basic';
	apiToken?: string;
	username?: string;
	password?: string;
	// LLM settings
	enableLlm?: boolean;
	llmProvider?: string;
	llmModel?: string;
	apiKey?: string;
	ollamaUrl?: string;
	ollamaModel?: string;
	customProvider?: string;
	customBaseUrl?: string;
	customApiKey?: string;
	// Auto Crawl Mode cache settings
	autoCacheFilePath?: string;
	autoCacheTtlDays?: number;
}

// Node options interface
export interface Crawl4aiNodeOptions extends IDataObject {
	bypassCache?: boolean;
	includeMedia?: boolean;
	verboseResponse?: boolean;
	cacheMode?: 'ENABLED' | 'BYPASS' | 'DISABLED' | 'READ_ONLY' | 'WRITE_ONLY';
}

// Browser configuration interface
// Fields use snake_case because they map directly to the Crawl4AI API's snake_case format,
// minimizing conversion needed in formatBrowserConfig().
// Only fields that are set by createBrowserConfig() or read by formatBrowserConfig() are included.
export interface BrowserConfig {
	headless?: boolean;
	use_persistent_context?: boolean;
	user_data_dir?: string;
	proxy_config?: object;
	viewport?: {
		width: number;
		height: number;
	};
	storage_state?: string | object;
	ignore_https_errors?: boolean;
	java_script_enabled?: boolean;
	cookies?: Array<object>;
	headers?: object;
	user_agent?: string;
	text_mode?: boolean;
	light_mode?: boolean;
	extra_args?: Array<string>;
	enable_stealth?: boolean;
	chrome_channel?: string;
	init_scripts?: string[];
}

// ── Strategy types for the Crawl4AI REST API ──────────────────────────────────
// Each strategy is sent as `{ type: "<StrategyName>", params: { ... } }`.
// The `params` values vary per strategy type, so we type them as Record<string, unknown>
// to catch structural mistakes (missing type/params) without over-constraining the payloads
// that the REST API may evolve.

/** Base shape shared by every Crawl4AI strategy object. */
export interface StrategyConfig {
	type: string;
	params: Record<string, unknown>;
}

/** Extraction strategies accepted by CrawlerRunConfig.extractionStrategy */
export interface LlmExtractionStrategy extends StrategyConfig { type: 'LLMExtractionStrategy' }
export interface JsonCssExtractionStrategy extends StrategyConfig { type: 'JsonCssExtractionStrategy' }
export interface JsonXPathExtractionStrategy extends StrategyConfig { type: 'JsonXPathExtractionStrategy' }
export interface RegexExtractionStrategy extends StrategyConfig { type: 'RegexExtractionStrategy' }
export interface CosineExtractionStrategy extends StrategyConfig { type: 'CosineStrategy' }

export type ExtractionStrategy =
	| LlmExtractionStrategy
	| JsonCssExtractionStrategy
	| JsonXPathExtractionStrategy
	| RegexExtractionStrategy
	| CosineExtractionStrategy;

/** Content filters used inside MarkdownGeneratorConfig.params.content_filter */
export interface ContentFilterConfig extends StrategyConfig {
	type: 'PruningContentFilter' | 'BM25ContentFilter' | 'LLMContentFilter';
}

/** Markdown generator config — always DefaultMarkdownGenerator with optional content_filter */
export interface MarkdownGeneratorConfig extends StrategyConfig {
	type: 'DefaultMarkdownGenerator';
}

/** Table extraction strategies */
export interface LlmTableExtractionConfig extends StrategyConfig { type: 'LLMTableExtraction' }
export interface DefaultTableExtractionConfig extends StrategyConfig { type: 'DefaultTableExtraction' }

export type TableExtractionStrategy =
	| LlmTableExtractionConfig
	| DefaultTableExtractionConfig;

/** Deep crawl strategies — type string comes from user input, so kept as StrategyConfig */
export type DeepCrawlStrategy = StrategyConfig;

// Crawler run configuration interface
// Fields use camelCase following TypeScript convention; formatCrawlerConfig() in apiClient.ts
// handles the conversion to the API's snake_case format.
// Only fields that are set by createCrawlerRunConfig() or read by formatCrawlerConfig() are included.
export interface CrawlerRunConfig {
	// Cache and Performance
	cacheMode?: 'ENABLED' | 'BYPASS' | 'DISABLED' | 'READ_ONLY' | 'WRITE_ONLY';
	streamEnabled?: boolean;

	// Timing and Timeouts
	pageTimeout?: number;
	requestTimeout?: number;
	waitUntil?: string;
	waitFor?: string;
	delayBeforeReturnHtml?: number;

	// JavaScript and Page Interaction
	jsCode?: string | string[];
	jsOnly?: boolean;
	simulateUser?: boolean;
	overrideNavigator?: boolean;
	magic?: boolean;

	// Content Selection and Filtering
	cssSelector?: string;
	excludedTags?: string[];
	wordCountThreshold?: number;

	// Links and External Resources
	excludeExternalLinks?: boolean;
	scoreLinks?: boolean;
	preserveHttpsForInternalLinks?: boolean;

	// Media and Screenshots
	screenshot?: boolean;
	pdf?: boolean;
	fetchSslCertificate?: boolean;

	// Network and Connection
	checkRobotsTxt?: boolean;

	// Session and Context
	sessionId?: string;
	maxRetries?: number;

	// Logging and Debug
	verbose?: boolean;

	// Extraction and Processing
	extractionStrategy?: ExtractionStrategy;
	markdownGenerator?: MarkdownGeneratorConfig;
	tableExtraction?: TableExtractionStrategy;

	// Advanced Features
	deepCrawlStrategy?: DeepCrawlStrategy;

	// 0.8.0: Fast URL discovery pre-fetch mode
	prefetch?: boolean;

	// 0.8.5: Resource filtering
	avoidAds?: boolean;
	avoidCss?: boolean;

	// 0.8.5: Consent popup removal
	removeConsentPopups?: boolean;
}

/**
 * Unified config type used when merging createBrowserConfig() + createCrawlerRunConfig() output.
 *
 * createBrowserConfig() sets camelCase aliases (browserType, browserMode, etc.) that don't exist
 * on BrowserConfig (which uses snake_case). formatBrowserConfig() in apiClient.ts reads those
 * camelCase fields to build the API payload. This type makes that contract explicit so TypeScript
 * can verify the full pipeline without `as any` casts.
 */
export type FullCrawlConfig = BrowserConfig & CrawlerRunConfig & {
	// camelCase aliases set by createBrowserConfig(), read by formatBrowserConfig()
	browserType?: string;
	useManagedBrowser?: boolean;
};

// Crawl result interface
export interface CrawlResult {
	url: string;
	success: boolean;
	status_code?: number;
	title?: string;
	markdown?: string | {
		raw_markdown?: string;
		fit_markdown?: string;
		markdown_with_citations?: string;
		references_markdown?: string;
		fit_html?: string;
	};
	html?: string;
	cleaned_html?: string;
	text?: string;
	links?: {
		internal: Link[];
		external: Link[];
	};
	media?: {
		images: Media[];
		videos: Media[];
		audios?: Media[];
	};
	screenshot?: string; // Base64 encoded
	pdf?: string | Buffer; // Base64 encoded or binary
	ssl_certificate?: SslCertificate;
	extracted_content?: string;
	tables?: TableResult[];
	error_message?: string;
	crawl_time?: number;
	cache_status?: string;
	cached_at?: number;
	redirected_url?: string;
	redirected_status_code?: number;
	response_headers?: Record<string, unknown>;
	js_execution_result?: Record<string, unknown>;
	downloaded_files?: string[];
	server_memory_delta_mb?: number;
	server_peak_memory_mb?: number;
	metadata?: Record<string, unknown>;
}

// SSL Certificate interface
export interface SslCertificate {
	issuer?: Record<string, string>;
	subject?: Record<string, string>;
	valid_from?: string;
	valid_until?: string;
	valid_to?: string;
	fingerprint?: string;
	fingerprint256?: string;
	serialNumber?: string;
	raw?: string;
}

// Link interface
export interface Link {
	href: string;
	text: string;
	title?: string;
}

// Media interface
export interface Media {
	src: string;
	alt?: string;
	title?: string;
	type?: string;
}

// Table result interface
export interface TableResult {
	headers: string[];
	rows: string[][];
	caption?: string;
	metadata?: {
		rowCount: number;
		columnCount: number;
		hasRowspan?: boolean;
		hasColspan?: boolean;
		[key: string]: unknown;
	};
}

// CSS Selector Schema Field (for Content Extractor)
export interface CssSelectorField {
	name: string;
	selector: string;
	type: 'text' | 'attribute' | 'html';
	attribute?: string;
}

// CSS Selector Schema (for Content Extractor)
export interface CssSelectorSchema {
	name: string;
	baseSelector: string;
	fields: CssSelectorField[];
}

// Webhook configuration for async job submission
export interface WebhookConfig {
	webhook_url: string;
	webhook_data_in_payload?: boolean;
	webhook_headers?: Record<string, string>;
}

// Crawl job request (POST /crawl/job)
export interface CrawlJobRequest {
	urls: string[];
	browser_config?: Record<string, unknown>;
	crawler_config?: Record<string, unknown>;
	webhook_config?: WebhookConfig;
}

// Job status response (GET /crawl/job/{task_id} or GET /llm/job/{task_id})
export interface JobStatusResponse {
	task_id: string;
	status: 'pending' | 'processing' | 'completed' | 'failed';
	result?: CrawlResult | CrawlResult[];
	message?: string;
	error?: string;
}

// Monitor health response (GET /monitor/health)
export interface MonitorHealth {
	status: string;
	memory_percent: number;
	cpu_percent: number;
	uptime_seconds: number;
	active_requests: number;
	pool_info?: Record<string, unknown>;
}

// LLM async job request (POST /llm/job)
export interface LlmJobRequest {
	url: string;
	q: string;
	schema?: string;
	provider?: string;
	temperature?: number;
	webhook_config?: WebhookConfig;
}

