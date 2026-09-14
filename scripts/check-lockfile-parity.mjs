#!/usr/bin/env node
// Fails when package-lock.json and pnpm-lock.yaml resolve different versions.
//
// Why this exists: CI and the Husky hook install from package-lock.json (npm),
// while Vercel installs from pnpm-lock.yaml. When the two drift, the tree that
// is tested is not the tree that deploys — measured 2026-09-10, `npm audit`
// reported 0 vulnerabilities while `pnpm audit` over the same package.json
// reported 4 high and 2 moderate, because the two lockfiles had resolved
// different versions of @typescript-eslint, minimatch, brace-expansion and ws.
//
// The comparison is every resolved `name@version` in each lockfile, as a set
// per package name. Anything present in one lockfile and not the other fails.
//
// Deliberately dependency-free (no YAML parser): it must run before `npm ci`,
// and the one section it reads from pnpm-lock.yaml — `packages:` in lockfile
// v9 — is a flat map of `name@version:` keys. An unexpected lockfile version
// fails loudly rather than being parsed on a guess.

import { readFileSync } from 'node:fs';

const NPM_LOCK = 'package-lock.json';
const PNPM_LOCK = 'pnpm-lock.yaml';

function add(map, name, version) {
  if (!map.has(name)) map.set(name, new Set());
  map.get(name).add(version);
}

function readNpmLock(path) {
  const lock = JSON.parse(readFileSync(path, 'utf8'));
  if (lock.lockfileVersion !== 3) {
    throw new Error(`${path}: expected lockfileVersion 3, found ${lock.lockfileVersion}`);
  }
  const map = new Map();
  for (const [key, entry] of Object.entries(lock.packages)) {
    // `inBundle` entries ship inside their parent's tarball; neither package
    // manager resolves them, and pnpm does not record them at all.
    if (key === '' || entry.link || entry.inBundle) continue;
    // An aliased install (`"foo": "npm:bar@1"`) records the real name in `name`.
    const name = entry.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    add(map, name, entry.version);
  }
  return map;
}

function readPnpmLock(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const version = lines.find((l) => l.startsWith('lockfileVersion:'));
  if (!/^lockfileVersion: '?9\.0'?$/.test(version ?? '')) {
    throw new Error(`${path}: expected lockfileVersion '9.0', found ${version ?? 'none'}`);
  }
  const start = lines.indexOf('packages:');
  if (start === -1) throw new Error(`${path}: no packages: section`);
  const map = new Map();
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // next top-level section (snapshots:)
    // Exactly two spaces of indent: deeper lines (resolution:, engines:, …) are fields.
    const m = /^ {2}(['"]?)([^\s'"].*)\1:$/.exec(line);
    if (!m) continue;
    const key = m[2];
    const at = key.lastIndexOf('@');
    if (at <= 0) throw new Error(`${path}: cannot split package key ${JSON.stringify(key)}`);
    add(map, key.slice(0, at), key.slice(at + 1));
  }
  return map;
}

const npm = readNpmLock(NPM_LOCK);
const pnpm = readPnpmLock(PNPM_LOCK);

const problems = [];
for (const name of [...new Set([...npm.keys(), ...pnpm.keys()])].sort()) {
  const a = [...(npm.get(name) ?? [])].sort();
  const b = [...(pnpm.get(name) ?? [])].sort();
  if (a.join() !== b.join()) {
    problems.push(`  ${name}\n    ${NPM_LOCK}: ${a.join(', ') || '(absent)'}\n    ${PNPM_LOCK}: ${b.join(', ') || '(absent)'}`);
  }
}

if (problems.length > 0) {
  console.error(`Lockfile drift: ${problems.length} package(s) resolve differently.\n`);
  console.error(problems.join('\n'));
  console.error(
    `\nRegenerate ${PNPM_LOCK} from ${NPM_LOCK} with the package manager's own tooling:\n` +
      `  rm ${PNPM_LOCK} && pnpm import\n` +
      `Never hand-edit either lockfile.`
  );
  process.exit(1);
}

console.log(`Lockfiles agree: ${npm.size} packages resolve identically in ${NPM_LOCK} and ${PNPM_LOCK}.`);
