import { createInterface } from 'node:readline';
import type { McpConfig } from './config.js';
import { GithubArchivePrompts } from './prompts/registry.js';
import { GithubArchiveResources } from './resources/registry.js';
import { GithubArchiveMcpTools } from './tools/registry.js';

interface JsonRpcRequest {
	jsonrpc?: '2.0';
	id?: string | number | null;
	method: string;
	params?: Record<string, unknown>;
}

export class GithubArchiveMcpServer {
	readonly tools: GithubArchiveMcpTools;
	readonly resources: GithubArchiveResources;
	readonly prompts: GithubArchivePrompts;

	constructor(private readonly config: McpConfig) {
		this.tools = new GithubArchiveMcpTools(config);
		this.resources = new GithubArchiveResources(config);
		this.prompts = new GithubArchivePrompts();
	}

	async handle(request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
		try {
			const result = await this.dispatch(request.method, request.params ?? {});
			if (request.id === undefined || request.id === null) return null;
			return { jsonrpc: '2.0', id: request.id, result };
		} catch (error) {
			if (request.id === undefined || request.id === null) return null;
			return {
				jsonrpc: '2.0',
				id: request.id,
				error: {
					code: -32000,
					message: error instanceof Error ? error.message : String(error)
				}
			};
		}
	}

	async startStdio(): Promise<void> {
		const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
		for await (const line of rl) {
			if (!line.trim()) continue;
			const response = await this.handle(JSON.parse(line) as JsonRpcRequest);
			if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
		}
	}

	private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
		switch (method) {
			case 'initialize':
				return {
					protocolVersion: '2024-11-05',
					capabilities: {
						tools: {},
						resources: {},
						prompts: {}
					},
					serverInfo: {
						name: 'githubarchive-plus-mcp',
						version: '0.1.0'
					}
				};
			case 'tools/list':
				return { tools: this.tools.listToolDefinitions() };
			case 'tools/call': {
				const name = String(params.name ?? '');
				const args = (params.arguments ?? {}) as Record<string, unknown>;
				const result = await this.tools.call(name, args);
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify(result, null, 2)
						}
					],
					isError: false
				};
			}
			case 'resources/list':
				return { resources: this.resources.list() };
			case 'resources/read': {
				const uri = String(params.uri ?? '');
				const resource = this.resources.read(uri);
				return {
					contents: [
						{
							uri: resource.uri,
							mimeType: resource.mimeType,
							text: resource.text
						}
					]
				};
			}
			case 'prompts/list':
				return { prompts: this.prompts.list() };
			case 'prompts/get': {
				const name = String(params.name ?? '');
				const args = Object.fromEntries(
					Object.entries((params.arguments ?? {}) as Record<string, unknown>).map(([key, value]) => [
						key,
						String(value ?? '')
					])
				);
				return this.prompts.get(name, args);
			}
			case 'notifications/initialized':
				return {};
			case 'ping':
				return {};
			default:
				throw new Error(`Unsupported MCP method: ${method}`);
		}
	}
}
