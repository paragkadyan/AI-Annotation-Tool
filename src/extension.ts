import * as vscode from 'vscode';

// Core Services
import { initEmployee, resetEmployee } from './services/employeeService';
import { ensureHandshake } from './services/handshakeService';
import { initPersistence } from './services/persistenceService';
import { initConfig, ensureConfigFile } from './services/configService';
import { initApproval } from './services/approvalService';
import { installPreCommitHook, isHookInstalled } from './services/policyService';
import { verifyChain } from './services/auditLogService';

// Handlers
import { handleChange } from './handlers/textChangeHandler';

// UI
import { initStatusBar } from './ui/statusBar';
import { updateAIStats, updateWorkspaceAIStats } from './core/aiTracker';
import { openReportPanel } from './ui/reportPanel';

export async function activate(context: vscode.ExtensionContext) {

    // 1. Persistence first
    initPersistence(context);

    // 2. Central config (.ai-annotator.json) — before policy/approval
    initConfig(context);
    ensureConfigFile();

    // 3. Employee ID
    await initEmployee(context);

    // 4. Approval workflow
    initApproval(context);

    // 5. Copilot handshake file
    await ensureHandshake();

    // 6. Status bar
    initStatusBar();

    // 7. Auto-install pre-commit hook if not already present
    if (!isHookInstalled()) {
        installPreCommitHook();
    }

    // 8. Verify audit chain integrity on startup (warns if broken)
    const chainResult = verifyChain();
    if (!chainResult.valid) {
        vscode.window.showWarningMessage(
            `AI Annotator ⚠ Audit log integrity check failed at entry #${chainResult.brokenAt}. ` +
            `The log may have been tampered with. Open Dashboard → Audit tab for details.`
        );
    }

    // ── Event Listeners ───────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(handleChange)
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === vscode.window.activeTextEditor?.document) {
                updateAIStats(event.document);
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor) {
                updateAIStats(editor.document);
                updateWorkspaceAIStats();
            }
        })
    );

    // ── Commands ──────────────────────────────────────────────────────────────

    context.subscriptions.push(
        vscode.commands.registerCommand('ai.resetId', async () => {
            await resetEmployee(context);
            vscode.window.showInformationMessage('Employee ID reset successfully.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ai.showReport', async () => {
            await openReportPanel();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ai.installHook', () => {
            installPreCommitHook();
            vscode.window.showInformationMessage('AI Annotator: Pre-commit hook installed.');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('ai.verifyAudit', () => {
            const result = verifyChain();
            if (result.valid) {
                vscode.window.showInformationMessage(
                    `AI Annotator: Audit chain verified ✓ — ${result.totalEntries} entries, integrity intact.`
                );
            } else {
                vscode.window.showErrorMessage(
                    `AI Annotator: Audit chain BROKEN at entry #${result.brokenAt}. Possible tampering detected.`
                );
            }
        })
    );

    // ── Initial stats ─────────────────────────────────────────────────────────
    if (vscode.window.activeTextEditor) {
        updateAIStats(vscode.window.activeTextEditor.document);
        updateWorkspaceAIStats();
    }
}

export function deactivate() {}
