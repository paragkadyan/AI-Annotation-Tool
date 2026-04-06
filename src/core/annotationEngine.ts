import * as vscode from 'vscode';
import { getEmployeeId } from '../services/employeeService';
import { generateMeta, updateEditedBy } from './metadataManager';
import { isInsideBlock } from './blockParser';
import { generateHash } from './hashManager';
import { writeAuditEntry } from '../services/auditLogService';
import { detectLicenseRisk } from '../services/licenseService';
import { getConfig } from '../services/configService';

// Per-document processing lock — prevents concurrent annotation loss
const processingMap = new Map<string, boolean>();

export async function annotate(doc: vscode.TextDocument, range: vscode.Range, text: string) {
    const key = doc.uri.toString();
    if (processingMap.get(key)) return;
    processingMap.set(key, true);

    try {
        const line = range.start.line;
        const { emp, date } = generateMeta(getEmployeeId());
        const edit = new vscode.WorkspaceEdit();
        const hash = generateHash(text);

        // CASE 1: Inside an existing block — update EditedBy only
        if (isInsideBlock(doc, line)) {
            for (let i = line; i >= 0; i--) {
                const t = doc.lineAt(i).text;
                if (t.trimStart().startsWith('// >>> AI_START')) {
                    const updated = updateEditedBy(t, emp, date);
                    edit.replace(doc.uri, doc.lineAt(i).range, updated);
                    break;
                }
                if (t.trimStart().startsWith('// <<< AI_END')) break;
            }
            await vscode.workspace.applyEdit(edit);

            writeAuditEntry('BLOCK_EDITED', emp, doc.fileName, hash);
            return;
        }

        // CASE 2: New block

        // License risk check
        const licenseRisk = detectLicenseRisk(text);
        let licenseFlag = '';
        if (licenseRisk.detected) {
            licenseFlag = ` | LICENSE_RISK: ${licenseRisk.license}(${licenseRisk.risk})`;
            vscode.window.showWarningMessage(
                `AI Annotator ⚠ License Risk: ${licenseRisk.detail}`,
                'Dismiss'
            );
        }

        // Policy: check if require_approval is on
        const requireApproval = getConfig().policies.requireApproval;
        const statusFlag = requireApproval ? ' | STATUS: PENDING' : ' | STATUS: APPROVED';

        const header = `// >>> AI_START | ID: ${emp} | ${date} | HASH: ${hash}${statusFlag}${licenseFlag}\n`;
        const footer = `\n// <<< AI_END\n`;

        const lineCount = text.trimEnd() === '' ? 1 : text.trimEnd().split('\n').length;

        edit.insert(doc.uri, new vscode.Position(line, 0), header);
        edit.insert(doc.uri, new vscode.Position(line + lineCount, 0), footer);

        await vscode.workspace.applyEdit(edit);

        // Audit log
        writeAuditEntry('BLOCK_CREATED', emp, doc.fileName, hash, {
            lines: String(lineCount),
            date,
            ...(licenseRisk.detected ? { licenseRisk: licenseRisk.license || 'UNKNOWN' } : {}),
        });

        // Notify about pending approval
        if (requireApproval) {
            vscode.window.showInformationMessage(
                `AI Annotator: Block created — awaiting Team Lead approval.`
            );
        }

    } catch (e) {
        console.error('[AI Annotator] annotate error:', e);
    } finally {
        setTimeout(() => processingMap.delete(key), 500);
    }
}
