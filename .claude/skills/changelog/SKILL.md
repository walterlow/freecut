---
name: changelog
description: Maintain FreeCut's user-facing weekly changelog manually. Use when the user asks to add a changelog entry, draft bullets from recent commits, or close out a week into a release. Curates commits into polished user-facing bullets and keeps CHANGELOG.md and src/data/changelog.json in sync.
---

# Changelog skill

FreeCut's changelog is **maintained manually** — there is no auto-append CI. The operator (or this skill, on request) curates commits into user-facing bullets and updates both files together.

Two synchronized files:

- **`CHANGELOG.md`** — human-facing, Keep-a-Changelog style, read on GitHub
- **`src/data/changelog.json`** — typed, imported by the "What's New" dialog UI

Always update both or neither.

## Structure: weekly releases + one rolling current entry

Two tiers:

1. **`current`** — rolling entry for the in-progress week. Shown in the UI as a "This Week" card. Updated manually whenever the user asks to refresh it from recent commits.
2. **`releases`** — one entry per completed week, newest first. Each has a version and a date.

### Versioning: CalVer, Monday-start weeks

- Format: `YYYY.MM.DD` where the date is the **Monday** that opens the week (Mon–Sun).
- Rollup is manually triggered, typically on Monday morning.
- Mid-week hotfix needing its own release: add `.N` suffix (`2026.04.13.2`). Rare.
- `package.json` `version` field mirrors the most recent released week.

**No git tags.** The web app ships continuously via Vercel.

Separate packages (future CLI/API) get their own semver and their own changelog under their package directory. This file is for the web app only.

## Modes

The user invokes one of these explicitly. Default to asking which mode if unclear.

### Draft mode (most common)

The user asks "draft changelog bullets for this week" or similar. Produce bullets from commits — do **not** write files yet, just show the user the curated list to approve.

1. `git log --first-parent main --pretty=format:"%H|%ad|%s" --date=short <range>` — range usually `<last-rollup>..HEAD` or a date range the user gives.
2. Apply curation rules (below). Drop noise, rewrite dev-speak into user language, dedupe revisits.
3. Group into Added / Fixed / Improved.
4. Show the result. Wait for approval before touching files.

### Append mode

After the user approves drafted bullets, write them into `current` in `changelog.json` and reflect in `CHANGELOG.md`.

1. Merge with existing `current.groups` — **dedupe by title**. If a new bullet refines or walks back something already there, edit the existing bullet rather than adding a duplicate.
2. Update `current.date` to today.
3. Update both `CHANGELOG.md` and `src/data/changelog.json`.
4. Do not create tags. Do not update `package.json`.

`scripts/changelog-append.mjs` and `npm run changelog:append` exist as a convenience for scripted runs, but the manual path (skill curates, then writes) is preferred — it produces better user-facing copy.

### Rollup mode

Triggered manually on Monday to close the previous week.

1. Determine last week's Monday → version `YYYY.MM.DD`.
2. Move `current` into `releases` with that version and the Monday date.
3. Empty `current` (or seed with any commits landed since Monday).
4. Bump `package.json` `version` to the new release.
5. Update `CHANGELOG.md` with the new entry at the top.
6. Print the commit/push commands for the operator to run manually.

`npm run changelog:rollup` exists as a scripted shortcut.

### Backfill mode

Given a git range, produce historical weekly entries. Used when seeding from scratch or filling a gap.

1. Walk PR merges chronologically: `git log --merges --first-parent main --pretty=format:"%H|%ad|%s" --date=short <range>`.
2. Group by week (Monday-start). Union all non-merge commits per week.
3. Apply curation, dedupe revisits.
4. Emit one entry per week with at least one user-visible change. Skip empty weeks.

Pre-PR era (if any): collapse the foundation into one initial release entry, dated the Monday before first-PR week.

## Curation rules

### Drop

- Merge commits (`Merge pull request`, `Merge branch`)
- `chore(...)` — including `chore(release)`
- `ci(...)`
- `test(...)` unless it documents notable test infra changes
- `refactor(...)` when the scope is internal (stores, types, utils, deps adapters, chunk splits)
- `deps` / `deps-dev` bumps unless major-version bumps with user-visible impact
- **Follow-up fixes** — commits whose message matches `/address.*(review|PR|findings|feedback)|code review|follow-?up|fix.*(lint|typecheck|build|pre-existing)/i` AND land in the same week as a parent feature. Roll into the parent bullet silently.
- Reverts paired with a subsequent re-fix in the same week — skip both, keep only the final correct implementation.
- "Update src/..." auto-subject merges (GitHub web-edit artifacts)
- Revisits: if the same feature is improved multiple times in one week, dedupe to one bullet describing the final state.

### Keep and rewrite

- `feat(...)` — always, one bullet per distinct user-visible feature
- `fix(...)` — if the bug was user-observable (rendering, playback, data loss, crash). Skip fixes for code never shipped, or shipped and reverted in the same week.
- `perf(...)` — if the impact is noticeable (measurable time saved, dropped frames recovered)

### Rewrite style

Commit messages are dev-speak. The changelog is user-facing. Rewrite every bullet.

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
- A `current` entry past ~15 bullets means it's time for a rollup.
- When the user asks to "update the changelog" with no other context, default to **draft mode** — show curated bullets first, write nothing until they approve.
