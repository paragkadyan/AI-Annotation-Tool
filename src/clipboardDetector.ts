import * as vscode from 'vscode';

/**
 * Detects clipboard paste operations using two strategies:
 *  1. Command interception: wraps Ctrl/Cmd+V to set a flag
 *  2. Content matching: compares inserted text against clipboard
 */
export class ClipboardDetector implements vscode.Disposable {
  private pasteFlag = false;
  private lastClipboard = '';
  private disposables: vscode.Disposable[] = [];
  private pollTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.registerPasteIntercept();
    this.startPolling();
  }

  public wasPasted(insertedText: string): boolean {
    // Flag-based: set by our paste command wrapper
    if (this.pasteFlag) {
      return true;
    }

    // Content-based: compare with clipboard
    if (
      this.lastClipboard.length > 3 &&
      insertedText.length > 3 &&
      insertedText.trim() === this.lastClipboard.trim()
    ) {
      return true;
    }

    // Partial match: clipboard content contained in insert
    if (
      this.lastClipboard.length > 20 &&
      insertedText.includes(this.lastClipboard.trim())
    ) {
      return true;
    }

    return false;
  }

  public dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private registerPasteIntercept(): void {
    const cmd = vscode.commands.registerCommand(
      'aiAnnotator.interceptPaste',
      () => this.handlePaste(),
    );
    this.disposables.push(cmd);
  }

  private async handlePaste(): Promise<void> {
    this.pasteFlag = true;
    try {
      this.lastClipboard = await vscode.env.clipboard.readText();
    } catch (_e: unknown) { /* ignore */ }

    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');

    // Keep flag up longer to cover async change events
    setTimeout(() => { this.pasteFlag = false; }, 500);
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      vscode.env.clipboard.readText().then(
        (t) => { this.lastClipboard = t; },
        () => { /* ignore */ },
      );
    }, 1500);
  }
}