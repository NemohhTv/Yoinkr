#!/usr/bin/env node
/**
 * In GitHub Actions, `GITHUB_REPOSITORY` is `owner/repo`. We sync `repository` + `build.publish`
 * so electron-builder and electron-updater target this repo without hand-editing package.json per machine.
 *
 * Locally: skip if `GITHUB_REPOSITORY` is unset (your `package.json` `repository` field or git remote is used).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkgPath = join(root, 'package.json');

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  console.log('[align-github-repo] GITHUB_REPOSITORY unset — skipping (local build).');
  process.exit(0);
}

const parts = repo.split('/');
const owner = parts[0];
const repoName = parts[1];
if (!owner || !repoName) {
  console.error('[align-github-repo] Invalid GITHUB_REPOSITORY:', repo);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.repository = {
  type: 'git',
  url: `https://github.com/${owner}/${repoName}.git`,
};
pkg.build = pkg.build ?? {};
pkg.build.publish = {
  provider: 'github',
  owner,
  repo: repoName,
  releaseType: 'release',
};
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`[align-github-repo] Set GitHub target → ${owner}/${repoName}`);
