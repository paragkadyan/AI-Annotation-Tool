import * as vscode from 'vscode';

export class ClipboardDetector {

    private lastClipboard: string = '';

    constructor() {
        setInterval(async () => {
            try {
                this.lastClipboard = await vscode.env.clipboard.readText();
            } catch {
                // ignore
            }
        }, 1500);
    }

    public isPaste(insertedText: string): boolean {

        if (!this.lastClipboard) {
            return false;
        }

        if (
            insertedText.trim().length > 5 &&
            insertedText.trim() === this.lastClipboard.trim()
        ) {
            console.log("PASTE DETECTED");
            return true;
        }

        return false;
    }
}