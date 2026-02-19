import * as vscode from 'vscode';
import { DetectionResult } from './types';
import {
  buildAnnotationStart,
  buildAnnotationEnd,
  ANNOTATION_MARKER,
  ANNOTATION_END_MARKER,
} from './annotationBuilder';
import { DetectionEngine } from './detectionEngine';

/**
 * Wraps AI-generated code with start/end markers.
 * Supports MULTIPLE annotated blocks per file.
 *
 * Strategy:
 *  - Snapshots track "known" file content
 *  - Diff finds NEW lines not present in snapshot
 *  - Checks if those specific new lines are already inside an annotation block
 *  - Only annotates truly unannotated new code
 */
export class AnnotationWriter {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cooldowns = new Map<string, number>();
  private readonly snapshots = new Map<string, string>();
  private log: vscode.OutputChannel | null = null;

  private static readonly COOLDOWN_MS = 2000;

  constructor(
    private employeeId: string,
    private readonly engine: DetectionEngine,
  ) {
    this.log = engine.getLog();
  }

  public setEmployeeId(id: string): void {
    this.employeeId = id;
  }

  public takeSnapshot(uri: string, content: string): void {
    this.snapshots.set(uri, content);
  }

  public async annotate(result: DetectionResult): Promise<void> {
    const realUri = this.resolveRealFile(result.document);
    if (!realUri) {
      this.log?.appendLine(`[WRITER] Cannot resolve real file`);
      return;
    }

    const key = realUri.toString();
    const last = this.cooldowns.get(key) ?? 0;
    if (Date.now() - last < AnnotationWriter.COOLDOWN_MS) {
      this.log?.appendLine(`[WRITER] Cooldown active, skipping`);
      return;
    }

    const prev = this.locks.get(key) ?? Promise.resolve();
    const job = prev.then(() => this.doAnnotate(result, realUri)).catch((e) => {
      this.log?.appendLine(`[WRITER] Error: ${e}`);
    });
    this.locks.set(key, job);
    await job;
  }

  private async doAnnotate(result: DetectionResult, realUri: vscode.Uri): Promise<void> {
    const key = realUri.toString();

    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(realUri);
    } catch (e) {
      this.log?.appendLine(`[WRITER] Cannot open: ${e}`);
      return;
    }

    if (doc.isClosed) { return; }

    // ── Find what's new ──
    const oldText = this.snapshots.get(key) ?? '';
    const { startLine, endLine } = this.findNewCodeRange(doc, oldText, result.text);

    if (startLine >= endLine) {
      this.log?.appendLine(`[WRITER] No new code range found`);
      return;
    }

    this.log?.appendLine(
      `[WRITER] New code at lines ${startLine}-${endLine} in ${realUri.fsPath}`
    );

    // ── Check if THIS SPECIFIC range is already inside an annotation block ──
    if (this.isRangeAnnotated(doc, startLine, endLine)) {
      this.log?.appendLine(`[WRITER] This range is already annotated, skipping`);
      return;
    }

    // ── Build annotations ──
    const startBlock = buildAnnotationStart(doc.languageId, this.employeeId);
    const endBlock = buildAnnotationEnd(doc.languageId);

    // ── Suppress ──
    this.engine.suppressedDocs.add(key);
    this.engine.suppressedDocs.add(result.document.uri.toString());

