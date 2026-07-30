import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { Crawl4aiNodeOptions } from '../helpers/interfaces';
import {
	getCrawl4aiClient,
	createBrowserConfig,
	createCrawlerRunConfig,
	isValidUrl,
	buildWebhookConfig,
	normalizeUrlProtocol,
} from '../../shared/utils';
import {
	urlsField,
	getBrowserSessionFields,
	getCrawlSettingsFields,
	getWebhookFields,
} from '../../shared/descriptions';
import { formatJobSubmission } from '../helpers/formatters';

// --- UI Definition ---
export const description: INodeProperties[] = [
	{
		...urlsField,
		displayOptions: {
			show: {
				operation: ['submitCrawlJob'],
			},
		},
	},
	...getBrowserSessionFields(['submitCrawlJob']),
	...getCrawlSettingsFields(['submitCrawlJob']),
	...getWebhookFields(['submitCrawlJob'], 'crawl'),
];

// --- Execution Logic ---
export async function execute(
	this: IExecuteFunctions,
	items: INodeExecutionData[],
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	_nodeOptions: Crawl4aiNodeOptions,
): Promise<INodeExecutionData[]> {
	const allResults: INodeExecutionData[] = [];
	const crawler = await getCrawl4aiClient(this);

	for (let i = 0; i < items.length; i++) {
		try {
			const rawUrls = this.getNodeParameter('urls', i, '') as string;
			const bs = this.getNodeParameter('browserSession', i, {}) as IDataObject;
			const cs = this.getNodeParameter('crawlSettings', i, {}) as IDataObject;
			const webhookConfigOptions = this.getNodeParameter('webhookConfig', i, {}) as IDataObject;

			// Parse and validate URLs
			const urls = rawUrls.split(/[\n,]/).map((u) => normalizeUrlProtocol(u.trim())).filter((u) => u.length > 0);
			if (urls.length === 0) {
				throw new NodeOperationError(this.getNode(), 'At least one URL is required.', { itemIndex: i });
			}

			for (const url of urls) {
				if (!isValidUrl(url)) {
					throw new NodeOperationError(this.getNode(), `Invalid URL: ${url}`, { itemIndex: i });
				}
			}

			// Build config from shared collections
			const config = {
				...createBrowserConfig(bs),
				...createCrawlerRunConfig(cs),
			};

			const browserCfg = crawler.formatBrowserConfig(config);
			const crawlerCfg = crawler.formatCrawlerConfig(config);

			// Build webhook config if URL provided
			const webhookConfig = buildWebhookConfig(webhookConfigOptions);

			const taskId = await crawler.submitCrawlJob({
				urls,
				browser_config: Object.keys(browserCfg).length > 0 ? browserCfg : {},
				crawler_config: Object.keys(crawlerCfg).length > 0 ? crawlerCfg : {},
				...(webhookConfig ? { webhook_config: webhookConfig } : {}),
			});

			allResults.push({
				json: formatJobSubmission(taskId, 'crawl'),
				pairedItem: { item: i },
			});
		} catch (error) {
			if (this.continueOnFail()) {
				allResults.push({
					json: items[i].json,
					error: new NodeOperationError(this.getNode(), (error as Error).message, {
						itemIndex: i,
					}),
					pairedItem: { item: i },
				});
				continue;
			}
			throw error;
		}
	}

	return allResults;
}
