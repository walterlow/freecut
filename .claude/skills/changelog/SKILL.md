---
name: changelog
description: Maintain FreeCut's weekly changelog with a rolling current entry. Use when (1) backfilling historical weeks into CHANGELOG.md and src/data/changelog.json (backfill mode), (2) adding new bullets to the rolling current entry as commits land (append mode), or (3) closing the week and promoting current into a weekly release (rollup mode). Handles commit curation, deduplication, version assignment, and keeping both markdown and JSON artifacts in sync.
---

# Changelog skill

FreeCut's changelog lives in two synchronized files:

- **`CHANGELOG.md`** — human-facing, Keep-a-Changelog style, read on GitHub
- **`src/data/changelog.json`** — typed, imported by the "What's New" dialog UI

Both are generated from the same data. Always update both or neither.

## Structure: weekly releases + one rolling current entry

The changelog has two tiers:

1. **`current`** — a single rolling entry for the in-progress week. It accumulates bullets as commits land, dedupes when the same feature is touched multiple times, and is shown in the UI as a "This Week" card.
2. **`releases`** — one entry per completed week, newest first. Each has a version and a date.

### Versioning: CalVer, Monday-start weeks

- Format: `YYYY.MM.DD` where the date is the **Monday** that opens the week (Mon–Sun).
- A week "closes" on Monday morning of the following week. Rollup is **manually triggered**.
- If a mid-week hotfix needs its own release, add `.N` suffix (`2026.04.13.2`). Rare.
- `package.json` `version` field is the authoritative version — mirrors the most recent released week.

**No git tags.** The web app ships continuously via Vercel; tags add maintenance overhead without buying anything. `changelog.json` + `package.json` are the source of truth. If GitHub Releases pages are wanted later, tag from `package.json` history at that point.

Separate packages (future CLI/API) get their own semver and their own changelog under their package directory. This file is for the web app only.

## Modes

### Backfill mode

Given a git range, produce historical weekly entries.

**Process**:
1. Walk PR merges in chronological order: `git log --merges --first-parent main --pretty=format:"%H|%ad|%s" --date=short <range>`.
2. Group commits by week (Monday-start). For each week, union all non-merge commits across all PRs that landed that week.
3. Apply curation rules (below), dedup features revisited within the week.
4. Emit one weekly entry per week that has at least one user-visible change. Skip empty weeks.

Pre-PR era (if any): collapse the entire foundation into a single initial release entry, dated the Monday of the week before first-PR week.

### Append mode

Triggered ad-hoc to update `current` as new commits land.

**Input**: commits since last read of `current`. When `current` is empty (just after a rollup), walk from the most recent `chore(release):` commit on `main` to HEAD.

**Process**:
1. Walk new commits, applying curation rules.
2. Merge with existing `current.groups` — **dedupe by title**. If a new commit refines or walks back a bullet already in current, edit the existing bullet rather than adding a duplicate.
3. Update `current.date` to today.
4. Do not create tags. Do not update `package.json`.

### Rollup mode

Triggered manually on Monday to close the previous week.

