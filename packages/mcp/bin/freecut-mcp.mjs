#!/usr/bin/env node
import { runServer } from '../src/server.mjs';

runServer().catch((err) => {
  process.stderr.write(`${err?.message ?? err}\n`);
  process.exit(1);
});
