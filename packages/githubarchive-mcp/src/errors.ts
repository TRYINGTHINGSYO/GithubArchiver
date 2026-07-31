export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly code = 'tool_error',
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}