    try {
      const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: true,
      });

      const success = await editor.edit((eb) => {
        // Insert END first (doesn't shift startLine)
        if (endLine < doc.lineCount) {
          eb.insert(new vscode.Position(endLine, 0), endBlock);
        } else {
          const lastLine = doc.lineAt(doc.lineCount - 1);
          eb.insert(lastLine.range.end, '\n' + endBlock);
        }

        // Insert START
        eb.insert(new vscode.Position(startLine, 0), startBlock);
      });

      if (success) {
        this.cooldowns.set(key, Date.now());
        await doc.save();
        // Update snapshot to include the annotated code
        this.snapshots.set(key, doc.getText());
        this.log?.appendLine(`[WRITER] ✅ Wrapped lines ${startLine}-${endLine}`);
      } else {
        this.log?.appendLine(`[WRITER] ❌ edit failed`);
      }
    } finally {
      setTimeout(() => {
        this.engine.suppressedDocs.delete(key);
        this.engine.suppressedDocs.delete(result.document.uri.toString());
      }, 2000);
    }
  }

  /**
   * Checks if a specific line range is already inside an annotation block.
   * An annotation block is defined as lines between AI_ASSISTED: true and AI_ASSISTED_END.
   */
  private isRangeAnnotated(doc: vscode.TextDocument, startLine: number, endLine: number): boolean {
    // Find all annotation blocks in the file
    const blocks: Array<{ start: number; end: number }> = [];
    let blockStart = -1;

    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (text.includes(ANNOTATION_MARKER) && blockStart === -1) {
        blockStart = i;
      } else if (text.includes(ANNOTATION_END_MARKER) && blockStart !== -1) {
        blocks.push({ start: blockStart, end: i });
        blockStart = -1;
      }
    }

    // Check if the new code range falls entirely within any existing block
    for (const block of blocks) {
      if (startLine >= block.start && endLine <= block.end + 1) {
        return true;
      }
    }

    // Also check if annotation markers are immediately adjacent (within 2 lines)
    for (let i = Math.max(0, startLine - 4); i <= Math.min(doc.lineCount - 1, startLine); i++) {
      if (doc.lineAt(i).text.includes(ANNOTATION_MARKER)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Finds the range of NEW lines by diffing snapshot vs current content.
   */
  private findNewCodeRange(
    doc: vscode.TextDocument,
    oldText: string,
    insertedText: string,
  ): { startLine: number; endLine: number } {
    // ── Case 1: File was empty → everything is new ──
    if (oldText.trim().length === 0) {
      return { startLine: 0, endLine: doc.lineCount };
    }

    const currentLines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      currentLines.push(doc.lineAt(i).text);
    }

    const oldLines = oldText.split('\n');

    // Build a set of old lines (trimmed) with their count for handling duplicates
    const oldLineCounts = new Map<string, number>();
    for (const l of oldLines) {
      const t = l.trim();
      if (t.length === 0) { continue; }
      oldLineCounts.set(t, (oldLineCounts.get(t) ?? 0) + 1);
    }

    // Find contiguous block of new lines
    const usedOld = new Map<string, number>();
    let firstNew = -1;
    let lastNew = -1;

    for (let i = 0; i < currentLines.length; i++) {
      const trimmed = currentLines[i].trim();
      if (trimmed.length === 0) { continue; }

      // Skip annotation markers
      if (trimmed.includes(ANNOTATION_MARKER) || trimmed.includes(ANNOTATION_END_MARKER)) {
        continue;
      }

      const oldCount = oldLineCounts.get(trimmed) ?? 0;
      const usedCount = usedOld.get(trimmed) ?? 0;

      if (usedCount < oldCount) {
        // This line existed in old file
        usedOld.set(trimmed, usedCount + 1);
      } else {
        // This line is NEW
        if (firstNew === -1) { firstNew = i; }
        lastNew = i;
      }
    }

    if (firstNew === -1) {
      // Fallback: try matching inserted text directly
      return this.findByInsertedText(currentLines, insertedText);
    }

    return { startLine: firstNew, endLine: lastNew + 1 };
  }

  /**
   * Fallback: find the inserted text in the current file by matching
   * its first and last non-empty lines.
   */
  private findByInsertedText(
    currentLines: string[],
    insertedText: string,
  ): { startLine: number; endLine: number } {
    const insertedLines = insertedText.split('\n').filter(l => l.trim().length > 0);
    if (insertedLines.length === 0) {
      return { startLine: 0, endLine: 0 };
    }

    const first = insertedLines[0].trim();
    const last = insertedLines[insertedLines.length - 1].trim();

    let startLine = -1;
    for (let i = 0; i < currentLines.length; i++) {
      if (currentLines[i].trim() === first) {
        startLine = i;
        break;
      }
    }

    if (startLine === -1) { return { startLine: 0, endLine: 0 }; }

    let endLine = startLine + insertedLines.length;
    for (let i = currentLines.length - 1; i >= startLine; i--) {
      if (currentLines[i].trim() === last) {
        endLine = i + 1;
        break;
      }
    }

    return { startLine, endLine };
  }

  private resolveRealFile(doc: vscode.TextDocument): vscode.Uri | null {
    if (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled') {
      return doc.uri;
    }

    const fsPath = doc.fileName;
    if (fsPath && fsPath !== '' && !fsPath.includes('extension-output')) {
      try { return vscode.Uri.file(fsPath); }
      catch (_e) { return null; }
    }
    return null;
  }

  public onDocumentClosed(uri: string): void {
    this.locks.delete(uri);
    this.cooldowns.delete(uri);
    this.snapshots.delete(uri);
    this.engine.suppressedDocs.delete(uri);
  }
}