import * as vscode from 'vscode';
import { DetectionResult } from './types';
import {
  buildAnnotationStart,
  buildAnnotationEnd,
  ANNOTATION_MARKER,
  ANNOTATION_END_MARKER,
} from './annotationBuilder';
import { DetectionEngine } from './detectionEngine';

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

  public setEmployeeId(id: string): void { this.employeeId = id; }

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
      this.log?.appendLine(`[WRITER] Cooldown, skipping`);
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

    // ── Find the new code range ──
    const oldText = this.snapshots.get(key) ?? '';
    const { startLine, endLine } = this.findNewCodeRange(doc, oldText, result.text);

    if (startLine >= endLine) {
      this.log?.appendLine(`[WRITER] No new code range found`);
      return;
    }

    this.log?.appendLine(
      `[WRITER] New code lines ${startLine}-${endLine} in ${realUri.fsPath}`
    );

    // ── Check if this EXACT range is INSIDE an existing annotation block ──
    const blockStatus = this.getAnnotationStatus(doc, startLine, endLine);
    this.log?.appendLine(`[WRITER] Annotation status: ${blockStatus}`);

    if (blockStatus === 'inside') {
      this.log?.appendLine(`[WRITER] Code is inside existing annotation block, skipping`);
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
        // END first (doesn't shift startLine)
        if (endLine < doc.lineCount) {
          eb.insert(new vscode.Position(endLine, 0), endBlock);
        } else {
          const lastLine = doc.lineAt(doc.lineCount - 1);
          eb.insert(lastLine.range.end, '\n' + endBlock);
        }
        // START
        eb.insert(new vscode.Position(startLine, 0), startBlock);
      });

      if (success) {
        this.cooldowns.set(key, Date.now());
        await doc.save();
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
   * Determines if a line range is:
   *  - 'inside'  → entirely within an existing START...END block → skip
   *  - 'outside' → not inside any block → annotate
   *
   * Logic: Walk through the file tracking open/close blocks.
   * A block is open after seeing ANNOTATION_MARKER and closed after
   * seeing ANNOTATION_END_MARKER. If startLine..endLine falls entirely
   * within an open block, it's 'inside'.
   */
  private getAnnotationStatus(
    doc: vscode.TextDocument,
    startLine: number,
    endLine: number,
  ): 'inside' | 'outside' {
    let insideBlock = false;
    let newCodeStartsInBlock = false;
    let newCodeEndsInBlock = false;

    for (let i = 0; i < doc.lineCount; i++) {
      const lineText = doc.lineAt(i).text;

      if (lineText.includes(ANNOTATION_MARKER) && !lineText.includes(ANNOTATION_END_MARKER)) {
        insideBlock = true;
      }

      if (i === startLine) {
        newCodeStartsInBlock = insideBlock;
      }
      if (i === endLine - 1) {
        newCodeEndsInBlock = insideBlock;
      }

      if (lineText.includes(ANNOTATION_END_MARKER)) {
        insideBlock = false;
      }
    }

    // Only skip if the ENTIRE range is inside a block
    if (newCodeStartsInBlock && newCodeEndsInBlock) {
      return 'inside';
    }

    return 'outside';
  }

  /**
   * Finds NEW lines by diffing snapshot vs current file content.
   */
  private findNewCodeRange(
    doc: vscode.TextDocument,
    oldText: string,
    insertedText: string,
  ): { startLine: number; endLine: number } {
    // ── File was empty → everything is new ──
    if (oldText.trim().length === 0) {
      return { startLine: 0, endLine: doc.lineCount };
    }

    const currentLines: string[] = [];
    for (let i = 0; i < doc.lineCount; i++) {
      currentLines.push(doc.lineAt(i).text);
    }

    const oldLines = oldText.split('\n');

    // Count occurrences of each line in old file
    const oldCounts = new Map<string, number>();
    for (const l of oldLines) {
      const t = l.trim();
      if (t.length === 0) { continue; }
      // Skip annotation lines in old content
      if (t.includes(ANNOTATION_MARKER) || t.includes(ANNOTATION_END_MARKER)) { continue; }
      oldCounts.set(t, (oldCounts.get(t) ?? 0) + 1);
    }

    // Find lines in current file that aren't in old file
    const usedCounts = new Map<string, number>();
    let firstNew = -1;
    let lastNew = -1;

    for (let i = 0; i < currentLines.length; i++) {
      const t = currentLines[i].trim();
      if (t.length === 0) { continue; }
      // Skip annotation lines
      if (t.includes(ANNOTATION_MARKER) || t.includes(ANNOTATION_END_MARKER)) { continue; }

      const oldCount = oldCounts.get(t) ?? 0;
      const used = usedCounts.get(t) ?? 0;

      if (used < oldCount) {
        usedCounts.set(t, used + 1);
      } else {
        // NEW line
        if (firstNew === -1) { firstNew = i; }
        lastNew = i;
      }
    }

    if (firstNew !== -1) {
      return { startLine: firstNew, endLine: lastNew + 1 };
    }

    // Fallback: match inserted text
    return this.findByInsertedText(currentLines, insertedText);
  }

  private findByInsertedText(
    currentLines: string[],
    insertedText: string,
  ): { startLine: number; endLine: number } {
    const iLines = insertedText.split('\n').filter(l => l.trim().length > 0);
    if (iLines.length === 0) { return { startLine: 0, endLine: 0 }; }

    const first = iLines[0].trim();
    const last = iLines[iLines.length - 1].trim();
    let start = -1;

    for (let i = 0; i < currentLines.length; i++) {
      if (currentLines[i].trim() === first) { start = i; break; }
    }
    if (start === -1) { return { startLine: 0, endLine: 0 }; }

    let end = start + iLines.length;
    for (let i = currentLines.length - 1; i >= start; i--) {
      if (currentLines[i].trim() === last) { end = i + 1; break; }
    }

    return { startLine: start, endLine: end };
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