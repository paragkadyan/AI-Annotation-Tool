import * as vscode from 'vscode';
import { DetectionEngine } from './detectionEngine';

/**
 * Thin listener layer. Simply forwards every content change to the engine.
 * All filtering and classification logic lives in DetectionEngine.
 */
export class EventListener implements vscode.Disposable {
  private disposable: vscode.Disposable;

  constructor(private readonly engine: DetectionEngine) {
    this.disposable = vscode.workspace.onDidChangeTextDocument((e) => {
      for (const change of e.contentChanges) {
        this.engine.processChange(e.document, change);
      }
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}