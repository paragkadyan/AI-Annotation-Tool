import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCommentStyle } from './commentStyles';

const documentSizeMap = new Map<string, number>();
const snapshotMap = new Map<string, string>();

let extensionEnabled = true;
let cooldown = false;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {

    // Status Bar
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = "aiAnnotator.toggle";
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Toggle Command
    context.subscriptions.push(
        vscode.commands.registerCommand("aiAnnotator.toggle", () => {
            extensionEnabled = !extensionEnabled;
            updateStatusBar();
            vscode.window.showInformationMessage(
                extensionEnabled
                    ? "AI Annotator Enabled"
                    : "AI Annotator Disabled"
            );
        })
    );

    // Force Annotate Command
    context.subscriptions.push(
        vscode.commands.registerCommand("aiAnnotator.forceAnnotate", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            const text = editor.document.getText();
            await annotateAIBlock(editor.document, text);
        })
    );

    // Main Detection Listener
    const disposable = vscode.workspace.onDidChangeTextDocument(async (event) => {

        if (!extensionEnabled) return;
        if (cooldown) return;

        const document = event.document;
        const docUri = document.uri.toString();
        const currentSize = document.getText().length;

        if (!documentSizeMap.has(docUri)) {
            documentSizeMap.set(docUri, currentSize);
            snapshotMap.set(docUri, document.getText());
            return;
        }

        const previousSize = documentSizeMap.get(docUri) || 0;
        const sizeDiff = currentSize - previousSize;
        documentSizeMap.set(docUri, currentSize);

        // Ignore small typing
        if (sizeDiff <= 30) return;

        const insertedText = event.contentChanges
            .map(c => c.text)
            .join("");

        const insertedLines = insertedText.split("\n").length - 1;

        if (insertedLines < 2) return;

        // Ignore manual paste
        const clipboardText = await vscode.env.clipboard.readText();

        if (
            clipboardText.replace(/\s/g, "") ===
            insertedText.replace(/\s/g, "")
        ) {
            return;
        }

        // Snapshot check (avoid double annotation)
        const previousSnapshot = snapshotMap.get(docUri) || "";
        if (previousSnapshot.includes(insertedText)) return;

        cooldown = true;

        await annotateAIBlock(document, insertedText);

        snapshotMap.set(docUri, document.getText());

        setTimeout(() => {
            cooldown = false;
        }, 1500);
    });

    context.subscriptions.push(disposable);
}

function updateStatusBar() {
    if (!statusBarItem) return;

    if (extensionEnabled) {
        statusBarItem.text = "$(eye) AI Annotator";
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = "$(circle-slash) AI Annotator OFF";
        statusBarItem.backgroundColor =
            new vscode.ThemeColor("statusBarItem.warningBackground");
    }
}

async function annotateAIBlock(
    document: vscode.TextDocument,
    insertedText: string
) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    if (insertedText.includes("AI_ASSISTED")) return;

    const employeeId = getEmployeeId();
    const style = getCommentStyle(document.languageId);

    let startBlock = "";
    let endBlock = "";

    if (style.blockStart && style.blockEnd) {

        startBlock =
`${style.blockStart}
  AI_ASSISTED: true
  AI_TOOL: GitHub Copilot
  EMPLOYEE_ID: ${employeeId}
${style.blockEnd}

`;

        endBlock =
`\n${style.blockStart} AI_ASSISTED_END ${style.blockEnd}\n`;

    } else {

        startBlock =
`${style.linePrefix} AI_ASSISTED: true
${style.linePrefix} AI_TOOL: GitHub Copilot
${style.linePrefix} EMPLOYEE_ID: ${employeeId}

`;

        endBlock =
`\n${style.linePrefix} AI_ASSISTED_END\n`;
    }

    const fullText = document.getText();
    const index = fullText.indexOf(insertedText);
    if (index === -1) return;

    const startPos = document.positionAt(index);
    const endPos = document.positionAt(index + insertedText.length);

    await editor.edit(editBuilder => {
        editBuilder.insert(startPos, startBlock);
        editBuilder.insert(endPos, endBlock);
    });

    vscode.window.showInformationMessage("AI Code Annotated");
}

function getEmployeeId(): string {

    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return "UNKNOWN";

    for (const folder of folders) {
        const envPath = path.join(folder.uri.fsPath, ".env");

        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, "utf-8");
            const match = content.match(/EMPLOYEE_ID\s*=\s*(.*)/);

            if (match && match[1]) {
                return match[1].trim();
            }
        }
    }

    return "UNKNOWN";
}

export function deactivate() {}