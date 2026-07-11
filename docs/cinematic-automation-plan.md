# Cinematic Automation Plan

## Goal

Generate a polished cinematic video from still images, narration, music, and sound effects with minimal user editing. The target is not a basic slideshow. It should feel like a designed motion scene: story-aware pacing, strong 2.5D image movement, image-to-narration matching, music ducking, and sound effects that match the audiobook content.

## Current App Strengths

- Timeline editing, generated media insertion, keyframes, text presets, karaoke captions, image-to-audio matching, and audio ducking already exist.
- Still-image animation already has camera move/keyframe infrastructure.
- Local transcription can provide timed narration segments.
- MusicGen can generate audio clips in-browser and insert them into timeline tracks.
- The Audiobook SFX panel can transcribe narration, plan cues, generate SFX, and place them at narration-aligned frames.

## Gaps Found

- The first SFX planner was too generic for high-end results. It could find obvious words like storm, door, clock, and magic, but it missed editorial, romance, legal, newsroom, secrecy, power, privacy, and reveal beats.
- A long audiobook needs more than a few short SFX hits. It needs scene beds plus fewer, meaningful accent cues.
- MusicGen-only SFX can sound synthetic unless prompts are precise and the cue plan is story-aware.
- Generated SFX must be mixed as foreground accents or background beds intentionally. A one-volume-fits-all insert makes important effects feel faint and cheap.
- Raw generated SFX need a post-production pass. Without EQ, compression, stereo polish, fades, and peak normalization, they can still feel demo-grade even when the cue is audible.
- Still-image animation quality still depends on depth/subject separation. The app now has preset-driven multi-axis camera moves, but true subject/background parallax needs stronger automatic depth maps.
- Fully cinematic output still needs deeper depth-map quality analysis and real waveform-aware narration/music/SFX balance analysis. The app now has pre-generation readiness scoring, timeline-level automation auditing, stem-aware timeline mix forecasting, rendered-frame visual QA for sharpness, black levels, contrast, and frame-to-frame motion, plus finished-export audio QA for loudness, clipping, dynamics, silence, and stereo width.

## Implementation Plan

1. Analyze narration with transcription.
2. Build a story beat map from transcript segments.
3. Match still images to transcript windows instead of distributing images evenly only by duration.
4. Apply cinematic image animation presets:
   - push-in plus pan
   - push-in plus pan-down
   - push-in plus pan-right
   - foreground-heavy parallax
   - slower background drift
5. Generate SFX in two layers:
   - scene beds for location and mood
   - accent cues for concrete story beats
6. Insert SFX onto dedicated timeline lanes with fades and safe overlap handling.
7. Duck music beds under narration/SFX with editable volume keyframes.
8. Produce a preview pass before full export.
9. Add a rating loop so the app can warn when a result is too sparse, too repetitive, too quiet, too blurry, or not cinematic enough.

## Update Made

The Audiobook SFX planner now includes story-aware cinematic categories for:

- chapter/title stings
- newsroom ambience
- folder and paper foley
- phone and keyboard detail
- public power and legal reveal beats
- secrecy, privacy, agency, and client beats
- character name reveals
- decision beats

The planner also now prefers category diversity, so it is less likely to repeat the same kind of sound over and over. The UI SFX count ceiling was raised from 12 to 36, and SFX duration can now use the MusicGen model's full 30-second limit for atmosphere beds.

The latest SFX pass adds cinematic prompt reinforcement, per-cue MusicGen guidance strength, and per-category mix volume. Name reveals, folder slides, legal/power reveals, doors, metal, and phone/keyboard details now insert as audible foreground accents, while wind, town, water, and room tone stay lower as supporting beds. The Audiobook SFX panel also now defaults to longer 8-second SFX generations instead of short 4-second cues.

The newest SFX quality pass adds automatic cinematic mastering for each generated audiobook sound effect before it is imported. Generated clips are decoded, shaped with a film-style EQ chain, compressed, lightly widened, faded, peak-normalized, saved as mastered WAV assets, and tagged as `cinematic-mastered`. The prompts were also tightened toward feature-film sound-library foley, distinct foreground effects, and controlled ambience beds instead of vague synthetic audio.

The latest image-motion pass adds an undoable timeline action that applies a dramatic story-camera rotation to selected still images. The Audiobook SFX workflow can now match stills to narration and, with a separate switch, automatically apply multi-axis camera moves such as push plus pan, push plus tilt-down, arcs, and dutch pushes. This directly addresses the reference requirement that each still frame needs more than one camera movement.

The latest quality-gate pass adds a Cinematic Readiness score to the Audiobook SFX workflow. After analysis, the app now rates whether the selected narration, still images, music bed, image-matching option, cinematic motion option, cue density, cue variety, ambience beds, and foreground SFX accents are likely to produce a cinematic automatic pass. The panel surfaces a 0-10 score, key metrics, and the top issues before the user spends time generating all SFX.

