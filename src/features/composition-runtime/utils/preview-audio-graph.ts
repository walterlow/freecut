import {
  AUDIO_EQ_MID_FREQUENCY_HZ,
  AUDIO_EQ_MID_Q,
  DEFAULT_AUDIO_EQ_SETTINGS,
  buildAudioEqPassIirCoefficients,
} from '@/shared/utils/audio-eq'
import type { ResolvedAudioEqSettings } from '@/types/audio'

export const PREVIEW_AUDIO_GAIN_RAMP_SECONDS = 0.008
export const PREVIEW_AUDIO_EQ_RAMP_SECONDS = 0.012

interface PreviewClipAudioEqStageNodes {
  band1BypassNode: GainNode
  band1PassNodes: IIRFilterNode[]
  band1BiquadNode: BiquadFilterNode
  lowNode: BiquadFilterNode
  lowMidNode: BiquadFilterNode
  midPeakingNode: BiquadFilterNode
  highMidNode: BiquadFilterNode
  highNode: BiquadFilterNode
  band6BypassNode: GainNode
  band6BiquadNode: BiquadFilterNode
  band6PassNodes: IIRFilterNode[]
  outputGainNode: GainNode
  resolvedStage: ResolvedAudioEqSettings
}

export interface PreviewClipAudioGraph {
  context: AudioContext
  sourceInputNode: GainNode
  outputGainNode: GainNode
  eqStageNodes: PreviewClipAudioEqStageNodes[]
  dispose: () => void
}

let sharedPreviewAudioContext: AudioContext | null = null

export function getSharedPreviewAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null

  const webkitWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext
  }
  const AudioContextCtor = window.AudioContext ?? webkitWindow.webkitAudioContext
  if (!AudioContextCtor) return null

  if (sharedPreviewAudioContext === null || sharedPreviewAudioContext.state === 'closed') {
    sharedPreviewAudioContext = new AudioContextCtor()
  }

  return sharedPreviewAudioContext
}

function createPassNodes(
  context: AudioContext,
  type: 'highpass' | 'lowpass',
  enabled: boolean,
  frequencyHz: number,
  slopeDbPerOct: ResolvedAudioEqSettings['lowCutSlopeDbPerOct'],
): IIRFilterNode[] {
  if (!enabled) return []

  const count = Math.max(1, Math.round(slopeDbPerOct / 6))
  const coefficients = buildAudioEqPassIirCoefficients(type, frequencyHz, context.sampleRate)

  return Array.from({ length: count }, () =>
    context.createIIRFilter(coefficients.feedforward, coefficients.feedback),
  )
}

function isPreviewPassBand1(stage: ResolvedAudioEqSettings): boolean {
  return stage.band1Enabled && stage.band1Type === 'high-pass'
}

function isPreviewPassBand6(stage: ResolvedAudioEqSettings): boolean {
  return stage.band6Enabled && stage.band6Type === 'low-pass'
}

function applyNodeType(node: BiquadFilterNode, type: BiquadFilterType): void {
  if (node.type !== type) {
    node.type = type
  }
}

function configureFilterNode(
  node: BiquadFilterNode,
  type: BiquadFilterType,
  frequencyHz: number,
  gainDb: number,
  q: number,
  write: (param: AudioParam, value: number) => void,
): void {
  applyNodeType(node, type)
  write(node.frequency, frequencyHz)
  write(node.gain, type === 'highpass' || type === 'lowpass' || type === 'notch' ? 0 : gainDb)
  write(node.Q, q)
}

