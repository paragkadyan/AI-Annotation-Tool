import * as vscode from 'vscode';
import { DetectionEngine } from './detectionEngine';

/**
 * Passes ALL document change events to the engine without filtering.
 * The engine decides what to skip and what to classify.
 */
export class EventListener implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(private readonly engine: DetectionEngine) {
    this.disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      for (const change of e.contentChanges) {
        try {
          this.engine.processChange(e.document, change);
        } catch (err) {
          console.error('[AI Annotator] Error processing change:', err);
        }
      }
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}