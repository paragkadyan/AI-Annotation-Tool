import * as vscode from 'vscode';

// Global State
export let isProcessing = false;
let lastActionTime = 0;
let debounceTimer: NodeJS.Timeout | undefined;
export const startRegex = /###\s*AI_GEN_START\s*###/gi;
let log: vscode.OutputChannel;
let currentEmployeeId: string = "JACK"; 
let aiStatusBarItem: vscode.StatusBarItem;

/**
 * PATH 0: Context Logic
 */
export function getContext(doc: { languageId: string }) {
    const lang = doc.languageId;
    let s = "//", e = "";
    
    if (['python', 'ruby', 'yaml'].includes(lang)) {
        s = "#";
    } else if (['html', 'xml'].includes(lang)) {
        s = ""; 
    }
    
    return { empId: currentEmployeeId, s, e };
}

/**
 * PATH 1 & 2: Annotation Logic
 */
export async function applyAnnotation(document: vscode.TextDocument, range: vscode.Range, insertedText: string) {
    const now = Date.now();
    if (isProcessing && (now - lastActionTime > 5000)) {
        isProcessing = false;
    }
    if (isProcessing) return;

    isProcessing = true;
    lastActionTime = now;

    const { empId, s, e } = getContext(document);
    const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
    const edit = new vscode.WorkspaceEdit();
    const fullText = document.getText();

    try {
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

        if (insertedText.length > 20 || insertedText.includes("#")) {
            let parentHeaderLine = -1;
            for (let i = range.start.line - 1; i >= Math.max(0, range.start.line - 100); i--) {
                const lineText = document.lineAt(i).text;
                if (lineText.includes("AI_END")) break;
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
        if (log) log.appendLine(`[ERROR] ${err}`);
    } finally {
        setTimeout(() => { isProcessing = false; }, 800);
    }
}

function updateAICodePercentage(document: vscode.TextDocument) {
    if (document.fileName.endsWith('copilot-instructions.md')) return;

    const lineCount = document.lineCount;
    let aiLines = 0;
    let totalMeaningfulLines = 0;
    let insideAIBlock = false;

    for (let i = 0; i < lineCount; i++) {
        const line = document.lineAt(i);
        const text = line.text.trim(); // Remove leading/trailing whitespace

        // 1. Handle Markers (We don't count the marker lines themselves as code)
        if (text.includes("AI_START")) {
            insideAIBlock = true;
            continue; 
        }
        if (text.includes("AI_END")) {
            insideAIBlock = false;
            continue;
        }

        // 2. Count Meaningful Lines
        if (text.length > 0) {
            totalMeaningfulLines++;
            if (insideAIBlock) {
                aiLines++;
            }
        }
    }

    // Calculate based on meaningful content rather than raw line count
    const percentage = totalMeaningfulLines > 0 
        ? ((aiLines / totalMeaningfulLines) * 100).toFixed(1) 
        : "0.0";
    
    aiStatusBarItem.text = `$(circuit-board) AI Content: ${percentage}%`;
    aiStatusBarItem.tooltip = `Code Lines: ${totalMeaningfulLines} | AI Lines: ${aiLines}`;
    aiStatusBarItem.show();
}

export async function handleTextChange(event: vscode.TextDocumentChangeEvent) {
    const doc = event.document;
    if (doc !== vscode.window.activeTextEditor?.document) return;
    if (isProcessing) return;
    
    if (event.reason === vscode.TextDocumentChangeReason.Undo || 
        event.reason === vscode.TextDocumentChangeReason.Redo) {
        return;
    }

    if (doc.fileName.endsWith('copilot-instructions.md')) {
        return; 
    }
    const clipboard = await vscode.env.clipboard.readText();
    const fullText = doc.getText();
    const hasMarkers = fullText.includes("###AI_GEN");

    for (const change of event.contentChanges) {
        const text = change.text;
        
        if (text.trim().length > 0 && text.trim() === clipboard.trim()) {
            if (log) log.appendLine(`[SKIP] Manual paste detected from clipboard.`);
            continue; 
        }

        if (hasMarkers) {
            if (log) log.appendLine(`[TRIGGER] Handshake detected. Overriding filters.`);
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (!isProcessing) applyAnnotation(doc, change.range, text);
            }, 1200); 
            break; 
        }

        if (text.includes(">>> AI_START") || text.includes("<<< AI_END")) continue;

        if (text.length > 20 || text.includes("#")) {
            if (log) log.appendLine(`[TRIGGER] Tab or Manual change detected.`);
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (!isProcessing) applyAnnotation(doc, change.range, text);
            }, 1200); 
            break; 
        }
    }
}

