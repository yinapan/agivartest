import fs from 'node:fs';
import path from 'node:path';
import { uia, screenshot, type PocResult } from '@agivar/core';
import { launchNotepad, killTrackedProcesses } from './helpers/cleanup.js';
import { sleep } from './helpers/timer.js';
import { createOutputDir } from './helpers/report.js';

export async function runPocUia(outputDir: string): Promise<PocResult> {
  const result: PocResult = {
    name: 'poc-uia',
    kind: 'readonly',
    status: 'failed',
    durationMs: 0,
    metrics: {},
    artifacts: [],
    notes: [],
  };

  const start = performance.now();

  try {
    // === Part 1: Notepad UIA ===
    const pid = launchNotepad();
    await sleep(2000);

    // Find the Notepad window
    const windows = await screenshot.listWindows();
    if (!windows.ok) throw new Error('listWindows failed');

    const notepadWin = windows.data.find(
      (w) =>
        w.title.includes('Notepad') ||
        w.title.includes('记事本') ||
        w.title.includes('无标题'),
    );
    if (!notepadWin) {
      result.notes.push('Notepad window not found');
      killTrackedProcesses();
      result.durationMs = Math.round(performance.now() - start);
      return result;
    }

    result.notes.push(`Notepad hwnd=${notepadWin.hwnd}, title="${notepadWin.title}"`);

    // Read the UI control tree
    const treeResult = await uia.getUiTree(notepadWin.hwnd, { maxDepth: 6, maxNodes: 500 });
    if (treeResult.ok) {
      result.metrics['notepad.treeNodes'] = countNodes(treeResult.data);
      result.metrics['notepad.treeDepth'] = maxDepth(treeResult.data);
      result.metrics['notepad.treeDurationMs'] = Math.round(treeResult.durationMs);

      // Save the control tree
      const treePath = path.join(outputDir, 'notepad-ui-tree.json');
      fs.writeFileSync(treePath, JSON.stringify(treeResult.data, null, 2));
      result.artifacts.push(treePath);
    } else {
      result.notes.push(`getUiTree failed: ${treeResult.error.message}`);
    }

    // Find the edit control — try Edit (classic Notepad) then Document (Win11 new Notepad)
    let editQuery: uia.ElementQuery | null = null;
    let editNode: uia.UiaNode | null = null;

    // Strategy 1: classic Notepad uses controlType='Edit'
    const editResult = await uia.findElement(notepadWin.hwnd, { controlType: 'Edit' });
    if (editResult.ok && editResult.data) {
      editQuery = { controlType: 'Edit' };
      editNode = editResult.data;
      result.notes.push(
        `Edit control: name="${editNode.name}", class="${editNode.className}"`,
      );
    } else {
      result.notes.push('Edit control not found — trying Document control type');
      // Strategy 2: Windows 11 new Notepad uses controlType='Document' (RichEditD2DPT)
      const docResult = await uia.findElement(notepadWin.hwnd, { controlType: 'Document' });
      if (docResult.ok && docResult.data) {
        editQuery = { controlType: 'Document' };
        editNode = docResult.data;
        result.notes.push(
          `Document control found: name="${editNode.name}", class="${editNode.className}"`,
        );
      } else {
        result.notes.push('Document findElement also returned null');
        // Strategy 3: search by className (RichEditD2DPT)
        const richResult = await uia.findElement(notepadWin.hwnd, {
          className: 'RichEditD2DPT',
        });
        if (richResult.ok && richResult.data) {
          editQuery = { className: 'RichEditD2DPT' };
          editNode = richResult.data;
          result.notes.push(
            `RichEditD2DPT found via className: name="${editNode.name}", controlType="${editNode.controlType}"`,
          );
        } else {
          // Strategy 4: fall back to getUiTree search — findElement may not traverse Win11 pane boundaries
          result.notes.push('findElement failed — falling back to tree search');
          if (treeResult.ok) {
            const docNode = findNodeInTree(treeResult.data, (n) =>
              n.controlType === 'Document' || n.controlType === 'Edit' || n.className === 'RichEditD2DPT',
            );
            if (docNode) {
              editNode = docNode;
              // Use className or controlType for subsequent queries
              editQuery = docNode.className
                ? { className: docNode.className }
                : { controlType: docNode.controlType };
              result.notes.push(
                `Found via tree walk: controlType="${docNode.controlType}", class="${docNode.className}", name="${docNode.name}"`,
              );
            } else {
              result.notes.push('No edit-like control found even in tree walk');
            }
          }
        }
      }
    }

    if (editNode && editQuery) {
      result.metrics['notepad.editFound'] = true;
      result.metrics['notepad.editControlType'] = editNode.controlType;

      // Build a full query with empty strings for unset fields to avoid Rust null conversion errors
      const fullQuery: uia.ElementQuery = {
        automationId: editQuery.automationId ?? '',
        name: editQuery.name ?? '',
        controlType: editQuery.controlType ?? '',
        className: editQuery.className ?? '',
      };

      // Try reading value via ValuePattern
      const valueResult = await uia.getElementValue(notepadWin.hwnd, fullQuery);
      if (valueResult.ok) {
        result.metrics['notepad.valuePatternRead'] = true;
        result.notes.push(`Current value: "${valueResult.data.substring(0, 50)}"`);
      } else {
        result.metrics['notepad.valuePatternRead'] = false;
        result.notes.push(`ValuePattern read failed: ${valueResult.error.message}`);
      }

      // Try setting value via ValuePattern
      const setResult = await uia.setElementValue(notepadWin.hwnd, fullQuery, 'Hello from UIA!');
      if (setResult.ok) {
        result.metrics['notepad.valuePatternWrite'] = true;
      } else {
        result.metrics['notepad.valuePatternWrite'] = false;
        result.notes.push(
          `ValuePattern write failed: ${setResult.error.message} — will fallback to keyboard`,
        );
      }
    } else {
      result.metrics['notepad.editFound'] = false;
    }

    killTrackedProcesses();
    await sleep(500);

    // === Part 2: Chrome/Edge window identification ===
    const allWindows = windows.data;
    const chromeWin = allWindows.find(
      (w) =>
        w.title.includes('Chrome') ||
        w.title.includes('Edge') ||
        w.title.includes('Chromium'),
    );

    if (chromeWin) {
      result.notes.push(`Chrome/Edge hwnd=${chromeWin.hwnd}, title="${chromeWin.title}"`);
      const chromeTree = await uia.getUiTree(chromeWin.hwnd, { maxDepth: 3, maxNodes: 200 });
      if (chromeTree.ok) {
        result.metrics['chrome.windowIdentified'] = true;
        result.metrics['chrome.topLevelNodes'] = chromeTree.data.children.length;
      } else {
        result.metrics['chrome.windowIdentified'] = false;
        result.notes.push(`Chrome tree failed: ${chromeTree.error.message}`);
      }
    } else {
      result.metrics['chrome.windowIdentified'] = false;
      result.notes.push('No Chrome/Edge window found — skipping browser UIA test');
    }

    // Determine overall result
    const notepadEdit = result.metrics['notepad.editFound'] === true;
    const chromeOk = result.metrics['chrome.windowIdentified'] === true || !chromeWin;
    result.status = notepadEdit && chromeOk ? 'passed' : 'failed';
  } catch (err: any) {
    result.notes.push(`Error: ${err.message}`);
  } finally {
    killTrackedProcesses();
    result.durationMs = Math.round(performance.now() - start);
  }

  return result;
}

function findNodeInTree(
  node: uia.UiaNode,
  predicate: (n: uia.UiaNode) => boolean,
): uia.UiaNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findNodeInTree(child, predicate);
    if (found) return found;
  }
  return null;
}

function countNodes(node: uia.UiaNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

function maxDepth(node: uia.UiaNode, depth: number = 0): number {
  if (node.children.length === 0) return depth;
  return Math.max(...node.children.map((c) => maxDepth(c, depth + 1)));
}

// Standalone execution
if (process.argv[1]?.endsWith('poc-uia.ts')) {
  const dir = createOutputDir();
  runPocUia(dir).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.status === 'passed' ? 0 : 1);
  });
}
