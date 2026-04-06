"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
// Core Services
const employeeService_1 = require("./services/employeeService");
const handshakeService_1 = require("./services/handshakeService");
const persistenceService_1 = require("./services/persistenceService");
const configService_1 = require("./services/configService");
const approvalService_1 = require("./services/approvalService");
const policyService_1 = require("./services/policyService");
const auditLogService_1 = require("./services/auditLogService");
// Handlers
const textChangeHandler_1 = require("./handlers/textChangeHandler");
// UI
const statusBar_1 = require("./ui/statusBar");
const aiTracker_1 = require("./core/aiTracker");
const reportPanel_1 = require("./ui/reportPanel");
async function activate(context) {
    // 1. Persistence first
    (0, persistenceService_1.initPersistence)(context);
    // 2. Central config (.ai-annotator.json) — before policy/approval
    (0, configService_1.initConfig)(context);
    (0, configService_1.ensureConfigFile)();
    // 3. Employee ID
    await (0, employeeService_1.initEmployee)(context);
    // 4. Approval workflow
    (0, approvalService_1.initApproval)(context);
    // 5. Copilot handshake file
    await (0, handshakeService_1.ensureHandshake)();
    // 6. Status bar
    (0, statusBar_1.initStatusBar)();
    // 7. Auto-install pre-commit hook if not already present
    if (!(0, policyService_1.isHookInstalled)()) {
        (0, policyService_1.installPreCommitHook)();
    }
    // 8. Verify audit chain integrity on startup (warns if broken)
    const chainResult = (0, auditLogService_1.verifyChain)();
    if (!chainResult.valid) {
        vscode.window.showWarningMessage(`AI Annotator ⚠ Audit log integrity check failed at entry #${chainResult.brokenAt}. ` +
            `The log may have been tampered with. Open Dashboard → Audit tab for details.`);
    }
    // ── Event Listeners ───────────────────────────────────────────────────────
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(textChangeHandler_1.handleChange));
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document === vscode.window.activeTextEditor?.document) {
            (0, aiTracker_1.updateAIStats)(event.document);
        }
    }));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            (0, aiTracker_1.updateAIStats)(editor.document);
            (0, aiTracker_1.updateWorkspaceAIStats)();
        }
    }));
    // ── Commands ──────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('ai.resetId', async () => {
        await (0, employeeService_1.resetEmployee)(context);
        vscode.window.showInformationMessage('Employee ID reset successfully.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai.showReport', async () => {
        await (0, reportPanel_1.openReportPanel)();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai.installHook', () => {
        (0, policyService_1.installPreCommitHook)();
        vscode.window.showInformationMessage('AI Annotator: Pre-commit hook installed.');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('ai.verifyAudit', () => {
        const result = (0, auditLogService_1.verifyChain)();
        if (result.valid) {
            vscode.window.showInformationMessage(`AI Annotator: Audit chain verified ✓ — ${result.totalEntries} entries, integrity intact.`);
        }
        else {
            vscode.window.showErrorMessage(`AI Annotator: Audit chain BROKEN at entry #${result.brokenAt}. Possible tampering detected.`);
        }
    }));
    // ── Initial stats ─────────────────────────────────────────────────────────
    if (vscode.window.activeTextEditor) {
        (0, aiTracker_1.updateAIStats)(vscode.window.activeTextEditor.document);
        (0, aiTracker_1.updateWorkspaceAIStats)();
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map