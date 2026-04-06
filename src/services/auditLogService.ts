/**
 * TIER 1 — FEATURE 1: Immutable Audit Log
 *
 * Every annotation event is written to an append-only NDJSON file
 * (.ai-annotator-audit.log) where each entry contains:
 *  - A SHA-256 hash of its own content
 *  - A prevHash pointing to the previous entry
 *
 * This creates a cryptographic chain: if any entry is tampered with,
 * the chain of hashes breaks — detectable by verifyChain().
 * Critical for SOC2 / ISO 27001 compliance audits.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AuditEntry } from '../core/types';

const AUDIT_FILENAME = '.ai-annotator-audit.log';

function getAuditPath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return undefined;
    return path.join(folders[0].uri.fsPath, AUDIT_FILENAME);
}

function hashEntry(entry: Omit<AuditEntry, 'entryHash'>): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(entry))
        .digest('hex');
}

function getLastEntryHash(auditPath: string): string {
    if (!fs.existsSync(auditPath)) return 'GENESIS';
    try {
        const lines = fs.readFileSync(auditPath, 'utf8')
            .split('\n')
            .filter(l => l.trim().length > 0);
        if (!lines.length) return 'GENESIS';
        const last = JSON.parse(lines[lines.length - 1]) as AuditEntry;
        return last.entryHash;
    } catch {
        return 'GENESIS';
    }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function writeAuditEntry(
    action: AuditEntry['action'],
    employeeId: string,
    file: string,
    blockHash: string,
    meta?: Record<string, string>
): void {
    const auditPath = getAuditPath();
    if (!auditPath) return;

    const prevHash = getLastEntryHash(auditPath);

    const partial: Omit<AuditEntry, 'entryHash'> = {
        id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
        timestamp: new Date().toISOString(),
        action,
        employeeId,
        file,
        blockHash,
        prevHash,
        ...(meta ? { meta } : {}),
    };

    const entry: AuditEntry = {
        ...partial,
        entryHash: hashEntry(partial),
    };

    try {
        fs.appendFileSync(auditPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) {
        console.error('[AI Annotator] Failed to write audit log:', e);
    }
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function readAuditLog(): AuditEntry[] {
    const auditPath = getAuditPath();
    if (!auditPath || !fs.existsSync(auditPath)) return [];
    try {
        return fs.readFileSync(auditPath, 'utf8')
            .split('\n')
            .filter(l => l.trim().length > 0)
            .map(l => JSON.parse(l) as AuditEntry);
    } catch {
        return [];
    }
}

// ── Verify chain integrity ────────────────────────────────────────────────────

export interface ChainVerifyResult {
    valid: boolean;
    totalEntries: number;
    brokenAt?: number;
    brokenEntryId?: string;
}

export function verifyChain(): ChainVerifyResult {
    const entries = readAuditLog();
    if (!entries.length) return { valid: true, totalEntries: 0 };

    let expectedPrev = 'GENESIS';

    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];

        if (e.prevHash !== expectedPrev) {
            return { valid: false, totalEntries: entries.length, brokenAt: i, brokenEntryId: e.id };
        }

        const { entryHash, ...partial } = e;
        const recomputed = hashEntry(partial as Omit<AuditEntry, 'entryHash'>);
        if (recomputed !== entryHash) {
            return { valid: false, totalEntries: entries.length, brokenAt: i, brokenEntryId: e.id };
        }

        expectedPrev = e.entryHash;
    }

    return { valid: true, totalEntries: entries.length };
}
