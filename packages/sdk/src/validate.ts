import {
  lintSnapshot as coreLintSnapshot,
  validateSnapshot as coreValidateSnapshot,
} from '@freecut/core';
import type { ProjectSnapshot } from './types.js';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
  path?: string;
  entityId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  findings: ValidationFinding[];
}

export interface ValidateSnapshotOptions {
  /** Warn when media-backed items reference media ids missing from mediaReferences. */
  warnOnMissingMedia?: boolean;
}

export function validateSnapshot(
  snapshot: ProjectSnapshot,
  opts: ValidateSnapshotOptions = {},
): ValidationResult {
  return coreValidateSnapshot(snapshot, opts) as ValidationResult;
}

export function lintSnapshot(
  snapshot: ProjectSnapshot,
  opts: ValidateSnapshotOptions = {},
): ValidationResult {
  return coreLintSnapshot(snapshot, opts) as ValidationResult;
}