function configureStageBiquads(
  stageNodes: PreviewClipAudioEqStageNodes,
  targetStage: ResolvedAudioEqSettings,
  write: (param: AudioParam, value: number) => void,
): void {
  configureFilterNode(
    stageNodes.band1BiquadNode,
    targetStage.band1Type === 'low-shelf'
      ? 'lowshelf'
      : targetStage.band1Type === 'high-shelf'
        ? 'highshelf'
        : 'peaking',
    targetStage.band1FrequencyHz,
    targetStage.band1GainDb,
    targetStage.band1Q,
    write,
  )
  configureFilterNode(
    stageNodes.lowNode,
    targetStage.lowEnabled
      ? targetStage.lowType === 'low-shelf'
        ? 'lowshelf'
        : targetStage.lowType === 'high-shelf'
          ? 'highshelf'
          : targetStage.lowType === 'notch'
            ? 'notch'
            : 'peaking'
      : 'peaking',
    targetStage.lowFrequencyHz,
    targetStage.lowEnabled ? targetStage.lowGainDb : 0,
    targetStage.lowEnabled ? targetStage.lowQ : 1,
    write,
  )
  configureFilterNode(
    stageNodes.lowMidNode,
    targetStage.lowMidEnabled
      ? targetStage.lowMidType === 'low-shelf'
        ? 'lowshelf'
        : targetStage.lowMidType === 'high-shelf'
          ? 'highshelf'
          : targetStage.lowMidType === 'notch'
            ? 'notch'
            : 'peaking'
      : 'peaking',
    targetStage.lowMidFrequencyHz,
    targetStage.lowMidEnabled ? targetStage.lowMidGainDb : 0,
    targetStage.lowMidEnabled ? targetStage.lowMidQ : 1,
    write,
  )
  configureFilterNode(
    stageNodes.midPeakingNode,
    'peaking',
    AUDIO_EQ_MID_FREQUENCY_HZ,
    targetStage.midGainDb,
    AUDIO_EQ_MID_Q,
    write,
  )
  configureFilterNode(
    stageNodes.highMidNode,
    targetStage.highMidEnabled
      ? targetStage.highMidType === 'low-shelf'
        ? 'lowshelf'
        : targetStage.highMidType === 'high-shelf'
          ? 'highshelf'
          : targetStage.highMidType === 'notch'
            ? 'notch'
            : 'peaking'
      : 'peaking',
    targetStage.highMidFrequencyHz,
    targetStage.highMidEnabled ? targetStage.highMidGainDb : 0,
    targetStage.highMidEnabled ? targetStage.highMidQ : 1,
    write,
  )
  configureFilterNode(
    stageNodes.highNode,
    targetStage.highEnabled
      ? targetStage.highType === 'low-shelf'
        ? 'lowshelf'
        : targetStage.highType === 'high-shelf'
          ? 'highshelf'
          : targetStage.highType === 'notch'
            ? 'notch'
            : 'peaking'
      : 'peaking',
    targetStage.highFrequencyHz,
    targetStage.highEnabled ? targetStage.highGainDb : 0,
    targetStage.highEnabled ? targetStage.highQ : 1,
    write,
  )
  configureFilterNode(
    stageNodes.band6BiquadNode,
    targetStage.band6Type === 'low-shelf'
      ? 'lowshelf'
      : targetStage.band6Type === 'high-shelf'
        ? 'highshelf'
        : 'peaking',
    targetStage.band6FrequencyHz,
    targetStage.band6GainDb,
    targetStage.band6Q,
    write,
  )
}

function configureStageOutputGain(
  stageNodes: PreviewClipAudioEqStageNodes,
  targetStage: ResolvedAudioEqSettings,
  write: (param: AudioParam, value: number) => void,
): void {
  write(stageNodes.outputGainNode.gain, Math.pow(10, targetStage.outputGainDb / 20))
}

function getBand1EntryNode(
  stageNodes: PreviewClipAudioEqStageNodes,
  stage = stageNodes.resolvedStage,
): AudioNode {
  if (!stage.band1Enabled) return stageNodes.band1BypassNode
  return isPreviewPassBand1(stage)
    ? (stageNodes.band1PassNodes[0] ?? stageNodes.band1BypassNode)
    : stageNodes.band1BiquadNode
}

function getBand1ExitNode(
  stageNodes: PreviewClipAudioEqStageNodes,
  stage = stageNodes.resolvedStage,
): AudioNode {
  if (!stage.band1Enabled) return stageNodes.band1BypassNode
  return isPreviewPassBand1(stage)
    ? (stageNodes.band1PassNodes.at(-1) ?? stageNodes.band1BypassNode)
    : stageNodes.band1BiquadNode
}