The newest timeline-audit pass inspects the actual timeline after automation. It scores whether the narration span is covered by still images, how many stills have multi-axis camera keyframes, whether Audiobook SFX clips are present, whether music beds overlap the scene, and whether those music beds have dialogue-ducking volume keyframes. The Audiobook SFX generation flow now also auto-ducks overlapping music beds after inserting generated SFX, so the app produces a more mixed scene instead of leaving music at full level under narration.

The latest rendered-output QA pass adds a cinematic frame-quality check to completed video exports. After export, the app samples frames from the finished preview and scores sharpness, crushed blacks, overall darkness, contrast, hot highlights, and frame-to-frame motion. This gives the user a direct warning when the exported video still looks blurry, too black, too flat, too static, or too abrupt.

The latest sound-design pass makes audiobook SFX more pronounced and cinematic. Foreground prompts now ask for layered film-library sound design, timeline insertion boosts foreground and ambience cues more assertively, the default audiobook SFX count is higher, and the mastering chain adds controlled low impact, motion air, sparkle, saturation, compression, stereo width, fades, and peak normalization. A five-minute review mix from `full_story.mp3` measured `-18.5 LUFS` / `-1.3 dBTP`, compared with the prior SFX bed at roughly `-35.3 LUFS`, which explains the audible improvement.

The latest export-audio QA pass adds a cinematic audio check to completed exports. The app now decodes the exported audio when the browser supports it and scores RMS loudness, true peak risk, dynamic range, dead-air ratio, clipping ratio, and stereo spread. This catches common "not movie quality" failures such as audio being too quiet, clipped, over-flat, full of gaps, or collapsed to mono/narrow output.

The newest role-aware sound-design pass addresses the user's "audible but not cinematic" review. Every planned cue is now tagged as `ambience`, `foreground`, `impact`, or `transition`; longer narration automatically reserves cue slots for continuity beds instead of relying only on isolated hits; and the readiness panel now exposes foreground, impact, and ambience counts. The mastering chain now targets perceived body with RMS-style gain before soft limiting and peak normalization, so a generated effect with a high transient but weak body is less likely to remain faint under narration.

The latest stem-aware timeline mix pass closes the previous final-mix planning gap. Generated audiobook SFX now preserve their role on the timeline, and the Timeline audit estimates narration gain, ducked music level under narration, foreground SFX level against narration, ambience level against narration, and a 0-10 stem mix score. It now flags music that competes with dialogue, music that vanishes, foreground SFX that are still too faint, SFX that are too hot, ambience beds that are too loud, and cue plans with no impact or transition accents.

The newest director-standard audio pass addresses the user's 2.5/10 review that the effects were audible but not cinematic. The planner now defaults to 32 cues and 12-second generations, adds editorial `Story hit` impact cues when the narration has dramatic meaning but no literal foley keyword, and inserts roles at film-mix levels: ambience stays controlled, foreground accents sit forward, and impact/transition cues get the strongest placement. The mastering chain now targets more foreground/impact RMS body, adds a controlled cinematic tail, strengthens low impact/motion air, adds transient snap for punctuation cues, and uses a stronger soft limiter. Readiness and timeline audit thresholds are stricter, so foreground SFX that merely exist but sit below the narration no longer pass as cinematic. A five-minute local review mix from `full_story.mp3` is at `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_DIRECTOR_MIX_V4_MOVIE_5min.mp3`; its SFX bed measured about `-24.7 LUFS`, compared with the prior bed at roughly `-35.4 LUFS`, and the final mix measured about `-17.1 LUFS` / `-0.9 dBTP` / `7.7 LRA`.

The latest studio-scene audio pass addresses the follow-up review that the SFX still did not sound like movie-quality sound design. The app planner now asks for clearer three-layer movie punctuation cues with sub body, crisp Foley transient, and airy decay; long narrations automatically add `Scene turn hit` punctuation anchors instead of relying only on literal transcript keywords; and generated SFX timeline fades are now role-aware, with immediate impact hits and longer ambience fades. A repeatable local review helper lives at `scripts/generate-cinematic-sfx-preview.py`. Its clean five-minute review mix is `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V5_STUDIO_SCENE_5min.mp3`, with a bolder audition at `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V5_STUDIO_SCENE_BOLD_5min.mp3`. The controlled mix measured `-16.9 LUFS` / `-1.8 dBTP` / `4.2 LRA`; the bold audition measured `-17.1 LUFS` / `-1.3 dBTP` / `4.7 LRA`; and the isolated SFX stem measured about `-25.1 LUFS` with safe true peak around `-7.2 dBFS`.

The latest depth-readiness pass makes the timeline audit stricter about the specific 3D parallax issue in the reference videos. Timeline items can now carry `cinematicDepthRole`, `cinematicDepthSourceId`, and `cinematicDepthQuality` metadata for subject, foreground, midground, background, or depth-map plates. The audit now reports depth-prepared image count, prepared percentage, parallax layer count, depth layer groups, and a 0-10 depth readiness score. It flags flat multi-axis camera moves as `timeline-depth-flat`, so a zoom-plus-pan no longer passes as reference-style 2.5D parallax unless the scene has real subject/background or depth-map prep. The Audiobook SFX panel surfaces Depth, Layers, and Prep metrics in the Timeline audit card.

