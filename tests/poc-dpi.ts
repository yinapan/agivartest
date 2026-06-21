import { dpi, type PocResult } from '@agivar/core';
import { createOutputDir } from './helpers/report.js';

export async function runPocDpi(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-dpi',
    kind: 'readonly',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();

  try {
    // Get monitor count
    const countResult = await dpi.getMonitorCount();
    if (countResult.ok) {
      result.metrics['monitorCount'] = countResult.data;
      result.notes.push(`Monitors: ${countResult.data}`);
    }

    // Get primary monitor DPI scale factor
    const scaleResult = await dpi.getScaleFactor(0);
    if (scaleResult.ok) {
      result.metrics['primaryScale'] = scaleResult.data;
      result.notes.push(`Primary monitor scale: ${scaleResult.data} (${scaleResult.data * 100}%)`);
    } else {
      result.notes.push(`getScaleFactor failed: ${scaleResult.error.message}`);
      result.durationMs = Math.round(performance.now() - start);
      return result;
    }

    const scale = scaleResult.data;

    // Coordinate roundtrip conversion verification
    const testPoints = [
      { x: 0, y: 0 },
      { x: 100, y: 200 },
      { x: 960, y: 540 },
      { x: 1920, y: 1080 },
    ];

    let conversionErrors = 0;
    for (const p of testPoints) {
      const physical = dpi.logicalToPhysical(p.x, p.y, scale);
      const backToLogical = dpi.physicalToLogical(physical.x, physical.y, scale);

      const errorX = Math.abs(backToLogical.x - p.x);
      const errorY = Math.abs(backToLogical.y - p.y);

      if (errorX > 1 || errorY > 1) {
        conversionErrors++;
        result.notes.push(`Roundtrip error at (${p.x},${p.y}): got (${backToLogical.x},${backToLogical.y})`);
      }
    }

    result.metrics['conversionRoundtripErrors'] = conversionErrors;
    result.metrics['testedPoints'] = testPoints.length;

    // toPhysicalCoords convenience function
    const toPhysResult = await dpi.toPhysicalCoords(500, 300);
    if (toPhysResult.ok) {
      result.metrics['toPhysical.x'] = toPhysResult.data.x;
      result.metrics['toPhysical.y'] = toPhysResult.data.y;
      result.notes.push(`Logical (500,300) -> Physical (${toPhysResult.data.x},${toPhysResult.data.y})`);
    }

    result.status = conversionErrors === 0 ? 'passed' : 'failed';
  } catch (err: any) {
    result.notes.push(`Error: ${err.message}`);
  } finally {
    result.durationMs = Math.round(performance.now() - start);
  }

  return result;
}

// Standalone execution
if (process.argv[1]?.endsWith('poc-dpi.ts')) {
  const dir = createOutputDir();
  runPocDpi(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
