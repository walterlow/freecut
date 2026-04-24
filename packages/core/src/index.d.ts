export type ValidationSeverity = 'error' | 'warning' | 'info';

export const SNAPSHOT_VERSION: '1.0';
export const CORE_VERSION: string;

export interface SerializeOptions {
  pretty?: boolean;
  exportedAt?: string;
  editorVersion?: string;
  version?: string;
  mediaReferences?: unknown[];
}

export class SnapshotParseError extends Error {
  constructor(message: string, cause?: unknown);
  cause?: unknown;
}

export function toSnapshot(source: unknown, opts?: SerializeOptions): any;
export function serializeSnapshot(source: unknown, opts?: SerializeOptions): string;
export function parseSnapshot(json: string): any;
export function secondsToFrames(seconds: number, fps: number): number;
export function framesToSeconds(frames: number, fps: number): number;

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
  warnOnMissingMedia?: boolean;
}

export function validateSnapshot(snapshot: unknown, opts?: ValidateSnapshotOptions): ValidationResult;
export function lintSnapshot(snapshot: unknown, opts?: ValidateSnapshotOptions): ValidationResult;

export interface RenderRange {
  inFrame: number;
  outFrame: number;
}

export interface CliRangeValues {
  start?: string;
  end?: string;
  duration?: string;
  'in-frame'?: string;
  'out-frame'?: string;
  'render-whole-project'?: boolean;
}

export interface ProjectSelector {
  project?: string;
  projectId?: string;
}

export interface WorkspaceIo {
  readFile?: (path: string, encoding: 'utf8') => Promise<string>;
  readdir?: (path: string, options?: { withFileTypes?: boolean }) => Promise<unknown[]>;
  stat?: (path: string) => Promise<{ size: number }>;
}

export function buildRange(values: CliRangeValues): RenderRange | {
  startSeconds: number;
  endSeconds?: number;
  durationSeconds?: number;
} | null;

export function resolveProjectRenderRange(
  project: any,
  requestedRange?: RenderRange | Record<string, number> | null,
  renderWholeProject?: boolean,
): RenderRange | null;

export function collectProjectMediaUsage(project: any, range?: RenderRange | null): Map<string, {
  mediaId: string;
  itemCount: number;
  items: Array<Record<string, unknown>>;
}>;

export function listWorkspaceProjects(workspace: string, opts?: WorkspaceIo & {
  includeTrashed?: boolean;
}): Promise<Array<Record<string, unknown>>>;

export function inspectWorkspaceProject(
  workspace: string,
  selector: ProjectSelector,
  opts?: WorkspaceIo,
): Promise<Record<string, unknown>>;

export function inspectWorkspaceMedia(
  workspace: string,
  selector: ProjectSelector,
  opts?: WorkspaceIo & {
    range?: RenderRange | Record<string, number> | null;
    renderWholeProject?: boolean;
  },
): Promise<Record<string, unknown>>;

export function loadWorkspaceRenderSource(
  workspace: string,
  selector: ProjectSelector,
  renderConfig?: {
    range?: RenderRange | Record<string, number> | null;
    renderWholeProject?: boolean;
  },
  deps?: WorkspaceIo,
): Promise<Record<string, unknown>>;

export function readWorkspaceProject(
  workspace: string,
  selector: ProjectSelector,
  opts?: WorkspaceIo,
): Promise<any>;

export function findWorkspaceMediaSource(mediaDir: string, opts?: Pick<WorkspaceIo, 'readdir'>): Promise<string | null>;
export function mimeTypeFromFileName(file: string): string;
