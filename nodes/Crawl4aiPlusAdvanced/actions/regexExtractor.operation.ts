import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { Crawl4aiNodeOptions, ExtractionStrategy, FullCrawlConfig } from '../helpers/interfaces';
import {
	getCrawl4aiClient,
	createBrowserConfig,
	createCrawlerRunConfig,
	cleanExtractedData,
	isValidUrl,
	normalizeUrlProtocol,
} from '../../shared/utils';
import { formatExtractionResult, parseExtractedJson } from '../../shared/formatters';
import {
	urlField,
	getBrowserSessionFields,
	getCrawlSettingsFields,
} from '../../shared/descriptions';

// --- UI Definition ---
export const description: INodeProperties[] = [
	{
		...urlField,
		description: 'The URL to extract content from using regex patterns',
		displayOptions: {
			show: {
				operation: ['regexExtractor'],
			},
		},
	},
	{
		displayName: 'Pattern Type',
		name: 'patternType',
		type: 'options',
		options: [
			{
				name: 'Built-in Patterns',
				value: 'builtin',
				description: 'Use pre-defined regex patterns for common data types',
			},
			{
				name: 'Custom Patterns',
				value: 'custom',
				description: 'Define your own regex patterns',
			},
			{
				name: 'Preset: Contact Info',
				value: 'preset_contact',
				description: 'Extract emails, phone numbers, and social media handles',
			},
			{
				name: 'Preset: Financial Data',
				value: 'preset_financial',
				description: 'Extract currencies, credit cards, IBANs, and percentages',
			},
		],
		default: 'builtin',
		description: 'Choose between presets, built-in patterns, or custom regex patterns',
		displayOptions: {
			show: {
				operation: ['regexExtractor'],
			},
		},
	},
	{
		displayName: 'Built-in Patterns',
		name: 'builtinPatterns',
		type: 'multiOptions',
		options: [
			{ name: 'Credit Card', value: 'CreditCard', description: 'Extract credit card numbers' },
			{ name: 'Currency', value: 'Currency', description: 'Extract currency values' },
			{ name: 'Date (ISO)', value: 'DateIso', description: 'Extract ISO format dates' },
			{ name: 'Date (US)', value: 'DateUS', description: 'Extract US format dates' },
			{ name: 'Email', value: 'Email', description: 'Extract email addresses' },
			{ name: 'Hashtag', value: 'Hashtag', description: 'Extract hashtags' },
			{ name: 'Hex Color', value: 'HexColor', description: 'Extract HTML hex colors' },
			{ name: 'IBAN', value: 'Iban', description: 'Extract bank account numbers (IBAN)' },
			{ name: 'IP Address (IPv4)', value: 'IPv4', description: 'Extract IPv4 addresses' },
			{ name: 'IP Address (IPv6)', value: 'IPv6', description: 'Extract IPv6 addresses' },
			{ name: 'MAC Address', value: 'MacAddr', description: 'Extract MAC addresses' },
			{ name: 'Number', value: 'Number', description: 'Extract numeric values' },
			{ name: 'Percentage', value: 'Percentage', description: 'Extract percentage values' },
			{ name: 'Phone (International)', value: 'PhoneIntl', description: 'Extract international phone numbers' },
			{ name: 'Phone (US)', value: 'PhoneUS', description: 'Extract US phone numbers' },
			{ name: 'Postal Code (UK)', value: 'PostalUK', description: 'Extract UK postal codes' },
			{ name: 'Postal Code (US)', value: 'PostalUS', description: 'Extract US postal codes' },
			{ name: 'Time (24h)', value: 'Time24h', description: 'Extract 24-hour time format' },
			{ name: 'Twitter Handle', value: 'TwitterHandle', description: 'Extract Twitter handles' },
			{ name: 'URL', value: 'Url', description: 'Extract HTTP/HTTPS URLs' },
			{ name: 'UUID', value: 'Uuid', description: 'Extract UUIDs' },
		],
		default: ['Email', 'Url'],
		description: 'Select built-in patterns to use for extraction',
		displayOptions: {
			show: {
				operation: ['regexExtractor'],
				patternType: ['builtin'],
			},
		},
	},
	{
		displayName: 'Custom Patterns',
		name: 'customPatterns',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		required: true,
		displayOptions: {
			show: {
				operation: ['regexExtractor'],
				patternType: ['custom'],
			},
		},
		options: [
			{
				name: 'patternValues',
				displayName: 'Pattern',
				values: [
					{
						displayName: 'Label',
						name: 'label',
						type: 'string',
						required: true,
						default: '',
						placeholder: 'price',
						description: 'Label for this pattern (used to identify matches)',
					},
					{
						displayName: 'Regex Pattern',
						name: 'pattern',
						type: 'string',
						required: true,
						default: '',
						placeholder: '\\$\\s?\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?',
						description: 'Regular expression pattern to match',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				operation: ['regexExtractor'],
			},
		},
		options: [
			{
				displayName: 'Clean Extracted Text',
				name: 'cleanText',
				type: 'boolean',
				default: false,
				description: 'Whether to normalise whitespace in all extracted string values',
			},
			{
				displayName: 'Include Original Text',
				name: 'includeFullText',
				type: 'boolean',
				default: false,
				description: 'Whether to include the original webpage text in output',
			},
		],
	},
	...getBrowserSessionFields(['regexExtractor']),
	...getCrawlSettingsFields(['regexExtractor']),
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
			const url = normalizeUrlProtocol(this.getNodeParameter('url', i, '') as string);
			const patternType = this.getNodeParameter('patternType', i, 'builtin') as string;
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const bs = this.getNodeParameter('browserSession', i, {}) as IDataObject;
			const cs = this.getNodeParameter('crawlSettings', i, {}) as IDataObject;

			if (!url) {
				throw new NodeOperationError(this.getNode(), 'URL cannot be empty.', { itemIndex: i });
			}

			if (!isValidUrl(url)) {
				throw new NodeOperationError(this.getNode(), `Invalid URL: ${url}`, { itemIndex: i });
			}

			// Build regex extraction strategy config
			const extractionStrategy: ExtractionStrategy = {
				type: 'RegexExtractionStrategy',
				params: {},
			};

			if (patternType === 'builtin') {
				const builtinPatterns = this.getNodeParameter('builtinPatterns', i, []) as string[];
				if (!builtinPatterns || builtinPatterns.length === 0) {
					throw new NodeOperationError(this.getNode(), 'At least one built-in pattern must be selected.', { itemIndex: i });
				}
				extractionStrategy.params.patterns = builtinPatterns;
			} else if (patternType === 'preset_contact') {
				extractionStrategy.params.patterns = ['Email', 'PhoneUS', 'PhoneIntl', 'TwitterHandle', 'Url'];
			} else if (patternType === 'preset_financial') {
				extractionStrategy.params.patterns = ['Currency', 'CreditCard', 'Iban', 'Percentage', 'Number'];
			} else if (patternType === 'llm') {
				throw new NodeOperationError(
					this.getNode(),
					'Pattern Type "LLM Generated Pattern" was removed in v5.10.0 — it called an endpoint that never existed on Crawl4AI\'s REST API and always failed. Choose Built-in, Custom, or a Preset instead.',
					{ itemIndex: i },
				);
			} else {
				// Custom patterns
				const customPatternsValues = this.getNodeParameter('customPatterns.patternValues', i, []) as IDataObject[];
				if (!customPatternsValues || customPatternsValues.length === 0) {
					throw new NodeOperationError(this.getNode(), 'At least one custom pattern must be defined.', { itemIndex: i });
				}

				// Validate custom regex patterns
				for (const { label, pattern } of customPatternsValues) {
					if (!label || !pattern) continue;
					try {
						new RegExp(pattern as string, 'g');
					} catch (e) {
						throw new NodeOperationError(
							this.getNode(),
							`Pattern "${label}" is not a valid regex: ${(e as Error).message}`,
							{ itemIndex: i },
						);
					}
				}

				const customPatterns: Record<string, string> = {};
				customPatternsValues.forEach(p => {
					const label = p.label as string;
					const patternStr = p.pattern as string;
					if (label && patternStr) {
						customPatterns[label] = patternStr;
					}
				});

				extractionStrategy.params.custom_patterns = customPatterns;
			}

			const config: FullCrawlConfig = {
				...createBrowserConfig(bs),
				...createCrawlerRunConfig(cs),
				extractionStrategy,
			};

			const fetchedAt = new Date().toISOString();
			const result = await crawler.crawlUrl(url, config);

			let extractedData = parseExtractedJson(result);

			if (options.cleanText === true && extractedData) {
				extractedData = cleanExtractedData(extractedData) as IDataObject;
			}

			const formattedResult = formatExtractionResult(result, extractedData, {
				fetchedAt,
				extractionStrategy: 'RegexExtractionStrategy',
				includeFullText: options.includeFullText as boolean,
				includeLinks: true,
			});

			allResults.push({
				json: formattedResult,
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
