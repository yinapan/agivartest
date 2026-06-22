#!/usr/bin/env node
// Node.js 环境 native addon 加载验证

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

const report = {
  environment: 'node',
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  moduleSearchPaths: [],
  loadedInNode: false,
  error: null,
  pingResult: null,
};

try {
  const nativePath = require.resolve('@agivar/native');
  report.moduleSearchPaths.push(nativePath);
  const native = require('@agivar/native');
  report.pingResult = native.ping();
  report.loadedInNode = true;
} catch (err) {
  report.loadedInNode = false;
  report.error = {
    code: 'NATIVE_LOAD_FAILED',
    message: err.message,
    stack: err.stack,
  };
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.loadedInNode ? 0 : 1);
