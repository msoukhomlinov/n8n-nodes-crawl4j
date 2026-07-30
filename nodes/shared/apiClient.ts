import type { IHttpRequestOptions } from 'n8n-workflow';
import { Crawl4aiApiCredentials, FullCrawlConfig, CrawlResult, CrawlJobRequest, JobStatusResponse, MonitorHealth, LlmJobRequest } from './interfaces';

/**
 * Minimal structural type for the n8n request helper this client depends on.
 * Kept intentionally narrow (not the full IExecuteFunctions) so the client can
 * be constructed with a lightweight stub in ad-hoc manual verification.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpRequestHelper = { httpRequest(options: IHttpRequestOptions): Promise<any> };

/**
 * Creates a client for communicating with the Crawl4AI API
 */
export class Crawl4aiClient {
  private readonly credentials: Crawl4aiApiCredentials;
  private readonly baseUrl: string;

  constructor(credentials: Crawl4aiApiCredentials, private readonly helpers: HttpRequestHelper) {
    this.credentials = credentials;
    this.baseUrl = credentials.dockerUrl || 'http://localhost:11235';
  }

  /**
   * Perform an HTTP request via n8n's request helper.
   *
   * n8n's httpRequest is a thin axios wrapper: on success it returns the
   * unwrapped response body (equivalent to axios's response.data), and on
   * failure it throws the raw AxiosError unchanged. Unlike the old axios
   * instance, it applies NO timeout of its own — so a default of 120000ms is
   * applied here to preserve the previous instance-level default; callers that
   * need a longer bound pass an explicit timeout.
   */
  private async request(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
    options: { timeout?: number; encoding?: 'stream' } = {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const requestOptions: IHttpRequestOptions = {
      baseURL: this.baseUrl,
      url,
      method,
      json: true,
      timeout: options.timeout ?? 120000,
    };

    if (body !== undefined) {
      requestOptions.body = body;
    }
    if (options.encoding) {
      requestOptions.encoding = options.encoding;
    }

    // Apply authentication per-request.
    if (this.credentials.authenticationType === 'token' && this.credentials.apiToken) {
      requestOptions.headers = { Authorization: `Bearer ${this.credentials.apiToken}` };
    } else if (
      this.credentials.authenticationType === 'basic' &&
      this.credentials.username &&
      this.credentials.password
    ) {
      requestOptions.auth = {
        username: this.credentials.username,
        password: this.credentials.password,
      };
    }

    return this.helpers.httpRequest(requestOptions);
  }

  /**
   * Get appropriate timeout based on config
   */
  private getTimeout(config: FullCrawlConfig): number {
    if (config.deepCrawlStrategy) {
      return 300000; // 5 minutes for deep crawl
    }
    return 120000;
  }

  /**
   * Duck-typed guard for an axios-shaped error. n8n's httpRequest propagates the
   * raw AxiosError unchanged, so we can detect it structurally without importing
   * axios itself.
   */
  private isAxiosLikeError(error: unknown): error is { isAxiosError: true; code?: string; message?: string; response?: { status: number; data?: unknown; statusText?: string } } {
    return typeof error === 'object' && error !== null && (error as { isAxiosError?: unknown }).isAxiosError === true;
  }

  /**
   * Parse API error response and return actionable error message
   */
  private parseApiError(error: unknown): string {
    if (this.isAxiosLikeError(error)) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return `Cannot connect to Crawl4AI API at ${this.baseUrl}. Check that the Docker container is running and the URL is correct.`;
      }

      if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        return `Request timed out. The crawl operation took longer than the configured timeout. Consider increasing the timeout or simplifying the crawl configuration.`;
      }

