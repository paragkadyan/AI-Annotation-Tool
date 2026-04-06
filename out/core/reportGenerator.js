"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAIBlocks = extractAIBlocks;
exports.extractWorkspaceBlocks = extractWorkspaceBlocks;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const persistenceService_1 = require("../services/persistenceService");
// ── Parser ─────────────────────────────────────────────────────────────────────
// All marker checks use anchored startsWith() — never loose includes().
// Orphaned AI_START/AI_END handled gracefully (Flaw 10 fix).
function extractBlocksFromText(content, filePath) {
    const blocks = [];
    const lines = content.split('\n');
    let inside = false;
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trimStart();
        if (trimmed.startsWith('// >>> AI_START')) {
            inside = true;
            const emp = raw.match(/ID:\s*([A-Za-z0-9_-]+)/)?.[1] || 'UNKNOWN';
            const date = raw.match(/\|\s*(\d{2}-\d{2}-\d{4})/)?.[1] || '';
            const edited = raw.match(/EditedBy:\s*(.*?)(?:\s*\|[^|]*$|$)/)?.[1];
            const hash = raw.match(/HASH:\s*([a-f0-9]{6,})/)?.[1];
            const status = (raw.match(/STATUS:\s*(\w+)/)?.[1] || 'PENDING');
            const reviewer = raw.match(/REVIEWER:\s*([A-Za-z0-9_-]+)/)?.[1];
            const licRaw = raw.match(/LICENSE_RISK:\s*([\w.\-()]+)/)?.[1];
            current = {
                employeeId: emp,
                editedBy: edited
                    ? edited.split(',').map(s => s.trim()).filter(Boolean)
                    : [],
                date,
                file: path.basename(filePath),
                lines: 0,
                hash,
                status,
                reviewer,
                licenseRisk: licRaw
                    ? { detected: true, license: licRaw, confidence: 'high', risk: 'unknown' }
                    : undefined,
            };
            continue;
        }
        if (trimmed.startsWith('// <<< AI_END')) {
            if (inside && current) {
                blocks.push(current);
            }
            else if (!inside) {
                console.warn(`[AI Annotator] Orphaned AI_END in ${filePath} at line ${i}`);
            }
            inside = false;
            current = null;
            continue;
        }
        if (inside && current && raw.trim().length > 0) {
            current.lines++;
        }
    }
    // Unclosed block — discard
    if (inside && current) {
        console.warn(`[AI Annotator] Unclosed AI_START block in ${filePath}`);
    }
    return blocks;
}
// ── Public API ────────────────────────────────────────────────────────────────
function extractAIBlocks(doc) {
    return extractBlocksFromText(doc.getText(), doc.fileName);
}
async function extractWorkspaceBlocks() {
    const exts = (0, persistenceService_1.getScanExtensions)().join(',');
    const files = await vscode.workspace.findFiles(`**/*.{${exts}}`, '**/node_modules/**');
    const results = await Promise.all(files.map(async (file) => {
        try {
            const content = await fs.promises.readFile(file.fsPath, 'utf8');
            return extractBlocksFromText(content, file.fsPath);
        }
        catch {
            return [];
        }
    }));
    return results.flat();
}
//# sourceMappingURL=reportGenerator.js.map