import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    const log = vscode.window.createOutputChannel("AI Annotator");
    log.show(true);

    const activeJobs = new Set<string>();

    const applyAnnotation = async (document: vscode.TextDocument, range: vscode.Range, insertedText: string) => {
        const uri = document.uri;
        const rangeKey = `${uri.toString()}:${range.start.line}`;
        if (activeJobs.has(rangeKey)) return;

        // 1. SCAN FOR PARENT BLOCK
        let parentHeaderLine = -1;
        for (let i = range.start.line - 1; i >= 0; i--) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes("AI_END")) break; // We are outside
            if (lineText.includes("AI_START")) {
                parentHeaderLine = i; // We are inside this block
                break;
            }
        }

        const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        const empId = "AravindKumar";
        const lang = document.languageId;
        let s = "//", e = "";
        if (['python', 'ruby'].includes(lang)) { s = "#"; }

        const edit = new vscode.WorkspaceEdit();

        // 2. LOGIC: TO NEST OR TO MERGE?
        if (parentHeaderLine !== -1) {
            // We are INSIDE. Instead of a new block, let's update the parent header 
            // to show it has been updated with new logic.
            const existingHeader = document.lineAt(parentHeaderLine).text;
            if (!existingHeader.includes("UPDATED")) {
                const newHeader = `${existingHeader.trimEnd()} | UPDATED: ${date}\n`;
                const headerRange = document.lineAt(parentHeaderLine).rangeIncludingLineBreak;
                edit.replace(uri, headerRange, newHeader);
                log.appendLine(`[UPDATE] Merged new code into existing block at line ${parentHeaderLine + 1}`);
            }
        } else {
            // We are OUTSIDE. Standard wrap.
            const header = `${s} >>> AI_START | ID: ${empId} | ${date}${e}\n`;
            const footer = `\n${s} <<< AI_END${e}\n`;
            const linesAdded = insertedText.split('\n').length;
            
            edit.insert(uri, new vscode.Position(range.start.line, 0), header);
            edit.insert(uri, new vscode.Position(range.start.line + linesAdded, 0), footer);
            log.appendLine(`[NEW] Wrapped new block at line ${range.start.line + 1}`);
        }

        activeJobs.add(rangeKey);
        try {
            await vscode.workspace.applyEdit(edit);
        } finally {
            setTimeout(() => activeJobs.delete(rangeKey), 1500);
        }
    };

    const textWatcher = vscode.workspace.onDidChangeTextDocument(async event => {
        for (const change of event.contentChanges) {
            // Trigger on significant changes
            if (change.text.length > 50) {
                if (change.text.includes("AI_START")) continue;
                
                // Allow a shorter delay for nested updates to feel responsive
                setTimeout(() => applyAnnotation(event.document, change.range, change.text), 800);
            }
        }
    });

    context.subscriptions.push(log, textWatcher);
}