# Changelog

All notable changes to FreeCut. Weekly CalVer: `YYYY.MM.DD` = the Monday of the release week (Mon–Sun).

<!-- Entries below are generated via the `changelog` skill. Newest first. -->

## [Current] — week of 2026-04-13

**Highlights**
- Projects now live on disk in a workspace folder you choose
- Per-clip pitch shift in semitones and cents
- Floating six-band clip EQ panels

### Added
- Projects now live on disk in a workspace folder you choose
- Multi-workspace support with waveform mirroring
- Multi-select projects with marquee and bulk delete
- Trash section with soft-delete, undo, and permanent delete
- Legacy browser-storage migration progress banner
- Per-clip pitch shift in semitones and cents
- Compact DaVinci-style six-band clip EQ with floating panel
- Mixer tuck handle to slide channel strips behind the bus
- Separate project master bus from per-device monitor volume

### Fixed
- Preview no longer fails when media blobs expire
- Disabled tracks remain editable and styled after reload
- Pen mask tracks are now visible in classic timelines
- Transitions stay aligned to source time across splits
- Pen paths default to shapes with 5-second duration
- UI accessibility, transition alpha, and viewport clamp fixes

### Improved
- Compact clip shell for narrow clips with short-circuited fades
- Smoother filmstrip rendering when zooming the timeline
- Smaller 960×540 proxy resolution with worker-side loading

## [2026.04.06] — week of 2026-04-06 to 2026-04-12

**Highlights**
- Unified clip EQ across preview, export, and editor
- AI-powered captioning, text-to-speech music, and scene detection
- Alt+C as alternate split-at-playhead shortcut

### Added
- Clip EQ with five-band presets across preview and export
- SoundTouch-based preview audio replaces WAV path
- Alt+C as alternate split-at-playhead shortcut
- AI-powered media captioning with LFM vision model
- Local MusicGen music generation with presets and cancellation
- Gemma-4 scene cut verification and LFM 2.5 VL alternative
- Fast histogram-based scene detection
- Local model cache management in settings
- Source monitor patch destination pickers
- Delete shortcut routes to keyframe editor when active

### Fixed
- Split linked items together without sync drift
- Glitch transition shader no longer paints black regions
- Context menu submenu clicks no longer deselect items
- Same-origin transition exit no longer pops a frame
- Vorbis audio and nested media play through proxies
- Stale timeline in/out points are clamped

### Improved
- Filmstrip rewritten: no edge gap, pop, or zoom-driven re-renders
- Reduced drag, marquee, and scroll-driven re-renders
- Editor dialogs now lazy-load
- Frame-accurate source time snapping prevents skipped frames

## [2026.03.30] — week of 2026-03-30 to 2026-04-05

**Highlights**
- Nested compound clips with cycle detection
- Local AI Text-to-Speech panel
- AV1 codec export support

### Added
- Nested compound clips with cycle detection and deep-nested rename/delete
- Crop-aware media layout with soft-edge feathering
- SVG import, image filmstrips, and draggable text/shape templates
- Renamed Composition to Compound Clip across UI
- AI Text-to-Speech panel with local WebGPU inference
- AV1 codec support in export with runtime capability checks
- Media library hover-skim preview in program monitor
- Audio preview play button on media cards
- Mixer fader and mute on the bus master channel
- Edge halo system for trim handles with constraint feedback
- Track push/pull handle for multi-track gap adjustment
- Full-column toggle for properties and media sidebars
- Per-card info popover replaces bottom info panel
- Video fade in/out handles applied in preview and export
- Single disable toggle unifies track visibility and mute
- Default FPS, snap, preview quality, and export defaults in settings
- Smart ripple behavior on rate-stretch tool
- Auto-match project canvas and FPS to first dropped video
- Alt+scroll to resize tracks from headers

### Fixed
- GPU transition effect renders when paused on a transition frame
- Sub-pixel seam gone from uncropped edges
- Masks apply in composition space with stable refs
- Clip volume edits persist with stereo waveform channels
- Per-track meter preview during fader drag
- Slide and linked-clip clamping respects transitions and limits
- Duplicate slide limit boxes on neighbor counterparts removed
- Overlapping items on the same track now detected and prevented

## [2026.03.23] — week of 2026-03-23 to 2026-03-29

**Highlights**
- Full editing toolset: trim, ripple, rolling, slip, slide
- Linked audio-video compound clips replace track groups
- Floating mixer with stereo LED meters and real-time fader metering

### Added
- Trim, ripple, rolling, slip, and slide tools with live previews
- Smart zone detection and constraint feedback while editing
- Tool operation overlay with compact limit edges
- Linked audio-video items replace track groups
- Compound wrappers: speed, transitions, trim, slip/slide, linked audio
- Split and join compound wrappers with crossfade playback
- Cut-centered handle-based transitions replace overlap model
- Transition drag tooltip and drop ghost polish
- Audio fade curves with power-curve model and edge snapping
- Media drop zones and track drop preview
- Content-based track drag lane moves
- Track-kind-aware item placement
- Drag-and-drop effects onto clips and draggable adjustment layers
- Floating dockable mixer with stereo LED meters and track colors
- Real-time volume and meter levels during fader drag
- Dopesheet with property accordion groups and marquee selection
- Bezier tangent mirroring, multi-curve overlay, and compact navigator
- Full-height media sidebar with in-panel keyframe editor
- Transition selector dropdown replaces large grid
- Compact source and program monitor toolbars
- Source patch controls moved into the source monitor

### Fixed
- Track resize now feels anchored, Resolve-style
- Transition audio doubling eliminated
- Prewarm worker initialization and transition cold decode stalls

