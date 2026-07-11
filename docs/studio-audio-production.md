# Studio Audio Production

## Optional Pixabay B-roll

Studio Production can automatically divide narration into visual beats and match each beat to Pixabay. The option is off by default. When enabled, it searches horizontal video first, falls back to a still image, downloads the chosen media into project storage, mutes embedded stock audio, and places editable clips on a dedicated `Pixabay B-roll` track. Still-image fallbacks are passed through the same depth preparation, camera direction, transition, and finishing pipeline as user-supplied images.

`Strict native 4K sources` rejects assets below 3840x2160 using both provider metadata and the dimensions of the imported file. The `Magnates 3D documentary` profile forces this gate on, prefers still images so they can become 2.5D scenes, and falls back only to native 4K video when Pixabay does not expose an original-resolution photo URL.

The Magnates profile automatically applies:

- subject/background separation with an inpainted background when depth preparation is available;
- simultaneous dolly, horizontal travel, vertical travel, and restrained roll keyframes;
- eased multi-property motion selected from four alternating camera directions;
- 3D scene-orbit or lens-warp transitions chosen from the narration beat;
- kinetic editorial cards with masked entrances and word-based exits;
- a lifted, detail-preserving grade with role-aware depth finishing;
- cinematic Freesound filtering that requires stereo, at least 48 kHz, and real bit depth.

Configure `PIXABAY_API_KEY` in `.env.local`. The key is read only by the local backend and is never sent to the browser. Search responses are cached for 24 hours, downloaded asset URLs are constrained to Pixabay's CDN, and each timeline clip stores its source page, contributor, query, variant, score, retrieval time, and Pixabay Content License URL.

FreeCut's Studio Audio workflow extends the existing Cinematic Story Edit. It transcribes the
selected narration, creates timestamped ambience/Foley/impact cues, searches imported media and
Freesound, places selected assets on role-specific tracks, applies narration-first ducking, and
persists source and licence metadata with the project.

## Backend setup

Copy the Studio Audio entries from `.env.example` into the ignored `.env.local` file and fill in the
credentials from the Freesound API credentials page:

```dotenv
FREESOUND_API_KEY=your_api_key
FREESOUND_CLIENT_ID=your_client_id
FREESOUND_CLIENT_SECRET=your_client_secret
FREESOUND_CALLBACK_URL=http://freesound.org/home/app_permissions/permission_granted/
STUDIO_AUDIO_PORT=8787
VITE_STUDIO_AUDIO_API_URL=http://127.0.0.1:8787/api/studio-audio
```

Never prefix Freesound credentials with `VITE_`; Vite variables are bundled into browser code.
The callback above is Freesound's hosted manual-code flow. Click **Connect** in Studio Audio,
approve access on Freesound, copy the short-lived code shown by Freesound, and paste it into the
authorization-code field in FreeCut. Search and high-quality previews require only the API key.
Original-file downloads require OAuth.

Run both the app and its local credential-holding service with:

```powershell
npm run dev:studio
```

The desktop launcher uses this command automatically.

## Workflow

1. Put an audiobook/narration clip and still images on the timeline.
2. Select the narration and the still images.
3. Open **AI > Cinematic Story Edit**.
4. Enable **Licensed Freesound studio SFX** and choose `CC0 + CC BY` or `CC0 only`.
5. Click **Plan edit**, review the timestamped cue plan, then click **Build cinematic edit**.
6. Review Studio Audio sources, timing, volume, reasons and licences. Approve safe recommendations,
   reduce all effects when needed, or edit individual clips with FreeCut's normal timeline controls.
7. Copy YouTube credits or download the UTF-8 credits file before publishing.

## Licensing and production limits

- The default filter accepts CC0 and CC BY. It rejects NonCommercial, ShareAlike, unknown and
  missing licences. `CC0 only` is available for a stricter project.
- Export preflight blocks missing or incompatible Studio Audio metadata and warns whenever CC BY
  attribution must accompany the published video.
- A content licence and permission to use the Freesound API commercially are separate matters.
  Freesound's published API terms state that free API use is for non-commercial purposes unless a
  separate agreement applies. Confirm the appropriate API permission before using this workflow in
  a commercial product or monetized production.
- Freesound previews are compressed audition assets. OAuth enables original files, but source
  quality still varies by uploader. Always audition important foreground effects.
- Scene analysis currently uses FreeCut's local transcript and deterministic cue planner. The
  provider boundary can be extended with a richer language-model story analyzer without changing
  the timeline, licence or credits model.

Official references: [Freesound API authentication](https://freesound.org/docs/api/authentication.html),
[API resources](https://freesound.org/docs/api/resources_apiv2.html), and
[API terms](https://freesound.org/help/tos_api/).
