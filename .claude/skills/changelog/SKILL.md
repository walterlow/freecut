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
- `package.json` `version` is pinned to `0.0.0` and ignored — the package is private, nothing reads it. The week version lives only in `changelog.json` and `CHANGELOG.md`.

**No git tags.** The web app ships continuously via Vercel.

Separate packages (future CLI/API) get their own semver and their own changelog under their package directory. This file is for the web app only.

## Preconditions (run before any mode)

Three checks block all other work. All must pass before drafting, appending, or rolling up.

### 1. Current must not span past weeks

`current` is the in-progress week — Mon–Sun, anchored to **this week's Monday**. If `current.date` falls in an earlier ISO week than today, you are rollup-overdue: the bullets in `current` belong to one or more closed weeks, not to the present.

Compute this week's Monday from today (in repo-local time): `monday = today - ((today.getDay() + 6) % 7)`. If `current.date` is not in `[monday, monday+6]`, **stop and run rollup mode first**, even if the user asked for append. Do not append into a stale `current` — it merges this week's bullets with last week's and corrupts both.

If `current` spans multiple closed weeks (the bullets were appended across several Mondays without rollup), do **partitioning rollup**. Do **not** merely re-split the bullets already in `current` — those bullets are only what someone happened to append, and a skipped week means they are incomplete (this is how the 2026-06-15 transcription and Color-workspace launches were nearly lost: they landed after the last append and were absent from `current` entirely). Instead, **re-derive each week from git**: walk `git log <branch> --no-merges` per Monday–Sunday window from the last release forward, curate each week's commits independently, then reconcile that against the existing `current` bullets (the existing bullets are a hint, not the source of truth). Emit one `[YYYY.MM.DD]` release per closed week and start a fresh `current` for this week.

### 2. CHANGELOG.md heading must match `current.date`

The markdown header `## [Current] — week of YYYY-MM-DD` is a literal string and does not auto-derive from JSON. Any time you write `current` (append, rollup, partition), recompute the heading as `## [Current] — week of <Monday-of-current.date>` and update it. Never leave the heading frozen at an old Monday — that is the bug that caused the 2026-04-13→2026-05-02 drift.

### 3. `current` + releases must fully cover the git log since the last release

The skill's default mode is incremental *append*, which trusts `current` to already hold everything prior and only adds newly-mentioned commits. That trust breaks silently when a week (or an append) is skipped: those commits never enter the changelog and nothing flags them — the outcome then depends on how often someone remembers to run the skill. Close that gap by reconciling against git on **every** run, so infrequent triggering is lossless instead of lossy.

Before drafting/appending/rolling up, walk `git log <branch> --no-merges --since=<date-of-last-release>` and confirm every user-facing commit (after curation rules) is represented in either `current` or an existing release. Surface anything missing to the user and fold it in — do not assume `current` is complete just because it has bullets. This is the check that would have caught the missing 2026-06-15 launches at append time instead of three weeks later. The reconciliation is against the curated git log, not a raw commit count: dropped noise (chore/ci/test/refactor, same-week regressions, follow-ups) is expected to be absent and is not a gap.

## Modes

The user invokes one of these explicitly. Default to asking which mode if unclear.

### Draft mode (most common)

The user asks "draft changelog bullets for this week" or similar. Produce bullets from commits — do **not** write files yet, just show the user the curated list to approve.

1. Pick the branch to read from:
   - For the **current rolling week** (drafting bullets for `current`), query the **active development branch** — typically `develop`, not `main`. PRs target `staging`/`develop` first, so commits from earlier today or this week may not be on `main` yet. Confirm the branch with `git branch --show-current` if unsure, or `git log <branch> --no-merges` to see what's actually there.
   - For **closed weeks** (rollup, backfill), `main` is usually fine — the week's PRs have merged by then. But if you're rolling up early Monday and the Sunday PRs haven't been promoted yet, fall back to `develop`.
2. `git log <branch> --no-merges --pretty=format:"%H|%ad|%s" --date=short --since=<week-start> --until=<week-end>` — `--no-merges` filters out PR merge commits, which carry no useful subject. Range is usually `<last-rollup>..HEAD` or explicit `--since`/`--until`.
3. Sanity-check: if the user just mentioned a specific commit you don't see in the output, you're on the wrong branch. Re-query.
4. Apply curation rules (below). Drop noise, rewrite dev-speak into user language, dedupe revisits.
5. Group into Added / Fixed / Improved.
6. Show the result. Wait for approval before touching files.

### Append mode

After the user approves drafted bullets, write them into `current` in `changelog.json` and reflect in `CHANGELOG.md`.

