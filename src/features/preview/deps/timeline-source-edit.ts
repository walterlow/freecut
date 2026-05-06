/**
 * Adapter exports for timeline source-edit dependencies.
 * Preview modules should import source monitor edit actions from here.
 */

export {
  getTrackKind,
  performInsertEdit,
  performOverwriteEdit,
  resolveSourceEditTrackTargets,
} from './timeline-contract'
