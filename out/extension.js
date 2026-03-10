"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const commentStyles_1 = require("./commentStyles");
let statusBarItem;
const documentSizeMap = new Map();
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "AI Annotator (0% AI)";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    vscode.workspace.onDidChangeTextDocument(async (event) => {
        const document = event.document;
        const insertedText = event.contentChanges
            .map(c => c.text)
            .join("");
        if (!insertedText)
            return;
        const employeeId = getEmployeeId();
        const docUri = document.uri.toString();
        const currentSize = document.getText().length;
        if (!documentSizeMap.has(docUri)) {
            documentSizeMap.set(docUri, currentSize);
            return;
        }
        const previousSize = documentSizeMap.get(docUri) || 0;
        const sizeDiff = currentSize - previousSize;
        documentSizeMap.set(docUri, currentSize);
        // ignore small typing
        if (sizeDiff < 30)
            return;
        // check paste
        const clipboard = await vscode.env.clipboard.readText();
        if (clipboard.replace(/\s/g, "") ===
            insertedText.replace(/\s/g, "")) {
            return;
        }
        await annotateAIBlock(document, insertedText, employeeId);
        updateAIPercentage(document);
    });
}
async function annotateAIBlock(document, insertedText, employeeId) {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    const style = (0, commentStyles_1.getCommentStyle)(document.languageId);
    let startBlock = "";
    let endBlock = "";
    if (style.blockStart && style.blockEnd) {
        startBlock =
            `${style.blockStart}
AI_ASSISTED: true | DEVELOPERS: ${employeeId} | LAST_MODIFIED_BY: ${employeeId}
${style.blockEnd}

`;
        endBlock = `\n${style.blockStart} AI_ASSISTED_END ${style.blockEnd}\n`;
    }
    else {
        startBlock =
            `${style.linePrefix} AI_ASSISTED: true | DEVELOPERS: ${employeeId} | LAST_MODIFIED_BY: ${employeeId}

`;
        endBlock =
            `\n${style.linePrefix} AI_ASSISTED_END\n`;
    }
    const fullText = document.getText();
    const index = fullText.indexOf(insertedText);
    if (index === -1)
        return;
    const startPos = document.positionAt(index);
    const endPos = document.positionAt(index + insertedText.length);
    await editor.edit(editBuilder => {
        editBuilder.insert(startPos, startBlock);
        editBuilder.insert(endPos, endBlock);
    });
}
function updateAIPercentage(document) {
    const text = document.getText();
    const lines = text.split("\n");
    let aiLines = 0;
    let insideAI = false;
    for (const line of lines) {
        if (line.includes("AI_ASSISTED: true")) {
            insideAI = true;
            continue;
        }
        if (line.includes("AI_ASSISTED_END")) {
            insideAI = false;
            continue;
        }
        if (insideAI)
            aiLines++;
    }
    const total = lines.length;
    const percent = Math.round((aiLines / total) * 100);
    statusBarItem.text = `AI Annotator (${percent}% AI)`;
}
function getEmployeeId() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders)
        return "UNKNOWN";
    for (const folder of folders) {
        const envPath = path.join(folder.uri.fsPath, ".env");
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, "utf-8");
            const match = content.match(/EMPLOYEE_ID\s*=\s*(.*)/);
            if (match && match[1])
                return match[1].trim();
        }
    }
    return "UNKNOWN";
}
function deactivate() { }
//# sourceMappingURL=extension.js.map