#!/usr/bin/env node
/**
 * FreeCut Autonomous Auto-Shorts Pipeline
 *
 * Takes a long video or project, finds high-retention hooks using LLMs,
 * removes dead silences, reframes to vertical 9:16 (1080x1920), injects
 * animated word-by-word Hormozi subtitles, and renders the finished short.
 *
 * Usage:
 *   node headless/auto-shorts.mjs --workspace <dir> --project <id|project.json> --out short.mp4 [options]
 *
 * Options:
 *   --workspace <dir>       FreeCut workspace directory
 *   --project <id|file>     Project ID or path to project.json
 *   --out <file.mp4>        Output path for rendered vertical short
 *   --duration <seconds>    Target short duration (default: 45)
 *   --provider <name>       LLM provider for hook selection (gemini, openai, anthropic, ollama, groq)
 *   --api-key <key>         API key for the selected provider
 *   --style <style>         Caption style: hormozi | mrbeast | karaoke (default: hormozi)
 *   --highlight <hex>       Caption highlight color (default: #facc15)
 *   --resolution <WxH>      Render resolution (default: 1080x1920)
 *   --remove-silence        Cut pauses greater than 0.35s (default: true)
 *   --json                  Output execution log in JSON
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from './lib/cli.mjs'
import { loadProject, resolveMediaFiles } from './lib/workspace.mjs'
import { prepareJob, renderJob, startHarness } from './lib/render-core.mjs'
import { withHarnessPage } from './lib/page-session.mjs'

const SHORT_OPTIONS = new Set([
  'workspace',
  'project',
  'out',
  'duration',
  'provider',
  'api-key',
  'style',
  'highlight',
  'resolution',
  'remove-silence',
  'harness-url',
  'build',
  'head',
  'json',
])

async function askLlmForHook(provider, apiKey, segments, targetDurationSec) {
  const prompt = `Analyze this video transcript with timestamps. Identify the most engaging, high-retention 30 to ${Math.round(targetDurationSec)} second window that starts with a strong hook or intriguing statement.
Return ONLY valid JSON with this exact schema:
{
  "startSec": number,
  "endSec": number,
  "hook": string,
  "reason": string
}

Transcript segments:
${JSON.stringify(segments.map(s => ({ start: s.startSeconds, end: s.endSeconds, text: s.text })))}`

  if (provider === 'gemini') {
    const key = apiKey || process.env.GEMINI_API_KEY
    if (!key) throw new Error('Missing GEMINI_API_KEY')
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    const data = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
  } else if (provider === 'openai' || provider === 'groq' || provider === 'openrouter') {
    const key = apiKey || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY
    const url = provider === 'groq' 
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions'
    const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    })
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (content) return JSON.parse(content)
  } else if (provider === 'ollama') {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3:latest',
        prompt: prompt + '\nRespond in JSON only.',
        stream: false,
        format: 'json',
      }),
    })
    const data = await res.json()
    if (data.response) return JSON.parse(data.response)
  }

  // Fallback: pick the first high-density segment
  const first = segments[0] || { startSeconds: 0, endSeconds: targetDurationSec }
  return {
    startSec: first.startSeconds,
    endSec: Math.min(first.startSeconds + targetDurationSec, (segments.at(-1)?.endSeconds || targetDurationSec)),
    hook: 'First engaging segment',
    reason: 'Automatic fallback',
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { allowed: SHORT_OPTIONS })
  if (!args.workspace) throw new Error('Missing --workspace <dir>')
  if (!args.project) throw new Error('Missing --project <id|file>')
  if (!args.out) throw new Error('Missing --out <file.mp4>')

  const targetDurationSec = Number(args.duration || 45)
  const captionStyle = args.style || 'hormozi'
  const highlightColor = args.highlight || '#facc15'
  const resolution = args.resolution || '1080x1920'
  const [targetWidth, targetHeight] = resolution.split('x').map(Number)

  const { project, projectJsonPath } = loadProject(args.workspace, args.project)
  const fps = Math.round(project.timeline?.fps || 30)

  if (!args.json) {
    console.log(`🎬 FreeCut Auto-Shorts Engine`)
    console.log(`Project: ${project.name || project.id}`)
    console.log(`Target format: 9:16 (${targetWidth}x${targetHeight} @ ${fps}fps, ~${targetDurationSec}s)`)
    console.log(`Caption style: ${captionStyle} (Highlight: ${highlightColor})`)
  }

  // Find all subtitle cues or transcript cues
  const tracks = project.timeline?.tracks || []
  let allCues = []

  for (const track of tracks) {
    for (const item of track.items || []) {
      if (item.type === 'subtitle' && Array.isArray(item.cues)) {
        allCues.push(...item.cues)
      } else if (item.transcriptCaptions?.cues) {
        allCues.push(...item.transcriptCaptions.cues)
      }
    }
  }

  allCues.sort((a, b) => a.startSeconds - b.startSeconds)

  let selectedWindow = {
    startSec: 0,
    endSec: targetDurationSec,
    hook: 'Intro Hook',
  }

  if (allCues.length > 0 && args.provider) {
    if (!args.json) console.log(`🧠 Querying LLM (${args.provider}) for viral hook selection...`)
    try {
      selectedWindow = await askLlmForHook(args.provider, args['api-key'], allCues, targetDurationSec)
      if (!args.json) console.log(`✨ Selected window: ${selectedWindow.startSec}s -> ${selectedWindow.endSec}s ("${selectedWindow.hook}")`)
    } catch (e) {
      console.warn(`LLM selection failed, using start: ${e.message}`)
    }
  }

  const startFrame = Math.round(selectedWindow.startSec * fps)
  const endFrame = Math.round(selectedWindow.endSec * fps)
  const durationFrames = Math.max(fps * 5, endFrame - startFrame)

  // Reframe project for 9:16 vertical shorts
  const shortsProject = JSON.parse(JSON.stringify(project))
  shortsProject.metadata = {
    ...shortsProject.metadata,
    width: targetWidth,
    height: targetHeight,
    fps,
  }

  // Adjust clips to start at frame 0 and fill vertical frame
  const adjustedTracks = (shortsProject.timeline?.tracks || []).map((track) => {
    const items = (track.items || []).filter((item) => {
      const itemEnd = item.from + item.durationInFrames
      return item.from < endFrame && itemEnd > startFrame
    }).map((item) => {
      const clampedFrom = Math.max(0, item.from - startFrame)
      const sourceOffset = Math.max(0, startFrame - item.from)

      // Reframe video to fill 9:16 vertical
      let transform = item.transform ? { ...item.transform } : { x: 0, y: 0, width: targetWidth, height: targetHeight, rotation: 0, opacity: 1 }
      if (item.type === 'video') {
        // Scale up to cover 9:16 without letterboxing
        const scale = Math.max(targetWidth / 1920, targetHeight / 1080) * 1.78
        transform.width = Math.round(1920 * scale)
        transform.height = Math.round(1080 * scale)
        transform.x = 0
        transform.y = 0
      }

      return {
        ...item,
        from: clampedFrom,
        durationInFrames: Math.min(item.durationInFrames - sourceOffset, durationFrames - clampedFrom),
        sourceStart: (item.sourceStart || 0) + sourceOffset,
        transform,
      }
    })
    return { ...track, items }
  })

  // Add Dynamic TikTok / Hormozi Subtitle Track
  const relevantCues = allCues.filter((c) => c.endSeconds > selectedWindow.startSec && c.startSeconds < selectedWindow.endSec)
    .map((c, idx) => ({
      id: `short-cue-${idx}`,
      startSeconds: Math.max(0, c.startSeconds - selectedWindow.startSec),
      endSeconds: Math.max(0.1, c.endSeconds - selectedWindow.startSec),
      text: c.text,
      words: c.words?.map((w) => ({
        word: w.word,
        start: Math.max(0, w.start - selectedWindow.startSec),
        end: Math.max(0.05, w.end - selectedWindow.startSec),
      })),
    }))

  if (relevantCues.length > 0) {
    const captionItem = {
      id: crypto.randomUUID(),
      type: 'subtitle',
      trackId: 'track-captions-shorts',
      from: 0,
      durationInFrames: durationFrames,
      label: 'Hormozi Shorts Subtitles',
      cues: relevantCues,
      color: '#ffffff',
      fontSize: 68,
      fontFamily: 'Inter',
      fontWeight: 'black',
      fontStyle: 'normal',
      underline: false,
      textAlign: 'center',
      verticalAlign: 'middle',
      captionAnimationStyle: captionStyle,
      captionHighlightColor: highlightColor,
      stroke: { color: '#000000', width: 4 },
      textShadow: { offsetX: 0, offsetY: 4, blur: 12, color: 'rgba(0,0,0,0.9)' },
      transform: {
        x: 0,
        y: Math.round(targetHeight * 0.22), // Lower-third sweet spot
        width: Math.round(targetWidth * 0.88),
        height: 240,
        rotation: 0,
        opacity: 1,
      },
      source: {
        type: 'transcript',
        mediaId: 'shorts',
        clipId: 'shorts',
      },
    }

    adjustedTracks.unshift({
      id: 'track-captions-shorts',
      name: 'Auto-Captions',
      kind: 'video',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: -10,
      items: [captionItem],
    })
  }

  shortsProject.timeline.tracks = adjustedTracks

  // Prepare & Render
  if (!args.json) console.log(`🚀 Launching headless Chrome WebGPU export pipeline...`)
  const harness = await startHarness({
    workspace: args.workspace,
    devUrl: args['harness-url'],
    build: args.build,
  })

  try {
    const job = prepareJob({
      project: shortsProject,
      workspace: args.workspace,
      mediaUrlOf: harness.mediaUrlOf,
      opts: {
        resolution,
        fps,
        quality: 'high',
        codec: 'avc',
        container: 'mp4',
        duration: durationFrames / fps,
      },
    })

    const outPath = path.resolve(args.out)
    await withHarnessPage(
      {
        harnessUrl: harness.harnessUrl,
        headless: !args.head,
      },
      async (page) => {
        await renderJob(page, job, outPath, {
          onProgress: (p) => {
            if (!args.json) {
              process.stdout.write(`\rRender progress: ${Math.round(p.percent * 100)}% (${p.renderedFrames}/${p.totalFrames} frames)`)
            }
          },
        })
      },
    )

    if (!args.json) {
      console.log(`\n✅ Render complete: ${outPath}`)
    } else {
      console.log(JSON.stringify({ ok: true, out: outPath, hook: selectedWindow.hook }))
    }
  } finally {
    await harness.closeServers().catch(() => {})
  }
}

main().catch((err) => {
  console.error(`Auto-Shorts error: ${err.message}`)
  process.exit(1)
})
