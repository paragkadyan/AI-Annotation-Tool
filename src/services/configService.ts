/**
 * TIER 2 — FEATURE 6: Central Config File (.ai-annotator.json)
 *
 * Single source of truth for all org-level settings checked into the repo.
 * Falls back to sensible defaults if no config file is present.
 * Watches the file for live changes — no VS Code restart required.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../core/types';

export const DEFAULT_CONFIG: AppConfig = {
    version: '1.0',
    policies: {
        maxAIPercentPerFile: 80,
        maxAILinesPerDayPerEmployee: 300,
        requireApproval: true,
        anomalyThreshold: 150,
        exemptPaths: [],
    },
    teams: {},
    roles: {},
    scanExtensions: ['js', 'ts', 'jsx', 'tsx'],
    riskThreshold: 60,
};

let _config: AppConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
let _watcher: vscode.FileSystemWatcher | undefined;

// ── Initialise ────────────────────────────────────────────────────────────────

export function initConfig(context: vscode.ExtensionContext): void {
    loadConfig();

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    _watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '.ai-annotator.json')
    );
    _watcher.onDidChange(() => loadConfig());
    _watcher.onDidCreate(() => loadConfig());
    _watcher.onDidDelete(() => {
        _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    });
    context.subscriptions.push(_watcher);
}

// ── Config File Path ──────────────────────────────────────────────────────────

export function getConfigPath(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return undefined;
    return path.join(folders[0].uri.fsPath, '.ai-annotator.json');
}

// ── Load & Save ───────────────────────────────────────────────────────────────

function loadConfig(): void {
    const configPath = getConfigPath();
    if (!configPath) return;

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        _config = deepMerge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed);
    } catch {
        _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
}

export function getConfig(): AppConfig {
    return _config;
}

export function saveConfig(config: AppConfig): void {
    const configPath = getConfigPath();
    if (!configPath) return;
    _config = config;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// ── Ensure config file exists in workspace root ───────────────────────────────

export function ensureConfigFile(): void {
    const configPath = getConfigPath();
    if (!configPath || fs.existsSync(configPath)) return;
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    vscode.window.showInformationMessage(
        'AI Annotator: Created .ai-annotator.json — commit this file so your team shares one config.'
    );
}

// ── Convenience getters (drop-in replacements for old persistenceService calls) ─

export function getTeamConfigFromFile(): Record<string, string> {
    return _config.teams;
}

export function getRiskThresholdFromFile(): number {
    return _config.riskThreshold;
}

export function getScanExtensionsFromFile(): string[] {
    return _config.scanExtensions;
}

// ── Deep merge utility ────────────────────────────────────────────────────────

function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result: any = { ...target };
    for (const key in source) {
        const sv = source[key];
        const tv = target[key];
        if (sv !== undefined && sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
            result[key] = deepMerge(tv || {}, sv);
        } else if (sv !== undefined) {
            result[key] = sv;
        }
    }
    return result as T;
}
