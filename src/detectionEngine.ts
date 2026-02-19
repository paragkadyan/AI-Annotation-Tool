import * as vscode from 'vscode';
import {
  AnnotatorConfig,
  DetectionResult,
  InsertionClassification,
} from './types';
import { ClipboardDetector } from './clipboardDetector';
import { ANNOTATION_MARKER, ANNOTATION_END_MARKER } from './annotationBuilder';

export class DetectionEngine {
  private onDetectionCb: ((r: DetectionResult) => void) | null = null;
  private log: vscode.OutputChannel;

  public suppressedDocs = new Set<string>();

  constructor(
    private readonly clipboard: ClipboardDetector,
    private config: AnnotatorConfig,
  ) {
    this.log = vscode.window.createOutputChannel('AI Annotator');
  }

  public getLog(): vscode.OutputChannel {
    return this.log;
  }

  public onResult(cb: (r: DetectionResult) => void): void {
    this.onDetectionCb = cb;
  }

  public updateConfig(cfg: AnnotatorConfig): void {
    this.config = cfg;
  }

  public processChange(
    doc: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent,
  ): void {
    if (!this.config.enabled) { return; }

    const uri = doc.uri.toString();
    const text = change.text;
    const charCount = text.length;
    const lineCount = this.countLines(text);

    // ══════════════════════════════════════════════════════════
    // CRITICAL: Skip output channels to prevent infinite loop.
    // Our own log writes trigger onDidChangeTextDocument on the
    // output channel document. We MUST skip these BEFORE logging.
    // ══════════════════════════════════════════════════════════
    const scheme = doc.uri.scheme;
    if (scheme === 'output' ||
        scheme === 'debug' ||
        scheme === 'git' ||
        scheme === 'vscode' ||
        scheme === 'search-editor' ||
        doc.fileName.includes('extension-output')) {
      return; // Silent skip — no logging!
    }

    // Now safe to log
    this.log.appendLine(
      `[CHANGE] file="${this.shortName(doc)}" scheme=${scheme} ` +
      `chars=${charCount} lines=${lineCount} rangeLen=${change.rangeLength} ` +
      `lang=${doc.languageId} suppressed=${this.suppressedDocs.has(uri)} ` +
      `preview="${text.substring(0, 100).replace(/\n/g, '\\n').replace(/\r/g, '')}"`
    );

    // ── SKIP: our annotation being written ──
    if (this.suppressedDocs.has(uri)) {
      this.log.appendLine(`  → SKIP: suppressed (our annotation write)`);
      return;
    }

    // ── SKIP: pure deletions ──
    if (charCount === 0) { return; }

    // ── SKIP: contains our annotation marker ──
    if (text.includes(ANNOTATION_MARKER) || text.includes(ANNOTATION_END_MARKER)) {
      this.log.appendLine(`  → SKIP: contains our marker`);
      return;
    }

    // ── SKIP: single character = human typing ──
    if (charCount === 1) { return; }

    // ── SKIP: 2 chars = bracket auto-close ──
    if (charCount === 2) { return; }

    // ── SKIP: short whitespace = auto-indent ──
    const trimmed = text.trim();
    if (trimmed.length === 0 && charCount < 16) {
      this.log.appendLine(`  → SKIP: whitespace`);
      return;
    }

    // ── SKIP: below minimum threshold ──
    if (trimmed.length < this.config.minCharsForDetection) {
      this.log.appendLine(`  → SKIP: below min (${trimmed.length} < ${this.config.minCharsForDetection})`);
      return;
    }

    // ── SKIP: clipboard paste ──
    if (this.clipboard.wasPasted(text)) {
      this.log.appendLine(`  → SKIP: clipboard paste`);
      return;
    }

    // ── SKIP: IntelliSense word completion ──
    if (lineCount === 1 && change.rangeLength > 0 && charCount < 40) {
      this.log.appendLine(`  → SKIP: IntelliSense (1 line, ${charCount}ch replacing ${change.rangeLength}ch)`);
      return;
    }

    // ── SKIP: snippet tabstop ──
    if (charCount < 6 && change.rangeLength > 0) {
      this.log.appendLine(`  → SKIP: snippet/tabstop`);
      return;
    }

    // ══════════════════════════════════════════════════════════
    //  AI_LIKELY
    // ══════════════════════════════════════════════════════════
    const reason = `${lineCount} lines, ${charCount} chars` +
      (change.rangeLength > 0 ? `, replaced ${change.rangeLength}` : ', pure insert');

    this.log.appendLine(`  ✅ AI_LIKELY: ${reason}`);

    this.onDetectionCb?.({
      classification: InsertionClassification.AI_LIKELY,
      document: doc,
      line: change.range.start.line,
      text,
      reason,
    });
  }

  /**
   * Called by FileWatcher when a file is saved/changed externally.
   * Checks if new content was added that looks AI-generated.
   */
  public async processFileChange(fileUri: vscode.Uri): Promise<void> {
    if (!this.config.enabled) { return; }

    const uri = fileUri.toString();
    if (this.suppressedDocs.has(uri)) { return; }

    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const text = doc.getText();

      // Skip if already annotated
      if (text.includes(ANNOTATION_MARKER) || text.includes(ANNOTATION_END_MARKER)) { return; }

      // Skip very short files
      const trimmed = text.trim();
      if (trimmed.length < this.config.minCharsForDetection) { return; }

      const lineCount = this.countLines(text);
      if (lineCount < 3) { return; }

      this.log.appendLine(
        `[FILE_CHANGE] file="${this.shortName(doc)}" lines=${lineCount} chars=${text.length}`
      );

      // If file has code but no annotation, flag it
      this.log.appendLine(`  ✅ AI_LIKELY (file watcher): unannotated code file changed`);

      this.onDetectionCb?.({
        classification: InsertionClassification.AI_LIKELY,
        document: doc,
        line: 0,
        text,
        reason: `File changed externally, ${lineCount} lines unannotated`,
      });
    } catch (_e: unknown) {
      // File may have been deleted
    }
  }

  private countLines(text: string): number {
    let c = 1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') { c++; }
    }
    return c;
  }

  private shortName(doc: vscode.TextDocument): string {
    const parts = doc.fileName.split(/[/\\]/);
    return parts[parts.length - 1] ?? doc.fileName;
  }
}