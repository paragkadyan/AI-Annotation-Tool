import * as vscode from 'vscode';
import {
  AnnotatorConfig,
  DetectionResult,
  InsertionClassification,
} from './types';
import { ClipboardDetector } from './clipboardDetector';
import { ANNOTATION_MARKER, ANNOTATION_END_MARKER } from './annotationBuilder';

interface PendingBuffer {
  document: vscode.TextDocument;
  totalText: string;
  totalChars: number;
  startLine: number;
  endLine: number;
  firstTime: number;
  lastTime: number;
  changeCount: number;
}

/**
 * Detection engine with two modes:
 *
 *  1. INSTANT detection: a single change event with many chars/lines
 *     → classified immediately (Copilot Chat Apply)
 *
 *  2. COALESCED detection: rapid small changes within 300ms window
 *     → buffered and classified after flush (Copilot Tab suggestions)
 *
 * The infinite-loop fix: output channel documents are rejected BEFORE
 * any logging occurs.
 */
export class DetectionEngine {
  private onDetectionCb: ((r: DetectionResult) => void) | null = null;
  private log: vscode.OutputChannel;

  public suppressedDocs = new Set<string>();

  /** Per-file buffers for coalescing rapid changes. */
  private buffers = new Map<string, PendingBuffer>();
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private static readonly COALESCE_MS = 350;
  private static readonly MIN_COALESCED_CHARS = 8;

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

    // ── CRITICAL: Skip output/internal docs BEFORE logging ──
    const scheme = doc.uri.scheme;
    if (scheme === 'output' || scheme === 'debug' || scheme === 'git' ||
        scheme === 'vscode' || scheme === 'search-editor' ||
        doc.fileName.includes('extension-output')) {
      return;
    }

    const uri = doc.uri.toString();
    const text = change.text;
    const charCount = text.length;
    const now = Date.now();

    this.log.appendLine(
      `[CHANGE] file="${this.shortName(doc)}" scheme=${scheme} ` +
      `chars=${charCount} lines=${this.countLines(text)} ` +
      `rangeLen=${change.rangeLength} suppressed=${this.suppressedDocs.has(uri)} ` +
      `preview="${text.substring(0, 80).replace(/[\n\r]/g, '\\n')}"`
    );

    // ── SKIP: suppressed ──
    if (this.suppressedDocs.has(uri)) {
      this.log.appendLine(`  → SKIP: suppressed`);
      return;
    }

    // ── SKIP: pure deletions ──
    if (charCount === 0) { return; }

    // ── SKIP: contains our markers ──
    if (text.includes(ANNOTATION_MARKER) || text.includes(ANNOTATION_END_MARKER)) {
      this.log.appendLine(`  → SKIP: our marker`);
      return;
    }

    // ── SKIP: single character = human typing ──
    if (charCount === 1 && change.rangeLength === 0) { return; }

    // ── SKIP: clipboard paste ──
    if (this.clipboard.wasPasted(text)) {
      this.log.appendLine(`  → SKIP: paste`);
      return;
    }

    // ── INSTANT: Large block in one event → classify now ──
    const lineCount = this.countLines(text);
    const trimmed = text.trim();

    if (trimmed.length >= 30 && lineCount >= 3) {
      this.log.appendLine(`  ✅ AI_LIKELY (instant): ${lineCount} lines, ${charCount} chars`);
      this.flushBuffer(uri); // flush any pending buffer first
      this.emitResult(doc, change.range.start.line, text,
        `Instant: ${lineCount} lines, ${charCount} chars`);
      return;
    }

    // ── COALESCE: Buffer small rapid changes ──
    // Use a combined key for both file:// and chat-editing-text-model://
    // pointing to the same file
    const bufKey = this.getBufferKey(doc);
    const existing = this.buffers.get(bufKey);

    if (existing && (now - existing.lastTime) < DetectionEngine.COALESCE_MS) {
      existing.totalText += text;
      existing.totalChars += charCount;
      existing.lastTime = now;
      existing.endLine = Math.max(existing.endLine,
        change.range.start.line + this.countLines(text) - 1);
      existing.changeCount++;
      this.resetFlushTimer(bufKey);
      this.log.appendLine(`  → BUFFERED (${existing.changeCount} changes, ${existing.totalChars} chars total)`);
      return;
    }

    // Flush old buffer if exists, start new one
    this.flushBuffer(bufKey);

