"use strict";
/**
 * TIER 2 — FEATURE 6: Central Config File (.ai-annotator.json)
 *
 * Single source of truth for all org-level settings checked into the repo.
 * Falls back to sensible defaults if no config file is present.
 * Watches the file for live changes — no VS Code restart required.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = void 0;
exports.initConfig = initConfig;
exports.getConfigPath = getConfigPath;
exports.getConfig = getConfig;
exports.saveConfig = saveConfig;
exports.ensureConfigFile = ensureConfigFile;
exports.getTeamConfigFromFile = getTeamConfigFromFile;
exports.getRiskThresholdFromFile = getRiskThresholdFromFile;
exports.getScanExtensionsFromFile = getScanExtensionsFromFile;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
exports.DEFAULT_CONFIG = {
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
let _config = JSON.parse(JSON.stringify(exports.DEFAULT_CONFIG));
let _watcher;
// ── Initialise ────────────────────────────────────────────────────────────────
function initConfig(context) {
    loadConfig();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder)
        return;
    _watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '.ai-annotator.json'));
    _watcher.onDidChange(() => loadConfig());
    _watcher.onDidCreate(() => loadConfig());
    _watcher.onDidDelete(() => {
        _config = JSON.parse(JSON.stringify(exports.DEFAULT_CONFIG));
    });
    context.subscriptions.push(_watcher);
}
// ── Config File Path ──────────────────────────────────────────────────────────
function getConfigPath() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
        return undefined;
    return path.join(folders[0].uri.fsPath, '.ai-annotator.json');
}
// ── Load & Save ───────────────────────────────────────────────────────────────
function loadConfig() {
    const configPath = getConfigPath();
    if (!configPath)
        return;
    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        _config = deepMerge(JSON.parse(JSON.stringify(exports.DEFAULT_CONFIG)), parsed);
    }
    catch {
        _config = JSON.parse(JSON.stringify(exports.DEFAULT_CONFIG));
    }
}
function getConfig() {
    return _config;
}
function saveConfig(config) {
    const configPath = getConfigPath();
    if (!configPath)
        return;
    _config = config;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
// ── Ensure config file exists in workspace root ───────────────────────────────
function ensureConfigFile() {
    const configPath = getConfigPath();
    if (!configPath || fs.existsSync(configPath))
        return;
    fs.writeFileSync(configPath, JSON.stringify(exports.DEFAULT_CONFIG, null, 2), 'utf8');
    vscode.window.showInformationMessage('AI Annotator: Created .ai-annotator.json — commit this file so your team shares one config.');
}
// ── Convenience getters (drop-in replacements for old persistenceService calls) ─
function getTeamConfigFromFile() {
    return _config.teams;
}
function getRiskThresholdFromFile() {
    return _config.riskThreshold;
}
function getScanExtensionsFromFile() {
    return _config.scanExtensions;
}
// ── Deep merge utility ────────────────────────────────────────────────────────
function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        const sv = source[key];
        const tv = target[key];
        if (sv !== undefined && sv !== null && typeof sv === 'object' && !Array.isArray(sv)) {
            result[key] = deepMerge(tv || {}, sv);
        }
        else if (sv !== undefined) {
            result[key] = sv;
        }
    }
    return result;
}
//# sourceMappingURL=configService.js.map