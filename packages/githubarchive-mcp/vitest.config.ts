import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/githubarchive-mcp/tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }
  }
});
