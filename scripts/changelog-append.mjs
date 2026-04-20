#!/usr/bin/env node
// Append user-visible commits to the `current` entry of src/data/changelog.json.
//
// Usage:
//   node scripts/changelog-append.mjs            # process HEAD only
//   node scripts/changelog-append.mjs <range>    # e.g. HEAD~5..HEAD or <sha>..HEAD
//
// Intended to run in CI on every push to main. Writes changelog.json in place
// and exits 0 whether or not changes were made. The workflow file decides
// whether to commit.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATH = resolve(__dirname, '..', 'src', 'data', 'changelog.json');

const DROP_SUBJECT_PATTERNS = [
  /^merge /i,
  /^revert /i,
  /address.*(review|pr|findings|feedback)/i,
  /code review/i,
  /follow-?up/i,
  /fix.*(lint|typecheck|build|pre-existing)/i,
];

const DROP_TYPES = new Set(['chore', 'ci', 'test', 'refactor', 'docs', 'style', 'build']);
const KEEP_TYPES = new Set(['feat', 'fix', 'perf']);

const GROUP_FOR_TYPE = {
  feat: 'added',
  fix: 'fixed',
  perf: 'improved',
};

function parseSubject(subject) {
  // type(scope): title   OR   type: title
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) return null;
  const [, type, scope, , title] = match;
  return { type: type.toLowerCase(), scope: scope ?? undefined, title: title.trim() };
}

function shouldDrop(subject) {
  return DROP_SUBJECT_PATTERNS.some((re) => re.test(subject));
}

function todayIso() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCommitSubjects(range) {
  const spec = range ?? 'HEAD~1..HEAD';
  const out = execSync(`git log --no-merges --pretty=format:%s ${spec}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').filter(Boolean);
}

function loadChangelog() {
  const raw = readFileSync(CHANGELOG_PATH, 'utf8');
  return JSON.parse(raw);
}

function saveChangelog(data) {
  writeFileSync(CHANGELOG_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function ensureCurrent(data) {
  if (data.current) {
    data.current.date = todayIso();
    data.current.groups = data.current.groups ?? {};
    return data.current;
  }
  data.current = {
    version: 'current',
    date: todayIso(),
    groups: {},
  };
  return data.current;
}

function addBulletDedup(groupArr, item) {
  const key = `${item.scope ?? ''}::${item.title.toLowerCase()}`;
  const exists = groupArr.some(
    (b) => `${b.scope ?? ''}::${b.title.toLowerCase()}` === key,
  );
  if (!exists) groupArr.push(item);
}

function main() {
  const range = process.argv[2];
  const subjects = getCommitSubjects(range);
  if (subjects.length === 0) {
    console.log('No commits in range; nothing to append.');
    return;
  }

  const data = loadChangelog();
  const current = ensureCurrent(data);

  let added = 0;
  for (const subject of subjects) {
    if (shouldDrop(subject)) continue;
    const parsed = parseSubject(subject);
    if (!parsed) continue;
    if (DROP_TYPES.has(parsed.type)) continue;
    if (!KEEP_TYPES.has(parsed.type)) continue;

    const groupKey = GROUP_FOR_TYPE[parsed.type];
    current.groups[groupKey] = current.groups[groupKey] ?? [];
    addBulletDedup(current.groups[groupKey], {
      title: parsed.title,
      ...(parsed.scope ? { scope: parsed.scope } : {}),
    });
    added += 1;
  }

  if (added === 0) {
    console.log(`Scanned ${subjects.length} commit(s); nothing user-visible to append.`);
    return;
  }

  saveChangelog(data);
  console.log(`Appended ${added} bullet(s) to current (${current.date}).`);
}

main();
