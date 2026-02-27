import * as vscode from 'vscode';

export class DetectionEngine {

    public processChange(
        document: vscode.TextDocument,
        change: vscode.TextDocumentContentChangeEvent
    ) {

        const insertedText = change.text;

        if (!insertedText || insertedText.trim().length === 0) {
            return;
        }

        const charCount = insertedText.length;
        const lineCount = insertedText.split('\n').length;

        console.log("---- CHANGE DETECTED ----");
        console.log("Characters:", charCount);
        console.log("Lines:", lineCount);

        // Ignore very small inserts (likely manual typing)
        if (charCount < 5) {
            console.log("Small manual typing detected");
            return;
        }

        // Large multi-line insert → AI likely
        if (charCount > 30 && lineCount > 2) {
            console.log("AI LIKELY DETECTED");

            vscode.window.showInformationMessage(
                "AI Insert Detected"
            );

            return;
        }

        console.log("Regular typing detected");
    }
}