      if (error.response) {
        const status = error.response.status;
        const data = error.response.data as Record<string, unknown> | undefined;
        const detail = data?.detail || data?.error || data?.message;

        if (status === 400) {
          const detailStr = typeof detail === 'string' ? detail : '';
          if (/not permitted .* from an untrusted request|may not be constructed from an untrusted request/.test(detailStr)) {
            return `Rejected by Crawl4AI (400): ${detailStr}. Crawl4AI Docker API server v0.9.0+ blocks this field/strategy over the network as a security measure (js_code, cookies, headers, proxy, magic/simulate_user, deep_crawl_strategy, and LLM-based extraction strategies are all affected) — there is no client-side workaround. See this package's README "Crawl4AI Version Compatibility" section, or use a Crawl4AI server on v0.8.9 or earlier for full feature support.`;
          }
          return `Invalid request (400): ${detail || 'Bad request format'}. Check your configuration parameters.`;
        }
        if (status === 401) {
          return `Authentication failed (401): ${detail || 'Invalid credentials'}. Check your API token or username/password in credentials.`;
        }
        if (status === 403) {
          return `Access forbidden (403): ${detail || 'Insufficient permissions'}. Check your authentication credentials.`;
        }
        if (status === 404) {
          return `Endpoint not found (404): ${detail || 'The requested endpoint does not exist'}. Verify the Crawl4AI API version.`;
        }
        if (status === 422) {
          return `Validation error (422): ${detail || 'Invalid configuration parameters'}. Review your browser_config or crawler_config settings.`;
        }
        if (status === 429) {
          return `Rate limit exceeded (429): ${detail || 'Too many requests'}. Please wait before retrying.`;
        }
        if (status >= 500) {
          return `Server error (${status}): ${detail || 'Crawl4AI API encountered an internal error'}. The server may be overloaded or experiencing issues.`;
        }
        return `API error (${status}): ${detail || error.response.statusText || 'Unknown error'}`;
      }