function getBand6EntryNode(
  stageNodes: PreviewClipAudioEqStageNodes,
  stage = stageNodes.resolvedStage,
): AudioNode {
  if (!stage.band6Enabled) return stageNodes.band6BypassNode
  return isPreviewPassBand6(stage)
    ? (stageNodes.band6PassNodes[0] ?? stageNodes.band6BypassNode)
    : stageNodes.band6BiquadNode
}

function getBand6ExitNode(
  stageNodes: PreviewClipAudioEqStageNodes,
  stage = stageNodes.resolvedStage,
): AudioNode {
  if (!stage.band6Enabled) return stageNodes.band6BypassNode
  return isPreviewPassBand6(stage)
    ? (stageNodes.band6PassNodes.at(-1) ?? stageNodes.band6BypassNode)
    : stageNodes.band6BiquadNode
}

function connectStageInternals(stageNodes: PreviewClipAudioEqStageNodes): void {
  const band1Exit = getBand1ExitNode(stageNodes)
  const band6Entry = getBand6EntryNode(stageNodes)
  const band6Exit = getBand6ExitNode(stageNodes)

  for (let i = 1; i < stageNodes.band1PassNodes.length; i++) {
    stageNodes.band1PassNodes[i - 1]!.connect(stageNodes.band1PassNodes[i]!)
  }
  for (let i = 1; i < stageNodes.band6PassNodes.length; i++) {
    stageNodes.band6PassNodes[i - 1]!.connect(stageNodes.band6PassNodes[i]!)
  }
  band1Exit.connect(stageNodes.lowNode)
  stageNodes.lowNode.connect(stageNodes.lowMidNode)
  stageNodes.lowMidNode.connect(stageNodes.midPeakingNode)
  stageNodes.midPeakingNode.connect(stageNodes.highMidNode)
  stageNodes.highMidNode.connect(stageNodes.highNode)
  stageNodes.highNode.connect(band6Entry)
  band6Exit.connect(stageNodes.outputGainNode)
}

function disconnectStageInternals(stageNodes: PreviewClipAudioEqStageNodes): void {
  stageNodes.band1BypassNode.disconnect()
  for (const node of stageNodes.band1PassNodes) {
    node.disconnect()
  }
  stageNodes.band1BiquadNode.disconnect()
  stageNodes.lowNode.disconnect()
  stageNodes.lowMidNode.disconnect()
  stageNodes.midPeakingNode.disconnect()
  stageNodes.highMidNode.disconnect()
  stageNodes.highNode.disconnect()
  stageNodes.band6BypassNode.disconnect()
  stageNodes.band6BiquadNode.disconnect()
  for (const node of stageNodes.band6PassNodes) {
    node.disconnect()
  }
  stageNodes.outputGainNode.disconnect()
}

function createPreviewClipAudioEqStage(
  context: AudioContext,
  resolvedStage: ResolvedAudioEqSettings = DEFAULT_AUDIO_EQ_SETTINGS,
): PreviewClipAudioEqStageNodes {
  const lowNode = context.createBiquadFilter()
  const lowMidNode = context.createBiquadFilter()
  const midPeakingNode = context.createBiquadFilter()
  const highMidNode = context.createBiquadFilter()
  const highNode = context.createBiquadFilter()
  const stageNodes: PreviewClipAudioEqStageNodes = {
    band1BypassNode: context.createGain(),
    band1PassNodes: createPassNodes(
      context,
      'highpass',
      isPreviewPassBand1(resolvedStage),
      resolvedStage.band1FrequencyHz,
      resolvedStage.band1SlopeDbPerOct,
    ),
    band1BiquadNode: context.createBiquadFilter(),
    lowNode,
    lowMidNode,
    midPeakingNode,
    highMidNode,
    highNode,
    band6BypassNode: context.createGain(),
    band6BiquadNode: context.createBiquadFilter(),
    band6PassNodes: createPassNodes(
      context,
      'lowpass',
      isPreviewPassBand6(resolvedStage),
      resolvedStage.band6FrequencyHz,
      resolvedStage.band6SlopeDbPerOct,
    ),
    outputGainNode: context.createGain(),
    resolvedStage,
  }

  configureStageBiquads(stageNodes, resolvedStage, (param, value) => {
    param.value = value
  })
  configureStageOutputGain(stageNodes, resolvedStage, (param, value) => {
    param.value = value
  })
  connectStageInternals(stageNodes)
  return stageNodes
}

