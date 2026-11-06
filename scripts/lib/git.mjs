// Minimal git transport. The token reaches git only through GIT_CONFIG_* environment variables of the push
// process: never a file, a remote URL, a log line or the build process. Mirrors the data repo's git.mjs.
import { execFileSync } from 'node:child_process';

export class GitError extends Error {
  constructor(message) { super(message); this.name = 'GitError'; }
}

export function git(args, { env = {}, cwd } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // Never echo stderr: it can contain request headers on some failures.
    throw new GitError(`git ${args[0]} failed (exit ${error.status ?? 'unknown'})`);
  }
}

export function pushEnv(token) {
  if (!token) throw new GitError('A repository token with contents:write is required to push');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    GIT_TRACE: '0',
    GIT_TRACE_CURL: '0',
    GIT_CURL_VERBOSE: '0',
  };
}
