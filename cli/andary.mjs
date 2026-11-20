#!/usr/bin/env node
// Andary command-line interface. Run `andary --help` for the commands.

// Checked before loading anything else, so an old Node gets this message, not a syntax error.
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  process.stderr.write(`Andary needs Node.js 20 or newer (this is ${process.versions.node}).\n`);
  process.exit(1);
}

const { main } = await import('../server/cli/main.mjs');

try {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
  // Idle keep-alive connections (from fetch) can hold the event loop open for a few seconds.
  setTimeout(() => process.exit(code), 500).unref();
} catch (error) {
  process.stderr.write(`Andary hit an unexpected error: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