The latest depth-layer generation pass reduces the ghosting risk that happens when a subject cutout moves over the unchanged original still. Automatic depth prep now generates three assets per selected still: a depth-derived background plate, a transparent subject cutout, and a hidden depth-map PNG. The timeline action swaps the source still to the generated background plate, adds the subject cutout above it, keeps the depth map hidden as source evidence, and then applies role-aware camera motion so the background moves less than the subject. This is not full neural inpainting yet, but it is a stronger 2.5D setup than using the original still as both background and subject source.

The newest depth-quality audit pass closes a loophole where any subject/background/depth-map layer group could score as parallax-ready even if the generated mask was weak. Timeline audit now reports average depth quality, counts low-quality depth layers, lowers the combined `Ready` score when `cinematicDepthQuality` is poor, and flags `timeline-depth-low-quality`. The Audiobook SFX panel surfaces this as `Depth Q`, so a cut-out, ghosted, or unreliable mask no longer gets treated like a clean high-end 2.5D plate.

The latest staged-camera pass addresses the "two camera movements per frame" visual requirement from the reference videos. The camera preset catalog now includes staged push-plus-pan and staged push-plus-tilt moves. These emit three timing points per property: a slight cover zoom at frame 0, a fast push-in beat near the middle of the shot, and the pan/tilt completion at the final frame. The cinematic story rotation now starts with these staged moves, so automatic audiobook/image generation prefers a zoom-then-pan or zoom-then-tilt shot instead of a single straight-line Ken Burns move.

The latest export-motion QA pass makes the finished-render check stricter about the same requirement. The cinematic frame-quality analyzer now estimates dominant motion vectors between sampled frames, reports motion magnitude/path metrics, and flags steady single-axis motion as under-directed. This helps catch a final video that technically has frame-to-frame movement but still looks like a simple pan rather than a staged cinematic push-plus-pan/tilt scene.

The latest reference-motion QA pass turns that cinematography standard into a separate score. Completed video exports now report a `Drama` metric from 0-10, based on visible frame movement, motion-vector energy, multi-axis balance, and staged timing variation. A sharp render with generic pixel movement can now drop from `excellent` to `strong` if it lacks the dramatic push-plus-pan/tilt energy of the reference. The export panel flags this as `reference-motion-too-soft`, so a video that is technically moving but still feels under-directed will not pass as cinema-ready.

The reference-motion QA has now been calibrated against the uploaded CapCut parallax reference rather than only a generic motion target. A local OpenCV/FFmpeg review of `Create Amazing 3D PARALLAX Effect in CapCut-854x480-mp4a.mp4` measured 30 fps, 456.3 seconds, mean frame delta about `11.1`, P90 frame delta about `39.4`, and top dramatic windows around `45-56` frame delta with optical-flow motion around `4.5-6.0` and axis balance around `0.65-0.86`. The export `Drama` score now stores this as an explicit `CapCut 3D parallax reference` profile and uses a stricter pass threshold, so mild diagonal motion is no longer treated as reference-grade.

The latest theatrical-camera pass makes the automatic image animation more like the sharp reference edits. The camera preset catalog now includes six `surge` moves that animate zoom, horizontal travel, and vertical travel from the first frame, with a fast early push and a controlled final settle. The cinematic story rotation now starts with varied diagonal surge and slight dutch-angle shots before the older staged push-pan/tilt moves, so an audiobook image sequence gets more dramatic multi-direction coverage instead of repeating a simple zoom-plus-one-axis move.

The latest motion-audit pass makes that standard testable after generation. Timeline audit now separates `Motion` from `Staged`: `Motion` counts stills with basic zoom-plus-pan/tilt/roll, while `Staged` counts stills whose zoom and movement properties have at least three timing beats. A timeline with plain two-keyframe motion can no longer pass as reference-style camera work without a warning. The Audiobook SFX panel now surfaces staged camera coverage directly in the Timeline audit card.

The newest reference-strength camera pass moves that standard upstream into generation. The six automatic `surge` story-camera presets now hit their mid-beat earlier, zoom farther, and travel more on both x/y axes. The first automatic story shot now reaches about `1.36x` zoom with a stronger diagonal push, while dutch surge shots reach about `1.38x`. This makes the generated image motion more likely to pass the stricter CapCut-calibrated `Drama` export QA instead of only warning after a soft render.

The latest reference-readiness audit pass gives the app one combined post-generation signal instead of leaving the user to interpret separate metrics. Timeline audit now calculates a `Ready` score from image coverage, multi-axis motion, staged camera beats, depth/parallax readiness, music ducking, SFX role coverage, and stem mix balance. If the combined score is below the stricter reference threshold, the panel flags `timeline-reference-not-ready`, even when some individual pieces exist. This catches timelines that have depth and audio but still only use plain two-keyframe motion, or timelines that move but lack the full movie-style motion/depth/audio stack.

