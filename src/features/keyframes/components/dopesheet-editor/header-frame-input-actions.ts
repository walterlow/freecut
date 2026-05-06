import type { BlockedFrameRange } from '@/features/keyframes/utils/transition-region'
import {
  clampFrame,
  clampToAvoidBlockedRanges,
} from '@/features/keyframes/components/dopesheet-editor/frame-utils'

export interface HeaderFrameSummaryState {
  hasMixedFrames: boolean
  localFrame: number | null
  globalFrame: number | null
}

export interface HeaderFrameCommitPlan {
  initialLocalFrame: number
  targetLocalFrame: number
  globalFrameOffset: number | null
}

interface PlanLocalHeaderFrameCommitArgs {
  inputValue: string
  selectedFrameSummary: HeaderFrameSummaryState
  totalFrames: number
  transitionBlockedRanges: BlockedFrameRange[]
}

interface PlanGlobalHeaderFrameCommitArgs {
  inputValue: string
  selectedFrameSummary: HeaderFrameSummaryState
  currentFrame: number
  globalFrame: number | null
  totalFrames: number
  transitionBlockedRanges: BlockedFrameRange[]
}

export interface HeaderFrameMoveResult {
  didMove: boolean
  appliedDeltaFrames: number
}

export interface HeaderFrameCommitValues {
  finalLocalFrame: number
  localInputValue: string
  globalInputValue: string | null
}

export function planLocalHeaderFrameCommit({
  inputValue,
  selectedFrameSummary,
  totalFrames,
  transitionBlockedRanges,
}: PlanLocalHeaderFrameCommitArgs): HeaderFrameCommitPlan | null {
  if (selectedFrameSummary.localFrame === null || selectedFrameSummary.hasMixedFrames) {
    return null
  }

  const parsed = Math.round(Number(inputValue))
  if (!Number.isFinite(parsed)) {
    return null
  }

  let targetLocalFrame = clampFrame(parsed, totalFrames)
  targetLocalFrame = clampToAvoidBlockedRanges(
    targetLocalFrame,
    selectedFrameSummary.localFrame,
    transitionBlockedRanges,
  )
  targetLocalFrame = clampFrame(targetLocalFrame, totalFrames)

  return {
    initialLocalFrame: selectedFrameSummary.localFrame,
    targetLocalFrame,
    globalFrameOffset:
      selectedFrameSummary.globalFrame === null
        ? null
        : selectedFrameSummary.globalFrame - selectedFrameSummary.localFrame,
  }
}

export function planGlobalHeaderFrameCommit({
  inputValue,
  selectedFrameSummary,
  currentFrame,
  globalFrame,
  totalFrames,
  transitionBlockedRanges,
}: PlanGlobalHeaderFrameCommitArgs): HeaderFrameCommitPlan | null {
  if (
    globalFrame === null ||
    selectedFrameSummary.localFrame === null ||
    selectedFrameSummary.hasMixedFrames
  ) {
    return null
  }

  const parsed = Math.round(Number(inputValue))
  if (!Number.isFinite(parsed)) {
    return null
  }

  const globalFrameOffset = globalFrame - currentFrame
  let targetLocalFrame = clampFrame(parsed - globalFrameOffset, totalFrames)
  targetLocalFrame = clampToAvoidBlockedRanges(
    targetLocalFrame,
    selectedFrameSummary.localFrame,
    transitionBlockedRanges,
  )
  targetLocalFrame = clampFrame(targetLocalFrame, totalFrames)

  return {
    initialLocalFrame: selectedFrameSummary.localFrame,
    targetLocalFrame,
    globalFrameOffset,
  }
}

export function getCommittedHeaderFrameValues(
  plan: HeaderFrameCommitPlan,
  moveResult: HeaderFrameMoveResult,
): HeaderFrameCommitValues {
  const finalLocalFrame = plan.initialLocalFrame + moveResult.appliedDeltaFrames
  return {
    finalLocalFrame,
    localInputValue: String(finalLocalFrame),
    globalInputValue:
      plan.globalFrameOffset === null ? null : String(finalLocalFrame + plan.globalFrameOffset),
  }
}
