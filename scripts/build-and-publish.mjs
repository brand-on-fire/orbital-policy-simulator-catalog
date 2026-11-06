// Fetch the full active-payload set from CelesTrak (one GROUP=active GP request + the bulk SATCAT CSV), build the
// catalog:active columnar file, and FORCE-RESET the catalog-data branch to one rootless commit holding just that
// file plus a tiny manifest. Force-reset keeps the branch's reachable content O(1) (~2.5 MB) no matter how many
// times it runs, so this feed never grows without bound. Publishing is gated on a repository token (contents:write).
//
// CelesTrak etiquette: exactly two requests (GP then SATCAT), each identified by User-Agent, 30 s timeout, redirect
// refused, and STOP on any non-200 (no retries). The data repo's own feed is never touched by this script.
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildCatalog, parseSatcat, GP_CITATION } from './lib/build.mjs';
import { git, pushEnv } from './lib/git.mjs';

const REPOSITORY = 'brand-on-fire/orbital-policy-simulator-catalog';
const BRANCH = 'catalog-data';
const REMOTE_URL = `https://github.com/${REPOSITORY}.git`;
const USER_AGENT = 'OrbitalPolicySimulatorCatalogCollector/1 (+https://github.com/brand-on-fire/orbital-policy-simulator-catalog)';
const GP_ACTIVE = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json';
const SATCAT_BULK = 'https://celestrak.org/pub/satcat.csv';
const MIB = 1024 * 1024;
const NOTICE = `# Notice

This branch (\`catalog-data\`) is a single force-reset snapshot of the full active-payload catalog for the Orbital
Policy Simulator: one \`catalog:active\` columnar file (GP elements joined to SATCAT) plus a tiny manifest, replaced
on each run with no retained history.

${GP_CITATION}

It is a point-in-time snapshot for visualization, not an archive and NOT for conjunction assessment or any
operational use.
`;

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv, application/json;q=0.9, text/plain;q=0.5' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  // CelesTrak firewalls IPs that accumulate non-200s; stop on the first one, never retry.
  if (response.status !== 200) throw new Error(`${url} returned HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 16 * MIB) throw new Error(`${url} response exceeded 16 MiB`);
  return text;
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) throw new Error('GH_TOKEN (a repository token with contents:write) is required to publish');

// 1. Fetch the full active set in one request; SATCAT is best-effort (classification columns blank if unavailable).
const gp = JSON.parse(await fetchText(GP_ACTIVE));
if (!Array.isArray(gp) || gp.length < 5000) throw new Error(`implausible GROUP=active response (${Array.isArray(gp) ? gp.length : 'not an array'} objects)`);
let satcat = new Map();
try {
  satcat = parseSatcat(await fetchText(SATCAT_BULK));
} catch (error) {
  console.warn(`SATCAT unavailable, publishing without owner/type/status: ${error.message}`);
}

// 2. Build and guard before publishing anything.
const now = new Date().toISOString();
const catalog = buildCatalog(gp, satcat, now);
if (catalog.objectCount < 5000) throw new Error(`refusing to publish an implausible catalog of ${catalog.objectCount} objects`);
const body = JSON.stringify(catalog);
const bytes = Buffer.byteLength(body);
if (bytes > 6 * MIB) throw new Error(`catalog is ${(bytes / MIB).toFixed(2)} MiB, over the app's 6 MiB per-file cap`);
const sha = createHash('sha256').update(body).digest('hex');

// 3. Assemble the single-snapshot tree (content-addressed file + manifest + notice).
const dir = mkdtempSync(resolve(tmpdir(), 'orbital-catalog-'));
mkdirSync(resolve(dir, 'catalog'));
writeFileSync(resolve(dir, `catalog/${sha}.json`), body);
const manifest = {
  schemaVersion: 1, generatedAt: now, scheduleGuarantee: false, notice: 'NOTICE.md', citations: [GP_CITATION],
  files: [{ id: 'catalog:active', path: `catalog/${sha}.json`, sha256: sha, bytes, objectCount: catalog.objectCount, retrievedAt: now }],
};
writeFileSync(resolve(dir, 'manifest.json'), JSON.stringify(manifest));
writeFileSync(resolve(dir, 'NOTICE.md'), NOTICE);

// 4. Force-reset catalog-data to one rootless commit (bounded history); token only via GIT_CONFIG_* (pushEnv).
const run = args => git(args, { cwd: dir });
run(['init', '-q', '-b', BRANCH]);
run(['config', 'user.name', 'Orbital catalog collector']);
run(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run(['add', '-A']);
run(['commit', '-q', '-m', `Publish active catalog: ${catalog.objectCount} objects (${now})`]);
git(['push', '--force', REMOTE_URL, `${BRANCH}:${BRANCH}`], { cwd: dir, env: pushEnv(token) });
console.log(`Published ${catalog.objectCount} objects, ${(bytes / 1e6).toFixed(2)} MB (sha ${sha.slice(0, 12)}) to ${REPOSITORY}#${BRANCH}`);
