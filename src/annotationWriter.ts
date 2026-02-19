import * as vscode from 'vscode';
import { DetectionResult } from './types';
import { buildAnnotation, hasExistingAnnotation } from './annotationBuilder';
import { DetectionEngine } from './detectionEngine';

/**
 * Writes annotation comments into documents.
 *
 * Uses the engine's suppressedDocs set to prevent our own edits
 * from being re-detected as AI insertions — this is the key to
 * avoiding the race condition that caused inconsistent behavior.
 */
export class AnnotationWriter {
  /** Tracks annotated regions to prevent doubles. Map<uri, Set<lineRange>>. */
  private readonly annotated = new Map<string, Set<string>>();

  /** Serializes writes per document. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private employeeId: string,
    private readonly engine: DetectionEngine,
  ) {}

  public setEmployeeId(id: string): void {
    this.employeeId = id;
  }

  public async annotate(result: DetectionResult): Promise<void> {
    const uri = result.document.uri.toString();

    // Serialize per document
    const prev = this.locks.get(uri) ?? Promise.resolve();
    const job = prev.then(() => this.doAnnotate(result)).catch(() => { /* swallow */ });
    this.locks.set(uri, job);
    await job;
  }

  private async doAnnotate(result: DetectionResult): Promise<void> {
    const doc = result.document;
    const uri = doc.uri.toString();
    const targetLine = result.line;

    // Guard: document closed
    if (doc.isClosed) { return; }

    // Guard: already annotated this region
    const regionKey = this.regionKey(targetLine);
    const docSet = this.annotated.get(uri) ?? new Set();
    if (docSet.has(regionKey)) { return; }

    // Guard: annotation already exists in file content
    const getLine = (l: number) =>
      l >= 0 && l < doc.lineCount ? doc.lineAt(l).text : '';

    if (hasExistingAnnotation(getLine, doc.lineCount, targetLine)) {
      docSet.add(regionKey);
      this.annotated.set(uri, docSet);
      return;
    }

    // Also check a few lines below (for streamed inserts where start line shifted)
    const checkBelow = Math.min(targetLine + 8, doc.lineCount);
    if (hasExistingAnnotation(getLine, doc.lineCount, checkBelow)) {
      docSet.add(regionKey);
      this.annotated.set(uri, docSet);
      return;
    }

    // Build annotation
    const annotation = buildAnnotation(doc.languageId, this.employeeId);
    const insertPos = new vscode.Position(targetLine, 0);

    // SUPPRESS detection while we write
    this.engine.suppressedDocs.add(uri);

    try {
      const edit = new vscode.WorkspaceEdit();
      edit.insert(doc.uri, insertPos, annotation);
      const ok = await vscode.workspace.applyEdit(edit);

      if (ok) {
        docSet.add(regionKey);
        this.annotated.set(uri, docSet);

        console.log(
          `[AI Annotator] ✅ Annotated line ${targetLine} in ${doc.fileName} — ${result.reason}`
        );
      }
    } finally {
      // Release suppression after a delay to cover async change events
      setTimeout(() => {
        this.engine.suppressedDocs.delete(uri);
      }, 600);
    }
  }

  /**
   * Creates a key covering a range of ±3 lines around the target,
   * so nearby detections don't double-annotate.
   */
  private regionKey(line: number): string {
    const bucket = Math.floor(line / 4);
    return `b${bucket}`;
  }

  public onDocumentClosed(uri: string): void {
    this.annotated.delete(uri);
    this.locks.delete(uri);
    this.engine.suppressedDocs.delete(uri);
  }
}