/**
 * PATH 3: User Setup Logic
 */
async function createInstructionFile() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const rootUri = workspaceFolders[0].uri;
    const githubFolderUri = vscode.Uri.joinPath(rootUri, '.github');
    const fileUri = vscode.Uri.joinPath(githubFolderUri, 'copilot-instructions.md');

    const instructionMarker = "###AI_GEN_START###";
    const endMarker = "###AI_GEN_END###";
    const newContent = `\n\n# AI Annotator Handshake\n` +
    `CRITICAL RULES for Code Generation:\n` +
    `1. You MUST wrap every new code block with these markers:\n` +
    `   ${instructionMarker}\n` +
    `   [Your code here]\n` +
    `   ${endMarker}\n\n` +
    `2. ANTI-NESTING RULE: Never insert markers inside an existing annotated block.\n` +
    `   - BAD: ${instructionMarker} ... ${instructionMarker} code ${endMarker} ... ${endMarker}\n` +
    `   - GOOD: Replace the existing block or start a new one entirely outside of it.\n\n` +
    `3. Do not include these instructions in the code output itself.`;
    try {
        await vscode.workspace.fs.createDirectory(githubFolderUri);
        let finalBuffer: Uint8Array;

        try {
            const existingData = await vscode.workspace.fs.readFile(fileUri);
            const existingContent = Buffer.from(existingData).toString('utf8');

            if (existingContent.includes(instructionMarker)) {
                vscode.window.showInformationMessage("Handshake instructions already exist.");
                return;
            }

            finalBuffer = Buffer.from(existingContent + newContent);
            log.appendLine("[INIT] Appending instructions to existing file.");
        } catch {
            finalBuffer = Buffer.from(newContent.trimStart());
            log.appendLine("[INIT] Creating new file.");
        }

        await vscode.workspace.fs.writeFile(fileUri, finalBuffer);
        vscode.window.showInformationMessage("Handshake file updated!");
    } catch (err) {
        vscode.window.showErrorMessage("Failed to manage .github/copilot-instructions.md");
    }
}

export async function activate(context: vscode.ExtensionContext) {
    // 1. Initialize UI/Logging immediately and register for disposal
    log = vscode.window.createOutputChannel("AI Annotator Pro");
    aiStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    
    // Push these FIRST so they are cleared even if the rest of the function fails
    context.subscriptions.push(log, aiStatusBarItem);
    
    log.show(true);
    log.appendLine("[INIT] AI Annotator Active.");

    // 2. Setup Event Listeners
    // Switch Tabs
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) updateAICodePercentage(editor.document);
        })
    );

    // Text Changes (Percentage calculation)
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === vscode.window.activeTextEditor?.document) {
                updateAICodePercentage(event.document);
            }
        })
    );

    // Text Changes (Annotation Logic - handleTextChange)
    const changeSub = vscode.workspace.onDidChangeTextDocument(handleTextChange);
    context.subscriptions.push(changeSub);

    // Initial check for open file
    if (vscode.window.activeTextEditor) {
        updateAICodePercentage(vscode.window.activeTextEditor.document);
    }

    // 3. Employee ID Setup
    let savedId = context.globalState.get<string>('employeeId');
    if (!savedId) {
        savedId = await vscode.window.showInputBox({
            prompt: "Setup: Enter your Employee ID",
            ignoreFocusOut: true,
            validateInput: text => text.length > 0 ? null : "ID cannot be empty"
        });
        if (savedId) { await context.globalState.update('employeeId', savedId); }
        else { savedId = "GUEST"; }
    }
    currentEmployeeId = savedId;

    // 4. SMART CHECK for Instructions
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        const fileUri = vscode.Uri.joinPath(folders[0].uri, '.github', 'copilot-instructions.md');
        try {
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            const content = Buffer.from(fileData).toString('utf8');
            if (!content.includes("###AI_GEN_START###")) {
                const action = await vscode.window.showInformationMessage("AI Annotator: Handshake markers missing.", "Append Markers");
                if (action === "Append Markers") { await createInstructionFile(); }
            }
        } catch {
            const action = await vscode.window.showInformationMessage("AI Annotator: No handshake file found.", "Create .github/copilot-instructions.md");
            if (action === "Create .github/copilot-instructions.md") { await createInstructionFile(); }
        }
    }

    // 5. Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('ai-annotator.resetId', async () => {
            await context.globalState.update('employeeId', undefined);
            vscode.window.showInformationMessage("ID cleared. Please reload VS Code.");
        }),
        vscode.commands.registerCommand('ai-annotator.initFile', async () => {
            await createInstructionFile();
        })
    );
}

export function deactivate() {}