The latest finishing automation pass wires the visual polish into the one-click audiobook workflow. The Audiobook SFX panel now has a default-on `Cinematic finishing` switch. When enabled, selected stills and generated visible depth layers receive the cinematic finishing stack automatically after matching/depth/motion: lifted blacks to avoid crushed shadows, controlled contrast, mid-detail/sharpening, and subtle grain. The pass skips hidden depth-map plates and preserves any manual grade already on the clip, so the automatic workflow feels sharper and more finished without destroying user color work.

The readiness scoring now accounts for that finishing pass. If `Cinematic finishing` is off, the Cinematic Readiness card reports `Finish: no`, applies a score penalty, and warns that the result may look softer or less polished. This keeps the app from presenting a visually unfinished automatic setup as if it were ready for a high-end render.

The latest pre-generation depth-readiness pass closes a planning blind spot. Cinematic Readiness now knows whether `Depth-map parallax layers` is enabled and whether the browser supports the depth-prep pipeline. The readiness card reports `Depth: auto`, `Depth: off`, or `Depth: unsupported` and applies warnings before generation if the automatic pass would fall back to flat still-image motion. This matters because the reference look depends on subject/background separation, not just zoom-and-pan keyframes.

The latest shot-rhythm pass makes image-to-narration matching more editorial. When narration transcript captions are present, selected still images now snap their cut boundaries to spoken transcript cue starts instead of using only evenly divided durations. The audiobook workflow also copies newly loaded or generated media transcripts onto the selected narration timeline item before matching, so fresh transcription can immediately drive shot timing, music ducking, and timeline audit.

The newest story-cut selection pass makes those transcript-aligned cuts more dramatic. When multiple caption starts are available near a target cut, the matcher now gives extra pull to cues containing story-turn language such as truth, danger, secret, decision, reveal, suddenly, finally, promise, power, judge, or senator. This means automatic image cuts favor narrative turns over plain nearby lines, making the still-image sequence feel edited to story beats instead of only aligned to transcript timing.

The newest image-story matching pass makes selected still ordering content-aware when metadata provides enough signal. After transcript or fallback shot boundaries are chosen, the matcher compares each segment's transcript text with image labels, media filenames, tags, and AI captions. Images with strong overlap are assigned to the matching story segment, while unmatched images keep their original order. The transcript boundary picker also now checks future-cut feasibility before letting a dramatic cue win, so a story beat cannot pull one cut so far that later transcript cuts become impossible.

The latest post-match image-story audit closes the verification loop for that feature. Timeline audit now measures how many labeled stills actually match the narration cues they overlap after automation has run, reports `Imgs` matched/total in the Audiobook SFX panel, feeds the match rate into the reference-readiness score, and flags `timeline-image-story-mismatch` when enough labeled stills are measurable but the order/content no longer follows the story.

The newest automatic pacing fallback removes that last even-spacing weakness. When transcript cue timing is missing or too sparse, image-to-audio matching now uses a deterministic cinematic rhythm pattern instead of equal slices. The total narration span is still preserved exactly, but shot durations vary enough to avoid mechanical slideshow timing and are then scaled through the existing keyframe retiming path.

The newest editorial-rhythm audit pass makes that timing testable after generation. Timeline audit now reports average still-image shot length, shot-length variation, transcript-aligned cut percentage, and a 0-10 `Rhythm` score in the Audiobook SFX panel. It flags timelines where still-image cuts miss narration cue starts, where average shots run long enough to feel like a slideshow, or where the edit rhythm is too flat even if the images technically cover the narration span.

The latest generated-SFX source gate responds directly to the 2.5/10 review that audible effects still sounded cheap. When `Audition stronger SFX takes` is enabled, the app now sets a minimum source-quality floor for foreground, impact, and transition cues. If the best generated take still scores below that floor, the workflow attempts up to two stricter rescue takes with prompts that prioritize concrete Foley, theatrical transients, low-mid body, and movie-library realism before mastering and timeline placement.

The newest theatrical SFX pass responds to the 2.5/10 review that the effects were audible but still not movie-quality. The planner now defaults to 40 cues and 14-second generations, with stronger major-studio prompt language, more scene-turn impact anchors, hotter role-aware timeline placement, and stricter timeline-audit thresholds for faint foreground SFX. The mastering chain now targets more RMS body, low-mid weight, transient snap, motion air, and cinematic tail before soft limiting and peak normalization. The local review helper now renders a V6 theatrical audition at `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V6_THEATRICAL_5min.mp3`; its isolated SFX stem measures about `-14.4 LUFS`, dramatically hotter than the prior `-25.1 LUFS` stem, while the delivered MP3 keeps safe playback headroom at about `-18.9 LUFS` / `-2.6 dBFS` / `6.7 LRA`.

The latest audiobook mix pass closes the missing-score gap that made generated SFX feel exposed and demo-like. The Audiobook SFX workflow now has an `Auto cinematic score bed` switch. When no overlapping music bed exists, the app generates a restrained MusicGen underscore from the narration transcript, imports it, tiles it under the full narration span on an `Audiobook Music` track, then inserts SFX and applies ducking. This gives the automatic mix a film-style foundation before foreground foley, ambience, and impact cues are judged.

