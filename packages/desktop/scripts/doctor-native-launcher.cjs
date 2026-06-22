#!/usr/bin/env node
// Cross-platform launcher for doctor-native.mjs
// Ensures ELECTRON_RUN_AS_NODE is unset so Electron starts as a proper app
const { execFileSync } = require('child_process');
const path = require('path');

// Resolve the electron binary
const electronPath = require('electron');

// Build environment without ELECTRON_RUN_AS_NODE
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const scriptPath = path.join(__dirname, 'doctor-native.mjs');

try {
  const result = execFileSync(electronPath, [scriptPath], {
    env,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  process.stdout.write(result);
  process.exit(0);
} catch (err) {
  // execFileSync throws on non-zero exit
  if (err.stdout) process.stdout.write(err.stdout);
  if (err.stderr) process.stderr.write(err.stderr);
  process.exit(err.status || 1);
}
