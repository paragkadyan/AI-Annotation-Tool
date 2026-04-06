/**
 * TIER 1 — FEATURE 2: Policy Enforcement Engine
 *
 * Evaluates all AI blocks against the rules defined in .ai-annotator.json
 * and returns violations. Also installs/updates a Git pre-commit hook
 * so that policy violations BLOCK commits automatically.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AIBlock, PolicyViolation } from '../core/types';
import { getConfig } from './configService';

// ── Policy Evaluation ─────────────────────────────────────────────────────────

export function evaluatePolicy(blocks: AIBlock[]): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    const config = getConfig();
    const policy = config.policies;

    // Rule 1: File-level AI% cap
    const fileLineMap: Record<string, { ai: number; total: number }> = {};
    blocks.forEach(b => {
        if (!fileLineMap[b.file]) fileLineMap[b.file] = { ai: 0, total: 0 };
        fileLineMap[b.file].ai += b.lines;
    });

    Object.entries(fileLineMap).forEach(([file, { ai }]) => {
        // We don't have per-file total here, so use AI-line cap directly
        if (ai > policy.maxAIPercentPerFile * 10) {
            violations.push({
                ruleId: 'MAX_AI_LINES_PER_FILE',
                ruleName: 'Max AI lines per file exceeded',
                file,
                employeeId: '',
                detail: `File "${file}" has ${ai} AI lines (policy limit: ${policy.maxAIPercentPerFile * 10})`,
                severity: 'error',
            });
        }
    });

    // Rule 2: Per-employee daily limit
    const today = new Date().toISOString().split('T')[0];
    const empDayMap: Record<string, number> = {};
    blocks.forEach(b => {
        const [d, m, y] = b.date.split('-');
        const blockDate = `${y}-${m}-${d}`;
        if (blockDate !== today) return;
        empDayMap[b.employeeId] = (empDayMap[b.employeeId] || 0) + b.lines;
    });

    Object.entries(empDayMap).forEach(([emp, lines]) => {
        if (lines > policy.maxAILinesPerDayPerEmployee) {
            violations.push({
                ruleId: 'MAX_AI_LINES_PER_DAY',
                ruleName: 'Daily AI line limit exceeded',
                file: '',
                employeeId: emp,
                detail: `${emp} added ${lines} AI lines today (limit: ${policy.maxAILinesPerDayPerEmployee})`,
                severity: 'warning',
            });
        }
    });

    // Rule 3: Unapproved blocks (when requireApproval is on)
    if (policy.requireApproval) {
        const unapproved = blocks.filter(b => !b.status || b.status === 'PENDING');
        if (unapproved.length > 0) {
            unapproved.forEach(b => {
                violations.push({
                    ruleId: 'UNAPPROVED_BLOCK',
                    ruleName: 'AI block requires approval',
                    file: b.file,
                    employeeId: b.employeeId,
                    detail: `Block in "${b.file}" by ${b.employeeId} on ${b.date} is not yet approved`,
                    severity: 'warning',
                });
            });
        }
    }

    return violations;
}

// ── Git Pre-commit Hook ───────────────────────────────────────────────────────

export function installPreCommitHook(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const gitDir = path.join(folders[0].uri.fsPath, '.git');
    if (!fs.existsSync(gitDir)) return;

    const hooksDir = path.join(gitDir, 'hooks');
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

    const hookPath = path.join(hooksDir, 'pre-commit');
    const hookContent = `#!/bin/sh
# AI Annotator — Policy Enforcement Pre-commit Hook
# Auto-generated — do not edit manually.

node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const configPath = path.join(process.cwd(), '.ai-annotator.json');
if (!fs.existsSync(configPath)) { process.exit(0); }

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const policy = config.policies || {};

if (!policy.maxAIPercentPerFile && !policy.requireApproval) { process.exit(0); }

// Scan staged files for unapproved blocks
const staged = execSync('git diff --cached --name-only').toString().trim().split('\\n').filter(Boolean);
const exts = (config.scanExtensions || ['js','ts','jsx','tsx']);
const toScan = staged.filter(f => exts.some(e => f.endsWith('.' + e)));
let violations = [];

toScan.forEach(file => {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split('\\n');
  let inside = false;
  let blockCount = 0;
  lines.forEach(l => {
    const t = l.trimStart();
    if (t.startsWith('// >>> AI_START')) { inside = true; blockCount++; return; }
    if (t.startsWith('// <<< AI_END'))   { inside = false; return; }
  });
  if (policy.requireApproval && blockCount > 0) {
    violations.push('  [POLICY] ' + file + ' has ' + blockCount + ' unapproved AI block(s)');
  }
});

if (violations.length > 0) {
  console.error('\\n\\x1b[31m[AI Annotator] COMMIT BLOCKED — Policy Violations:\\x1b[0m');
  violations.forEach(v => console.error('\\x1b[33m' + v + '\\x1b[0m'));
  console.error('\\n  Run \\'AI Annotator: Open Dashboard\\' to review and approve blocks.\\n');
  process.exit(1);
}
process.exit(0);
"
`;

    try {
        fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
    } catch {
        // Windows — write without chmod
        fs.writeFileSync(hookPath, hookContent);
    }
}

export function isHookInstalled(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return false;
    const hookPath = path.join(folders[0].uri.fsPath, '.git', 'hooks', 'pre-commit');
    if (!fs.existsSync(hookPath)) return false;
    const content = fs.readFileSync(hookPath, 'utf8');
    return content.includes('AI Annotator');
}
