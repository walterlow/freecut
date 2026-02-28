/**
 * Native SVG path utilities to replace @legacy-video/paths
 *
 * Provides path transformation functions for scaling and translating SVG paths.
 */

/**
 * Scale an SVG path by the given factors
 *
 * @param path - The SVG path string to scale
 * @param scaleX - Horizontal scale factor
 * @param scaleY - Vertical scale factor (defaults to scaleX for uniform scaling)
 * @returns The scaled path string
 */
export function scalePath(path: string, scaleX: number, scaleY: number = scaleX): string {
  // Parse and transform the path
  const commands = path.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];
  const result: string[] = [];

  for (const cmd of commands) {
    const type = cmd[0]!;
    const typeUpper = type.toUpperCase();
    const args = cmd
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !isNaN(n));

    switch (typeUpper) {
      case 'M':
      case 'L':
      case 'T': {
        // Move/Line/Smooth quadratic: x y
        const scaled: number[] = [];
        for (let i = 0; i < args.length; i += 2) {
          scaled.push(args[i]! * scaleX, args[i + 1]! * scaleY);
        }
        result.push(`${type} ${scaled.join(' ')}`);
        break;
      }
      case 'H': {
        // Horizontal line: x
        result.push(`${type} ${args.map((x) => x * scaleX).join(' ')}`);
        break;
      }
      case 'V': {
        // Vertical line: y
        result.push(`${type} ${args.map((y) => y * scaleY).join(' ')}`);
        break;
      }
      case 'C': {
        // Cubic bezier: x1 y1 x2 y2 x y
        const scaled: number[] = [];
        for (let i = 0; i < args.length; i += 6) {
          scaled.push(
            args[i]! * scaleX,
            args[i + 1]! * scaleY,
            args[i + 2]! * scaleX,
            args[i + 3]! * scaleY,
            args[i + 4]! * scaleX,
            args[i + 5]! * scaleY
          );
        }
        result.push(`${type} ${scaled.join(' ')}`);
        break;
      }
      case 'S': {
        // Smooth cubic: x2 y2 x y
        const scaled: number[] = [];
        for (let i = 0; i < args.length; i += 4) {
          scaled.push(
            args[i]! * scaleX,
            args[i + 1]! * scaleY,
            args[i + 2]! * scaleX,
            args[i + 3]! * scaleY
          );
        }
        result.push(`${type} ${scaled.join(' ')}`);
        break;
      }
      case 'Q': {
        // Quadratic bezier: x1 y1 x y
        const scaled: number[] = [];
        for (let i = 0; i < args.length; i += 4) {
          scaled.push(
            args[i]! * scaleX,
            args[i + 1]! * scaleY,
            args[i + 2]! * scaleX,
            args[i + 3]! * scaleY
          );
        }
        result.push(`${type} ${scaled.join(' ')}`);
        break;
      }
      case 'A': {
        // Arc: rx ry x-axis-rotation large-arc sweep x y
        const scaled: number[] = [];
        for (let i = 0; i < args.length; i += 7) {
          scaled.push(
            args[i]! * scaleX, // rx
            args[i + 1]! * scaleY, // ry
            args[i + 2]!, // x-axis-rotation (unchanged)
            args[i + 3]!, // large-arc flag (unchanged)
            args[i + 4]!, // sweep flag (unchanged)
            args[i + 5]! * scaleX, // x
            args[i + 6]! * scaleY // y
          );
        }
        result.push(`${type} ${scaled.join(' ')}`);
        break;
      }
      case 'Z': {
        result.push(type);
        break;
      }
      default: {
        // Pass through unknown commands
        result.push(cmd);
      }
    }
  }

  return result.join(' ');
}

/**
 * Translate an SVG path by the given offsets
 *
 * @param path - The SVG path string to translate
 * @param dx - Horizontal offset
 * @param dy - Vertical offset
 * @returns The translated path string
 */
export function translatePath(path: string, dx: number, dy: number): string {
  const commands = path.match(/[MLHVCSQTAZ][^MLHVCSQTAZ]*/gi) || [];
  const result: string[] = [];

  for (const cmd of commands) {
    const type = cmd[0]!;
    const isRelative = type === type.toLowerCase();
    const typeUpper = type.toUpperCase();
    const args = cmd
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !isNaN(n));

    // Relative commands don't need translation (they're relative to current point)
    if (isRelative && typeUpper !== 'M') {
      result.push(cmd);
      continue;
    }

    switch (typeUpper) {
      case 'M':
      case 'L':
      case 'T': {
        // Move/Line/Smooth quadratic: x y
        const translated: number[] = [];
        for (let i = 0; i < args.length; i += 2) {
          translated.push(args[i]! + dx, args[i + 1]! + dy);
        }
        result.push(`${type} ${translated.join(' ')}`);
        break;
      }
      case 'H': {
        // Horizontal line: x
        result.push(`${type} ${args.map((x) => x + dx).join(' ')}`);
        break;
      }
      case 'V': {
        // Vertical line: y
        result.push(`${type} ${args.map((y) => y + dy).join(' ')}`);
        break;
      }
      case 'C': {
        // Cubic bezier: x1 y1 x2 y2 x y
        const translated: number[] = [];
        for (let i = 0; i < args.length; i += 6) {
          translated.push(
            args[i]! + dx,
            args[i + 1]! + dy,
            args[i + 2]! + dx,
            args[i + 3]! + dy,
            args[i + 4]! + dx,
            args[i + 5]! + dy
          );
        }
        result.push(`${type} ${translated.join(' ')}`);
        break;
      }
      case 'S': {
        // Smooth cubic: x2 y2 x y
        const translated: number[] = [];
        for (let i = 0; i < args.length; i += 4) {
          translated.push(
            args[i]! + dx,
            args[i + 1]! + dy,
            args[i + 2]! + dx,
            args[i + 3]! + dy
          );
        }
        result.push(`${type} ${translated.join(' ')}`);
        break;
      }
      case 'Q': {
        // Quadratic bezier: x1 y1 x y
        const translated: number[] = [];
        for (let i = 0; i < args.length; i += 4) {
          translated.push(
            args[i]! + dx,
            args[i + 1]! + dy,
            args[i + 2]! + dx,
            args[i + 3]! + dy
          );
        }
        result.push(`${type} ${translated.join(' ')}`);
        break;
      }
      case 'A': {
        // Arc: rx ry x-axis-rotation large-arc sweep x y
        const translated: number[] = [];
        for (let i = 0; i < args.length; i += 7) {
          translated.push(
            args[i]!, // rx (unchanged)
            args[i + 1]!, // ry (unchanged)
            args[i + 2]!, // x-axis-rotation (unchanged)
            args[i + 3]!, // large-arc flag (unchanged)
            args[i + 4]!, // sweep flag (unchanged)
            args[i + 5]! + dx, // x
            args[i + 6]! + dy // y
          );
        }
        result.push(`${type} ${translated.join(' ')}`);
        break;
      }
      case 'Z': {
        result.push(type);
        break;
      }
      default: {
        result.push(cmd);
      }
    }
  }

  return result.join(' ');
}
