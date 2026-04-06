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

import { UserRole } from '../core/types';
import { getConfig } from './configService';
import { getEmployeeId } from './employeeService';

export function getRole(employeeId?: string): UserRole {
    const id = employeeId ?? getEmployeeId();
    const roles = getConfig().roles;
    return roles[id] ?? 'developer';
}

export function isAdmin(employeeId?: string): boolean {
    return getRole(employeeId) === 'admin';
}

export function isTeamLeadOrAbove(employeeId?: string): boolean {
    const r = getRole(employeeId);
    return r === 'teamlead' || r === 'admin';
}

// Dashboard capability matrix
export interface DashboardCapabilities {
    canApprove: boolean;
    canReject: boolean;
    canExport: boolean;
    canEditSettings: boolean;
    canViewAllTeams: boolean;
    canInstallHook: boolean;
    canVerifyAudit: boolean;
    visibleTabs: string[];
    role: UserRole;
}

export function getDashboardCapabilities(): DashboardCapabilities {
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