The latest SFX source-quality pass addresses the remaining problem that the first generated MusicGen take can be audible but still weak, thin, narrow, or mostly empty. The Audiobook SFX workflow now has an `Audition stronger SFX takes` switch. For impact, transition, and strong foreground cues, the app can generate an alternate cinematic take, analyze each source for RMS body, peak strength, crest, silence ratio, duration, and stereo spread, then keep the stronger source before mastering and timeline import. The history entry records the selected source score and audition take count so the user can see when the app kept a better take.

The latest film-mix correction responds to the user's follow-up 2.5/10 review that the SFX were audible but still not cinematic. The planner now caps repeated cue categories so one kind of hit does not dominate the opening, impact prompts ask for a physical three-stage film punctuation cue, and the timeline insertion separates audiobook SFX into ambience, Foley, and impact tracks. The local preview helper now renders ambience and event stems separately: only the ambience bed is ducked under narration, while Foley and impact events stay forward. A new five-minute review mix is `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V8_FILM_MIX_5min.mp3`; the final mix measured about `-16.0 LUFS` / `6.6 LRA` with safe peak headroom, the ambience bed measured about `-37.2 LUFS`, and the event stem measured about `-15.5 LUFS`. The cue plan is now 24 planned cues instead of an overstacked wall of repeated title hits.

The newest studio-library pass addresses the remaining quality ceiling: if the generated source sounds cheap, no mastering chain can fully make it movie-grade. The Audiobook SFX workflow now has a `Use imported SFX first` switch, enabled by default. It scores imported project audio against each planned narration cue by role, cue label, tags, filename, source text, and duration, then places the best real asset on the timeline before falling back to MusicGen. This lets a user import professional Foley, impacts, transitions, and ambience beds, and the app will automatically choose and align them to the narration beats. Completion messaging reports how many cues came from imported SFX, and generated fallback cues still use the existing audition/mastering path.

The latest source-quality readiness pass makes that quality ceiling visible before generation. The Cinematic Readiness score now knows whether imported SFX matching is enabled, how many planned cues matched real imported assets, and whether those matches cover foreground or impact moments. If no imported studio SFX match, or if only background beds match while dramatic cues fall back to generated audio, the readiness card applies a penalty and surfaces a warning. The panel now shows `Studio SFX` matched/total so an audible-but-cheap sound pass cannot be mistaken for a film-ready mix.

The latest generated-fallback sweetening pass improves the cases where no studio-library asset exists. Impact and transition cues now receive a more theatrical generated-source polish: reverse-air lead-in, delayed reinforced low-body hit, transient snap, wider motion air, and a longer cinematic tail before RMS normalization, limiting, fades, and peak normalization. Generated impact placements now start about a third of a second before the narration beat so the lead-in can build into the story moment instead of starting flat on top of it. This does not replace real Foley and impact libraries, but it should lift generated-only cues above the previous "audible but cheap" result. The local preview helper now renders `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V9_THEATRICAL_HITS_5min.mp3`; its delivered mix measured about `-16.1 LUFS`, `7.4 LRA`, and `-1.4 dBTP`.

The newest story-beat SFX readiness pass checks whether sound design is narratively placed, not just present. When a transcript is available, Cinematic Readiness now detects dramatic narration beats such as truth, choice, danger, secrets, promises, privacy, judges, senators, and reveal language, then measures whether a foreground or impact cue lands nearby. The panel surfaces this as `Beats` covered/total and warns with `sfx-story-beats-undercovered` when dramatic beats are not supported by audible SFX. This prevents a plan with enough total cues from passing when the cues miss the actual story turns.

The latest story-beat repair pass moves that same standard into the SFX planner. After keyword and editorial cues are selected, the planner now checks dramatic transcript segments and inserts additional `Story hit` impact cues for uncovered beats when cue budget remains. This means the automatic plan actively tries to support the actual narrative turns before the readiness card has to warn the user, rather than only counting total SFX density.

The newest post-generation story-beat audit verifies that those planned cues actually landed in the timeline. Timeline audit now reads transcript captions from the narration item, detects dramatic story beats, and measures whether foreground, impact, or transition SFX clips overlap those beats within an editorial timing window. The Audiobook SFX panel surfaces this as `Beats` covered/total next to the post-generation `Ready` score and flags `timeline-story-beats-undercovered` when dramatic narration moments are left with only ambience or no nearby effect.

The newest movie-Foley correction responds to the review that the V4 mix was audible but still only about 2.5/10 because the effects did not sound like film sound design. The analysis found the delivered V4 file was already technically loud enough at about `-17.1 LUFS`; the weak point was source texture, not bitrate or final level. Generated SFX scoring now measures transient contrast, envelope movement, and activity so loud but flat synthetic booms are penalized, and the mastering sweetener adds wider pre-whoosh, impact crack, Foley texture, stronger low body, room bloom, and longer cinematic tails. The local review helper now renders `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V11_MOVIE_FOLEY_5min.mp3` plus a 24-bit WAV reference. The V11 master measures about `-15.8 LUFS`, `10.2 LRA`, and `-1.6 dBFS` true peak, with separate ambience/event stems preserved for review.

