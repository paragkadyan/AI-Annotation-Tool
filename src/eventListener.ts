import * as vscode from 'vscode';
import { DetectionEngine } from './detectionEngine';
import { ClipboardDetector } from './clipboardDetector';

export class EventListener implements vscode.Disposable {

    private disposable: vscode.Disposable;

    constructor(
        private readonly engine: DetectionEngine,
        private readonly clipboard: ClipboardDetector
    ) {

        console.log("EventListener registered");

        this.disposable = vscode.workspace.onDidChangeTextDocument((event) => {

            for (const change of event.contentChanges) {

                if (!change.text) {
                    return;
                }

                // First check paste
                if (this.clipboard.isPaste(change.text)) {
                    vscode.window.showInformationMessage("Paste Detected");
                    return;
                }

                // Then check AI
                this.engine.processChange(event.document, change);
            }
        });
    }

    dispose(): void {
        this.disposable.dispose();
    }
}