"use strict";
/**
 * TIER 1 — FEATURE 3: AI Block Review & Approval Workflow
 *
 * Stores approval state for each AI block keyed by (file + hash + date).
 * Team Leads and Admins can approve/reject blocks from the dashboard.
 * Unapproved blocks trigger policy warnings (and can block commits via the hook).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initApproval = initApproval;
exports.getApprovalStatus = getApprovalStatus;
exports.approveBlock = approveBlock;
exports.rejectBlock = rejectBlock;
exports.getAllApprovals = getAllApprovals;
exports.getCurrentUserRole = getCurrentUserRole;
const vscode = require("vscode");
const configService_1 = require("./configService");
const auditLogService_1 = require("./auditLogService");
const employeeService_1 = require("./employeeService");
let _context;
function initApproval(context) {
    _context = context;
}
function makeKey(file, hash, date) {
    return `${file}::${hash}::${date}`;
}
function getApprovalStatus(file, hash, date) {
    const records = _context.globalState.get('ai_approvals') || {};
    return records[makeKey(file, hash, date)]?.status ?? 'PENDING';
}
function approveBlock(file, hash, date, employeeId) {
    if (!canApprove(employeeId)) {
        vscode.window.showErrorMessage(`AI Annotator: "${employeeId}" does not have Team Lead or Admin role to approve blocks.`);
        return;
    }
    const records = _context.globalState.get('ai_approvals') || {};
    const key = makeKey(file, hash, date);
    records[key] = { status: 'APPROVED', reviewer: employeeId, timestamp: new Date().toISOString() };
    _context.globalState.update('ai_approvals', records);
    (0, auditLogService_1.writeAuditEntry)('BLOCK_APPROVED', employeeId, file, hash, {
        reviewer: employeeId,
        date,
    });
}
function rejectBlock(file, hash, date, employeeId) {
    if (!canApprove(employeeId)) {
        vscode.window.showErrorMessage(`AI Annotator: "${employeeId}" does not have Team Lead or Admin role to reject blocks.`);
        return;
    }
    const records = _context.globalState.get('ai_approvals') || {};
    const key = makeKey(file, hash, date);
    records[key] = { status: 'REJECTED', reviewer: employeeId, timestamp: new Date().toISOString() };
    _context.globalState.update('ai_approvals', records);
    (0, auditLogService_1.writeAuditEntry)('BLOCK_REJECTED', employeeId, file, hash, {
        reviewer: employeeId,
        date,
    });
}
function getAllApprovals() {
    return _context.globalState.get('ai_approvals') || {};
}
// ── Role check ────────────────────────────────────────────────────────────────
function canApprove(employeeId) {
    const roles = (0, configService_1.getConfig)().roles;
    const role = roles[employeeId];
    return role === 'teamlead' || role === 'admin';
}
function getCurrentUserRole() {
    const roles = (0, configService_1.getConfig)().roles;
    return roles[(0, employeeService_1.getEmployeeId)()] ?? 'developer';
}
//# sourceMappingURL=approvalService.js.map