The V12 film-Foley redesign responds to the follow-up review that the SFX were now audible but still not high-quality or cinematic. The local preview generator now builds each major hit from multiple source-like layers: tension lift, licensed whoosh/swell when available, sharper physical transient, debris scatter, close desk/foley texture, and room slap instead of a smooth synthesized boom. The cue plan also fills long gaps with scene-pressure lifts, investigative office texture, and story-world texture accents. The app defaults were tightened in parallel: audiobook SFX now plan more cues, allow closer editorial spacing, request messy tactile source layers instead of simple tonal swells, and reject flat generated takes more aggressively with higher transient/envelope thresholds. The new review mix is `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V12_FILM_FOLEY_REDESIGN_5min.mp3`; it has 31 planned cues, a 24-bit WAV reference, separated bed/event stems, and measures about `-15.2 LUFS`, `10.6 LRA`, and `-1.6 dBTP` after final mastering.

The V13 film-sound-design correction responds to the user's next review that the effects were audible but still rated only 2.5/10 because they did not feel like movie sound effects. The analysis found the V12 event stem was being pushed too hard, measuring about `+4.1 dBTP` true peak before final mix control, which made the effects read loud but clipped, flat, and synthetic. The app now lowers role-aware timeline boosts, raises generated-source quality floors for impact and foreground cues, explicitly rejects over-limited generated takes, penalizes hot impact sources, and uses more controlled RMS/peak targets with less saturation and sweetener drive. The local preview helper now also lays a restrained score bed under the narration when available, clamps event stems before delivery, and renders `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V13_FILM_SOUND_DESIGN_5min.mp3`. The V13 master measures about `-16.1 LUFS`, `10.5 LRA`, and `-1.4 dBTP`; its bed is about `-33.2 LUFS`, and the event stem is about `-12.6 LUFS` with safe sample peak around `-4.2 dB`, so the mix should feel bigger without relying on brittle clipping.

The V14 studio-Foley correction responds to the user's review that the previous pass was audible but still not high-quality or movie-like. The failure was treated as source-design and variety, not loudness: the app now asks for more practical object contact, debris, room slap, and physical Foley in impact prompts; generated source audition thresholds are stricter; flat smooth impact takes are penalized harder; and the mastering sweetener adds more tactile crack/texture while backing off limiter drive so transients are not smeared. The local preview helper now splits repeated political reveal hits into `Institutional power hit`, `Private leverage hit`, `Name-card reveal hit`, `Choice rupture hit`, and `Truth pressure hit`, then layers card snaps, latch detail, cloth/desk movement, debris, real whoosh/swell assets, and room slap. The new review mix is `C:\Users\nicol\Downloads\full_story_opening_CINEMATIC_SFX_V14_STUDIO_FOLEY_5min.mp3`; its final master measured about `-16.0 LUFS`, `10.6 LRA`, and `-1.4 dBTP`, with the event stem active RMS around `-14.6 dBFS` and safe sample peak around `-3.4 dBFS`.

The latest delivery-readiness pass closes the final QA interpretation gap. Export completion now combines export preflight, timeline edit readiness, rendered-frame analysis, and rendered-audio analysis into one `Cinematic delivery verdict` instead of asking the user to interpret separate panels. A video can no longer look acceptable in one area while silently failing the overall standard: below-4K delivery, non-Ultra quality, slideshow-like edit structure, missing depth prep, thin SFX roles, missing frame samples, soft motion, crushed blacks, clipping, quiet mixes, and weak dynamics all feed a single 0-10 final score.

The newest pre-export readiness pass moves part of that judgment earlier. Export preflight now runs the same timeline edit-readiness analysis before rendering and warns when the edit is weak or only fair, so users are pushed back toward more multi-axis motion, staged camera beats, 2.5D depth prep, music, and role-balanced SFX before spending time on a final export.

The latest range-accuracy fix makes those warnings judge the actual render target. Export preflight now builds its analysis composition through the same timeline-to-composition conversion used by rendering, so in/out exports are clipped, shifted, and keyframe-adjusted before edit readiness is scored. A strong selected scene no longer gets misread as weak just because its clips sit later on the full timeline.

The newest reference-camera gate tightens the exact "two camera movements in one frame" requirement from the uploaded parallax guide. Pre-export edit readiness now measures whether stills have overlapping zoom-plus-pan/tilt/roll movement for a meaningful portion of the shot, not just separate keyframed properties somewhere on the clip. A sequential zoom-then-pan can still count as animated and staged, but it now fails the reference-style camera metric and triggers a `Reference camera motion missing` preflight warning before the user exports.

The newest export-rhythm gate moves the editorial timing standard into final preflight as well. Export edit readiness now measures average still-image shot length, shot-duration variation, and a 0-10 rhythm score. A sequence can have depth layers, score, SFX, and reference-style camera movement but still fail the pacing gate if the stills are long and evenly timed like a slideshow. In that case export preflight shows `Shot rhythm feels too flat` with the average shot length and variation, pushing the user back to image-to-narration rematching before the final render.

