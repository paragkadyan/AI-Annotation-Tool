"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClipboardDetector = void 0;
const vscode = require("vscode");
class ClipboardDetector {
    constructor() {
        this.lastClipboard = '';
        setInterval(async () => {
            try {
                this.lastClipboard = await vscode.env.clipboard.readText();
            }
            catch {
                // ignore
            }
        }, 1500);
    }
    isPaste(insertedText) {
        if (!this.lastClipboard) {
            return false;
        }
        if (insertedText.trim().length > 5 &&
            insertedText.trim() === this.lastClipboard.trim()) {
            console.log("PASTE DETECTED");
            return true;
        }
        return false;
    }
}
exports.ClipboardDetector = ClipboardDetector;
//# sourceMappingURL=clipboardDetector.js.map