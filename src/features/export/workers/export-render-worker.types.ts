import type { CompositionInputProps } from '@/types/export'
import type {
  ClientExportSettings,
  ClientRenderResult,
  RenderProgress,
} from '../utils/client-renderer'

export interface ExportRenderStartRequest {
  type: 'start'
  requestId: string
  settings: ClientExportSettings
  composition: CompositionInputProps
}

export interface ExportRenderCancelRequest {
  type: 'cancel'
  requestId: string
}

export type ExportRenderWorkerRequest = ExportRenderStartRequest | ExportRenderCancelRequest

export interface ExportRenderProgressResponse {
  type: 'progress'
  requestId: string
  progress: RenderProgress
}

export interface ExportRenderCompleteResponse {
  type: 'complete'
  requestId: string
  result: ClientRenderResult
}

export interface ExportRenderCancelledResponse {
  type: 'cancelled'
  requestId: string
}

export interface ExportRenderErrorResponse {
  type: 'error'
  requestId: string
  error: string
}

export type ExportRenderWorkerResponse =
  | ExportRenderProgressResponse
  | ExportRenderCompleteResponse
  | ExportRenderCancelledResponse
  | ExportRenderErrorResponse
