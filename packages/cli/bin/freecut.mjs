#!/usr/bin/env node
import { main } from '../src/index.mjs';

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(`${err?.message ?? err}\n`);
  process.exit(1);
});
