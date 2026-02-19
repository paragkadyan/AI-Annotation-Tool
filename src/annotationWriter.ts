import * as vscode from 'vscode';
import { DetectionResult } from './types';
import {
  buildAnnotationStart,
  buildAnnotationEnd,
  ANNOTATION_MARKER,
} from './annotationBuilder';
import { DetectionEngine } from './detectionEngine';

/**
 * Wraps AI-generated code with start and end annotation markers.
 *
 * NO session-level caching — always checks actual file content
 * to decide whether annotation is needed. This means if the user
 * deletes an annotation, the next AI insert will be annotated again.
 */
export class AnnotationWriter {
  private readonly locks = new Map<string, Promise<void>>();
  private log: vscode.OutputChannel | null = null;

  /** Cooldown: don't annotate same file within N ms */
  private readonly cooldowns = new Map<string, number>();
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

  public async annotate(result: DetectionResult): Promise<void> {
    const realUri = this.resolveRealFile(result.document);
    if (!realUri) {
      this.log?.appendLine(`[WRITER] Cannot resolve real file for "${result.document.fileName}"`);
      return;
    }

    const key = realUri.toString();

    // Cooldown check
    const lastWrite = this.cooldowns.get(key) ?? 0;
    if (Date.now() - lastWrite < AnnotationWriter.COOLDOWN_MS) {
      this.log?.appendLine(`[WRITER] Cooldown active for ${realUri.fsPath}, skipping`);
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
      this.log?.appendLine(`[WRITER] Cannot open ${realUri.fsPath}: ${e}`);
      return;
    }

    if (doc.isClosed) { return; }

    // ── Check ACTUAL file content for existing annotation ──
    const fullText = doc.getText();
    if (fullText.includes(ANNOTATION_MARKER)) {
      this.log?.appendLine(`[WRITER] File already contains annotation marker, skipping`);
      return;
    }

    // ── Find where the inserted code is in the real file ──
    const codeLines = result.text.split('\n').filter(l => l.trim().length > 0);
    if (codeLines.length === 0) {
      this.log?.appendLine(`[WRITER] No meaningful code lines found, skipping`);
      return;
    }

    const firstCodeLine = codeLines[0].trim();
    const lastCodeLine = codeLines[codeLines.length - 1].trim();

    // Search for the first line of inserted code
    let insertLine = -1;
    for (let i = 0; i < doc.lineCount; i++) {
      if (doc.lineAt(i).text.trim() === firstCodeLine) {
        insertLine = i;
        break;
      }
    }

    if (insertLine === -1) {
      // Code not found in file — might not have been applied yet
      // Default to line 0
      this.log?.appendLine(`[WRITER] Could not find code in file, inserting at line 0`);
      insertLine = 0;
    }

    // Search for the last line of inserted code
    let endLine = Math.min(insertLine + codeLines.length, doc.lineCount);
    for (let i = Math.min(doc.lineCount - 1, insertLine + codeLines.length + 5); i >= insertLine; i--) {
      if (i < doc.lineCount && doc.lineAt(i).text.trim() === lastCodeLine) {
        endLine = i + 1;
        break;
      }
    }

    this.log?.appendLine(
      `[WRITER] Writing to ${realUri.fsPath} — start@${insertLine} end@${endLine} lang=${doc.languageId}`
    );

    // ── Build annotation blocks ──
    const startBlock = buildAnnotationStart(doc.languageId, this.employeeId);
    const endBlock = buildAnnotationEnd(doc.languageId);

    // ── Suppress detection ──
    this.engine.suppressedDocs.add(key);
    this.engine.suppressedDocs.add(result.document.uri.toString());

    try {
      // Use a TextEditor to make edits — more reliable than WorkspaceEdit
      // for inserting at specific positions
      const editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });

      const success = await editor.edit((editBuilder) => {
        // Insert START annotation before the code
        editBuilder.insert(new vscode.Position(insertLine, 0), startBlock);

        // Insert END annotation after the code
        // Since we're in the same edit, line numbers haven't shifted yet
        if (endLine < doc.lineCount) {
          editBuilder.insert(new vscode.Position(endLine, 0), endBlock);
        } else {
          // Append at end of file
          const lastLine = doc.lineAt(doc.lineCount - 1);
          editBuilder.insert(lastLine.range.end, '\n' + endBlock);
        }
      });

      if (success) {
        this.cooldowns.set(key, Date.now());
        await doc.save();
        this.log?.appendLine(`[WRITER] ✅ Done — wrapped lines ${insertLine}-${endLine}`);
      } else {
        this.log?.appendLine(`[WRITER] ❌ editor.edit returned false`);
      }
    } finally {
      setTimeout(() => {
        this.engine.suppressedDocs.delete(key);
        this.engine.suppressedDocs.delete(result.document.uri.toString());
      }, 2000);
    }
  }

  /**
   * Resolves virtual document URI to real file:// URI.
   */
  private resolveRealFile(doc: vscode.TextDocument): vscode.Uri | null {
    if (doc.uri.scheme === 'file' || doc.uri.scheme === 'untitled') {
      return doc.uri;
    }

    // Virtual schemes: fileName still has the real path
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
    this.engine.suppressedDocs.delete(uri);
  }
}