The latest reference-measurement pass verifies the app's motion profile against the uploaded CapCut guide instead of relying on taste alone. `scripts/analyze-reference-motion.py` measured `Create Amazing 3D PARALLAX Effect in CapCut-854x480-mp4a.mp4` at `11.12` average frame delta, `39.38` P90 frame delta, `1.213` average motion, `4.431` P90 motion, and top-window axis balance around `0.65-0.86`; those match the current in-app CapCut reference profile. The uploaded After Effects parallax tutorial measured much sharper and less crushed overall (`0.047` crushed-black ratio and `0.281` dark ratio versus CapCut's `0.099` and `0.384`), so rendered-frame QA now warns earlier when shadows exceed the reference range even before they become fully crushed.

The latest export-quality pass addresses the user's repeated complaint that the generated result did not feel like 4K. The export dialog now includes a true `Cinema 4K` preset and matching resolution option. It preserves the project aspect ratio, targets a 2160-pixel short edge, rounds dimensions to encoder-safe even numbers, and pairs the output with MP4/H.264 Ultra quality. For a standard 16:9 project this produces 3840x2160; for slightly nonstandard sources such as 854x480 it preserves the source aspect and exports 3844x2160 instead of stretching.

The latest export-preflight pass makes that final-delivery standard harder to miss. Video exports now warn before rendering when the selected resolution is below the Cinema 4K target or when quality is below Ultra. These checks do not block quick draft exports, but they steer the user toward the `Cinema 4K` preset and Ultra quality for the final master so a good cinematic timeline is not undercut by a soft low-resolution delivery.

## Latest Reference Audit

The uploaded CapCut guide and the latest Bellmere preview were decoded and measured with the repeatable `scripts/analyze-reference-motion.py` tool. These values are engineering proxies, not a substitute for a cinematographer's viewing pass, but they identify the largest mismatch clearly:

- CapCut reference: sharpness `1289.66`, mean luma `85.42`, crushed-black ratio `0.099`, highlight ratio `0.067`, mean motion `1.213`, and mean axis balance `0.549`.
- Bellmere preview: sharpness `1277.77`, mean luma `49.73`, crushed-black ratio `0.083`, highlight ratio `0.001`, mean motion `4.479`, and mean axis balance `0.510`.
- The Bellmere render is already close to the CapCut reference in measured edge sharpness and has plenty of raw movement. Its main visual miss is the much darker tonal distribution, almost absent highlight sparkle, and less consistently balanced two-axis movement. More movement alone would not fix it.

## Latest Implementation Pass

- Depth preparation now attempts true MODNet subject matting and uses the depth-derived mask as a graceful fallback when matting is flat, unreliable, or unavailable.
- Background reconstruction now uses directional pixels from outside the subject bounds plus a small soft-fill blend. This removes more of the original subject than the previous blur-only plate and reduces visible ghosting during parallax.
- Image-to-narration matching now automatically runs the app's existing local vision captioner for selected stills that have no AI captions. Generic filenames such as `ChatGPT Image...` can therefore be ordered from actual scene content.
- The workflow now plans sparse story-directed cut effects. Dramatic transcript beats can receive a short lens-warp or light-leak transition, continuity cuts can receive a short smooth cut, and the remaining cuts stay hard to protect sharpness.
- The same transition direction is mirrored across background and subject tracks so a 2.5D subject does not pop while only its background blends.
- Cinematic finishing now lifts the toe and lower mids more decisively, protects highlight presence, and slightly reduces sharpening strength. This directly targets the measured darkness mismatch without turning the night scene flat.
- The editor preserves the narration and source-image selection after depth, score, and SFX insertion, so the Cinematic Story Edit panel and timeline audit do not disappear after generation.
- The panel is open by default and now says `Cinematic Story Edit`, `Plan edit`, and `Build cinematic edit`; it no longer disguises the full automatic workflow as a button that merely generates SFX.
- Timeline audit now reports story-directed cut coverage without double-counting matching background and subject transition layers.

## Revised Plan

1. Ingest narration and selected stills, transcribe narration, and automatically caption uncatalogued stills.
2. Build story beats, story-aware shot order, and varied transcript-aligned shot timing.
3. Prepare a subject matte plus depth map, reconstruct a clean background plate, and reject low-quality depth groups.
4. Apply subject-safe, multi-axis staged camera moves with different motion strength by depth role.
5. Direct the cuts: mostly hard cuts, with short continuity or dramatic transitions only where the story supports them.
6. Build score, ambience, Foley, impact, and transition stems; prefer imported studio SFX, then audition generated fallbacks.
7. Duck score beneath narration, preserve foreground punctuation, and run role-aware mastering.
8. Apply lifted cinematic finishing and export at Cinema 4K / Ultra.
9. Run timeline, rendered-frame, rendered-audio, and combined delivery QA; return weak scenes to an automatic repair pass before final delivery.

Remaining priorities, in order:

