# Changelog

All notable changes to FreeCut. Weekly CalVer: `YYYY.MM.DD` = the Monday of the release week (Mon–Sun).

<!-- Entries below are generated via the `changelog` skill. Newest first. -->

## [Current] — week of 2026-06-29

### Added
- Edit ProRes footage — import, preview, thumbnails, and export
- Procedural motion modifiers — drift, breath, shake, sway, and spin, with one-click bake to keyframes
- Audio-reactive motion that animates from your clip's sound
- New GPU effects: gradient map, VHS, CRT, Droste, and block glitch
- ASCII effect now supports custom text, fonts, and glyph character sets

### Fixed
- Fixed an export crash triggered by certain layered effects
- Preview no longer hangs mid-clip during playback

### Improved
- Keyframe graph editor gains fit-to-view, a grid, and smoother scrolling
- Clearer Animate workflow with procedural and keyframe state indicators

## [2026.06.22] — week of 2026-06-22 to 2026-06-28

### Added
- Reorder tracks by dragging the track header — clip rows follow along

### Fixed
- Track reordering no longer drops transitions between composition clips
- Audio now plays for MKV and other non-native file containers
- Timeline momentum scrolling stays consistent across display refresh rates

### Improved
- Clips start faster when the playhead reaches them (pre-mounted ahead of time)
- Snappier tooltips and tactile press feedback, with reduced-motion support
- AI models are cached on disk so they don't re-download each session

## [2026.06.15] — week of 2026-06-15 to 2026-06-21

### Added
- New Animate workspace — keyframe animation with a dopesheet, curve (graph) editor, and side-by-side split view
- Save, reuse, and apply animation presets, with a library that travels with exported projects
- On-device transcription with the new Parakeet engine (Whisper fallback) — auto-caption clips, then search and edit transcripts in a dedicated panel
- Redesigned Color workspace — grade, effects, and keyframes in three columns with a reworked navigator
- Live animated A/B previews in the transition picker, rendered through real GPU shaders
- Live GPU-rendered previews in the effect picker
- Drag text and shape presets straight onto the preview canvas as overlay layers
- Track-size and add-track controls in the timeline header
- Color picker hex input with live preview

### Fixed
- Ctrl+click now reliably toggles clip selection
- Middle-click pans the timeline instead of starting a clip drag
- Delete/Backspace no longer deletes clips while editing a transcript
- Fixed decoder and video-source memory leaks during long editing sessions

### Improved
- Smoother playback of clips with keyframe animation
- Smoother scrubbing — preview reuses zero-copy video frames and cached text and warps

## [2026.06.08] — week of 2026-06-08 to 2026-06-14

### Added
- DaVinci-style Color workspace — color wheels, curves, LUT import, grade presets, bypass, and copy/paste grading
- Video scopes in the Color workspace — waveform, vectorscope, and histogram
- Switch between Edit and Color workspaces, with your layout remembered
- In-app user guide, linked from the toolbar

### Fixed
- Project list no longer breaks when a project file is corrupt

### Improved
- Keyframe editor — guided empty state, mode legend, and clearer draggable controls
- Faster playback cold-start when returning to a backgrounded tab

## [2026.06.01] — week of 2026-06-01 to 2026-06-07

### Added
- Audio clips show an interactive waveform instead of a flat placeholder
- Hear audio while you scrub and skim the timeline
- Searchable keyboard-shortcut editor with conflict detection and reset
- Projects scan for missing media on load and flag what's broken
- Export dialog warns before risky, very long renders

### Improved
- Auto-save is now on by default, with clearer onboarding and import feedback

## [2026.05.25] — week of 2026-05-25 to 2026-05-31

### Added
- In-app render queue — line up several exports and they render one after another, surviving a page refresh
- One-click quality presets in the export dialog
- Exports now save to a per-project folder, with a notice showing where files land
- Automatic caption styling, with per-item progress in the AI panel

### Fixed
- Waveforms render from true audio peaks and stay sharp when zoomed in
- Waveforms no longer flash a skeleton when moving a clip to another track
- Preview no longer jumps when entering pen/path edit mode
- Preview stays continuous through transitions during playback
- Remaining placeholder strings are now translated across all 9 languages

### Improved
- Much smoother timeline zooming and scrolling, especially with many clips on screen
- The editor stays responsive while audio loads — decoding now runs in the background

## [2026.05.18] — week of 2026-05-18 to 2026-05-24

### Added
- Hold (stepped) interpolation for keyframes
- Language switcher on the projects page, with more panels translated (text tools, transitions, scene browser)

### Fixed
- Rotated videos display the correct orientation in skim preview and exports
- Scrub overlay stays aligned and the skim indicator sits flush on clip edges
- Transitions on same-clip (A-A) splits now render correctly
- Splitting a reversed clip keeps both halves continuous

### Improved
- Filmstrips and waveforms render smoother while zooming the timeline
- Faster filmstrip reload from disk cache when reopening projects