      return error.message || 'Unknown error occurred';
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error occurred';
  }

  /**
   * Crawl a single URL
   */
  async crawlUrl(url: string, config: FullCrawlConfig): Promise<CrawlResult> {
    try {
      const result = await this.request('POST', '/crawl', {
        urls: [url],
        browser_config: this.formatBrowserConfig(config),
        crawler_config: this.formatCrawlerConfig(config),
      }, {
        timeout: this.getTimeout(config),
      });

      if (result && Array.isArray(result.results) && result.results.length > 0) {
        const crawlResult = result.results[0] as CrawlResult;
        // Promote wrapper-level server metrics onto the result so formatters can surface them
        if (result.server_processing_time_s != null && crawlResult.crawl_time == null) {
          crawlResult.crawl_time = result.server_processing_time_s as number;
        }
        if (result.server_memory_delta_mb != null && crawlResult.server_memory_delta_mb == null) {
          crawlResult.server_memory_delta_mb = result.server_memory_delta_mb as number;
        }
        if (result.server_peak_memory_mb != null && crawlResult.server_peak_memory_mb == null) {
          crawlResult.server_peak_memory_mb = result.server_peak_memory_mb as number;
        }
        return crawlResult;
      }

      return {
        url,
        success: false,
        error_message: 'No result returned from Crawl4AI API. The API responded but did not return any crawl results.',
      };
    } catch (error) {
      if (!this.isAxiosLikeError(error)) throw error;
      return {
        url,
        success: false,
        error_message: this.parseApiError(error),
      };
    }
  }

  /**
   * Crawl multiple URLs
   */
  async crawlMultipleUrls(urls: string[], config: FullCrawlConfig): Promise<CrawlResult[]> {
    try {
      const response = await this.request('POST', '/crawl', {
        urls,
        browser_config: this.formatBrowserConfig(config),
        crawler_config: this.formatCrawlerConfig(config),
      }, {
        timeout: this.getTimeout(config),
      });

      if (response && Array.isArray(response.results)) {
        const results = response.results as CrawlResult[];
        // Promote batch-level server metrics onto every result so all URLs see consistent data
        if (results.length > 0) {
          for (const result of results) {
            if (response.server_processing_time_s != null && result.crawl_time == null) {
              result.crawl_time = response.server_processing_time_s as number;
            }
            if (response.server_memory_delta_mb != null && result.server_memory_delta_mb == null) {
              result.server_memory_delta_mb = response.server_memory_delta_mb as number;
            }
            if (response.server_peak_memory_mb != null && result.server_peak_memory_mb == null) {
              result.server_peak_memory_mb = response.server_peak_memory_mb as number;
            }
          }
        }
        return results;
      }

      return urls.map(url => ({
        url,
        success: false,
        error_message: 'No results returned from Crawl4AI API. The API responded but did not return any crawl results.',
      }));
    } catch (error) {
      if (!this.isAxiosLikeError(error)) throw error;
      const errorMessage = this.parseApiError(error);
      return urls.map(url => ({
        url,
        success: false,
        error_message: errorMessage,
      }));
    }
  }

  /**
   * Stream crawl via POST /crawl/stream — buffers all NDJSON chunks and returns full results
   */
  async crawlStream(urls: string[], config: FullCrawlConfig): Promise<{ results: CrawlResult[]; parseErrors: number }> {
    const readline = await import('readline');

    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.request('POST', '/crawl/stream', {
        urls,
        browser_config: this.formatBrowserConfig(config),
        crawler_config: this.formatCrawlerConfig(config),
      }, {
        encoding: 'stream',
        timeout: 300000, // 5 minutes for streaming
      });
    } catch (error) {
      if (!this.isAxiosLikeError(error)) throw error;
      throw new Error(this.parseApiError(error));
    }

    return new Promise<{ results: CrawlResult[]; parseErrors: number }>((resolve, reject) => {
      const results: CrawlResult[] = [];
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let parseErrors = 0;
      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const parsed = JSON.parse(trimmed);
          // Skip terminal status messages
          if (parsed.status === 'completed' || parsed.status === 'processing') return;
          results.push(parsed as CrawlResult);
        } catch {
          parseErrors++;
        }
      });

      rl.on('close', () => resolve({ results, parseErrors }));
      rl.on('error', (err: Error) => reject(err));
      stream.on('error', (err: Error) => reject(err));
    });
  }

  /**
   * Submit an async crawl job — POST /crawl/job — returns task_id
   */
  async submitCrawlJob(request: CrawlJobRequest): Promise<string> {
    try {
      const result = await this.request('POST', '/crawl/job', request);
      const taskId = result?.task_id || result?.id;
      if (!taskId) {
        throw new Error('No task_id returned from /crawl/job endpoint.');
      }
      return String(taskId);
    } catch (error) {
      throw new Error(this.parseApiError(error));
    }
  }

  /**
   * Get async job status — GET /crawl/job/{task_id} or GET /llm/job/{task_id}.
   * There is no unified /job/{task_id} endpoint; crawl and LLM jobs are polled
   * via separate paths, so the caller must know which kind of job it submitted.
   */
  async getJobStatus(taskId: string, jobType: 'crawl' | 'llm'): Promise<JobStatusResponse> {
    try {
      const result = await this.request('GET', `/${jobType}/job/${taskId}`);
      return result as JobStatusResponse;
    } catch (error) {
      throw new Error(this.parseApiError(error));
    }
  }

  /**
   * Get server health — GET /monitor/health
   */
  async getMonitorHealth(): Promise<MonitorHealth> {
    try {
      const result = await this.request('GET', '/monitor/health');
      return result as MonitorHealth;
    } catch (error) {
      throw new Error(this.parseApiError(error));
    }
  }

  /**
   * Get endpoint stats — GET /monitor/endpoints/stats
   */
  async getEndpointStats(): Promise<Record<string, unknown>> {
    try {
      const result = await this.request('GET', '/monitor/endpoints/stats');
      return result as Record<string, unknown>;
    } catch (error) {
      throw new Error(this.parseApiError(error));
    }
  }

  /**
   * Submit an async LLM extraction job — POST /llm/job — returns task_id
   */
  async submitLlmJob(request: LlmJobRequest): Promise<string> {
    try {
      const result = await this.request('POST', '/llm/job', request);
      const taskId = result?.task_id || result?.id;
      if (!taskId) {
        throw new Error('No task_id returned from /llm/job endpoint.');
      }
      return String(taskId);
    } catch (error) {
      throw new Error(this.parseApiError(error));
    }
  }

  /**
   * Process raw HTML content
   */
  async processRawHtml(html: string, baseUrl: string, config: FullCrawlConfig): Promise<CrawlResult> {
    try {
      const htmlSizeBytes = new TextEncoder().encode(html).length;
      const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
      if (htmlSizeBytes > MAX_HTML_SIZE) {
        return {
          url: baseUrl,
          success: false,
          error_message: `HTML content too large (${(htmlSizeBytes / 1024 / 1024).toFixed(2)}MB). Maximum allowed: 5MB`,
        };
      }

      const rawUrl = `raw:${html}`;
      const formattedCrawlerConfig = this.formatCrawlerConfig(config);
      // When extractionStrategy/deepCrawlStrategy/tableExtraction is present,
      // formatCrawlerConfig returns { type: 'CrawlerRunConfig', params: {...} }.
      // base_url must go inside params, not at the wrapper level.
      const crawlerConfigWithBase = formattedCrawlerConfig?.type === 'CrawlerRunConfig'
        ? { ...formattedCrawlerConfig, params: { ...(formattedCrawlerConfig.params as Record<string, unknown>), base_url: baseUrl } }
        : { ...formattedCrawlerConfig, base_url: baseUrl };

      const result = await this.request('POST', '/crawl', {
        urls: [rawUrl],
        browser_config: this.formatBrowserConfig(config),
        crawler_config: crawlerConfigWithBase,
      }, {
        timeout: this.getTimeout(config),
      });

      if (result && Array.isArray(result.results) && result.results.length > 0) {
        return result.results[0];
      }

      return {
        url: baseUrl,
        success: false,
        error_message: 'No result returned from Crawl4AI API. The API responded but did not return any crawl results.',
      };
    } catch (error) {
      if (!this.isAxiosLikeError(error)) throw error;
      return {
        url: baseUrl,
        success: false,
        error_message: this.parseApiError(error),
      };
    }
  }

  /**
   * Run an advanced operation (used for Content Extractor operations)
   */
  async arun(url: string, config: FullCrawlConfig): Promise<CrawlResult> {
    return this.crawlUrl(url, config);
  }

  /**
   * Format browser config for the API (public for use by job-submission operations)
   */
  formatBrowserConfig(config: FullCrawlConfig): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (config.browserType) {
      params.browser_type = config.browserType;
    }
    if (config.useManagedBrowser) {
      params.use_managed_browser = true;
    }
    if (config.headless !== undefined) {
      params.headless = config.headless;
    }
    if (config.viewport && (config.viewport.width !== undefined || config.viewport.height !== undefined)) {
      params.viewport = {
        type: 'dict',
        value: {
          ...(config.viewport.width !== undefined ? { width: config.viewport.width } : {}),
          ...(config.viewport.height !== undefined ? { height: config.viewport.height } : {}),
        },
      };
    }
    if (config.java_script_enabled !== undefined) {
      params.java_script_enabled = config.java_script_enabled;
    }
    if (config.user_agent) {
      params.user_agent = config.user_agent;
    }
    if (config.ignore_https_errors !== undefined) {
      params.ignore_https_errors = config.ignore_https_errors;
    }
    if (config.text_mode === true) {
      params.text_mode = true;
    }
    if (config.light_mode === true) {
      params.light_mode = true;
    }
    if (config.enable_stealth === true) {
      params.enable_stealth = true;
    }
    if (config.chrome_channel) {
      params.chrome_channel = config.chrome_channel;
    }
    if (config.extra_args && Array.isArray(config.extra_args) && config.extra_args.length > 0) {
      params.extra_args = config.extra_args;
    }
    if (config.init_scripts && Array.isArray(config.init_scripts) && config.init_scripts.length > 0) {
      params.init_scripts = config.init_scripts;
    }
    if (config.proxy_config && typeof config.proxy_config === 'object' && Object.keys(config.proxy_config).length > 0) {
      params.proxy_config = {
        type: 'dict',
        value: config.proxy_config,
      };
    }
    if (config.cookies && Array.isArray(config.cookies) && config.cookies.length > 0) {
      params.cookies = config.cookies;
    }
    if (config.headers && typeof config.headers === 'object' && Object.keys(config.headers).length > 0) {
      params.headers = {
        type: 'dict',
        value: config.headers,
      };
    }
    if (config.storage_state !== undefined) {
      params.storage_state = config.storage_state;
    }
    if (config.use_persistent_context === true) {
      params.use_persistent_context = true;
    }
    if (config.user_data_dir) {
      params.user_data_dir = config.user_data_dir;
    }

    return Object.keys(params).length > 0 ? params : {};
  }

  /**
   * Format crawler config for the API (public for use by job-submission operations)
   */
  formatCrawlerConfig(config: FullCrawlConfig): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (config.cacheMode) {
      params.cache_mode = config.cacheMode;
    }
    if (config.streamEnabled) {
      params.stream = true;
    }
    if (config.pageTimeout !== undefined) {
      params.page_timeout = config.pageTimeout;
    }
    if (config.waitUntil) {
      params.wait_until = config.waitUntil;
    }
    if (config.waitFor) {
      params.wait_for = config.waitFor;
    }
    if (config.jsCode) {
      params.js_code = config.jsCode;
    }
    if (config.jsOnly) {
      params.js_only = true;
    }
    if (config.cssSelector) {
      params.css_selector = config.cssSelector;
    }
    if (config.excludedTags && config.excludedTags.length > 0) {
      params.excluded_tags = config.excludedTags;
    }
    if (config.excludeExternalLinks) {
      params.exclude_external_links = true;
    }
    if (config.checkRobotsTxt) {
      params.check_robots_txt = true;
    }
    if (config.wordCountThreshold !== undefined) {
      params.word_count_threshold = config.wordCountThreshold;
    }
    if (config.sessionId) {
      params.session_id = config.sessionId;
    }
    if (config.maxRetries !== undefined) {
      params.max_retries = config.maxRetries;
    }
    if (config.prefetch === true) {
      params.prefetch = true;
    }
    if (config.preserveHttpsForInternalLinks === true) {
      params.preserve_https_for_internal_links = true;
    }
    if (config.scoreLinks !== undefined) {
      params.score_links = config.scoreLinks;
    }
    if (config.screenshot === true) params.screenshot = true;
    if (config.pdf === true) params.pdf = true;
    if (config.fetchSslCertificate === true) params.fetch_ssl_certificate = true;
    if (config.requestTimeout !== undefined) params.request_timeout = config.requestTimeout;
    if (config.magic === true) params.magic = true;
    if (config.simulateUser === true) params.simulate_user = true;
    if (config.overrideNavigator === true) params.override_navigator = true;
    if (config.avoidAds === true) params.avoid_ads = true;
    if (config.avoidCss === true) params.avoid_css = true;
    if (config.removeConsentPopups === true) params.remove_consent_popups = true;
    if (config.delayBeforeReturnHtml !== undefined) params.delay_before_return_html = config.delayBeforeReturnHtml;
    if (config.verbose === true) params.verbose = true;
    if (config.markdownGenerator) params.markdown_generator = config.markdownGenerator;

    // Use type/params wrapper ONLY if extraction strategy, deep crawl, or table extraction present
    if (config.extractionStrategy || config.deepCrawlStrategy || config.tableExtraction) {
      return {
        type: 'CrawlerRunConfig',
        params: {
          ...params,
          ...(config.extractionStrategy ? { extraction_strategy: config.extractionStrategy } : {}),
          ...(config.deepCrawlStrategy ? { deep_crawl_strategy: config.deepCrawlStrategy } : {}),
          ...(config.tableExtraction ? { table_extraction: config.tableExtraction } : {}),
        },
      };
    }

    return Object.keys(params).length > 0 ? params : {};
  }

}

/**
 * Create an instance of the Crawl4AI client
 */
export async function createCrawlerInstance(
  credentials: Crawl4aiApiCredentials,
  helpers: HttpRequestHelper,
): Promise<Crawl4aiClient> {
  return new Crawl4aiClient(credentials, helpers);
}
