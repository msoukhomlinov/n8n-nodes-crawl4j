import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { Crawl4aiNodeOptions, CrawlResult } from '../helpers/interfaces';
import { getCrawl4aiClient } from '../../shared/utils';
import { formatCrawlResult } from '../helpers/formatters';

// --- UI Definition ---
export const description: INodeProperties[] = [
	{
		displayName: 'Job Type',
		name: 'jobType',
		type: 'options',
		required: true,
		options: [
			{ name: 'Crawl Job', value: 'crawl', description: 'Job submitted via Submit Crawl Job' },
			{ name: 'LLM Job', value: 'llm', description: 'Job submitted via Submit LLM Job' },
		],
		default: 'crawl',
		description: 'Crawl4AI polls crawl jobs and LLM jobs via separate endpoints — must match how the Task ID was submitted',
		displayOptions: {
			show: {
				operation: ['getJobStatus'],
			},
		},
	},
	{
		displayName: 'Task ID',
		name: 'taskId',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'abc123-...',
		description: 'The taskId returned from Submit Crawl Job or Submit LLM Job',
		displayOptions: {
			show: {
				operation: ['getJobStatus'],
			},
		},
	},
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
			const taskId = this.getNodeParameter('taskId', i, '') as string;
			const jobType = this.getNodeParameter('jobType', i, 'crawl') as 'crawl' | 'llm';

			if (!taskId || !taskId.trim()) {
				throw new NodeOperationError(this.getNode(), 'Task ID cannot be empty.', { itemIndex: i });
			}
			const statusResponse = await crawler.getJobStatus(taskId.trim(), jobType);
			const checkedAt = new Date().toISOString();

			// If completed and result data available, format the crawl results
			if (statusResponse.status === 'completed' && statusResponse.result) {
				const rawResults = Array.isArray(statusResponse.result)
					? statusResponse.result as CrawlResult[]
					: [statusResponse.result as CrawlResult];

				if (rawResults.length > 0) {
					for (const result of rawResults) {
						const formatted = formatCrawlResult(result, {
							includeLinks: true,
							includeScreenshot: true,
							includePdf: true,
							includeSslCertificate: true,
							includeTables: true,
							includeMedia: true,
							includeHtml: true,
							extractionStrategy: result.extracted_content ? 'unknown' : undefined,
							fetchedAt: checkedAt,
						});
						allResults.push({
							json: {
								...formatted,
								taskId: statusResponse.task_id,
								status: statusResponse.status,
								checkedAt,
							} as IDataObject,
							pairedItem: { item: i },
						});
					}
				} else {
					// Job completed but returned empty results
					allResults.push({
						json: {
							taskId: statusResponse.task_id,
							status: statusResponse.status,
							checkedAt,
							message: 'Job completed but returned no results.',
						} as IDataObject,
						pairedItem: { item: i },
					});
				}
			} else {
				allResults.push({
					json: {
						taskId: statusResponse.task_id,
						status: statusResponse.status,
						checkedAt,
						...(statusResponse.message ? { message: statusResponse.message } : {}),
					} as IDataObject,
					pairedItem: { item: i },
				});
			}
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
