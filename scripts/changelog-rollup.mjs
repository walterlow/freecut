#!/usr/bin/env node
// Close the current week and promote `current` into a weekly release.
//
// Usage:
//   node scripts/changelog-rollup.mjs
//   node scripts/changelog-rollup.mjs --date YYYY-MM-DD
//
// Steps:
//   1. Compute the Monday-of-last-week (or --date override) -> new version.
//   2. Move `current` into `releases` with that version and date.
//   3. Update CHANGELOG.md with the new entry.
//   4. Bump package.json version.
//
// Does NOT commit or push. Operator runs:
//   git add src/data/changelog.json CHANGELOG.md package.json
//   git commit -m "chore(release): <version>"
//   git push

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CHANGELOG_JSON = resolve(REPO_ROOT, 'src', 'data', 'changelog.json');
const CHANGELOG_MD = resolve(REPO_ROOT, 'CHANGELOG.md');
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');

const GROUP_ORDER = ['added', 'fixed', 'improved'];
const GROUP_LABEL = { added: 'Added', fixed: 'Fixed', improved: 'Improved' };

function parseArgs() {
  const args = process.argv.slice(2);
  let dateOverride;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--date') {
      dateOverride = args[i + 1];
      i += 1;
    }
  }
  return { dateOverride };
}

function lastMondayIso(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // Monday-start: getUTCDay() → 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  // We want the Monday of the most recent *completed* calendar week (Mon–Sun).
  //   - Mon → 7 days back (last week's Monday)
  //   - Tue → 8, Wed → 9, ..., Sat → 12
  //   - Sun → 13 days back (previous week's Monday; the current Mon–Sun
  //     week is still in progress until the next Monday).
  const dayOfWeek = d.getUTCDay();
  const daysBack = ((dayOfWeek + 6) % 7) + 7;
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function bulletLine(item) {
  const scope = item.scope ? `**${item.scope}**: ` : '';
  return `- ${scope}${item.title}`;
}

function renderMarkdownEntry(entry, mondayIso) {
  const lines = [];
  lines.push(`## [${entry.version}] — week of ${mondayIso} to ${toSundayIso(mondayIso)}`);
  lines.push('');
  if (entry.highlights?.length) {
    lines.push('**Highlights**');
    for (const h of entry.highlights) lines.push(`- ${h}`);
    lines.push('');
  }
  for (const groupKey of GROUP_ORDER) {
    const items = entry.groups?.[groupKey];
    if (!items?.length) continue;
    lines.push(`### ${GROUP_LABEL[groupKey]}`);
    for (const item of items) lines.push(bulletLine(item));
    lines.push('');
  }
  return lines.join('\n');
}

function toSundayIso(mondayIso) {
  const m = new Date(`${mondayIso}T00:00:00Z`);
  m.setUTCDate(m.getUTCDate() + 6);
  return m.toISOString().slice(0, 10);
}

function insertIntoMarkdown(newEntryMd) {
  const md = readFileSync(CHANGELOG_MD, 'utf8');
  const marker = '## ';
  const insertIdx = md.indexOf(marker);
  if (insertIdx === -1) {
    writeFileSync(CHANGELOG_MD, `${md.trimEnd()}\n\n${newEntryMd}\n`);
    return;
  }
  const before = md.slice(0, insertIdx);
  const after = md.slice(insertIdx);
  writeFileSync(CHANGELOG_MD, `${before}${newEntryMd}\n${after}`);
}

function main() {
  const { dateOverride } = parseArgs();
  const mondayIso = dateOverride ?? lastMondayIso();
  const version = mondayIso.replaceAll('-', '.');

  const data = loadJson(CHANGELOG_JSON);
  if (!data.current || Object.keys(data.current.groups ?? {}).length === 0) {
    console.error('No bullets in current entry; nothing to roll up.');
    process.exit(1);
  }

  if (data.releases.some((r) => r.version === version)) {
    console.error(`Release ${version} already exists.`);
    process.exit(1);
  }

  const releaseEntry = {
    version,
    date: mondayIso,
    ...(data.current.highlights?.length ? { highlights: data.current.highlights } : {}),
    groups: data.current.groups,
  };

  data.releases.unshift(releaseEntry);
  data.current = null;
  writeJson(CHANGELOG_JSON, data);

  const newEntryMd = renderMarkdownEntry(releaseEntry, mondayIso);
  insertIntoMarkdown(newEntryMd);

  const pkg = loadJson(PACKAGE_JSON);
  pkg.version = version;
  writeJson(PACKAGE_JSON, pkg);

  console.log(`
Rollup complete.
  Version:   ${version}
  Files:     src/data/changelog.json, CHANGELOG.md, package.json

Next steps (run manually when ready):
  git add src/data/changelog.json CHANGELOG.md package.json
  git commit -m "chore(release): ${version}"
  git push
`);
}

main();