    this.buffers.set(bufKey, {
      document: doc,
      totalText: text,
      totalChars: charCount,
      startLine: change.range.start.line,
      endLine: change.range.start.line + this.countLines(text) - 1,
      firstTime: now,
      lastTime: now,
      changeCount: 1,
    });
    this.resetFlushTimer(bufKey);
    this.log.appendLine(`  → BUFFER START`);
  }

  /**
   * Called by FileWatcher when a file changes on disk.
   */
  public async processFileChange(fileUri: vscode.Uri): Promise<void> {
    if (!this.config.enabled) { return; }
    const uri = fileUri.toString();
    if (this.suppressedDocs.has(uri)) { return; }

    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const text = doc.getText();
      const trimmed = text.trim();

      if (trimmed.length < this.config.minCharsForDetection) { return; }
      if (text.includes(ANNOTATION_MARKER)) {
        // Check if there's unannotated code AFTER the last AI_ASSISTED_END
        const lastEnd = text.lastIndexOf(ANNOTATION_END_MARKER);
        const afterEnd = text.substring(lastEnd + ANNOTATION_END_MARKER.length).trim();
        if (afterEnd.length < 20) { return; }

        this.log.appendLine(`[FILE_CHANGE] Found unannotated code after last AI_ASSISTED_END`);
        this.emitResult(doc, 0, afterEnd, 'File watcher: unannotated code after last block');
        return;
      }

      const lineCount = this.countLines(text);
      if (lineCount < 3) { return; }

      this.log.appendLine(`[FILE_CHANGE] ${this.shortName(doc)} — ${lineCount} lines unannotated`);
      this.emitResult(doc, 0, text, `File watcher: ${lineCount} lines unannotated`);
    } catch (_e: unknown) { /* file deleted */ }
  }

  // ── Buffer management ──────────────────────────────────────

  private resetFlushTimer(bufKey: string): void {
    const existing = this.flushTimers.get(bufKey);
    if (existing) { clearTimeout(existing); }

    this.flushTimers.set(bufKey, setTimeout(() => {
      this.flushBuffer(bufKey);
    }, DetectionEngine.COALESCE_MS + 50));
  }

  private flushBuffer(bufKey: string): void {
    const timer = this.flushTimers.get(bufKey);
    if (timer) { clearTimeout(timer); }
    this.flushTimers.delete(bufKey);

    const buf = this.buffers.get(bufKey);
    if (!buf) { return; }
    this.buffers.delete(bufKey);

    const trimmed = buf.totalText.trim();

    this.log.appendLine(
      `[FLUSH] ${this.shortName(buf.document)}: ${buf.changeCount} changes, ` +
      `${buf.totalChars} chars, ${this.countLines(buf.totalText)} lines, ` +
      `trimmed=${trimmed.length} chars`
    );

    // Skip if total coalesced content is too small or just whitespace
    if (trimmed.length < DetectionEngine.MIN_COALESCED_CHARS) {
      this.log.appendLine(`  → SKIP: coalesced content too small (${trimmed.length} chars)`);
      return;
    }

    // Skip single-change buffers that look like IntelliSense
    if (buf.changeCount === 1 && buf.totalChars < 40 && this.countLines(buf.totalText) === 1) {
      this.log.appendLine(`  → SKIP: likely IntelliSense`);
      return;
    }

    // Multiple rapid changes with meaningful content → AI_LIKELY
    if (buf.changeCount >= 2 || trimmed.length >= 20) {
      this.log.appendLine(`  ✅ AI_LIKELY (coalesced): ${buf.changeCount} changes, ${trimmed.length} chars`);
      this.emitResult(buf.document, buf.startLine, buf.totalText,
        `Coalesced: ${buf.changeCount} changes, ${buf.totalChars} chars`);
      return;
    }

    this.log.appendLine(`  → SKIP: not enough evidence`);
  }

  // ── Helpers ────────────────────────────────────────────────

  private emitResult(doc: vscode.TextDocument, line: number, text: string, reason: string): void {
    this.onDetectionCb?.({
      classification: InsertionClassification.AI_LIKELY,
      document: doc,
      line,
      text,
      reason,
    });
  }

  /**
   * Normalize buffer key: both file:// and chat-editing-text-model://
   * for the same file should share a buffer.
   */
  private getBufferKey(doc: vscode.TextDocument): string {
    // Use the fsPath as key so virtual and real docs coalesce together
    return doc.fileName.toLowerCase();
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