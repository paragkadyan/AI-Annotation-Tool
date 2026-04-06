"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.annotate = annotate;
const vscode = require("vscode");
const employeeService_1 = require("../services/employeeService");
const metadataManager_1 = require("./metadataManager");
const blockParser_1 = require("./blockParser");
const hashManager_1 = require("./hashManager");
const auditLogService_1 = require("../services/auditLogService");
const licenseService_1 = require("../services/licenseService");
const configService_1 = require("../services/configService");
// Per-document processing lock — prevents concurrent annotation loss
const processingMap = new Map();
async function annotate(doc, range, text) {
    const key = doc.uri.toString();
    if (processingMap.get(key))
        return;
    processingMap.set(key, true);
    try {
        const line = range.start.line;
        const { emp, date } = (0, metadataManager_1.generateMeta)((0, employeeService_1.getEmployeeId)());
        const edit = new vscode.WorkspaceEdit();
        const hash = (0, hashManager_1.generateHash)(text);
        // CASE 1: Inside an existing block — update EditedBy only
        if ((0, blockParser_1.isInsideBlock)(doc, line)) {
            for (let i = line; i >= 0; i--) {
                const t = doc.lineAt(i).text;
                if (t.trimStart().startsWith('// >>> AI_START')) {
                    const updated = (0, metadataManager_1.updateEditedBy)(t, emp, date);
                    edit.replace(doc.uri, doc.lineAt(i).range, updated);
                    break;
                }
                if (t.trimStart().startsWith('// <<< AI_END'))
                    break;
            }
            await vscode.workspace.applyEdit(edit);
            (0, auditLogService_1.writeAuditEntry)('BLOCK_EDITED', emp, doc.fileName, hash);
            return;
        }
        // CASE 2: New block
        // License risk check
        const licenseRisk = (0, licenseService_1.detectLicenseRisk)(text);
        let licenseFlag = '';
        if (licenseRisk.detected) {
            licenseFlag = ` | LICENSE_RISK: ${licenseRisk.license}(${licenseRisk.risk})`;
            vscode.window.showWarningMessage(`AI Annotator ⚠ License Risk: ${licenseRisk.detail}`, 'Dismiss');
        }
        // Policy: check if require_approval is on
        const requireApproval = (0, configService_1.getConfig)().policies.requireApproval;
        const statusFlag = requireApproval ? ' | STATUS: PENDING' : ' | STATUS: APPROVED';
        const header = `// >>> AI_START | ID: ${emp} | ${date} | HASH: ${hash}${statusFlag}${licenseFlag}\n`;
        const footer = `\n// <<< AI_END\n`;
        const lineCount = text.trimEnd() === '' ? 1 : text.trimEnd().split('\n').length;
        edit.insert(doc.uri, new vscode.Position(line, 0), header);
        edit.insert(doc.uri, new vscode.Position(line + lineCount, 0), footer);
        await vscode.workspace.applyEdit(edit);
        // Audit log
        (0, auditLogService_1.writeAuditEntry)('BLOCK_CREATED', emp, doc.fileName, hash, {
            lines: String(lineCount),
            date,
            ...(licenseRisk.detected ? { licenseRisk: licenseRisk.license || 'UNKNOWN' } : {}),
        });
        // Notify about pending approval
        if (requireApproval) {
            vscode.window.showInformationMessage(`AI Annotator: Block created — awaiting Team Lead approval.`);
        }
    }
    catch (e) {
        console.error('[AI Annotator] annotate error:', e);
    }
    finally {
        setTimeout(() => processingMap.delete(key), 500);
    }
}
//# sourceMappingURL=annotationEngine.js.map