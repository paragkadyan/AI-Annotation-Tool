import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

let debounceTimer: NodeJS.Timeout | null = null;
let aiInsertStartLine: number | null = null;
let aiInsertDocument: vscode.TextDocument | null = null;

let extensionEnabled = true;
let isAnnotating = false;

let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {

    statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );

    statusBar.text = "AI Annotator (0% AI)";
    statusBar.show();

    context.subscriptions.push(statusBar);

    const toggleCommand = vscode.commands.registerCommand(
        "aiAnnotator.toggle",
        () => {

            extensionEnabled = !extensionEnabled;

            vscode.window.showInformationMessage(
                extensionEnabled
                    ? "AI Annotator Enabled"
                    : "AI Annotator Disabled"
            );
        }
    );

    context.subscriptions.push(toggleCommand);

    vscode.workspace.onDidChangeTextDocument(async (event) => {

        if (!extensionEnabled) return;
        if (isAnnotating) return;

        const change = event.contentChanges[0];
        if (!change) return;

        const inserted = change.text;
        if (!inserted) return;

        // ignore whitespace
        if (inserted.trim() === "") return;

        // ignore annotation lines
        if (
            inserted.includes("AI_ASSISTED") ||
            inserted.includes("AI_ASSISTED_END")
        ) return;

        const clipboard = await vscode.env.clipboard.readText();

        // ignore copy paste
        if (
            clipboard &&
            clipboard.replace(/\s/g, "") === inserted.replace(/\s/g, "")
        ) {
            return;
        }

        const lines = inserted.split("\n");

        // ignore manual typing
        if (lines.length < 2 && inserted.length < 25) return;

        aiInsertStartLine = change.range.start.line;
        aiInsertDocument = event.document;

        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(async () => {

            if (!aiInsertDocument || aiInsertStartLine === null) return;

            const empId = getEmployeeId();

            await annotateBlock(aiInsertDocument, aiInsertStartLine, empId);

            updatePercentage(aiInsertDocument);

            aiInsertDocument = null;
            aiInsertStartLine = null;

        }, 1200);

    });

}

async function annotateBlock(
    document: vscode.TextDocument,
    startLine: number,
    empId: string
) {

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    isAnnotating = true;

    const startTag =
`// AI_ASSISTED: true | DEVELOPERS: ${empId}\n`;

    const endTag =
`\n// AI_ASSISTED_END\n`;

    await editor.edit(edit => {

        edit.insert(new vscode.Position(startLine, 0), startTag);

        const endLine = startLine + 12;

        edit.insert(new vscode.Position(endLine, 0), endTag);

    });

    isAnnotating = false;

}

function updatePercentage(document: vscode.TextDocument) {

    const lines = document.getText().split("\n");

    let total = 0;
    let ai = 0;
    let inside = false;

    for (const line of lines) {

        const t = line.trim();

        if (t.includes("AI_ASSISTED")) {
            inside = true;
            continue;
        }

        if (t.includes("AI_ASSISTED_END")) {
            inside = false;
            continue;
        }

        if (t === "") continue;

        if (
            t.startsWith("//") ||
            t.startsWith("#") ||
            t.startsWith("/*") ||
            t.startsWith("*")
        ) continue;

        total++;

        if (inside) ai++;

    }

    const percent =
        total === 0 ? 0 : Math.round((ai / total) * 100);

    statusBar.text = `AI Annotator (${percent}% AI)`;

}

function getEmployeeId(): string {

    const folders = vscode.workspace.workspaceFolders;

    if (!folders) return "UNKNOWN";

    for (const folder of folders) {

        const envPath = path.join(folder.uri.fsPath, ".env");

        if (fs.existsSync(envPath)) {

            const content = fs.readFileSync(envPath, "utf8");

            const match =
                content.match(/EMPLOYEE_ID\s*=\s*(.*)/);

            if (match) return match[1].trim();

        }

    }

    return "UNKNOWN";

}

export function deactivate() {}