import * as vscode from 'vscode';
import {
  AnnotatorConfig,
  DetectionResult,
  InsertionClassification,
} from './types';
import { ClipboardDetector } from './clipboardDetector';
import { ANNOTATION_MARKER } from './annotationBuilder';

/**
 * Simplified, reliable detection engine.
 *
 * Core principle: ANY text insertion that is NOT one of these is AI_LIKELY:
 *   - Single character (human typing)
 *   - Clipboard paste
 *   - Our own annotation
 *   - Whitespace / auto-indent
 *   - Too short to matter
 *
 * This avoids all timing-based race conditions. If multiple characters
 * appear in a single onDidChangeTextDocument event and it's not a paste,
 * it's almost certainly from Copilot (Tab or Chat).
 */
export class DetectionEngine {
  private onDetectionCb: ((r: DetectionResult) => void) | null = null;
  private log: vscode.OutputChannel;

  /** Set of document URIs we are currently writing annotations to. */
  public suppressedDocs = new Set<string>();

  constructor(
    private readonly clipboard: ClipboardDetector,
    private config: AnnotatorConfig,
  ) {
    this.log = vscode.window.createOutputChannel('AI Annotator');
  }

  public onResult(cb: (r: DetectionResult) => void): void {
    this.onDetectionCb = cb;
  }

  public updateConfig(cfg: AnnotatorConfig): void {
    this.config = cfg;
  }

  /**
   * Called for every content change in a text document.
   * Decides synchronously whether it's AI or not.
   */
  public processChange(
    doc: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent,
  ): void {
    if (!this.config.enabled) { return; }

    const uri = doc.uri.toString();
    const text = change.text;
    const charCount = text.length;
    const lineCount = this.countLines(text);

    this.log.appendLine(
      `[CHANGE] file=${this.shortName(doc)} chars=${charCount} lines=${lineCount} ` +
      `rangeLen=${change.rangeLength} suppressed=${this.suppressedDocs.has(uri)}`
    );

    // ── SKIP conditions ──

    // Skip if we're currently writing an annotation to this doc
    if (this.suppressedDocs.has(uri)) {
      this.log.appendLine(`  → SKIP: suppressed (our annotation)`);
      return;
    }

    // Skip non-file documents
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') {
      return;
    }

    // Skip pure deletions
    if (charCount === 0) { return; }

    // Skip if it contains our annotation marker (our own edit looped back)
    if (text.includes(ANNOTATION_MARKER)) {
      this.log.appendLine(`  → SKIP: contains annotation marker`);
      return;
    }

    // Skip single characters — that's human typing
    if (charCount === 1) {
      this.log.appendLine(`  → SKIP: single char (human typing)`);
      return;
    }

    // Skip if only whitespace and short (auto-indent, enter key with indent)
    if (text.trim().length === 0 && charCount < 12) {
      this.log.appendLine(`  → SKIP: short whitespace (auto-indent)`);
      return;
    }

    // Skip very short non-meaningful text
    if (charCount < this.config.minCharsForDetection) {
      this.log.appendLine(`  → SKIP: below threshold (${charCount} < ${this.config.minCharsForDetection})`);
      return;
    }

    // ── PASTE check ──
    if (this.clipboard.wasPasted(text)) {
      this.log.appendLine(`  → SKIP: clipboard paste`);
      return;
    }

    // ── AUTO-COMPLETE check ──
    // VS Code's built-in autocomplete (IntelliSense word completion) typically
    // inserts short completions. Allow up to 2 lines and under 60 chars as
    // potential autocomplete. Copilot suggestions are almost always longer.
    if (lineCount <= 1 && charCount < 60 && change.rangeLength > 0) {
      // This looks like IntelliSense replacing a partial word
      const ratio = charCount / Math.max(change.rangeLength, 1);
      if (ratio < 4) {
        this.log.appendLine(`  → SKIP: likely IntelliSense completion (ratio=${ratio.toFixed(1)})`);
        return;
      }
    }

    // ── BRACKET AUTO-CLOSE check ──
    // Editors auto-insert closing brackets/quotes: (), {}, [], "", ''
    if (charCount <= 2 && /^[\)\]\}'"` ]$/.test(text.trim())) {
      this.log.appendLine(`  → SKIP: bracket/quote auto-close`);
      return;
    }

    // ── If we got here: it's AI_LIKELY ──
    const reason = this.buildReason(charCount, lineCount, change.rangeLength);
    this.log.appendLine(`  → AI_LIKELY: ${reason}`);

    const result: DetectionResult = {
      classification: InsertionClassification.AI_LIKELY,
      document: doc,
      line: change.range.start.line,
      text,
      reason,
    };

    this.onDetectionCb?.(result);
  }

  private buildReason(chars: number, lines: number, replaced: number): string {
    const parts: string[] = [];
    if (lines >= 3) { parts.push(`${lines}-line block`); }
    else { parts.push(`${chars} chars`); }
    if (replaced === 0) { parts.push('pure insert'); }
    else { parts.push(`replaced ${replaced} chars`); }
    return parts.join(', ');
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