1. Add source-resolution-aware camera limits and optional AI super-resolution. A 4K container cannot create detail that is absent from a low-resolution still.
2. Replace directional fill with a true inpainting model for large subject reveals and complex patterned backgrounds.
3. Add stronger non-human/object segmentation so MODNet portrait matting is not the only semantic matte source.
4. Generate several evolving score sections with crossfaded handoffs instead of tiling one short MusicGen result over a long audiobook.
5. Measure decoded narration, music, ambience, Foley, and impact stems after render, not only timeline gain estimates and final-file loudness.
6. Add a closed automatic repair loop that rerenders only failed shots after sharpness, framing, depth-edge, motion, or mix QA fails.

## Plan Rating

- Plan design: **8.8/10**. It now covers story analysis, scene understanding, edit rhythm, layered motion, transitions, score, SFX, mix, finishing, and delivery QA in one coherent workflow.
- Current implementation maturity: **8.2/10**. Most stages exist and are connected, but several are browser/model dependent and the inpainting, source-resolution, evolving-score, and decoded-stem gates are not complete.
- Likelihood the workflow completes in a supported WebGPU browser with cached models and valid media: **8.4/10**.
- Likelihood it produces a visibly high-quality result from strong stills, clean narration, and imported studio SFX: **8.1/10**.
- Likelihood it produces a true movie-master result from arbitrary stills and generated-only music/SFX with no human review: **6.5/10**.

The practical conclusion is that the architecture is now strong and should produce a major improvement, but a guaranteed high-end result still depends on source resolution, a clean matte/background reconstruction, and professional-quality audio sources. Those dependencies should remain visible instead of being hidden inside an inflated 9/10 promise.

## Studio Documentary Reference Pass

The uploaded `ROLEX The Most Secretive Business In The World` film establishes a different reference grammar from the parallax guides. It is a 17:26, 23.976 fps, 1920x1080 factual documentary. The studio impression comes from controlled editorial rhythm rather than a large bitrate: archival/product coverage, mostly hard cuts, restrained push/pan movement, sparse serif-like date and statistic cards, light texture, and deliberately placed narration punctuation. Its opening 90 seconds measure around `-12.5 LUFS` with only `2.7 LU` of loudness range, which explains the highly forward YouTube-documentary mix.

The automatic `Studio documentary` editing profile is now available in `Cinematic Story Edit`. It preserves the original `Cinematic story` mode, but changes the automatic decisions for factual films:

1. It uses restrained coverage-style camera moves instead of the dramatic two-axis story-camera rotation.
2. It keeps hard cuts by default and uses very short smooth cuts only at dates, chapter turns, and major factual reveals.
3. It applies a neutral lifted documentary finish with controlled sharpening and lighter grain.

## Magnates 3D Reference Profile

The tutorial-reference pass adds a dedicated `Magnates 3D documentary` profile for still-led factual sequences. The reference grammar is treated as a coordinated system rather than a stronger Ken Burns preset: true subject/background plates, foreground occlusion, multiple camera properties moving on every frame, eased acceleration, perspective scene transitions, restrained kinetic type, and sound accents placed on movement or reveal beats.

The automatic profile enforces native 4K inputs, sends downloaded Pixabay stills back through depth preparation, rotates among four compound camera directions, and applies simultaneous scale, X, Y, and roll keyframes. It also adds a WebGPU `3D Scene Orbit` transition, narration-directed kinetic cards, a sharper lifted finishing stack, and a Freesound technical gate requiring stereo 48 kHz assets. Provider metadata is not trusted by itself: the imported media dimensions are checked again before the shot is accepted. 4. It reads the narration transcript and places sparse all-caps date, statistic, and thesis cards on a dedicated `Studio Documentary Titles` track.

This makes the workflow capable of building a Rolex-style first assembly automatically from narration and correctly labeled images/video. It still cannot invent the production's licensed archive footage, product macros, brand graphics, or human editorial taste from arbitrary stills; those assets remain the quality ceiling for a final studio master.

## Cinematic Coverage And Layered Sound Pass

The latest comparison measured the opening three minutes of the uploaded references against the previous proof film. The `12 SHOTS` reference cut about `51` times per minute, the Rolex documentary about `19` times per minute, and the CapCut parallax tutorial about `8` times per minute. The previous proof film managed only about `5.3` cuts per minute, confirming that its main editorial failure was repeated long full-frame stills rather than a shortage of zoom strength.

The automatic Magnates profile now converts long narration segments into coverage beats capped near three seconds and cycles through establishing, medium, close-up detail, macro texture, silhouette, and foreground-depth search intent. Matching stills receive framing-specific simultaneous scale, X, Y, and roll presets, including pull reveals and foreground sweeps, so a source image can function as multiple purposeful shots instead of one long animated slide.

Transitions are now sparse and motivated. Hard cuts remain the default to preserve sharpness; lens warp is reserved for impact or fantasy beats, while scene orbit is limited to chapter turns and occasional structural cuts. This better matches the references, where professional energy comes from coverage and timing rather than placing a conspicuous transition between every shot.

Automatic Freesound placement now treats a dramatic cue as a designed event. Impact and transition moments can receive a pre-motion layer, primary body, tactile texture, and tail selected from distinct assets, while foreground Foley can receive body plus texture. The layer role is preserved in source metadata and placement timing, allowing the mix to build anticipation before the visual action, keep the main transient readable, and let a separate room or debris tail carry the cut.
