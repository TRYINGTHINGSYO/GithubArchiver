/** Public adapter surface — implementation lives in src/adapters for the TypeScript build. */
export {
  createGithubRepository,
  GITHUB_REMOTE_POLICY,
  type GithubCreateRequest,
  type GithubCreateResult,
} from "../src/adapters/github.js";
