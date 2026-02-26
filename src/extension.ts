import * as vscode from 'vscode';

let log: vscode.OutputChannel;
const activeJobs = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("AI Annotator Pro");
    log.show(true);
    log.appendLine("[SYSTEM] AI Annotator Active.");

    /**
     * HELPER: Resolves Identity and Comment Syntax
     */
    const getContext = (doc: vscode.TextDocument) => {
        const config = vscode.workspace.getConfiguration('aiAnnotator');
        const empId = config.get<string>('employeeId') || "AravindKumar";
        
        const lang = doc.languageId;
        let s = "//", e = "";
        if (['python', 'ruby', 'yaml'].includes(lang)) s = "#";
        else if (['html', 'xml'].includes(lang)) { s = ""; }
        
        return { empId, s, e };
    };

    /**
     * CORE LOGIC: Analyzes and wraps code blocks
     */
    const applyAnnotation = async (document: vscode.TextDocument, range: vscode.Range, insertedText: string) => {
        const uri = document.uri;
        //log.appendLine(`[ANALYZE] Change detected in ${document.fileName} at line ${range.start.line + 1}`);
        //log.appendLine(`[ANALYZE] Inserted Text: "${insertedText}"`);
        const rangeKey = `${uri.toString()}:${range.start.line}`;

        if (activeJobs.has(rangeKey)) return;

        const { empId, s, e } = getContext(document);
        const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

        // 1. NESTING CHECK
        let isInsideExistingBlock = false;
        let parentHeaderLine = -1;
        const stopLine = Math.max(0, range.start.line - 500);

        for (let i = range.start.line - 1; i >= stopLine; i--) {
            const lineText = document.lineAt(i).text;
            if (lineText.includes("AI_END")) break;
            if (lineText.includes("AI_START")) {
                isInsideExistingBlock = true;
                parentHeaderLine = i;
                break;
            }
        }

        activeJobs.add(rangeKey);
        const edit = new vscode.WorkspaceEdit();

        try {
            if (isInsideExistingBlock && parentHeaderLine !== -1) {
                const existingHeader = document.lineAt(parentHeaderLine).text;
                
                // FEATURE: COLLABORATIVE UPDATE
                // Only update if current user is NOT in the header or it's a new day
                if (!existingHeader.includes(empId) || !existingHeader.includes(date)) {
                    const separator = existingHeader.includes("EditedBy") ? ", " : " | EditedBy: ";
                    const newHeader = `${existingHeader.trimEnd()}${separator}${empId} (${date})${e}\n`;
                    
                    edit.replace(uri, document.lineAt(parentHeaderLine).rangeIncludingLineBreak, newHeader);
                    log.appendLine(`[COLLAB] Contribution logged for ${empId} at line ${parentHeaderLine + 1}`);
                }
            } else {
                // FEATURE: NEW WRAP
                const header = `${s} >>> AI_START | ID: ${empId} | ${date}${e}\n`;
                const footer = `\n${s} <<< AI_END${e}\n`;
                
                const linesAdded = insertedText.split('\n').length;
                edit.insert(uri, new vscode.Position(range.start.line, 0), header);
                edit.insert(uri, new vscode.Position(range.start.line + linesAdded, 0), footer);
                
                log.appendLine(`[NEW] Wrapped AI block for ${empId} at line ${range.start.line + 1}`);
            }

            await vscode.workspace.applyEdit(edit);
        } catch (err) {
            log.appendLine(`[ERROR] ${err}`);
        } finally {
            setTimeout(() => activeJobs.delete(rangeKey), 1500);
        }
    };

    /**
     * LISTENER 1: Incremental edits
     */
    const changeSub = vscode.workspace.onDidChangeTextDocument(async event => {
        if (event.reason === vscode.TextDocumentChangeReason.Undo || 
            event.reason === vscode.TextDocumentChangeReason.Redo) return;

        for (const change of event.contentChanges) {
            const text = change.text;

            // PREVENT LOOPS: Ignore if text contains our own tags or logs
            if (text.length < 50 || text.includes("AI_START") || text.includes("AI_END") || text.includes("[SYSTEM]") || text.includes("[ANALYZE]")) continue;

            const clipboard = await vscode.env.clipboard.readText();
            if (text.trim() === clipboard.trim()) continue;

            setTimeout(() => applyAnnotation(event.document, change.range, text), 1000);
        }
    });

    /**
     * LISTENER 2: New files / Existing Workspace
     */
    const openSub = vscode.workspace.onDidOpenTextDocument(doc => {
        if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return;

        setTimeout(() => {
            const text = doc.getText();
            // Don't log for empty files or already tagged files
            if (text.trim().length > 50 && !text.includes("AI_START")) {
                log.appendLine(`[FILE-OPEN] Scanning: ${doc.fileName}`);
                applyAnnotation(doc, new vscode.Range(0, 0, 0, 0), text);
            }
        }, 1000);
    });

    context.subscriptions.push(log, changeSub, openSub);
}

export function deactivate() {}