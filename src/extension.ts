import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Auto-Annotator is now active!');
	vscode.window.showInformationMessage("Annotator is Watching...");

    // This function adds the header/footer
    const applyAnnotation = async (document: vscode.TextDocument) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document !== document) return;

        // Configuration: Use $env:USERNAME for Employee ID
        const empId = process.env.USERNAME || "Unknown_User";
        const date = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
        const lang = document.languageId;

        // Adaptive Comment Style
        let s = "#", e = "";
        if (['javascript', 'typescript', 'java'].includes(lang)) { s = "//"; }
        else if (lang === 'html' || lang === 'xml') { s = ""; }

        const header = `${s} GENERATED_CODE on ${date}${e}\n` +
                       `${s} TOOL_VERSION : GitHub Copilot 1.50${e}\n` +
                       `${s} EMPLOYEEID : ${empId}${e}\n` +
                       `${s} ACTION : GENERATED${e}\n`;
        const footer = `\n${s} END: AI_Generated_Code on ${date}${e}`;

        await editor.edit(editBuilder => {
            // Check if header is already there to avoid double-adding
            const firstLine = document.lineAt(0).text;
            if (!firstLine.includes("GENERATED_CODE")) {
                editBuilder.insert(new vscode.Position(0, 0), header);
                editBuilder.insert(new vscode.Position(document.lineCount, 0), footer);
            }
        });
    };

    // The Observer: Fires when Copilot generates a block of code (usually > 40 chars)
    const watcher = vscode.workspace.onDidChangeTextDocument(event => {
        const changes = event.contentChanges;
        if (changes.length > 0 && changes[0].text.length > 10) {
            // Debounce for 1 second to wait for Copilot to finish the insertion
            setTimeout(() => applyAnnotation(event.document), 1000);
        }
    });

    context.subscriptions.push(watcher);
}

export function deactivate() {}