// Central domain types shared across the entire extension.

// ── Approval & Roles ──────────────────────────────────────────────────────────
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type UserRole = 'developer' | 'teamlead' | 'admin';

// ── Core Data ─────────────────────────────────────────────────────────────────
export interface AIBlock {
    employeeId: string;
    editedBy: string[];
    date: string;
    file: string;
    lines: number;
    hash?: string;
    status?: ApprovalStatus;
    reviewer?: string;
    licenseRisk?: LicenseRisk;
}

export interface Snapshot {
    timestamp: string;
    date: string;
    blocks: AIBlock[];
    totalLines: number;
    aiLines: number;
    aiPercent: number;
}

// ── Policy ────────────────────────────────────────────────────────────────────
export interface PolicyConfig {
    maxAIPercentPerFile: number;            // 0-100
    maxAILinesPerDayPerEmployee: number;
    requireApproval: boolean;
    anomalyThreshold: number;
    exemptPaths: string[];
}

export interface PolicyViolation {
    ruleId: string;
    ruleName: string;
    file: string;
    employeeId: string;
    detail: string;
    severity: 'error' | 'warning';
}

// ── Central Config ────────────────────────────────────────────────────────────
export interface AppConfig {
    version: string;
    policies: PolicyConfig;
    teams: Record<string, string>;          // employeeId → teamName
    roles: Record<string, UserRole>;        // employeeId → role
    scanExtensions: string[];
    riskThreshold: number;
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export interface AuditEntry {
    id: string;
    timestamp: string;
    action: 'BLOCK_CREATED' | 'BLOCK_EDITED' | 'BLOCK_APPROVED' |
            'BLOCK_REJECTED' | 'POLICY_VIOLATION' | 'CONFIG_CHANGED';
    employeeId: string;
    file: string;
    blockHash: string;
    prevHash: string;
    entryHash: string;
    meta?: Record<string, string>;
}

// ── License Detection ─────────────────────────────────────────────────────────
export interface LicenseRisk {
    detected: boolean;
    license?: string;
    confidence: 'high' | 'medium' | 'low';
    risk: 'copyleft' | 'permissive' | 'unknown';
    detail?: string;
}
