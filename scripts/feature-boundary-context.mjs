import path from 'node:path';
import process from 'node:process';
import {
  collectSourceFiles,
  normalizePath,
} from './feature-import-utils.mjs';

export {
  collectSpecifiers,
  normalizePath,
  resolveRelativeSpecifier,
  stripQueryAndHash,
} from './feature-import-utils.mjs';

export const ROOT_DIR = process.cwd();
export const FEATURES_DIR = path.join(ROOT_DIR, 'src', 'features');

export function collectFeatureFiles() {
  return collectSourceFiles(FEATURES_DIR);
}

export function relativeToRoot(absolutePath) {
  return normalizePath(path.relative(ROOT_DIR, absolutePath));
}
