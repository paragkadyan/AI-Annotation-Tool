/**
 * TIER 1 — FEATURE 3: AI Block Review & Approval Workflow
 *
 * Stores approval state for each AI block keyed by (file + hash + date).
 * Team Leads and Admins can approve/reject blocks from the dashboard.
 * Unapproved blocks trigger policy warnings (and can block commits via the hook).
 */

import * as vscode from 'vscode';
import { ApprovalStatus } from '../core/types';
import { getConfig } from './configService';
import { writeAuditEntry } from './auditLogService';
import { getEmployeeId } from './employeeService';

type ApprovalRecord = Record<string, { status: ApprovalStatus; reviewer: string; timestamp: string }>;

let _context: vscode.ExtensionContext;

export function initApproval(context: vscode.ExtensionContext): void {
    _context = context;
}

function makeKey(file: string, hash: string, date: string): string {
    return `${file}::${hash}::${date}`;
}

export function getApprovalStatus(file: string, hash: string, date: string): ApprovalStatus {
    const records = _context.globalState.get<ApprovalRecord>('ai_approvals') || {};
    return records[makeKey(file, hash, date)]?.status ?? 'PENDING';
}

export function approveBlock(
    file: string,
    hash: string,
    date: string,
    employeeId: string
): void {
    if (!canApprove(employeeId)) {
        vscode.window.showErrorMessage(
            `AI Annotator: "${employeeId}" does not have Team Lead or Admin role to approve blocks.`
        );
        return;
    }

    const records = _context.globalState.get<ApprovalRecord>('ai_approvals') || {};
    const key = makeKey(file, hash, date);
    records[key] = { status: 'APPROVED', reviewer: employeeId, timestamp: new Date().toISOString() };
    _context.globalState.update('ai_approvals', records);

    writeAuditEntry('BLOCK_APPROVED', employeeId, file, hash, {
        reviewer: employeeId,
        date,
    });
}

export function rejectBlock(
    file: string,
    hash: string,
    date: string,
    employeeId: string
): void {
    if (!canApprove(employeeId)) {
        vscode.window.showErrorMessage(
            `AI Annotator: "${employeeId}" does not have Team Lead or Admin role to reject blocks.`
        );
        return;
    }

    const records = _context.globalState.get<ApprovalRecord>('ai_approvals') || {};
    const key = makeKey(file, hash, date);
    records[key] = { status: 'REJECTED', reviewer: employeeId, timestamp: new Date().toISOString() };
    _context.globalState.update('ai_approvals', records);

    writeAuditEntry('BLOCK_REJECTED', employeeId, file, hash, {
        reviewer: employeeId,
        date,
    });
}

export function getAllApprovals(): ApprovalRecord {
    return _context.globalState.get<ApprovalRecord>('ai_approvals') || {};
}

// ── Role check ────────────────────────────────────────────────────────────────

function canApprove(employeeId: string): boolean {
    const roles = getConfig().roles;
    const role = roles[employeeId];
    return role === 'teamlead' || role === 'admin';
}

export function getCurrentUserRole(): string {
    const roles = getConfig().roles;
    return roles[getEmployeeId()] ?? 'developer';
}