## [2026.05.11] — week of 2026-05-11 to 2026-05-17

### Added
- Translated UI in 9 languages: English, Spanish, French, German, Portuguese (Brazil), Turkish, Japanese, Korean, and Chinese (Simplified)
- Language picker in editor settings, with auto-detection from your browser
- Effect names, timeline labels, and media library all translate alongside the rest of the UI
- Supertonic voice engine added to AI text-to-speech
- Install FreeCut as a desktop app, with prompts when new versions ship

## [2026.05.04] — week of 2026-05-04 to 2026-05-10

### Fixed
- Filmstrips reload reliably after reopening a project from your workspace folder

## [2026.04.27] — week of 2026-04-27 to 2026-05-03

### Added
- Motion, iris, shape, and DaVinci-style wipe transition packs
- Lens warp zoom transition
- Liquid distort transition
- Searchable transition preset picker
- Tunable transition parameters in the properties panel
- Transition placement controls with alignment-aware drops
- Compound clips can now host transitions
- Reset buttons on transition parameter sliders
- Extract embedded subtitles from video files (works for MKVs over 2GB)
- Subtitle segments on the timeline with live cue overlay during playback
- Cue editor in the inspector with bold/italic/underline, positioning, and click-to-seek
- Subtitle style presets, including a TikTok-style preset
- Burn or embed subtitles in exports
- Reverse playback for video, audio, and GPU effects
- Reverse-aware exports preserve the reversed audio and video
- Detect and remove silence across selected clips with preview overlay and ripple delete

### Fixed
- Effect drag overlays no longer stick or hijack adjacent lanes
- Transition preset selection syncs with the chosen direction
- Removed the transition duration cap
- Multi-channel audio downmixes to stereo with proper coefficients on export
- Subtitle cues trim and split alongside their segment
- Cue time inputs accept 4-digit seconds without truncating
- Preview no longer drifts from stale player frames while paused
- Paused scrub stays on the rendered path with sharp output

### Improved
- Subtitle cue editor stays responsive with hundreds of cues
- Smoother playback start when entering a transition

## [2026.04.20] — week of 2026-04-20 to 2026-04-26

### Added
- Stacked text spans for mixed-style titles
- Text box backgrounds and scalable text presets
- Richer text animation presets grouped by layout
- Animated text previews in the runtime and editor
- Promote span text controls and move preset selector to the inspector
- Canvas snap system overhaul with visual guides
- Video flip transforms (horizontal and vertical)
- Transform anchors in preview and export
- Anchor and flip controls keyframeable inside compound clips
- Keyframeable color effect parameters
- MOSS multilingual TTS in the browser
- Replace Kitten TTS with Kokoro TTS
- Collapsible AI panel sections
- Import media from a direct URL
- Dedup media imports and captions by content
- Move scenes toggle next to search as a segmented control

### Fixed
- Animated crop renders correctly in exports
- Curves effect now uses point-based S-curves
- Compound clip hover preview renders through the canvas engine
- Restore middle-click drag to resize the A/V divider from anywhere
- Smooth live pitch preview on Semi Tones and Cents sliders
- Pixel-snap audio volume line to avoid sub-pixel blur
- Stop nested video black flashes from stale references
- Project list no longer blanks with a spinner during edits
- Add Effect picker no longer flashes on first open
- Live-trim attached captions during regular trims
- Batch playback speed undo as a single step

## [2026.04.13] — week of 2026-04-13 to 2026-04-19

### Added
- Per-clip pitch shift in semitones and cents
- Compact DaVinci-style six-band clip EQ with floating panels
- Mixer tuck handle to slide channel strips behind the bus
- Separate project master bus from per-device monitor volume
- AI caption generation with timeline insertion
- AI analysis indicators in the media library
- Find scenes with a similar palette
- Color mode with library palette grid
- Scene browser hotkey
- Projects now live on disk in a workspace folder you choose
- Multi-workspace support with waveform mirroring
- Multi-select projects with marquee, bulk delete, and double-click to open
- Trash section with soft-delete, undo, and permanent delete
- Legacy browser-storage migration progress banner
- What's New dialog with weekly changelog viewer
- Source monitor scrubbing matches timeline playback

### Fixed
- Disabled tracks remain editable and styled after reload
- Pen mask tracks are now visible in classic timelines
- Pen paths default to shapes with 5-second duration
- Transitions stay aligned to source time across splits
- Preview no longer fails when media blobs expire
- UI accessibility, transition alpha, and viewport clamp fixes

### Improved
- Compact clip shell for narrow clips with short-circuited fades
- Smoother filmstrip rendering when zooming the timeline
- Smaller 960×540 proxy resolution with worker-side loading

## [2026.04.06] — week of 2026-04-06 to 2026-04-12

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

### Added
- Distort and stylize effect family with color parameters
- Structured wide-event logging across core features

## [2026.02.23] — week of 2026-02-23 to 2026-03-01

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
