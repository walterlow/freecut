# FreeCut Workspace

This folder is your FreeCut project workspace — the app's source of truth
for everything: projects, media metadata, thumbnails, waveforms, caches.

Everything here is **plain files** you can `cat`, `grep`, and diff with
normal tools. AI coding agents can read them directly without a browser.

## Layout

```
./
├── README.md                  ← this file
├── .freecut-workspace.json    ← marker + schema version
├── index.json                 ← fast project list
├── projects/
│   └── <projectId>/
│       ├── project.json       ← timeline, settings, keyframes, markers, transitions
│       ├── thumbnail.jpg
│       └── media-links.json   ← which media this project uses
├── media/
│   └── <mediaId>/
│       ├── metadata.json      ← codec, duration, resolution, etc.
│       ├── source.<ext>       ← inline source file
│       ├── source.link.json   ← OR a link descriptor to an external file
│       ├── thumbnail.jpg
│       └── cache/
│           ├── filmstrip/     ← timeline thumbnails
│           ├── waveform/      ← audio peaks (binned binary)
│           ├── gif-frames/    ← pre-extracted GIF frames
│           ├── decoded-audio/ ← preview audio for non-browser codecs
│           └── transcript.json
└── content/
    └── <hash>/
        ├── refs.json          ← reference count
        └── data.<ext>         ← deduped blob
```

## Safe to edit?

Everything except media source bytes is safe to inspect. Editing
`project.json` externally works; FreeCut picks up changes on next load.

Binary caches (waveforms, decoded audio) are regeneratable — delete and
the app will rebuild them on demand.

## Moving the workspace

You can move this folder to a new location — the app just needs you to
re-pick it via the "Reconnect" prompt on next launch.
