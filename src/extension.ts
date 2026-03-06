import * as vscode from 'vscode';

// Global state for the extension (kept outside for simplicity in this stage)
export let isProcessing = false;
let lastActionTime = 0;
export const startRegex = /###\s*AI_GEN_START\s*###/gi;
let debounceTimer: NodeJS.Timeout | undefined;
let log: vscode.OutputChannel;

/**
 * PATH 0: Context Logic
 * Extracted so we can test language detection without launching VS Code.
 */
export function getContext(doc: { languageId: string }) {
    const config = vscode.workspace.getConfiguration('aiAnnotator');
    const empId = config.get<string>('employeeId') || "JACK";
    const lang = doc.languageId;
    let s = "//", e = "";
    
    if (['python', 'ruby', 'yaml'].includes(lang)) {
        s = "#";
    } else if (['html', 'xml'].includes(lang)) {
        s = ""; // Or appropriate comment tags
    }
    
    return { empId, s, e };
}

/**
 * PATH 1 & 2: Annotation Logic
 * Exported so the test suite can trigger it manually.
 */
export async function applyAnnotation(document: vscode.TextDocument, range: vscode.Range, insertedText: string) {
    const now = Date.now();
    if (isProcessing && (now - lastActionTime > 5000)) {
        isProcessing = false;
    }
    if (isProcessing) {
        return;
    }

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
            return;
        }

        // --- PATH 2: EDITEDBY & TAB WRAPPER ---
        if (insertedText.length > 20 || insertedText.includes("#")) {
            let parentHeaderLine = -1;
            for (let i = range.start.line - 1; i >= Math.max(0, range.start.line - 100); i--) {
                const lineText = document.lineAt(i).text;
                if (lineText.includes("AI_END")) {
                    break;
                }
                if (lineText.includes("AI_START")) {
                    parentHeaderLine = i;
                    break;
                }
            }

            if (parentHeaderLine !== -1) {
                const headerLine = document.lineAt(parentHeaderLine);
                const currentHeaderText = headerLine.text;

                if (!currentHeaderText.includes(`${empId} (${date})`)) {
                    const separator = currentHeaderText.includes("EditedBy:") ? ", " : " | EditedBy: ";
                    const updatedHeader = currentHeaderText.replace(e, "").trimEnd() + `${separator}${empId} (${date})${e}\n`;
                    edit.replace(document.uri, headerLine.rangeIncludingLineBreak, updatedHeader);
                }
            } else {
                const header = `${s} >>> AI_START | ID: ${empId} | ${date}${e}\n`;
                const footer = `\n${s} <<< AI_END${e}\n`;
                const linesAdded = insertedText.split('\n').length;

                edit.insert(document.uri, new vscode.Position(range.start.line, 0), header);
                edit.insert(document.uri, new vscode.Position(range.start.line + linesAdded, 0), footer);
            }
            await vscode.workspace.applyEdit(edit);
        }
    } catch (err) {
        if (log) {
            log.appendLine(`[ERROR] ${err}`);
        }
    } finally {
        setTimeout(() => { isProcessing = false; }, 800);
    }
}

export function handleTextChange(event: vscode.TextDocumentChangeEvent) {
    const doc = event.document;
    if (doc !== vscode.window.activeTextEditor?.document) return;
    if (isProcessing) return;

    const fullText = doc.getText();
    const hasMarkers = fullText.includes("###AI_GEN");

    for (const change of event.contentChanges) {
        const text = change.text;

        // Self-Recognition Filter
        if (text.includes(">>> AI_START") || text.includes("<<< AI_END")) {
            continue; 
        }

        // Trigger logic...
        if (hasMarkers || text.length > 20 || text.includes("#")) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (!isProcessing) applyAnnotation(doc, change.range, text);
            }, 1200);
            break;
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    log = vscode.window.createOutputChannel("AI Annotator Pro");
    log.show(true);
    log.appendLine("[INIT] AI Annotator Active.");

    const changeSub = vscode.workspace.onDidChangeTextDocument(handleTextChange);
    context.subscriptions.push(log,changeSub);
}

export function deactivate() {}