function reconnectPreviewClipAudioGraph(graph: PreviewClipAudioGraph): void {
  graph.sourceInputNode.disconnect()
  for (const stageNodes of graph.eqStageNodes) {
    disconnectStageInternals(stageNodes)
    connectStageInternals(stageNodes)
  }

  let previousNode: AudioNode = graph.sourceInputNode
  for (const stageNodes of graph.eqStageNodes) {
    const band1Entry = getBand1EntryNode(stageNodes)
    previousNode.connect(band1Entry)
    previousNode = stageNodes.outputGainNode
  }

  previousNode.connect(graph.outputGainNode)
}

function disconnectNodeFromTarget(source: AudioNode, target: AudioNode): void {
  try {
    source.disconnect(target)
  } catch {
    source.disconnect()
  }
}

function getStagePreviousNode(graph: PreviewClipAudioGraph, index: number): AudioNode {
  return index === 0 ? graph.sourceInputNode : graph.eqStageNodes[index - 1]!.outputGainNode
}

function getStageNextNode(graph: PreviewClipAudioGraph, index: number): AudioNode {
  if (index >= graph.eqStageNodes.length - 1) {
    return graph.outputGainNode
  }

  return getBand1EntryNode(graph.eqStageNodes[index + 1]!)
}

function replacePreviewClipEqStage(
  graph: PreviewClipAudioGraph,
  index: number,
  currentStage: PreviewClipAudioEqStageNodes,
  targetStage: ResolvedAudioEqSettings,
): PreviewClipAudioEqStageNodes {
  const previousNode = getStagePreviousNode(graph, index)
  const nextNode = getStageNextNode(graph, index)
  const currentEntryNode = getBand1EntryNode(currentStage)
  const replacementStage = createPreviewClipAudioEqStage(graph.context, targetStage)
  const replacementEntryNode = getBand1EntryNode(replacementStage)

  previousNode.connect(replacementEntryNode)
  replacementStage.outputGainNode.connect(nextNode)

  disconnectNodeFromTarget(previousNode, currentEntryNode)
  disconnectNodeFromTarget(currentStage.outputGainNode, nextNode)
  disconnectStageInternals(currentStage)

  graph.eqStageNodes[index] = replacementStage
  return replacementStage
}

function shouldRebuildStageTopology(
  currentStage: ResolvedAudioEqSettings,
  nextStage: ResolvedAudioEqSettings,
): boolean {
  return (
    currentStage.band1Enabled !== nextStage.band1Enabled ||
    currentStage.band1Type !== nextStage.band1Type ||
    ((isPreviewPassBand1(currentStage) || isPreviewPassBand1(nextStage)) &&
      (currentStage.band1FrequencyHz !== nextStage.band1FrequencyHz ||
        currentStage.band1SlopeDbPerOct !== nextStage.band1SlopeDbPerOct)) ||
    currentStage.band6Enabled !== nextStage.band6Enabled ||
    currentStage.band6Type !== nextStage.band6Type ||
    ((isPreviewPassBand6(currentStage) || isPreviewPassBand6(nextStage)) &&
      (currentStage.band6FrequencyHz !== nextStage.band6FrequencyHz ||
        currentStage.band6SlopeDbPerOct !== nextStage.band6SlopeDbPerOct))
  )
}

function rampAudioParam(
  param: AudioParam,
  targetValue: number,
  startAt: number,
  rampSeconds: number,
): void {
  param.cancelScheduledValues(startAt)
  param.setValueAtTime(param.value, startAt)
  param.linearRampToValueAtTime(targetValue, startAt + rampSeconds)
}

function applyStageParams(
  stageNodes: PreviewClipAudioEqStageNodes,
  targetStage: ResolvedAudioEqSettings,
  startAt?: number,
  rampSeconds?: number,
): void {
  const write =
    startAt === undefined || rampSeconds === undefined
      ? (param: AudioParam, targetValue: number) => {
          param.value = targetValue
        }
      : (param: AudioParam, targetValue: number) => {
          rampAudioParam(param, targetValue, startAt, rampSeconds)
        }

  configureStageBiquads(stageNodes, targetStage, write)
  configureStageOutputGain(stageNodes, targetStage, write)
  stageNodes.resolvedStage = targetStage
}

