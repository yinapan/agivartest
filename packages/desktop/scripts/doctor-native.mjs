#!/usr/bin/env node
// Electron 环境 native addon 加载验证
// 用法: electron packages/desktop/scripts/doctor-native.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { app } = require('electron');

app.whenReady().then(async () => {
  const report = {
    environment: 'electron',
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    loadedInElectron: false,
    modulePath: null,
    error: null,
    pingResult: null,
  };

  try {
    const nativePath = require.resolve('@agivar/native');
    report.modulePath = nativePath;
    const native = require('@agivar/native');
    report.pingResult = native.ping();
    report.loadedInElectron = true;
  } catch (err) {
    report.loadedInElectron = false;
    report.error = {
      code: 'NATIVE_LOAD_FAILED',
      message: err.message,
    };
  }

  console.log(JSON.stringify(report, null, 2));
  app.quit();
  process.exit(report.loadedInElectron ? 0 : 1);
});
