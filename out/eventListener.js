"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventListener = void 0;
const vscode = require("vscode");
class EventListener {
    engine;
    clipboard;
    disposable;
    constructor(engine, clipboard) {
        this.engine = engine;
        this.clipboard = clipboard;
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
    dispose() {
        this.disposable.dispose();
    }
}
exports.EventListener = EventListener;
//# sourceMappingURL=eventListener.js.map