function ensurePreviewClipEqStage(
  graph: PreviewClipAudioGraph,
  index: number,
  targetStage: ResolvedAudioEqSettings,
): PreviewClipAudioEqStageNodes {
  const currentStage = graph.eqStageNodes[index]
  if (!currentStage) {
    const createdStage = createPreviewClipAudioEqStage(graph.context, targetStage)
    graph.eqStageNodes[index] = createdStage
    reconnectPreviewClipAudioGraph(graph)
    return createdStage
  }

  if (shouldRebuildStageTopology(currentStage.resolvedStage, targetStage)) {
    return replacePreviewClipEqStage(graph, index, currentStage, targetStage)
  }

  return currentStage
}

export function createPreviewClipAudioGraph(options?: {
  eqStageCount?: number
}): PreviewClipAudioGraph | null {
  const context = getSharedPreviewAudioContext()
  if (!context) {
    return null
  }

  const sourceInputNode = context.createGain()
  const outputGainNode = context.createGain()
  outputGainNode.gain.value = 0

  const eqStageCount = Math.max(1, options?.eqStageCount ?? 1)
  const eqStageNodes = Array.from({ length: eqStageCount }, () =>
    createPreviewClipAudioEqStage(context, DEFAULT_AUDIO_EQ_SETTINGS),
  )

  const graph: PreviewClipAudioGraph = {
    context,
    sourceInputNode,
    outputGainNode,
    eqStageNodes,
    dispose: () => {
      sourceInputNode.disconnect()
      for (const stageNodes of eqStageNodes) {
        disconnectStageInternals(stageNodes)
      }
      outputGainNode.disconnect()
    },
  }

  reconnectPreviewClipAudioGraph(graph)
  outputGainNode.connect(context.destination)
  return graph
}

export function rampPreviewClipGain(
  graph: PreviewClipAudioGraph,
  targetGain: number,
  startAt: number = graph.context.currentTime,
  rampSeconds: number = PREVIEW_AUDIO_GAIN_RAMP_SECONDS,
): void {
  const safeGain = Math.max(0, targetGain)
  const gainParam = graph.outputGainNode.gain
  gainParam.cancelScheduledValues(startAt)
  gainParam.setValueAtTime(gainParam.value, startAt)
  gainParam.linearRampToValueAtTime(safeGain, startAt + rampSeconds)
}

export function setPreviewClipGain(graph: PreviewClipAudioGraph, targetGain: number): void {
  graph.outputGainNode.gain.value = Math.max(0, targetGain)
}

export function rampPreviewClipEq(
  graph: PreviewClipAudioGraph,
  targetStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
  startAt: number = graph.context.currentTime,
  rampSeconds: number = PREVIEW_AUDIO_EQ_RAMP_SECONDS,
): void {
  const targetCount = targetStages?.length ?? 0
  const iterCount = Math.max(graph.eqStageNodes.length, targetCount)
  for (let i = 0; i < iterCount; i++) {
    const targetStage = targetStages?.[i] ?? DEFAULT_AUDIO_EQ_SETTINGS
    const stageNodes = ensurePreviewClipEqStage(graph, i, targetStage)
    applyStageParams(stageNodes, targetStage, startAt, rampSeconds)
  }
}

export function setPreviewClipEq(
  graph: PreviewClipAudioGraph,
  targetStages: ReadonlyArray<ResolvedAudioEqSettings> | undefined,
): void {
  const targetCount = targetStages?.length ?? 0
  const iterCount = Math.max(graph.eqStageNodes.length, targetCount)
  for (let i = 0; i < iterCount; i++) {
    const targetStage = targetStages?.[i] ?? DEFAULT_AUDIO_EQ_SETTINGS
    const stageNodes = ensurePreviewClipEqStage(graph, i, targetStage)
    applyStageParams(stageNodes, targetStage)
  }
}