0. **Run preconditions first.** If `current.date` is older than this week's Monday → rollup before appending.
1. Merge with existing `current.groups` — **dedupe by title**. If a new bullet refines or walks back something already there, edit the existing bullet rather than adding a duplicate.
2. Update `current.date` to today.
3. Update `CHANGELOG.md`:
   - Bump `## [Current] — week of <date>` to `<this week's Monday>` if the heading is stale.
   - Insert new bullets at the top of each group (Added / Fixed / Improved).
4. Update `src/data/changelog.json` to mirror.
5. Do not create tags. Do not update `package.json`.

If `current` already has ~15+ bullets in any one group when you arrive, mention this to the user — it's a signal that a rollup is overdue, not a license to keep appending.

`scripts/changelog-append.mjs` and `npm run changelog:append` exist as a convenience for scripted runs, but the manual path (skill curates, then writes) is preferred — it produces better user-facing copy.

### Rollup mode

Triggered manually on Monday to close the previous week.

1. Determine last week's Monday → version `YYYY.MM.DD`.
2. Move `current` into `releases` with that version and the Monday date.
3. Empty `current` (or seed with any commits landed since Monday).
4. Update `CHANGELOG.md` with the new entry at the top.
5. Print the commit/push commands for the operator to run manually.

`npm run changelog:rollup` exists as a scripted shortcut.

### Backfill mode

Given a git range, produce historical weekly entries. Used when seeding from scratch or filling a gap.

1. Walk PR merges chronologically: `git log --merges --first-parent main --pretty=format:"%H|%ad|%s" --date=short <range>`.
2. Group by week (Monday-start). Union all non-merge commits per week.
3. Apply curation, dedupe revisits.
4. Emit one entry per week with at least one user-visible change. Skip empty weeks.

Pre-PR era (if any): collapse the foundation into one initial release entry, dated the Monday before first-PR week.

## The user-facing test

Before keeping any bullet, ask: **would a user notice this if they used the app today vs. yesterday, without diffing screenshots?** If no, drop it. This is the single most important filter — apply it to every candidate bullet, not just borderline ones.

Concretely, a bullet survives only if it changes something the user can see, do, or feel:
- A new control, panel, shortcut, format, or capability
- A bug they hit (or could hit) is gone
- A workflow that visibly stalled, jittered, or felt sluggish is now smooth in a way they'd remark on

A bullet fails if it only describes:
- Internal mechanics (allocation, caching, dirty-marking, dispatch, refs, props)
- Sub-pixel or single-pixel visual tweaks (centering, alignment, hover color shifts, tiny margins)
- Hit-target widening, drop-zone expansion, ghost-position adjustments — fold into the parent feature instead
- Same-week regression fixes for code shipped in the same week
- Anything the operator only knows happened because they read the diff

When in doubt, drop it. The changelog is read by users browsing "what's new" — they will not appreciate a bullet they cannot perceive.

## Frame the story: launch vs. increment

Commit subjects are written from the inside — the author already knows the system exists, so each commit reads like an increment ("add Turkish locale coverage", "localize timeline labels", "fix tts locale strings"). From outside, a series of "increments" can actually be the **launch of an entirely new system** that didn't exist last week.

Before writing bullets for a feature area, sanity-check the framing:

1. Pick the directory or module the commits touch most (e.g. `src/i18n/`, `src/features/subtitles/`, `lib/gpu-transitions/`).
2. Run `git log --diff-filter=A --since=<week-start> -- <path>` to see when files in that area first appeared.
3. If most of the files were **born this week**, the area is a launch — write one top-line bullet describing the new capability, and treat the individual "add X" commits as facets of it, not separate bullets.
4. If the area has older history, the commits are real increments — describe each that passes the user-facing test.

The user once flagged this directly: an i18n week was drafted as "Turkish language support" + two localization fixes. The actual story was "UI is now translated, with 9 languages." The Turkish commit looked incremental because the operator was thinking from inside the feature; the user reading "What's New" had no prior context that translations existed at all.

When you spot a launch:
- Lead with the capability ("Translated UI in 9 languages — …", "Subtitle editing on the timeline", "Pen tool for masks").
- List the supporting facets only if they're not obviously implied (a language picker is implied by "translated UI"; ASS subtitle support inside subtitle editing might be worth its own bullet).
- Resist the urge to itemize every commit just because they're all in the Added group.

## Curation rules

### Drop

