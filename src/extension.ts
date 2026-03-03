import * as vscode from 'vscode';

let log: vscode.OutputChannel;
let isProcessing = false;
let lastActionTime = 0;
let debounceTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("AI Annotator Pro");
    log.show(true);
    log.appendLine("[INIT] AI Annotator Active. EditedBy Feature Enabled.");

    const getContext = (doc: vscode.TextDocument) => {
        const config = vscode.workspace.getConfiguration('aiAnnotator');
        const empId = config.get<string>('employeeId') || "JACK";
        const lang = doc.languageId;
        let s = "//", e = "";
        if (['python', 'ruby', 'yaml'].includes(lang)) s = "#";
        else if (['html', 'xml'].includes(lang)) { s = ""; }
        return { empId, s, e };
    };

    const applyAnnotation = async (document: vscode.TextDocument, range: vscode.Range, insertedText: string) => {
        const now = Date.now();
        if (isProcessing && (now - lastActionTime > 5000)) isProcessing = false;
        if (isProcessing) return;

        isProcessing = true;
        lastActionTime = now;

        const { empId, s, e } = getContext(document);
        const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        const edit = new vscode.WorkspaceEdit();
        const fullText = document.getText();

        try {
            // --- PATH 1: CHAT SCANNER ---
            if (fullText.includes("###AI_GEN")) {
                const startRegex = /###\s*AI_GEN_START\s*###/gi;
                const endRegex = /###\s*AI_GEN_END\s*###/gi;
                let match;
                while ((match = startRegex.exec(fullText)) !== null) {
                    edit.replace(document.uri, new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)), `${s} >>> AI_START | ID: ${empId} | ${date}${e}`);
                }
                while ((match = endRegex.exec(fullText)) !== null) {
                    edit.replace(document.uri, new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)), `${s} <<< AI_END${e}`);
                }
                await vscode.workspace.applyEdit(edit);
                return; // Chat is handled, exit completely.
            }

            // --- PATH 2: EDITEDBY & TAB WRAPPER ---
            if (insertedText.length > 20) {
                let parentHeaderLine = -1;
                
                // 1. Upward Scan to check for existing blocks
                for (let i = range.start.line - 1; i >= Math.max(0, range.start.line - 100); i--) {
                    const lineText = document.lineAt(i).text;
                    // If we hit an END before a START, we are NOT inside a block
                    if (lineText.includes("AI_END")) break; 
                    if (lineText.includes("AI_START")) {
                        parentHeaderLine = i;
                        break;
                    }
                }

                if (parentHeaderLine !== -1) {
                    // CASE A: UPDATE HEADER (EditedBy)
                    const headerLine = document.lineAt(parentHeaderLine);
                    const currentHeaderText = headerLine.text;

                    if (!currentHeaderText.includes(`${empId} (${date})`)) {
                        const separator = currentHeaderText.includes("EditedBy:") ? ", " : " | EditedBy: ";
                        const updatedHeader = currentHeaderText.replace(e, "").trimEnd() + `${separator}${empId} (${date})${e}\n`;
                        
                        edit.replace(document.uri, headerLine.rangeIncludingLineBreak, updatedHeader);
                        log.appendLine(`[EDITEDBY] Tagged ${empId} on line ${parentHeaderLine + 1}`);
                    }
                    // IMPORTANT: We found a parent, so we DO NOT want to add a new header/footer.
                } else {
                    // CASE B: NEW BLOCK (Wrap)
                    log.appendLine("[TAB] New AI block detected. Wrapping...");
                    const header = `${s} >>> AI_START | ID: ${empId} | ${date}${e}\n`;
                    const footer = `\n${s} <<< AI_END${e}\n`;
                    const linesAdded = insertedText.split('\n').length;

                    edit.insert(document.uri, new vscode.Position(range.start.line, 0), header);
                    edit.insert(document.uri, new vscode.Position(range.start.line + linesAdded, 0), footer);
                }
                
                await vscode.workspace.applyEdit(edit);
            }
        } catch (err) {
            log.appendLine(`[ERROR] ${err}`);
        } finally {
            setTimeout(() => { isProcessing = false; }, 800);
        }
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument(event => {
    const doc = event.document;
    if (doc !== vscode.window.activeTextEditor?.document) return;

    // 1. If we are already processing, don't even start a new timer.
    // This is the first line of defense against the loop.
    if (isProcessing) return;

    const fullText = doc.getText();
    const hasMarkers = fullText.includes("###AI_GEN");
    log.appendLine(`[DETECT] Change detected in ${doc.fileName}. Markers present: ${hasMarkers}`); 
    for (const change of event.contentChanges) {
        const text = change.text;

        // 2. SELF-RECOGNITION: Ignore our own tags
        if (text.includes(">>> AI_START") || text.includes("<<< AI_END")) continue;

        // 3. THE SAFE TRIGGER
        if (hasMarkers || text.length > 20 || text.includes("#")) {
            log.appendLine(`[TRIGGER] Change qualifies for processing. Text: ${text}`);
            if (debounceTimer) clearTimeout(debounceTimer);
            
            const r = change.range;
            const t = text;

            debounceTimer = setTimeout(() => {
                // Double-check lock before firing the heavy logic
                if (!isProcessing) {
                    applyAnnotation(doc, r, t);
                }
            }, 1200); 
            
            break; 
        }
    }
});
    context.subscriptions.push(log, changeSub);
}

export function deactivate() {}