**Input**: none (reads `current` and today's date).

**Process**:
1. Determine last week's Monday date → new version `YYYY.MM.DD`.
2. Move `current` into `releases` with that version and the Monday date.
3. Empty `current` (or seed with any commits landed since Monday).
4. Bump `package.json` `version` to the new release.
5. Update `CHANGELOG.md` with the new entry at the top.
6. Print the commit/push commands for the operator to run manually.

## Curation rules

### Drop

- Merge commits (`Merge pull request`, `Merge branch`)
- `chore(...)` — including `chore(release)`
- `ci(...)`
- `test(...)` unless it documents notable test infra changes
- `refactor(...)` when the scope is internal (stores, types, utils, deps adapters, chunk splits)
- `deps` / `deps-dev` bumps unless major-version bumps with user-visible impact
- **Follow-up fixes** — commits whose message matches `/address.*(review|PR|findings|feedback)|code review|follow-?up|fix.*(lint|typecheck|build|pre-existing)/i` AND land in the same week as a parent feature. Roll them into the parent bullet silently.
- Reverts paired with a subsequent re-fix in the same week — skip both the revert and the offending commit; keep only the final correct implementation.
- "Update src/..." auto-subject merges (GitHub web-edit artifacts)
- Revisits: if the same feature is improved multiple times in one week, dedupe to one bullet describing the final state. Never list the same feature twice in one week.

### Keep and rewrite

- `feat(...)` — always, one bullet per distinct user-visible feature
- `fix(...)` — if the bug was user-observable (rendering, playback, data loss, crash). Skip fixes for code that never shipped or was shipped and reverted in the same week.
- `perf(...)` — if the impact is noticeable (measurable time saved, dropped frames recovered)

### Rewrite style

Commit messages are dev-speak. The changelog is user-facing. Rewrite:

| Commit subject | Changelog bullet |
|---|---|
| `feat(timeline): add Alt+C as alternate split-at-playhead shortcut` | Split clips at playhead with Alt+C |
| `perf(filmstrip): fill zoom gaps with cover frame background and full-set fallback` | Smoother filmstrip rendering when zooming the timeline |
| `fix(preview): retry video with fresh blob URL on stale-blob load errors` | Preview no longer fails when media blobs expire |
| `feat(storage): migrate to workspace folder via File System Access API` | Projects now live on disk in a folder you choose, not hidden browser storage |

Rules of thumb:
- Lead with the verb of the user experience, not the code change.
- Drop internal names (stores, modules, workers) unless the user knows them.
- If a bullet is only meaningful to developers, drop it.
- Aim for ≤12 words per bullet.
- For weekly entries, prefer thematic phrasing over commit-level phrasing ("Trim tools with smart zone detection" rather than listing each tool variant).

### Grouping

Within each weekly entry, group into:
- **Added** — new features
- **Fixed** — user-visible bug fixes
- **Improved** — performance, polish, noticeable refactors

Skip any group with zero entries.

### Highlights

Each weekly entry picks 1–3 highlights — the bullets a user would brag about. These appear at the top of the UI card. Skip highlights for weeks that are purely fixes.

## File formats

### `src/data/changelog.json`

Matches types in `src/data/changelog-types.ts`:

```ts
export type ChangelogGroup = 'added' | 'fixed' | 'improved';

export type ChangelogItem = {
  title: string;           // ≤12 words, user-facing
  scope?: string;          // optional, e.g. "timeline"
};

export type ChangelogEntry = {
  version: string;         // "2026.04.13" for releases, "current" for rolling
  date: string;            // ISO date — Monday for releases, today for current
  highlights?: string[];   // 1-3 bullets
  groups: Partial<Record<ChangelogGroup, ChangelogItem[]>>;
};

export type ChangelogFile = {
  current: ChangelogEntry | null;   // in-progress week
  releases: ChangelogEntry[];       // completed weeks, newest first
};
```

### `CHANGELOG.md`

```markdown
# Changelog

All notable changes to FreeCut. Versioning follows weekly CalVer: `YYYY.MM.DD` = the Monday of the release week.

## [Current] — week of 2026-04-13
...
## [2026.04.06] — week of 2026-04-06 to 2026-04-12
...
```

Do **not** include PR links in weekly entries. Weekly entries aggregate many PRs; PR links add noise.

## When in doubt

- Fewer bullets > more bullets. A wall of text is worse than missing a tiny fix.
- If a week is 100 commits but they all revisit the same 3 features, produce 3 bullets.
- If a commit scope is new and you don't know if it's user-visible, check what files it touches. UI components and public APIs = user-visible; stores/utils/tests = usually not.
- A "current" entry that has grown past ~15 bullets is a sign you need a rollup.
