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
 * Annotates only the NEW code added by AI, not the entire file.
 *
 * Strategy:
 *  - Maintains snapshots of file content before AI edits
 *  - Diffs the snapshot vs current content to find new lines
 *  - Wraps only the new lines with start/end markers
 */
export class AnnotationWriter {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly cooldowns = new Map<string, number>();
  private log: vscode.OutputChannel | null = null;

  /** Stores the last known "clean" content of each file (before AI edit). */
  private readonly snapshots = new Map<string, string>();

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

  /**
   * Call this to snapshot a file's current content.
   * Should be called periodically for active files so we know
   * what the file looked like before AI made changes.
   */
  public takeSnapshot(uri: string, content: string): void {
    // Don't snapshot if it already contains our markers (avoid snapshot after annotation)
    if (!content.includes(ANNOTATION_MARKER)) {
      this.snapshots.set(uri, content);
    }
  }

  public async annotate(result: DetectionResult): Promise<void> {
    const realUri = this.resolveRealFile(result.document);
    if (!realUri) {
      this.log?.appendLine(`[WRITER] Cannot resolve real file for "${result.document.fileName}"`);
      return;
    }

    const key = realUri.toString();

    // Cooldown
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

    // ── Open the REAL file ──
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(realUri);
    } catch (e) {
      this.log?.appendLine(`[WRITER] Cannot open: ${e}`);
      return;
    }

    if (doc.isClosed) { return; }

    const currentText = doc.getText();

    // ── Already annotated? ──
    if (currentText.includes(ANNOTATION_MARKER)) {
      this.log?.appendLine(`[WRITER] File already annotated, skipping`);
      return;
    }

    // ── Find what's NEW ──
    const oldText = this.snapshots.get(key) ?? '';
    const { startLine, endLine } = this.findNewCodeRange(doc, oldText, result.text);

    this.log?.appendLine(
      `[WRITER] New code at lines ${startLine}-${endLine} in ${realUri.fsPath} ` +
      `(old=${oldText.length} chars, current=${currentText.length} chars)`
    );

    if (startLine === endLine) {
      this.log?.appendLine(`[WRITER] No new code range found, skipping`);
      return;
    }

    // ── Build annotations ──
    const startBlock = buildAnnotationStart(doc.languageId, this.employeeId);
    const endBlock = buildAnnotationEnd(doc.languageId);

    // ── Suppress detection ──
    this.engine.suppressedDocs.add(key);
    this.engine.suppressedDocs.add(result.document.uri.toString());

    try {
      const editor = await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: true,
      });

      const success = await editor.edit((eb) => {
        // Insert END marker first (so line numbers for START aren't shifted)
        if (endLine < doc.lineCount) {
          eb.insert(new vscode.Position(endLine, 0), endBlock);
        } else {
          const lastLine = doc.lineAt(doc.lineCount - 1);
          eb.insert(lastLine.range.end, '\n' + endBlock);
        }

        // Insert START marker
        eb.insert(new vscode.Position(startLine, 0), startBlock);
      });

      if (success) {
        this.cooldowns.set(key, Date.now());
        await doc.save();
        // Update snapshot to include our annotations
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
   * Finds the range of NEW lines in the current document by comparing
   * against the old snapshot and the detected insertion text.
   */
  private findNewCodeRange(
    doc: vscode.TextDocument,
    oldText: string,
    insertedText: string,
  ): { startLine: number; endLine: number } {
    const currentLines = doc.getText().split('\n');

    // ── Case 1: File was empty → everything is new ──
    if (oldText.trim().length === 0) {
      return { startLine: 0, endLine: doc.lineCount };
    }

    // ── Case 2: Use the inserted text to find where it lives ──
    const insertedLines = insertedText.split('\n').filter(l => l.trim().length > 0);
    if (insertedLines.length === 0) {
      return { startLine: 0, endLine: 0 };
    }

    // ── Case 3: Diff old vs current to find new lines ──
    const oldLines = oldText.split('\n');
    const oldSet = new Set(oldLines.map(l => l.trim()));

    // Find first line in current file that wasn't in old file
    let startLine = -1;
    let endLine = -1;

    for (let i = 0; i < currentLines.length; i++) {
      const trimmed = currentLines[i].trim();
      if (trimmed.length === 0) { continue; }
      if (!oldSet.has(trimmed)) {
        if (startLine === -1) { startLine = i; }
        endLine = i + 1;
      }
    }

    // If diff didn't find anything, try matching inserted text directly
    if (startLine === -1) {
      const firstInserted = insertedLines[0].trim();
      const lastInserted = insertedLines[insertedLines.length - 1].trim();

      for (let i = 0; i < currentLines.length; i++) {
        if (currentLines[i].trim() === firstInserted) {
          startLine = i;
          break;
        }
      }

      if (startLine !== -1) {
        for (let i = currentLines.length - 1; i >= startLine; i--) {
          if (currentLines[i].trim() === lastInserted) {
            endLine = i + 1;
            break;
          }
        }
      }
    }

    // Fallback: wrap everything
    if (startLine === -1) { startLine = 0; }
    if (endLine === -1) { endLine = doc.lineCount; }

    return { startLine, endLine };
  }

  private resolveRealFile(doc: vscode.TextDocument): vscode.Uri | null {
    if (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled') {
      return doc.uri;
    }

    const fsPath = doc.fileName;
    if (fsPath && fsPath !== '' && !fsPath.includes('extension-output')) {
      try {
        return vscode.Uri.file(fsPath);
      } catch (_e) {
        return null;
      }
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