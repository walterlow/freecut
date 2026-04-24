/**
 * `freecut` command-line interface. Dispatches to command modules based
 * on the first positional. Mutations read the snapshot, apply through
 * the SDK, and write back atomically.
 *
 * Every command accepts `--json` for machine-readable output — point
 * agents at that form for chaining.
 */

import { runNew } from './commands/new.mjs';
import { runInspect } from './commands/inspect.mjs';
import { runTrackAdd } from './commands/track.mjs';
import { runClipAdd } from './commands/clip.mjs';
import { runMediaAdd } from './commands/media.mjs';
import { runEffectAdd } from './commands/effect.mjs';
import { runTransitionAdd } from './commands/transition.mjs';
import { runMarkerAdd } from './commands/marker.mjs';
import { runLint } from './commands/lint.mjs';
import { runDoctor } from './commands/doctor.mjs';
import { runRender } from './commands/render.mjs';

const HELP = `freecut — programmatic FreeCut project authoring

usage:
  freecut doctor [file] [--json]
  freecut new <file> [--name X --fps 30 --width 1920 --height 1080]
  freecut inspect <file> [--json]
  freecut lint <file> [--json] [--strict]
  freecut render <file> [--output out.mp4 --format mp4|webm|mov|mkv --quality high]
  freecut render --project ABC [--start 0 --duration 5 --output out.mp4]
  freecut track add <file> [--kind video|audio --name X]
  freecut clip add <file> --type video|audio|image|text|shape|adjustment \\
                          --track <id> --from <sec> --duration <sec> [options]
  freecut media add <file> --file-name <name> [--id X --duration S --width W --height H ...]
  freecut effect add <file> --item <id> --gpu-type <name> [--params JSON]
  freecut transition add <file> --left <id> --right <id> --duration <sec> [--preset fade]
  freecut marker add <file> --at <sec> [--label X --color #fff]

every command accepts --json for machine-readable output.
`;

export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    io.stdout.write(HELP);
    return;
  }

  const [first, second, ...rest] = argv;

  switch (first) {
    case 'doctor':
      await runDoctor(argv.slice(1), io);
      return;
    case 'new':
      await runNew(argv.slice(1), io);
      return;
    case 'inspect':
      await runInspect(argv.slice(1), io);
      return;
    case 'lint':
      await runLint(argv.slice(1), io);
      return;
    case 'render':
      await runRender(argv.slice(1), io);
      return;
    case 'track':
      if (second !== 'add') throw usage(`unknown track subcommand: ${second ?? '(none)'}`);
      await runTrackAdd(rest, io);
      return;
    case 'clip':
      if (second !== 'add') throw usage(`unknown clip subcommand: ${second ?? '(none)'}`);
      await runClipAdd(rest, io);
      return;
    case 'media':
      if (second !== 'add') throw usage(`unknown media subcommand: ${second ?? '(none)'}`);
      await runMediaAdd(rest, io);
      return;
    case 'effect':
      if (second !== 'add') throw usage(`unknown effect subcommand: ${second ?? '(none)'}`);
      await runEffectAdd(rest, io);
      return;
    case 'transition':
      if (second !== 'add') throw usage(`unknown transition subcommand: ${second ?? '(none)'}`);
      await runTransitionAdd(rest, io);
      return;
    case 'marker':
      if (second !== 'add') throw usage(`unknown marker subcommand: ${second ?? '(none)'}`);
      await runMarkerAdd(rest, io);
      return;
    default:
      throw usage(`unknown command: ${first}`);
  }
}

function usage(msg) {
  return new Error(`${msg}\n\n${HELP}`);
}
