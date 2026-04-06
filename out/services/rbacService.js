"use strict";
/**
 * TIER 2 — FEATURE 5: Role-Based Access Control (RBAC)
 *
 * Three roles:
 *   developer  — Can annotate their own code. Read-only dashboard.
 *   teamlead   — Can approve/reject blocks. Can view team dashboard.
 *   admin      — Full access: configure policies, export, view all teams.
 *
 * Roles are defined in .ai-annotator.json under the "roles" key:
 *   { "roles": { "EMP001": "admin", "EMP002": "teamlead" } }
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRole = getRole;
exports.isAdmin = isAdmin;
exports.isTeamLeadOrAbove = isTeamLeadOrAbove;
exports.getDashboardCapabilities = getDashboardCapabilities;
const configService_1 = require("./configService");
const employeeService_1 = require("./employeeService");
function getRole(employeeId) {
    const id = employeeId ?? (0, employeeService_1.getEmployeeId)();
    const roles = (0, configService_1.getConfig)().roles;
    return roles[id] ?? 'developer';
}
function isAdmin(employeeId) {
    return getRole(employeeId) === 'admin';
}
function isTeamLeadOrAbove(employeeId) {
    const r = getRole(employeeId);
    return r === 'teamlead' || r === 'admin';
}
function getDashboardCapabilities() {
    const role = getRole();
    switch (role) {
        case 'admin':
            return {
                canApprove: true, canReject: true, canExport: true,
                canEditSettings: true, canViewAllTeams: true,
                canInstallHook: true, canVerifyAudit: true,
                visibleTabs: ['overview', 'employees', 'files', 'trends', 'audit', 'policy', 'settings'],
                role,
            };
        case 'teamlead':
            return {
                canApprove: true, canReject: true, canExport: true,
                canEditSettings: false, canViewAllTeams: true,
                canInstallHook: false, canVerifyAudit: true,
                visibleTabs: ['overview', 'employees', 'files', 'trends', 'audit', 'policy'],
                role,
            };
        default: // developer
            return {
                canApprove: false, canReject: false, canExport: false,
                canEditSettings: false, canViewAllTeams: false,
                canInstallHook: false, canVerifyAudit: false,
                visibleTabs: ['overview', 'files', 'trends'],
                role,
            };
    }
}
//# sourceMappingURL=rbacService.js.map