### Improved
- Mixer fader decoupled from store writes for smooth dragging
- Adaptive seek backtracking via keyframe index
- Batch preseek and faster keyframe extraction
- Eager WASM warmup and batch prearm for transitions
- Narrow render-critical store subscriptions

## [2026.03.16] — week of 2026-03-16 to 2026-03-22

**Highlights**
- Pen mode with canvas drop and mask editing
- Audio transcription
- GPU transitions migrated to WebGPU shaders

### Added
- Pen mode with canvas drop, scopes, and interaction lock
- Mask editing with in-panel keyframe editor
- Audio transcription
- Explicit auto-keyframe arming via dopesheet toggle
- GPU shader migration for all transitions with export parity

### Fixed
- Transition playback jitter and scrub stability
- Waveform now renders on initial media drop
- Properties sidebar scrollbar

### Improved
- Export blits GPU composite directly to canvas (no readback)
- Cold-start playback stalls eliminated
- Timeline scroll and zoom rendering optimizations

## [2026.03.09] — week of 2026-03-09 to 2026-03-15

**Highlights**
- New distort and stylize effects with color parameters

### Added
- Distort and stylize effect family with color parameters
- Structured wide-event logging across core features

## [2026.02.23] — week of 2026-02-23 to 2026-03-01

**Highlights**
- Timeline and preview performance overhaul
- Export packet remux fast path

### Fixed
- No more infinite retry storms on failed video source init
- Audio clicks and spurious video warnings eliminated during playback
- Keyframed transforms apply on ruler frame seeks
- Stale fast-scrub renders no longer flash after scrub exit
- Gizmo and keyframe scrub stay in sync with the preview frame
- Hidden adjustment tracks now respected in canvas renderer

### Improved
- Indexed stores, streaming proxies, and cost-aware resolution
- Memory-aware filmstrip cache with batch optimizations
- Export: packet remux fast path and streaming source
- Strict-decode video frames in edit 2-up overlay with legacy fallback
- Chunked window optimizations for export, timeline, and waveforms

## [2026.02.16] — week of 2026-02-16 to 2026-02-22

**Highlights**
- Ripple, rolling, slip, and slide editing tools with 2-up previews
- Font picker with searchable catalog and live preview
- NLE-style waveforms and FCP-style transition bridge

### Added
- Ripple edit tool with downstream clip shifting
- Rolling edit with 2-up frame comparison overlay
- Slip and slide editing with live filmstrip preview
- Font picker with searchable catalog and live preview
- Proxy playback toggle and proxy management UI
- Option to delete local files when deleting a project
- Single-page new project with inline template picker
- Undo history depth setting
- AC-3/E-AC-3 codec support
- Streaming partial audio decode with wavesurfer-style rendering
- Sub-composition audio extraction in export
- Animated WebP support and transparent GIF rendering
- Per-track Close Gaps button replaces magnetic mode
- 3-row clip layout with dedicated label row
- Project-scoped cache, thumbnail, and proxy controls
- NLE-style continuous filled-path waveform rendering
- FCP-style transition bridge with live ripple preview
- Shift+Z to zoom to 100% at cursor or playhead
- Interactive razor mode with tool-aware playhead colors
- Brave browser support guidance in media library

### Fixed
- Stale properties panel on clip selection
- Audio stable across split boundaries during playback
- Playback and proxy seek no longer hang
- Clock frozen while tab is hidden prevents reseek stutter
- Recovery from stale blob URLs after tab inactivity
- 1px gaps from clip edge rounding eliminated
- Block split and razor cuts inside transition overlap zones
- Stale asset errors now show a save prompt

### Improved
- Video source pooling reduces transition flicker

## [2026.02.09] — week of 2026-02-09 to 2026-02-15

**Highlights**
- Pre-compositions with 1-level nesting
- Track groups with gate behavior
- Animatable volume and gain keyframes

### Added
- Track groups with collapse, drag, and gate behavior
- Source monitor with In/Out points and Insert/Overwrite editing
- Animatable volume and gain via keyframes
- Pre-compositions: group clips into nested sequences
- Reverse clip, freeze frame, and magnetic timeline mode
- Bento layout presets with interactive drag-to-swap canvas
- Inline preview player in the export complete view
- On-demand 720p proxy video generation
- Drag-to-resize sidebars with persisted widths
- Source monitor with split layout and slide-up media info
- Hover-based keyboard shortcuts for source monitor

### Fixed
- Transition system overhaul: split-clip stutter and flip flash gone
- Export corner radius and audio quality now match preview
- Correct source-FPS conversion for clip trim points
- Toggling track visibility no longer leaves stale opacity
- Segments and transitions can move on hidden tracks
- Prevent dropping items onto group tracks
- Export shortcut (Ctrl+E) overrides Chrome default

### Improved
- App-wide error boundaries and toast notifications
- Frame callback drift correction and smoother resume playback
- Filmstrip extraction throttled for lower CPU load

## [2026.02.02] — initial release

**Highlights**
- First public beta — multi-track video editor in the browser
- Custom playback engine with WebGPU acceleration
- Export via WebCodecs with client and server render modes

### Added
- Multi-track timeline: drag, drop, trim, razor, zoom, snap
- Media library with import, metadata, thumbnails, and waveforms
- Live preview with resizable layout
- Transition library with 24+ effects
- Keyframe animation with Bezier easing and graph editor
- GPU effects and blend modes
- Video export with MP3 audio and animated GIF support
- Project save/load with schema versioning and migrations
- Project bundle (ZIP) export and import
- Customizable keyboard shortcuts
- In/out points for selective timeline exports
- Hover playhead preview with video seeking