- Merge commits (`Merge pull request`, `Merge branch`)
- `chore(...)` — including `chore(release)`
- `ci(...)`
- `test(...)` unless it documents notable test infra changes
- `refactor(...)` when the scope is internal (stores, types, utils, deps adapters, chunk splits)
- `deps` / `deps-dev` bumps unless major-version bumps with user-visible impact
- **Follow-up fixes** — commits whose message matches `/address.*(review|PR|findings|feedback)|code review|follow-?up|fix.*(lint|typecheck|build|pre-existing)/i` AND land in the same week as a parent feature. Roll into the parent bullet silently.
- **Same-week regression fixes** — fixes for bugs introduced by other commits in the same week. The user never saw the regression; only the final state matters. Fold into the parent feature bullet, do not add a separate "Fixed" entry.
- **Visual polish micro-tweaks** — recentering, hover-color changes, padding/margin nudges, alignment fixes that no user would notice as a discrete improvement. If a feature has 3+ such tweaks, the parent feature bullet absorbs them.
- **Hit-zone / drop-zone / ghost-position adjustments** — fold into the parent drag/drop feature. Never their own bullet.
- **Internal perf on this week's new work** — perf commits that optimize code shipped earlier in the same week. The user experiences the feature once, smoothly. No separate "Improved" bullet.
- Reverts paired with a subsequent re-fix in the same week — skip both, keep only the final correct implementation.
- "Update src/..." auto-subject merges (GitHub web-edit artifacts)
- Revisits: if the same feature is improved multiple times in one week, dedupe to one bullet describing the final state.
- Duplicates worded differently — drag overlays sticking, drag overlays hijacking lanes, stale drop overlays are all "dragging works better now." One bullet, not three.

### Keep and rewrite

- `feat(...)` — when the feature is user-perceivable (a new control, mode, format, shortcut, panel). Skip internal `feat(...)` that only changes plumbing.
- `fix(...)` — only if the bug was user-observable (rendering glitch, playback hitch, data loss, crash, wrong output) AND shipped to users before the fix. Skip fixes for code never released, or shipped and corrected in the same week.
- `perf(...)` — only if the user would describe the change in their own words ("playback is smoother", "scrolling doesn't lag anymore"). Skip perf the user can't perceive without instruments.

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
- **Sentence case**: write every bullet starting with a capital letter. The dialog has a render-time safety net that capitalizes the first character, but `CHANGELOG.md` ships the raw string to GitHub — fix the source, don't rely on the UI fallback.

### Grouping

Within each weekly entry, group into:
- **Added** — new user-facing features
- **Fixed** — bugs the user actually hit (in shipped builds)
- **Improved** — performance or polish wins the user would describe in their own words

Skip any group with zero entries. **It is normal and good for "Improved" to be empty.** If you cannot phrase an Improved bullet in a way the user would say it out loud ("playback is smoother", "exporting is faster"), it does not belong here. Do not pad the section with internal perf to make the week look productive.

## File formats

### `src/data/changelog.json`

Matches types in `src/data/changelog-types.ts`:

```ts
export type ChangelogGroup = 'added' | 'fixed' | 'improved';

export type ChangelogItem = {
  title: string;           // ≤12 words, user-facing — must stand alone, no scope tag
};

export type ChangelogEntry = {
  version: string;         // "2026.04.13" for releases, "current" for rolling
  date: string;            // ISO date — Monday for releases, today for current
  subtitle?: string;       // rare, only for the initial release entry
  groups: Partial<Record<ChangelogGroup, ChangelogItem[]>>;
};

export type ChangelogFile = {
  current: ChangelogEntry | null;   // in-progress week
  releases: ChangelogEntry[];       // completed weeks, newest first
};
```

The What's New dialog renders one entry per group with title-only bullets — no scope tags, no highlights section. Make every title carry its own context (a user reading it cold should know what changed).

### `CHANGELOG.md`

```markdown
# Changelog

All notable changes to FreeCut. Versioning follows weekly CalVer: `YYYY.MM.DD` = the Monday of the release week.

## [Current] — week of 2026-04-13

### Added
- ...

### Fixed
- ...

## [2026.04.06] — week of 2026-04-06 to 2026-04-12
...
```

No `**Highlights**` block. No scope prefixes on bullets.

Do **not** include PR links in weekly entries. Weekly entries aggregate many PRs; PR links add noise.

## When in doubt

- Fewer bullets > more bullets. A wall of text is worse than missing a tiny fix.
- If a week is 100 commits but they all revisit the same 3 features, produce 3 bullets.
- If a commit scope is new and you don't know if it's user-visible, check what files it touches. UI components and public APIs = user-visible; stores/utils/tests = usually not.
- A `current` entry past ~15 bullets means it's time for a rollup.
- When the user asks to "update the changelog" with no other context, default to **draft mode** — show curated bullets first, write nothing until they approve.
