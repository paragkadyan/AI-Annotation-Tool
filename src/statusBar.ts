import * as vscode from 'vscode';

/**
 * Manages a status-bar item that shows annotator state and
 * flashes briefly when an annotation is inserted.
 */
export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = 'aiAnnotator.toggle';
    this.setIdle();
    this.item.show();
  }

  public setEnabled(enabled: boolean): void {
    if (enabled) {
      this.setIdle();
    } else {
      this.item.text = '$(circle-slash) AI Annotator OFF';
      this.item.tooltip = 'Click to enable AI code annotation';
      this.item.backgroundColor = undefined;
    }
  }

  public flashAnnotation(): void {
    this.item.text = '$(sparkle) AI Annotated!';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );

    if (this.flashTimer) { clearTimeout(this.flashTimer); }
    this.flashTimer = setTimeout(() => {
      this.setIdle();
      this.flashTimer = null;
    }, 2500);
  }

  private setIdle(): void {
    this.item.text = '$(eye) AI Annotator';
    this.item.tooltip = 'AI code annotation detection is active';
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    if (this.flashTimer) { clearTimeout(this.flashTimer); }
    this.item.dispose();
  }
}