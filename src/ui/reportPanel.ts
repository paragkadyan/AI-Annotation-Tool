import * as vscode from 'vscode';
import { extractWorkspaceBlocks, AIBlock } from '../core/reportGenerator';
import { updateWorkspaceAIStats } from '../core/aiTracker';
import {
    saveSnapshot, getSnapshots,
    getRiskThreshold, saveRiskThreshold,
    getScanExtensions, saveScanExtensions,
    getTeamConfig, saveTeamConfig,
} from '../services/persistenceService';
import { getConfig, saveConfig } from '../services/configService';
import { approveBlock, rejectBlock, getAllApprovals } from '../services/approvalService';
import { evaluatePolicy } from '../services/policyService';
import { readAuditLog, verifyChain } from '../services/auditLogService';
import { getDashboardCapabilities } from '../services/rbacService';
import { getEmployeeId } from '../services/employeeService';

let panel: vscode.WebviewPanel | undefined;

export async function openReportPanel() {
    if (panel) {
        panel.reveal(vscode.ViewColumn.One);
        await refreshPanel();
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'aiDashboard',
        'AI Annotator — Enterprise Dashboard',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.onDidDispose(() => { panel = undefined; });

    panel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.command) {
            case 'refresh':
                await refreshPanel();
                break;

            case 'saveSettings': {
                const cfg = getConfig();
                if (msg.threshold !== undefined)  { saveRiskThreshold(Number(msg.threshold)); cfg.riskThreshold = Number(msg.threshold); }
                if (msg.teamConfig !== undefined)  { saveTeamConfig(msg.teamConfig); cfg.teams = msg.teamConfig; }
                if (msg.extensions !== undefined)  { saveScanExtensions(msg.extensions); cfg.scanExtensions = msg.extensions; }
                if (msg.policies !== undefined)    { cfg.policies = { ...cfg.policies, ...msg.policies }; }
                if (msg.roles !== undefined)       { cfg.roles = msg.roles; }
                saveConfig(cfg);
                vscode.window.showInformationMessage('AI Annotator: Settings saved & written to .ai-annotator.json');
                await refreshPanel();
                break;
            }

            case 'exportCSV':
                await exportCSV(msg.blocks);
                break;

            case 'approveBlock':
                approveBlock(msg.file, msg.hash, msg.date, getEmployeeId());
                await refreshPanel();
                break;

            case 'rejectBlock':
                rejectBlock(msg.file, msg.hash, msg.date, getEmployeeId());
                await refreshPanel();
                break;
        }
    });

    await refreshPanel();
}

// ── Refresh ───────────────────────────────────────────────────────────────────

async function refreshPanel() {
    if (!panel) return;
    panel.webview.postMessage({ command: 'loading' });

    const blocks           = await extractWorkspaceBlocks();
    const { totalAI, totalAll } = await updateWorkspaceAIStats();
    saveSnapshot(blocks, totalAll, totalAI);

    const snapshots    = getSnapshots();
    const teamConfig   = getTeamConfig();
    const threshold    = getRiskThreshold();
    const extensions   = getScanExtensions();
    const config       = getConfig();
    const violations   = evaluatePolicy(blocks);
    const auditEntries = readAuditLog().slice(-100);
    const chainResult  = verifyChain();
    const approvals    = getAllApprovals();
    const caps         = getDashboardCapabilities();

    panel.webview.html = generateHTML(
        blocks, snapshots, teamConfig, threshold, extensions,
        totalAI, totalAll, violations, auditEntries, chainResult,
        approvals, caps, config
    );
}

// ── CSV Export ────────────────────────────────────────────────────────────────

async function exportCSV(blocks: any[]) {
    const header = 'Employee,Date,File,Lines,Status,Reviewer,EditedBy,Hash,LicenseRisk\n';
    const rows = blocks.map((b: AIBlock) =>
        `${b.employeeId},${b.date},"${b.file}",${b.lines},${b.status || 'PENDING'},${b.reviewer || ''},"${b.editedBy.join(' | ')}",${b.hash || ''},${b.licenseRisk?.license || ''}`
    ).join('\n');
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('ai-report.csv'),
        filters: { 'CSV': ['csv'] },
    });
    if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(header + rows));
        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
    }
}

// ── HTML Generation ───────────────────────────────────────────────────────────

function generateHTML(
    blocks: AIBlock[],
    snapshots: any[],
    teamConfig: Record<string, string>,
    threshold: number,
    extensions: string[],
    totalAI: number,
    totalAll: number,
    violations: any[],
    auditEntries: any[],
    chainResult: any,
    _approvals: Record<string, any>,
    caps: any,
    config: any
): string {

    // ── Aggregations ──────────────────────────────────────────────────────────
    const totalBlocks = blocks.length;
    const wsPercent   = totalAll > 0 ? ((totalAI / totalAll) * 100).toFixed(1) : '0.0';

    const empMap: Record<string, number> = {};
    const fileMap: Record<string, number> = {};
    const empSet = new Set<string>();

    blocks.forEach(b => {
        empMap[b.employeeId] = (empMap[b.employeeId] || 0) + b.lines;
        fileMap[b.file]      = (fileMap[b.file]      || 0) + b.lines;
        empSet.add(b.employeeId);
    });

    const uniqueFiles        = Object.keys(fileMap).length;
    const uniqueContributors = empSet.size;

    const today = new Date().toISOString().split('T')[0];
    const todayEmpMap: Record<string, number> = {};
    blocks.filter(b => {
        const [d, m, y] = b.date.split('-');
        return `${y}-${m}-${d}` === today;
    }).forEach(b => { todayEmpMap[b.employeeId] = (todayEmpMap[b.employeeId] || 0) + b.lines; });

    const anomalies = Object.entries(todayEmpMap)
        .filter(([, lines]) => lines > (config.policies?.anomalyThreshold || 150))
        .map(([id, lines]) => ({ id, lines }));

    // Trend data
    const trendLabels: string[] = [];
    const trendData: number[]   = [];
    snapshots.slice(-14).forEach(s => { trendLabels.push(s.date); trendData.push(s.aiLines); });

    // Team rollup
    const teamMap: Record<string, number> = {};
    Object.entries(empMap).forEach(([emp, lines]) => {
        const team = teamConfig[emp] || 'Unassigned';
        teamMap[team] = (teamMap[team] || 0) + lines;
    });

    // Pending approvals count
    const pendingBlocks = blocks.filter(b => !b.status || b.status === 'PENDING');
    const licenseRiskBlocks = blocks.filter(b => b.licenseRisk?.detected);
    const errorViolations   = violations.filter(v => v.severity === 'error');

    // Tab visibility
    const visibleTabs = caps.visibleTabs as string[];

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none';
               script-src 'unsafe-inline' https://cdn.jsdelivr.net;
               style-src  'unsafe-inline';
               img-src    data: 'self';">
<title>AI Annotator Enterprise Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0f172a;--surface:#1e293b;--surface2:#263348;--surface3:#1a2540;
  --accent:#38bdf8;--accent2:#818cf8;--accent3:#34d399;
  --danger:#f87171;--warn:#fbbf24;--text:#e2e8f0;--muted:#94a3b8;
  --radius:12px;--shadow:0 4px 24px rgba(0,0,0,.4);
}
body{font-family:'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}

/* NAV */
nav{display:flex;align-items:center;justify-content:space-between;
    padding:12px 28px;background:var(--surface);
    border-bottom:2px solid #334155;position:sticky;top:0;z-index:100}
.nav-logo{display:flex;align-items:center;gap:10px;font-size:1.1rem;font-weight:700;color:var(--accent)}
.nav-logo svg{width:26px;height:26px}
.nav-meta{display:flex;align-items:center;gap:12px}
.role-badge{padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.role-admin{background:rgba(248,113,113,.2);color:var(--danger);border:1px solid rgba(248,113,113,.4)}
.role-teamlead{background:rgba(251,191,36,.2);color:var(--warn);border:1px solid rgba(251,191,36,.4)}
.role-developer{background:rgba(52,211,153,.2);color:var(--accent3);border:1px solid rgba(52,211,153,.4)}
.nav-actions{display:flex;gap:8px}

/* TABS */
.tabs{display:flex;gap:2px;padding:0 20px;background:var(--surface);border-bottom:1px solid #334155;overflow-x:auto}
.tab{padding:12px 18px;border-radius:0;cursor:pointer;font-size:.88rem;white-space:nowrap;
     color:var(--muted);border:none;background:transparent;transition:.2s;border-bottom:3px solid transparent}
.tab.active{color:var(--accent);font-weight:600;border-bottom-color:var(--accent)}
.tab:hover:not(.active){color:var(--text)}
.tab-panel{display:none;padding:24px 28px}
.tab-panel.active{display:block}

/* BUTTONS */
.btn{padding:8px 16px;border-radius:8px;border:none;cursor:pointer;font-size:.85rem;font-weight:600;transition:.2s}
.btn-primary{background:var(--accent);color:#0f172a}.btn-primary:hover{background:#7dd3fc}
.btn-success{background:var(--accent3);color:#0f172a}.btn-success:hover{filter:brightness(1.1)}
.btn-danger2{background:var(--danger);color:#fff}.btn-danger2:hover{filter:brightness(1.1)}
.btn-outline{background:transparent;color:var(--accent);border:1px solid var(--accent)}.btn-outline:hover{background:rgba(56,189,248,.1)}
.btn-warn{background:transparent;color:var(--warn);border:1px solid var(--warn)}.btn-warn:hover{background:rgba(251,191,36,.1)}
.btn-danger{background:transparent;color:var(--danger);border:1px solid var(--danger)}
.btn-sm{padding:5px 12px;font-size:.78rem}
.btn:disabled{opacity:.4;cursor:not-allowed}

/* KPI CARDS */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px}
.kpi-card{background:var(--surface);border-radius:var(--radius);padding:18px;border:1px solid #334155;position:relative;overflow:hidden}
.kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px}
.kpi-card.blue::before{background:var(--accent)}.kpi-card.purple::before{background:var(--accent2)}
.kpi-card.green::before{background:var(--accent3)}.kpi-card.red::before{background:var(--danger)}
.kpi-card.yellow::before{background:var(--warn)}.kpi-card.orange::before{background:#fb923c}
.kpi-label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
.kpi-value{font-size:1.9rem;font-weight:700}
.kpi-sub{font-size:.75rem;color:var(--muted);margin-top:4px}

/* ALERT */
.alert-box{border-radius:var(--radius);padding:14px 18px;margin-bottom:18px;display:flex;gap:12px;align-items:flex-start}
.alert-error{background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3)}
.alert-warn{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3)}
.alert-info{background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.3)}
.alert-icon{font-size:1.1rem;flex-shrink:0;margin-top:2px}
.alert-text{font-size:.85rem;line-height:1.6}

/* CHARTS */
.charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;margin-bottom:22px}
.chart-card{background:var(--surface);border-radius:var(--radius);padding:20px;border:1px solid #334155}
.chart-title{font-size:.82rem;font-weight:600;color:var(--muted);margin-bottom:14px;text-transform:uppercase;letter-spacing:.05em}
.chart-wrap{position:relative;height:240px}

/* TABLE */
.table-card{background:var(--surface);border-radius:var(--radius);border:1px solid #334155;overflow:hidden;margin-bottom:20px}
.table-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #334155;flex-wrap:wrap;gap:8px}
.table-title{font-weight:600;font-size:.92rem}
.table-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
table{width:100%;border-collapse:collapse}
thead{background:var(--surface2)}
th{padding:10px 14px;text-align:left;font-size:.76rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;cursor:pointer;user-select:none;white-space:nowrap}
th:hover{color:var(--accent)}
td{padding:10px 14px;border-top:1px solid #1e293b;font-size:.84rem}
tbody tr{transition:.15s;cursor:pointer}tbody tr:hover{background:var(--surface2)}

/* BADGES */
.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;
       border-radius:999px;font-size:.7rem;font-weight:700;text-transform:uppercase;white-space:nowrap}
.badge-high{background:rgba(248,113,113,.15);color:var(--danger);border:1px solid rgba(248,113,113,.3)}
.badge-med{background:rgba(251,191,36,.15);color:var(--warn);border:1px solid rgba(251,191,36,.3)}
.badge-low{background:rgba(52,211,153,.15);color:var(--accent3);border:1px solid rgba(52,211,153,.3)}
.badge-pending{background:rgba(251,191,36,.15);color:var(--warn);border:1px solid rgba(251,191,36,.3)}
.badge-approved{background:rgba(52,211,153,.15);color:var(--accent3);border:1px solid rgba(52,211,153,.3)}
.badge-rejected{background:rgba(248,113,113,.15);color:var(--danger);border:1px solid rgba(248,113,113,.3)}
.badge-error{background:rgba(248,113,113,.15);color:var(--danger);border:1px solid rgba(248,113,113,.3)}
.badge-warn2{background:rgba(251,191,36,.15);color:var(--warn);border:1px solid rgba(251,191,36,.3)}
.badge-license{background:rgba(251,146,60,.15);color:#fb923c;border:1px solid rgba(251,146,60,.3)}
.badge-admin{background:rgba(248,113,113,.15);color:var(--danger)}
.badge-teamlead{background:rgba(251,191,36,.15);color:var(--warn)}
.badge-developer{background:rgba(52,211,153,.15);color:var(--accent3)}

/* FILTER BAR */
.filter-bar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:18px;background:var(--surface);padding:14px;border-radius:var(--radius);border:1px solid #334155}
.filter-bar input,.filter-bar select{background:var(--surface2);border:1px solid #475569;color:var(--text);padding:7px 12px;border-radius:8px;font-size:.84rem;min-width:150px}
.filter-bar input:focus,.filter-bar select:focus{outline:none;border-color:var(--accent)}
.filter-bar label{font-size:.75rem;color:var(--muted);display:block;margin-bottom:3px}

/* PAGINATION */
.pagination{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-top:1px solid #334155;font-size:.82rem;color:var(--muted)}
.page-btns{display:flex;gap:5px}
.page-btn{width:30px;height:30px;border-radius:6px;border:1px solid #334155;background:transparent;color:var(--text);cursor:pointer;font-size:.8rem}
.page-btn.active{background:var(--accent);color:#0f172a;border-color:var(--accent)}
.page-btn:hover:not(.active){background:var(--surface2)}

/* DRAWER */
.drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:200;display:none;backdrop-filter:blur(2px)}
.drawer{position:fixed;right:0;top:0;bottom:0;width:440px;background:var(--surface);z-index:201;
        transform:translateX(100%);transition:.3s cubic-bezier(.4,0,.2,1);
        display:flex;flex-direction:column;border-left:1px solid #334155;overflow-y:auto}
.drawer.open{transform:translateX(0)}
.drawer-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #334155;position:sticky;top:0;background:var(--surface)}
.drawer-body{padding:20px;flex:1}
.drawer-close{background:none;border:none;color:var(--muted);cursor:pointer;font-size:1.2rem;padding:4px}
.detail-row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #1e293b;font-size:.86rem}
.detail-label{color:var(--muted)}
.timeline{margin-top:14px}
.timeline-item{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #1e293b}
.timeline-dot{width:9px;height:9px;border-radius:50%;background:var(--accent);margin-top:4px;flex-shrink:0}

/* EMPLOYEE CARDS */
.emp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.emp-card{background:var(--surface);border-radius:var(--radius);padding:18px;border:1px solid #334155;cursor:pointer;transition:.2s}
.emp-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:var(--shadow)}
.emp-name{font-size:.95rem;font-weight:700;margin-bottom:3px}
.emp-team{font-size:.76rem;color:var(--accent2);margin-bottom:10px}
.emp-stats{display:flex;gap:14px;margin-bottom:10px}
.emp-stat{text-align:center}
.emp-stat-val{font-size:1.2rem;font-weight:700;color:var(--accent)}
.emp-stat-label{font-size:.7rem;color:var(--muted)}
.progress-bar{height:5px;background:#334155;border-radius:999px;overflow:hidden}
.progress-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:.4s}

/* FILE CARDS */
.file-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.file-card{background:var(--surface);border-radius:var(--radius);padding:16px;border:1px solid #334155}
.file-card.risk-high{border-color:rgba(248,113,113,.4)}.file-card.risk-med{border-color:rgba(251,191,36,.4)}.file-card.risk-low{border-color:rgba(52,211,153,.4)}
.file-name{font-size:.83rem;font-weight:600;margin-bottom:6px;word-break:break-all}

/* SETTINGS */
.settings-section{background:var(--surface);border-radius:var(--radius);padding:22px;border:1px solid #334155;margin-bottom:18px}
.settings-title{font-weight:700;margin-bottom:14px;color:var(--accent);font-size:.95rem}
.form-group{margin-bottom:14px}
.form-label{font-size:.83rem;color:var(--muted);display:block;margin-bottom:5px}
.form-input{width:100%;background:var(--surface2);border:1px solid #475569;color:var(--text);padding:8px 12px;border-radius:8px;font-size:.875rem}
.form-input:focus{outline:none;border-color:var(--accent)}
.range-wrap{display:flex;align-items:center;gap:12px}
.range-wrap input[type=range]{flex:1;accent-color:var(--accent)}
.range-val{min-width:40px;text-align:center;font-weight:700;color:var(--accent)}
.team-row{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center}

/* AUDIT */
.audit-status{display:flex;align-items:center;gap:10px;padding:14px 18px;border-radius:var(--radius);margin-bottom:18px;font-size:.88rem;font-weight:600}
.audit-ok{background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);color:var(--accent3)}
.audit-fail{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:var(--danger)}
.audit-action{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:.7rem;font-weight:700;text-transform:uppercase}
.action-created{background:rgba(56,189,248,.15);color:var(--accent);border:1px solid rgba(56,189,248,.3)}
.action-edited{background:rgba(129,140,248,.15);color:var(--accent2);border:1px solid rgba(129,140,248,.3)}
.action-approved{background:rgba(52,211,153,.15);color:var(--accent3);border:1px solid rgba(52,211,153,.3)}
.action-rejected{background:rgba(248,113,113,.15);color:var(--danger);border:1px solid rgba(248,113,113,.3)}
.action-violation{background:rgba(251,191,36,.15);color:var(--warn);border:1px solid rgba(251,191,36,.3)}

/* POLICY */
.violation-row{padding:12px 16px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.violation-error{background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25)}
.violation-warning{background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25)}
.violation-detail{font-size:.83rem;line-height:1.5}
.violation-rule{font-size:.72rem;color:var(--muted);margin-top:3px}

/* LEADERBOARD */
.leader-row{display:flex;align-items:center;gap:14px;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:8px;border:1px solid #334155;transition:.15s}
.leader-row:hover{border-color:var(--accent)}
.leader-rank{font-size:1.1rem;font-weight:700;color:var(--muted);width:28px;flex-shrink:0;text-align:center}
.leader-rank.gold{color:#fbbf24}.leader-rank.silver{color:#94a3b8}.leader-rank.bronze{color:#fb923c}
.leader-info{flex:1}
.leader-name{font-weight:600;font-size:.9rem}
.leader-team{font-size:.75rem;color:var(--muted)}
.leader-bar-wrap{flex:2;background:#334155;border-radius:999px;height:8px;overflow:hidden}
.leader-bar-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.leader-val{font-weight:700;color:var(--accent);min-width:60px;text-align:right;font-size:.9rem}

/* APPROVAL QUEUE */
.approval-card{background:var(--surface);border-radius:var(--radius);padding:16px;border:1px solid rgba(251,191,36,.3);margin-bottom:12px}
.approval-meta{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;align-items:center}
.approval-actions{display:flex;gap:8px}

/* TOAST */
.toast-container{position:fixed;top:20px;right:20px;z-index:300;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--surface2);border:1px solid #334155;border-radius:10px;padding:10px 16px;font-size:.84rem;box-shadow:var(--shadow);animation:slideIn .3s ease;display:flex;gap:8px;align-items:center;min-width:250px}
.toast.success{border-color:rgba(52,211,153,.4)}.toast.error{border-color:rgba(248,113,113,.4)}.toast.warn{border-color:rgba(251,191,36,.4)}
@keyframes slideIn{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}

/* MISC */
.section-title{font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:14px}
.empty{text-align:center;padding:40px;color:var(--muted);font-size:.9rem}
.col-toggle{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.col-toggle label{display:flex;align-items:center;gap:4px;font-size:.76rem;color:var(--muted);cursor:pointer}
.divider{height:1px;background:#334155;margin:16px 0}
.info-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:.75rem;background:var(--surface2);border:1px solid #334155;color:var(--muted)}

@media(max-width:700px){.charts-grid{grid-template-columns:1fr}.kpi-grid{grid-template-columns:repeat(2,1fr)}.drawer{width:100%}}
@media print{nav,.tabs,.nav-actions,.filter-bar,.drawer,.drawer-overlay,.toast-container,.pagination,.col-toggle,.table-actions{display:none!important}body{background:white;color:black}.tab-panel{display:block!important}.kpi-card,.chart-card,.table-card{break-inside:avoid}}
</style>
</head>
<body>

<div class="toast-container" id="toastContainer"></div>
<div class="drawer-overlay" id="drawerOverlay" onclick="closeDrawer()"></div>
<div class="drawer" id="drawer">
  <div class="drawer-header">
    <strong id="drawerTitle">Details</strong>
    <button class="drawer-close" onclick="closeDrawer()">✕</button>
  </div>
  <div class="drawer-body" id="drawerBody"></div>
</div>

<!-- NAV -->
<nav>
  <div class="nav-logo">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
    </svg>
    AI Annotator
    <span style="font-size:.7rem;color:var(--muted);font-weight:400">v3.0 Enterprise</span>
  </div>
  <div class="nav-meta">
    <span class="info-chip">👤 ${getEmployeeId()}</span>
    <span class="role-badge role-${caps.role}">${caps.role}</span>
    ${pendingBlocks.length > 0 ? `<span class="badge badge-pending">⏳ ${pendingBlocks.length} Pending</span>` : ''}
    ${errorViolations.length > 0 ? `<span class="badge badge-error">🚨 ${errorViolations.length} Policy</span>` : ''}
    ${licenseRiskBlocks.length > 0 ? `<span class="badge badge-license">⚖ ${licenseRiskBlocks.length} License Risk</span>` : ''}
  </div>
  <div class="nav-actions">
    ${caps.canExport ? `<button class="btn btn-outline btn-sm" onclick="exportCSV()">⬇ CSV</button>
    <button class="btn btn-outline btn-sm" onclick="exportPDF()">🖨 Print</button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="refresh()">⟳ Refresh</button>
  </div>
</nav>

<!-- TABS -->
<div class="tabs">
  ${visibleTabs.includes('overview')   ? `<button class="tab active" onclick="switchTab('overview',this)">📊 Overview</button>` : ''}
  ${visibleTabs.includes('employees')  ? `<button class="tab" onclick="switchTab('employees',this)">👥 Employees</button>` : ''}
  ${visibleTabs.includes('files')      ? `<button class="tab" onclick="switchTab('files',this)">📁 Files</button>` : ''}
  ${visibleTabs.includes('trends')     ? `<button class="tab" onclick="switchTab('trends',this)">📈 Trends</button>` : ''}
  ${visibleTabs.includes('audit')      ? `<button class="tab" onclick="switchTab('audit',this)">🔐 Audit${!chainResult.valid ? ' ⚠' : ''}</button>` : ''}
  ${visibleTabs.includes('policy')     ? `<button class="tab" onclick="switchTab('policy',this)">📋 Policy${errorViolations.length > 0 ? ` (${errorViolations.length})` : ''}</button>` : ''}
  ${visibleTabs.includes('settings')   ? `<button class="tab" onclick="switchTab('settings',this)">⚙ Settings</button>` : ''}
</div>

<!-- ══ OVERVIEW ══════════════════════════════════════════════════════════════ -->
<div class="tab-panel active" id="tab-overview">

  ${anomalies.length > 0 ? `
  <div class="alert-box alert-error">
    <span class="alert-icon">🚨</span>
    <div class="alert-text">
      <strong>Anomaly Detected</strong> — Unusually high AI activity today:<br>
      ${anomalies.map(a => `<strong>${a.id}</strong>: ${a.lines} AI lines`).join(' &nbsp;·&nbsp; ')}
    </div>
  </div>` : ''}

  ${errorViolations.length > 0 ? `
  <div class="alert-box alert-error">
    <span class="alert-icon">🚨</span>
    <div class="alert-text">
      <strong>${errorViolations.length} Policy Violation${errorViolations.length > 1 ? 's' : ''}</strong> — Switch to the Policy tab for details.
    </div>
  </div>` : ''}

  ${licenseRiskBlocks.length > 0 ? `
  <div class="alert-box alert-warn">
    <span class="alert-icon">⚖</span>
    <div class="alert-text">
      <strong>License Risk Detected</strong> — ${licenseRiskBlocks.length} AI block(s) contain potential open-source license markers.
      Review before merging.
    </div>
  </div>` : ''}

  <div class="kpi-grid">
    <div class="kpi-card blue">
      <div class="kpi-label">Total AI Blocks</div>
      <div class="kpi-value">${totalBlocks}</div>
      <div class="kpi-sub">across all files</div>
    </div>
    <div class="kpi-card ${parseFloat(wsPercent) > threshold ? 'red' : parseFloat(wsPercent) > threshold * 0.5 ? 'yellow' : 'green'}">
      <div class="kpi-label">Workspace AI %</div>
      <div class="kpi-value">${wsPercent}%</div>
      <div class="kpi-sub">${totalAI} of ${totalAll} lines</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-label">Contributors</div>
      <div class="kpi-value">${uniqueContributors}</div>
      <div class="kpi-sub">unique employees</div>
    </div>
    <div class="kpi-card green">
      <div class="kpi-label">Files Affected</div>
      <div class="kpi-value">${uniqueFiles}</div>
      <div class="kpi-sub">with AI annotations</div>
    </div>
    <div class="kpi-card yellow">
      <div class="kpi-label">Pending Approval</div>
      <div class="kpi-value">${pendingBlocks.length}</div>
      <div class="kpi-sub">awaiting review</div>
    </div>
    <div class="kpi-card ${errorViolations.length > 0 ? 'red' : 'green'}">
      <div class="kpi-label">Policy Violations</div>
      <div class="kpi-value">${violations.length}</div>
      <div class="kpi-sub">${errorViolations.length} errors, ${violations.length - errorViolations.length} warnings</div>
    </div>
    <div class="kpi-card orange">
      <div class="kpi-label">License Risks</div>
      <div class="kpi-value">${licenseRiskBlocks.length}</div>
      <div class="kpi-sub">blocks flagged</div>
    </div>
  </div>

  <div class="charts-grid">
    <div class="chart-card">
      <div class="chart-title">AI Lines by Employee</div>
      <div class="chart-wrap"><canvas id="pieChart"></canvas></div>
    </div>
    <div class="chart-card">
      <div class="chart-title">Top 10 Files by AI Lines</div>
      <div class="chart-wrap"><canvas id="barChart"></canvas></div>
    </div>
    ${Object.keys(teamMap).length > 0 ? `
    <div class="chart-card">
      <div class="chart-title">AI Lines by Team</div>
      <div class="chart-wrap"><canvas id="teamChart"></canvas></div>
    </div>` : ''}
    <div class="chart-card">
      <div class="chart-title">Block Approval Status</div>
      <div class="chart-wrap"><canvas id="approvalChart"></canvas></div>
    </div>
  </div>

  <!-- Filters -->
  <div class="filter-bar">
    <div><label>Employee</label>
      <select id="fEmployee" onchange="applyFilters()">
        <option value="">All Employees</option>
        ${[...empSet].map(e => `<option value="${e}">${e}</option>`).join('')}
      </select></div>
    <div><label>From Date</label><input type="date" id="fFrom" onchange="applyFilters()"/></div>
    <div><label>To Date</label><input type="date" id="fTo" onchange="applyFilters()"/></div>
    <div><label>Search File</label><input type="text" id="fFile" placeholder="e.g. extension.ts" oninput="applyFilters()"/></div>
    <div><label>Risk Level</label>
      <select id="fRisk" onchange="applyFilters()">
        <option value="">All</option><option value="high">High</option><option value="med">Medium</option><option value="low">Low</option>
      </select></div>
    <div><label>Status</label>
      <select id="fStatus" onchange="applyFilters()">
        <option value="">All</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
      </select></div>
    <div style="display:flex;align-items:flex-end">
      <button class="btn btn-outline btn-sm" onclick="clearFilters()">✕ Clear</button>
    </div>
  </div>

  <div class="col-toggle">
    <span style="font-size:.76rem;color:var(--muted);margin-right:4px">Columns:</span>
    <label><input type="checkbox" checked onchange="toggleCol(0)"> #</label>
    <label><input type="checkbox" checked onchange="toggleCol(1)"> Employee</label>
    <label><input type="checkbox" checked onchange="toggleCol(2)"> Date</label>
    <label><input type="checkbox" checked onchange="toggleCol(3)"> File</label>
    <label><input type="checkbox" checked onchange="toggleCol(4)"> Lines</label>
    <label><input type="checkbox" checked onchange="toggleCol(5)"> Risk</label>
    <label><input type="checkbox" checked onchange="toggleCol(6)"> Status</label>
    <label><input type="checkbox" checked onchange="toggleCol(7)"> License</label>
    <label><input type="checkbox" checked onchange="toggleCol(8)"> Edited By</label>
  </div>

  <div class="table-card">
    <div class="table-header">
      <span class="table-title">AI Block Details</span>
      <div class="table-actions">
        <span id="rowCount" style="font-size:.8rem;color:var(--muted)"></span>
        <select id="pageSize" onchange="setPageSize()" style="background:var(--surface2);border:1px solid #475569;color:var(--text);padding:4px 8px;border-radius:6px;font-size:.8rem">
          <option value="25">25/page</option><option value="50">50/page</option><option value="100">100/page</option>
        </select>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table id="mainTable">
        <thead><tr>
          <th onclick="sortBy(0)">#</th>
          <th onclick="sortBy(1)">Employee ↕</th>
          <th onclick="sortBy(2)">Date ↕</th>
          <th onclick="sortBy(3)">File ↕</th>
          <th onclick="sortBy(4)">Lines ↕</th>
          <th>Risk</th>
          <th>Status</th>
          <th>License</th>
          <th>Edited By</th>
        </tr></thead>
        <tbody id="tableBody"></tbody>
      </table>
    </div>
    <div class="pagination">
      <span id="paginationInfo"></span>
      <div class="page-btns" id="pageBtns"></div>
    </div>
  </div>
</div>

<!-- ══ EMPLOYEES ═════════════════════════════════════════════════════════════ -->
<div class="tab-panel" id="tab-employees">
  <div class="section-title">Team Leaderboard</div>
  ${(() => {
      const totalLines = blocks.reduce((s, b) => s + b.lines, 0);
      const ranked = Object.entries(empMap).sort(([, a], [, b]) => b - a);
      const maxLines = ranked[0]?.[1] || 1;
      return ranked.map(([id, lines], idx) => {
          const pct = totalLines > 0 ? ((lines / totalLines) * 100).toFixed(0) : 0;
          const team = teamConfig[id] || 'Unassigned';
          const role = config.roles?.[id] || 'developer';
          const rankClass = idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : '';
          const rankEmoji = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
          const barPct = ((lines / maxLines) * 100).toFixed(0);
          return `
          <div class="leader-row" onclick="showEmpDetail('${id}')">
            <div class="leader-rank ${rankClass}">${rankEmoji}</div>
            <div class="leader-info">
              <div class="leader-name">
                ${id}
                <span class="badge badge-${role}" style="margin-left:6px;font-size:.65rem">${role}</span>
              </div>
              <div class="leader-team">${team} · ${pct}% of total AI</div>
            </div>
            <div class="leader-bar-wrap"><div class="leader-bar-fill" style="width:${barPct}%"></div></div>
            <div class="leader-val">${lines} lines</div>
          </div>`;
      }).join('');
  })()}

  <div class="divider"></div>
  <div class="section-title" style="margin-top:20px">Contributor Cards</div>
  <div class="emp-grid">
  ${Object.entries(empMap).map(([id, lines]) => {
      const totalLines = blocks.reduce((s, b) => s + b.lines, 0);
      const pct = totalLines > 0 ? ((lines / totalLines) * 100).toFixed(0) : 0;
      const team = teamConfig[id] || 'Unassigned';
      const fileCount = new Set(blocks.filter(b => b.employeeId === id).map(b => b.file)).size;
      const approved  = blocks.filter(b => b.employeeId === id && b.status === 'APPROVED').length;
      const pending   = blocks.filter(b => b.employeeId === id && (!b.status || b.status === 'PENDING')).length;
      const lastDate  = blocks.filter(b => b.employeeId === id).map(b => b.date).sort().pop() || '—';
      const role = config.roles?.[id] || 'developer';
      return `
    <div class="emp-card" onclick="showEmpDetail('${id}')">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div class="emp-name">👤 ${id}</div>
        <span class="badge badge-${role}">${role}</span>
      </div>
      <div class="emp-team">${team}</div>
      <div class="emp-stats">
        <div class="emp-stat"><div class="emp-stat-val">${lines}</div><div class="emp-stat-label">AI Lines</div></div>
        <div class="emp-stat"><div class="emp-stat-val">${fileCount}</div><div class="emp-stat-label">Files</div></div>
        <div class="emp-stat"><div class="emp-stat-val">${pct}%</div><div class="emp-stat-label">Share</div></div>
        <div class="emp-stat"><div class="emp-stat-val" style="color:var(--accent3)">${approved}</div><div class="emp-stat-label">Approved</div></div>
        <div class="emp-stat"><div class="emp-stat-val" style="color:var(--warn)">${pending}</div><div class="emp-stat-label">Pending</div></div>
      </div>
      <div style="font-size:.73rem;color:var(--muted);margin-bottom:7px">Last active: ${lastDate}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('')}
  </div>
</div>

<!-- ══ FILES ══════════════════════════════════════════════════════════════════ -->
<div class="tab-panel" id="tab-files">
  <div class="section-title">File Risk Assessment</div>
  <div class="file-grid">
  ${Object.entries(fileMap).sort(([, a], [, b]) => b - a).map(([file, lines]) => {
      const riskClass   = lines > threshold ? 'risk-high' : lines > threshold * 0.5 ? 'risk-med' : 'risk-low';
      const badgeClass  = lines > threshold ? 'badge-high' : lines > threshold * 0.5 ? 'badge-med' : 'badge-low';
      const badgeLabel  = lines > threshold ? 'HIGH RISK' : lines > threshold * 0.5 ? 'MEDIUM' : 'LOW';
      const blockCount  = blocks.filter(b => b.file === file).length;
      const hasLicense  = blocks.some(b => b.file === file && b.licenseRisk?.detected);
      const pendingCount = blocks.filter(b => b.file === file && (!b.status || b.status === 'PENDING')).length;
      return `
    <div class="file-card ${riskClass}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:4px">
        <span class="badge ${badgeClass}">● ${badgeLabel}</span>
        ${hasLicense  ? `<span class="badge badge-license">⚖ License Risk</span>` : ''}
        ${pendingCount > 0 ? `<span class="badge badge-pending">⏳ ${pendingCount} Pending</span>` : ''}
      </div>
      <div class="file-name">📄 ${file}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:.8rem;color:var(--muted)">
        <span>${blockCount} block${blockCount !== 1 ? 's' : ''} · ${lines} AI lines</span>
      </div>
    </div>`;
  }).join('')}
  </div>
</div>

<!-- ══ TRENDS ═════════════════════════════════════════════════════════════════ -->
<div class="tab-panel" id="tab-trends">
  <div class="section-title">AI Adoption — Last 14 Days</div>
  ${trendLabels.length < 2 ? `<div class="empty">📈 Not enough history — open the dashboard daily to build trend data.</div>` : `
  <div class="chart-card" style="margin-bottom:20px">
    <div class="chart-title">Daily AI Lines Trend</div>
    <div class="chart-wrap" style="height:300px"><canvas id="trendChart"></canvas></div>
  </div>`}
  <div class="chart-card">
    <div class="chart-title">Snapshot History (Last 20 days)</div>
    <table style="width:100%">
      <thead><tr><th>Date</th><th>AI Lines</th><th>Total Lines</th><th>AI %</th><th>Blocks</th></tr></thead>
      <tbody>
      ${[...snapshots].reverse().slice(0, 20).map(s => `
        <tr>
          <td>${s.date}</td>
          <td style="color:var(--accent)">${s.aiLines}</td>
          <td>${s.totalLines}</td>
          <td><span class="${s.aiPercent > threshold ? 'badge badge-high' : s.aiPercent > threshold * 0.5 ? 'badge badge-med' : 'badge badge-low'}">${s.aiPercent}%</span></td>
          <td>${s.blocks?.length || 0}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
</div>

<!-- ══ AUDIT ══════════════════════════════════════════════════════════════════ -->
${visibleTabs.includes('audit') ? `
<div class="tab-panel" id="tab-audit">
  <div class="audit-status ${chainResult.valid ? 'audit-ok' : 'audit-fail'}">
    ${chainResult.valid
        ? `✓ Audit chain integrity verified — ${chainResult.totalEntries} entries, no tampering detected`
        : `⚠ Audit chain BROKEN at entry #${chainResult.brokenAt} — possible tampering! (ID: ${chainResult.brokenEntryId})`}
  </div>

  <div class="table-card">
    <div class="table-header">
      <span class="table-title">Immutable Audit Log (Last 100 entries)</span>
      <div class="table-actions">
        <span class="info-chip">${auditEntries.length} entries shown</span>
      </div>
    </div>
    <div style="overflow-x:auto">
      <table>
        <thead><tr>
          <th>Timestamp</th><th>Action</th><th>Employee</th><th>File</th><th>Block Hash</th><th>Entry Hash</th>
        </tr></thead>
        <tbody>
        ${[...auditEntries].reverse().map(e => {
            const actionClass = e.action.includes('CREATED') ? 'action-created'
                : e.action.includes('EDITED') ? 'action-edited'
                : e.action.includes('APPROVED') ? 'action-approved'
                : e.action.includes('REJECTED') ? 'action-rejected'
                : 'action-violation';
            const ts = new Date(e.timestamp).toLocaleString();
            const shortFile = e.file ? e.file.split(/[\\/]/).pop() : '—';
            return `<tr>
              <td style="white-space:nowrap;font-size:.78rem">${ts}</td>
              <td><span class="audit-action ${actionClass}">${e.action}</span></td>
              <td><strong>${e.employeeId || '—'}</strong></td>
              <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.78rem" title="${e.file}">${shortFile}</td>
              <td><code style="font-size:.72rem;color:var(--accent)">${(e.blockHash || '').substring(0, 8)}</code></td>
              <td><code style="font-size:.72rem;color:var(--muted)">${(e.entryHash || '').substring(0, 12)}…</code></td>
            </tr>`;
        }).join('')}
        </tbody>
      </table>
    </div>
  </div>
</div>` : ''}

<!-- ══ POLICY ═════════════════════════════════════════════════════════════════ -->
${visibleTabs.includes('policy') ? `
<div class="tab-panel" id="tab-policy">

  ${caps.canApprove ? `
  <div class="section-title">⏳ Pending Approval Queue (${pendingBlocks.length})</div>
  ${pendingBlocks.length === 0 ? `<div class="empty">All blocks approved ✓</div>` :
    pendingBlocks.map(b => `
    <div class="approval-card">
      <div class="approval-meta">
        <span class="badge badge-pending">PENDING</span>
        <strong>${b.employeeId}</strong>
        <span style="color:var(--muted);font-size:.8rem">${b.date}</span>
        <span style="color:var(--muted);font-size:.8rem">📄 ${b.file}</span>
        <span style="color:var(--accent);font-size:.8rem">${b.lines} lines</span>
        ${b.licenseRisk?.detected ? `<span class="badge badge-license">⚖ ${b.licenseRisk.license}</span>` : ''}
        ${b.hash ? `<code style="font-size:.72rem;color:var(--muted)">HASH: ${b.hash}</code>` : ''}
      </div>
      <div class="approval-actions">
        <button class="btn btn-success btn-sm" onclick="approveBlock('${b.file}','${b.hash || ''}','${b.date}')">✓ Approve</button>
        <button class="btn btn-danger2 btn-sm" onclick="rejectBlock('${b.file}','${b.hash || ''}','${b.date}')">✕ Reject</button>
      </div>
    </div>`).join('')}
  <div class="divider"></div>` : ''}

  <div class="section-title">🚨 Policy Violations (${violations.length})</div>
  ${violations.length === 0
    ? `<div class="empty">✓ All policies satisfied</div>`
    : violations.map(v => `
    <div class="violation-row ${v.severity === 'error' ? 'violation-error' : 'violation-warning'}">
      <div>
        <div class="violation-detail">
          <span class="badge ${v.severity === 'error' ? 'badge-error' : 'badge-warn2'}" style="margin-right:6px">${v.severity.toUpperCase()}</span>
          ${v.detail}
        </div>
        <div class="violation-rule">Rule: ${v.ruleId} · ${v.ruleName}</div>
      </div>
      ${v.employeeId ? `<span style="font-size:.8rem;color:var(--muted);white-space:nowrap">${v.employeeId}</span>` : ''}
    </div>`).join('')}
</div>` : ''}

<!-- ══ SETTINGS ═══════════════════════════════════════════════════════════════ -->
${visibleTabs.includes('settings') ? `
<div class="tab-panel" id="tab-settings">
  ${!caps.canEditSettings ? `<div class="alert-box alert-info"><span class="alert-icon">ℹ</span><div class="alert-text">Settings can only be modified by <strong>Admin</strong> users. Contact your admin to update org-level policies.</div></div>` : ''}

  <div class="settings-section">
    <div class="settings-title">📋 Policy Configuration</div>
    <div class="form-group">
      <label class="form-label">Require Approval before blocks are considered compliant</label>
      <select class="form-input" id="requireApproval" ${!caps.canEditSettings ? 'disabled' : ''}>
        <option value="true"  ${config.policies?.requireApproval ? 'selected' : ''}>Enabled — blocks need Team Lead sign-off</option>
        <option value="false" ${!config.policies?.requireApproval ? 'selected' : ''}>Disabled — blocks auto-approve</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Max AI lines per employee per day (anomaly threshold)</label>
      <div class="range-wrap">
        <input type="range" min="50" max="1000" step="25"
               value="${config.policies?.maxAILinesPerDayPerEmployee || 300}"
               id="anomalyRange" ${!caps.canEditSettings ? 'disabled' : ''}
               oninput="document.getElementById('anomalyVal').textContent=this.value"/>
        <span class="range-val" id="anomalyVal">${config.policies?.maxAILinesPerDayPerEmployee || 300}</span>
        <span style="font-size:.78rem;color:var(--muted)">lines/day</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Risk threshold — files with more AI lines than this are HIGH RISK</label>
      <div class="range-wrap">
        <input type="range" min="10" max="500" value="${threshold}" id="thresholdRange"
               ${!caps.canEditSettings ? 'disabled' : ''}
               oninput="document.getElementById('thresholdVal').textContent=this.value"/>
        <span class="range-val" id="thresholdVal">${threshold}</span>
        <span style="font-size:.78rem;color:var(--muted)">lines</span>
      </div>
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-title">👥 Team / Role Mapping</div>
    <div class="form-group">
      <label class="form-label">Map Employee IDs to teams and roles (roles: developer | teamlead | admin)</label>
      <div id="teamRows">
        ${Object.entries(config.teams || {}).map(([emp, team]) => `
        <div class="team-row">
          <input class="form-input emp-inp" placeholder="Employee ID" value="${emp}" ${!caps.canEditSettings ? 'disabled' : ''}/>
          <input class="form-input team-inp" placeholder="Team Name" value="${team}" ${!caps.canEditSettings ? 'disabled' : ''}/>
          <select class="form-input role-sel" ${!caps.canEditSettings ? 'disabled' : ''}>
            <option ${(config.roles?.[emp] || 'developer') === 'developer' ? 'selected' : ''}>developer</option>
            <option ${(config.roles?.[emp] || 'developer') === 'teamlead' ? 'selected' : ''}>teamlead</option>
            <option ${(config.roles?.[emp] || 'developer') === 'admin' ? 'selected' : ''}>admin</option>
          </select>
          ${caps.canEditSettings ? `<button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>` : '<span></span>'}
        </div>`).join('')}
      </div>
      ${caps.canEditSettings ? `<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="addTeamRow()">+ Add Employee</button>` : ''}
    </div>
  </div>

  <div class="settings-section">
    <div class="settings-title">🔍 Scan Extensions</div>
    <div class="form-group">
      <label class="form-label">Comma-separated file extensions to scan for AI blocks</label>
      <input class="form-input" id="extInput" value="${extensions.join(', ')}" ${!caps.canEditSettings ? 'disabled' : ''}/>
    </div>
  </div>

  ${caps.canEditSettings ? `<button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>` : ''}
</div>` : ''}

<script>
// ── Data injected from extension ───────────────────────────────────────────
const blocks      = ${JSON.stringify(blocks)};
const empMap      = ${JSON.stringify(empMap)};
const teamMap     = ${JSON.stringify(teamMap)};
const trendLabels = ${JSON.stringify(trendLabels)};
const trendData   = ${JSON.stringify(trendData)};
const snapshots   = ${JSON.stringify(snapshots)};
const threshold   = ${threshold};
const canApprove  = ${caps.canApprove};
const vscode      = acquireVsCodeApi();

// ── State ──────────────────────────────────────────────────────────────────
let filteredBlocks = [...blocks];
let sortCol = -1, sortAsc = true, currentPage = 1, pageSize = 25;

// ── Tab Switching ──────────────────────────────────────────────────────────
function switchTab(id, el) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    const panel = document.getElementById('tab-' + id);
    if (panel) panel.classList.add('active');
    el.classList.add('active');
}

// ── Charts ─────────────────────────────────────────────────────────────────
const COLORS = ['#38bdf8','#818cf8','#34d399','#fbbf24','#f87171','#a78bfa','#fb923c','#4ade80','#f472b6','#22d3ee'];

function initCharts() {
    const defaults = { plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } } };

    // Employee donut
    const pieEl = document.getElementById('pieChart');
    if (pieEl && Object.keys(empMap).length > 0) {
        new Chart(pieEl, {
            type: 'doughnut',
            data: { labels: Object.keys(empMap),
                    datasets: [{ data: Object.values(empMap), backgroundColor: COLORS, borderWidth: 2, borderColor: '#1e293b' }] },
            options: { ...defaults, cutout: '58%',
                plugins: { ...defaults.plugins, tooltip: { callbacks: { label: ctx => \` \${ctx.label}: \${ctx.parsed} lines\` } } } }
        });
    }

    // Top 10 files bar
    const barEl = document.getElementById('barChart');
    if (barEl) {
        const fileEntries = Object.entries(
            blocks.reduce((acc, b) => { acc[b.file] = (acc[b.file]||0)+b.lines; return acc; }, {})
        ).sort(([,a],[,b]) => b-a).slice(0,10);
        new Chart(barEl, {
            type: 'bar',
            data: { labels: fileEntries.map(([f]) => f.length>20?'…'+f.slice(-18):f),
                    datasets: [{ label:'AI Lines', data: fileEntries.map(([,v])=>v), backgroundColor:'#38bdf8', borderRadius:5 }] },
            options: { ...defaults, indexAxis:'y',
                scales: { x:{ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}},
                          y:{ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}} },
                plugins: { legend:{display:false} } }
        });
    }

    // Team chart
    const teamEl = document.getElementById('teamChart');
    if (teamEl && Object.keys(teamMap).length > 0) {
        new Chart(teamEl, {
            type: 'pie',
            data: { labels: Object.keys(teamMap),
                    datasets: [{ data: Object.values(teamMap), backgroundColor: COLORS, borderWidth: 2, borderColor:'#1e293b' }] },
            options: defaults
        });
    }

    // Approval status donut
    const approvalEl = document.getElementById('approvalChart');
    if (approvalEl) {
        const approved = blocks.filter(b=>b.status==='APPROVED').length;
        const rejected = blocks.filter(b=>b.status==='REJECTED').length;
        const pending  = blocks.filter(b=>!b.status||b.status==='PENDING').length;
        new Chart(approvalEl, {
            type: 'doughnut',
            data: { labels: ['Approved','Pending','Rejected'],
                    datasets:[{ data:[approved,pending,rejected],
                                backgroundColor:['#34d399','#fbbf24','#f87171'],
                                borderWidth:2, borderColor:'#1e293b' }] },
            options: { ...defaults, cutout:'58%' }
        });
    }

    // Trend line
    const trendEl = document.getElementById('trendChart');
    if (trendEl && trendLabels.length >= 2) {
        new Chart(trendEl, {
            type: 'line',
            data: { labels: trendLabels,
                    datasets: [{ label:'AI Lines', data: trendData,
                                 borderColor:'#38bdf8', backgroundColor:'rgba(56,189,248,.12)',
                                 tension:0.4, fill:true, pointBackgroundColor:'#38bdf8', pointRadius:4 }] },
            options: { ...defaults,
                scales: { x:{ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}},
                          y:{ticks:{color:'#94a3b8'},grid:{color:'#1e293b'}} } }
        });
    }
}

// ── Table ──────────────────────────────────────────────────────────────────
function applyFilters() {
    const emp    = document.getElementById('fEmployee')?.value.toLowerCase() || '';
    const from   = document.getElementById('fFrom')?.value || '';
    const to     = document.getElementById('fTo')?.value || '';
    const file   = document.getElementById('fFile')?.value.toLowerCase() || '';
    const risk   = document.getElementById('fRisk')?.value || '';
    const status = document.getElementById('fStatus')?.value || '';

    filteredBlocks = blocks.filter(b => {
        if (emp  && !b.employeeId.toLowerCase().includes(emp)) return false;
        if (file && !b.file.toLowerCase().includes(file))      return false;
        if (status && (b.status || 'PENDING') !== status)      return false;
        if (risk) {
            const isHigh = b.lines > threshold;
            const isMed  = b.lines > threshold*0.5 && !isHigh;
            if (risk==='high' && !isHigh) return false;
            if (risk==='med'  && !isMed)  return false;
            if (risk==='low'  && (isHigh||isMed)) return false;
        }
        if (from || to) {
            const [d,m,y] = b.date.split('-');
            const bd = \`\${y}-\${m}-\${d}\`;
            if (from && bd < from) return false;
            if (to   && bd > to)   return false;
        }
        return true;
    });
    currentPage = 1;
    renderTable();
}

function clearFilters() {
    ['fEmployee','fFrom','fTo','fFile','fRisk','fStatus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    applyFilters();
}

function sortBy(col) {
    if (sortCol===col) sortAsc=!sortAsc; else { sortCol=col; sortAsc=true; }
    filteredBlocks.sort((a,b) => {
        const map = [[0,0],[a.employeeId,b.employeeId],[a.date,b.date],[a.file,b.file],[a.lines,b.lines]];
        const [av,bv] = map[col]||[0,0];
        return av<bv ? (sortAsc?-1:1) : av>bv ? (sortAsc?1:-1) : 0;
    });
    renderTable();
}

function setPageSize() {
    pageSize = parseInt(document.getElementById('pageSize').value);
    currentPage = 1;
    renderTable();
}

function renderTable() {
    const total = filteredBlocks.length;
    const pages = Math.max(1, Math.ceil(total/pageSize));
    currentPage = Math.min(currentPage, pages);
    const start = (currentPage-1)*pageSize;
    const page  = filteredBlocks.slice(start, start+pageSize);

    document.getElementById('rowCount').textContent = \`\${total} records\`;
    document.getElementById('paginationInfo').textContent =
        \`Showing \${start+1}–\${Math.min(start+pageSize,total)} of \${total}\`;

    document.getElementById('tableBody').innerHTML = page.map((b,i) => {
        const isHigh  = b.lines > threshold;
        const isMed   = b.lines > threshold*0.5;
        const riskBadge = isHigh ? '<span class="badge badge-high">●HIGH</span>'
                        : isMed  ? '<span class="badge badge-med">●MED</span>'
                        :          '<span class="badge badge-low">●LOW</span>';
        const st = b.status||'PENDING';
        const statusBadge = st==='APPROVED' ? '<span class="badge badge-approved">✓ Approved</span>'
                          : st==='REJECTED' ? '<span class="badge badge-rejected">✕ Rejected</span>'
                          :                   '<span class="badge badge-pending">⏳ Pending</span>';
        const licBadge = b.licenseRisk?.detected
            ? \`<span class="badge badge-license">⚖\${b.licenseRisk.license||''}</span>\`
            : '—';
        const edited = b.editedBy?.length ? b.editedBy.join(', ') : '—';
        return \`<tr onclick="showDrawer(\${blocks.indexOf(b)})">
            <td>\${start+i+1}</td>
            <td><strong>\${b.employeeId}</strong></td>
            <td>\${b.date}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${b.file}">\${b.file}</td>
            <td>\${b.lines}</td>
            <td>\${riskBadge}</td>
            <td>\${statusBadge}</td>
            <td>\${licBadge}</td>
            <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${edited}">\${edited}</td>
        </tr>\`;
    }).join('');

    // Pagination
    const pc = document.getElementById('pageBtns');
    pc.innerHTML = '';
    const max=7; let s=Math.max(1,currentPage-3); let e=Math.min(pages,s+max-1);
    if (e-s<max-1) s=Math.max(1,e-max+1);
    if (s>1) { pc.innerHTML+=pageBtn(1); if(s>2) pc.innerHTML+='<span style="padding:0 3px;color:var(--muted)">…</span>'; }
    for (let p=s;p<=e;p++) pc.innerHTML+=pageBtn(p);
    if (e<pages) { if(e<pages-1) pc.innerHTML+='<span style="padding:0 3px;color:var(--muted)">…</span>'; pc.innerHTML+=pageBtn(pages); }
}

function pageBtn(p) {
    return \`<button class="page-btn \${p===currentPage?'active':''}" onclick="goPage(\${p})">\${p}</button>\`;
}
function goPage(p) { currentPage=p; renderTable(); }

function toggleCol(idx) {
    document.querySelectorAll(\`#mainTable th:nth-child(\${idx+1}),#mainTable td:nth-child(\${idx+1})\`)
        .forEach(el => { el.style.display = el.style.display==='none' ? '' : 'none'; });
}

// ── Drawer ─────────────────────────────────────────────────────────────────
function showDrawer(idx) {
    const b = blocks[idx]; if (!b) return;
    const isHigh = b.lines>threshold; const isMed=b.lines>threshold*0.5;
    const risk = isHigh ? '<span class="badge badge-high">● HIGH RISK</span>'
               : isMed  ? '<span class="badge badge-med">● MEDIUM</span>'
               :           '<span class="badge badge-low">● LOW</span>';
    const st = b.status||'PENDING';
    const statusBadge = st==='APPROVED' ? '<span class="badge badge-approved">✓ Approved</span>'
                      : st==='REJECTED' ? '<span class="badge badge-rejected">✕ Rejected</span>'
                      :                   '<span class="badge badge-pending">⏳ Pending</span>';

    document.getElementById('drawerTitle').textContent = b.file;
    document.getElementById('drawerBody').innerHTML = \`
      <div class="detail-row"><span class="detail-label">Employee</span><strong>\${b.employeeId}</strong></div>
      <div class="detail-row"><span class="detail-label">Created</span>\${b.date}</div>
      <div class="detail-row"><span class="detail-label">AI Lines</span>\${b.lines}</div>
      <div class="detail-row"><span class="detail-label">Risk</span>\${risk}</div>
      <div class="detail-row"><span class="detail-label">Approval</span>\${statusBadge}</div>
      \${b.reviewer ? \`<div class="detail-row"><span class="detail-label">Reviewer</span>\${b.reviewer}</div>\` : ''}
      \${b.hash ? \`<div class="detail-row"><span class="detail-label">Hash (SHA-256)</span><code style="font-size:.75rem;color:var(--accent)">\${b.hash}</code></div>\` : ''}
      \${b.licenseRisk?.detected ? \`<div class="detail-row"><span class="detail-label">License Risk</span><span class="badge badge-license">⚖ \${b.licenseRisk.license} (\${b.licenseRisk.risk})</span></div>\` : ''}
      \${canApprove && st==='PENDING' ? \`
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-success" onclick="approveBlock('\${b.file}','\${b.hash||''}','\${b.date}')">✓ Approve</button>
        <button class="btn btn-danger2" onclick="rejectBlock('\${b.file}','\${b.hash||''}','\${b.date}')">✕ Reject</button>
      </div>\` : ''}
      <div style="margin-top:18px;margin-bottom:6px;font-weight:600;font-size:.85rem">Edit Timeline</div>
      <div class="timeline">
        <div class="timeline-item">
          <div class="timeline-dot" style="background:var(--accent3)"></div>
          <div><div style="font-size:.83rem"><strong>\${b.employeeId}</strong> created block</div>
          <div style="font-size:.75rem;color:var(--muted)">\${b.date}</div></div>
        </div>
        \${(b.editedBy||[]).map(e => \`
        <div class="timeline-item">
          <div class="timeline-dot"></div>
          <div><div style="font-size:.83rem"><strong>\${e.split('(')[0].trim()}</strong> edited</div>
          <div style="font-size:.75rem;color:var(--muted)">\${(e.match(/\\(([^)]+)\\)/)||['',''])[1]}</div></div>
        </div>\`).join('')}
      </div>\`;

    document.getElementById('drawerOverlay').style.display = 'block';
    setTimeout(() => document.getElementById('drawer').classList.add('open'), 10);
}

function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    setTimeout(() => { document.getElementById('drawerOverlay').style.display = 'none'; }, 300);
}

// ── Employee Drill-Down ────────────────────────────────────────────────────
function showEmpDetail(id) {
    const eb = blocks.filter(b=>b.employeeId===id);
    const lines = eb.reduce((s,b)=>s+b.lines,0);
    const files = [...new Set(eb.map(b=>b.file))];
    const approved = eb.filter(b=>b.status==='APPROVED').length;
    const pending  = eb.filter(b=>!b.status||b.status==='PENDING').length;

    document.getElementById('drawerTitle').textContent = '👤 ' + id;
    document.getElementById('drawerBody').innerHTML = \`
      <div class="detail-row"><span class="detail-label">Total AI Lines</span><strong style="color:var(--accent)">\${lines}</strong></div>
      <div class="detail-row"><span class="detail-label">Blocks</span>\${eb.length}</div>
      <div class="detail-row"><span class="detail-label">Files</span>\${files.length}</div>
      <div class="detail-row"><span class="detail-label">Approved</span><span style="color:var(--accent3)">\${approved}</span></div>
      <div class="detail-row"><span class="detail-label">Pending</span><span style="color:var(--warn)">\${pending}</span></div>
      <div style="margin-top:14px;font-weight:600;font-size:.85rem;margin-bottom:6px">Files Touched</div>
      \${files.map(f => {
          const fl = eb.filter(b=>b.file===f).reduce((s,b)=>s+b.lines,0);
          return \`<div class="detail-row"><span class="detail-label" style="overflow:hidden;text-overflow:ellipsis">\${f}</span><span>\${fl} lines</span></div>\`;
      }).join('')}
      <div style="margin-top:14px;font-weight:600;font-size:.85rem;margin-bottom:6px">All Blocks</div>
      \${eb.map((b,i) => \`
      <div style="padding:8px 0;border-bottom:1px solid #1e293b;cursor:pointer;font-size:.82rem" onclick="closeDrawer();setTimeout(()=>showDrawer(\${blocks.indexOf(b)}),350)">
        <strong>#\${i+1}</strong> \${b.file} — \${b.lines} lines — \${b.date}
        <span class="badge \${b.status==='APPROVED'?'badge-approved':b.status==='REJECTED'?'badge-rejected':'badge-pending'}" style="margin-left:6px">\${b.status||'PENDING'}</span>
      </div>\`).join('')}\`;

    document.getElementById('drawerOverlay').style.display = 'block';
    setTimeout(() => document.getElementById('drawer').classList.add('open'), 10);
}

// ── Approval Actions ───────────────────────────────────────────────────────
function approveBlock(file, hash, date) {
    vscode.postMessage({ command:'approveBlock', file, hash, date });
    toast('Block approved ✓', 'success');
    closeDrawer();
}

function rejectBlock(file, hash, date) {
    vscode.postMessage({ command:'rejectBlock', file, hash, date });
    toast('Block rejected', 'warn');
    closeDrawer();
}

// ── Settings ───────────────────────────────────────────────────────────────
function addTeamRow() {
    const row = document.createElement('div');
    row.className = 'team-row';
    row.innerHTML = \`
      <input class="form-input emp-inp"  placeholder="Employee ID"/>
      <input class="form-input team-inp" placeholder="Team Name"/>
      <select class="form-input role-sel">
        <option>developer</option><option>teamlead</option><option>admin</option>
      </select>
      <button class="btn btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>\`;
    document.getElementById('teamRows').appendChild(row);
}

function saveSettings() {
    const threshold  = parseInt(document.getElementById('thresholdRange')?.value||'60');
    const anomalyMax = parseInt(document.getElementById('anomalyRange')?.value||'300');
    const requireApp = document.getElementById('requireApproval')?.value === 'true';
    const teamConfig = {}, roles = {};

    document.querySelectorAll('.team-row').forEach(row => {
        const emp  = row.querySelector('.emp-inp')?.value.trim();
        const team = row.querySelector('.team-inp')?.value.trim();
        const role = row.querySelector('.role-sel')?.value;
        if (emp && team) teamConfig[emp] = team;
        if (emp && role) roles[emp] = role;
    });

    const extVal = document.getElementById('extInput')?.value||'js,ts,jsx,tsx';
    const extensions = extVal.split(',').map(e=>e.trim()).filter(Boolean);

    vscode.postMessage({
        command:'saveSettings',
        threshold, teamConfig, extensions,
        policies: { requireApproval: requireApp, maxAILinesPerDayPerEmployee: anomalyMax },
        roles,
    });
    toast('Settings saved & written to .ai-annotator.json', 'success');
}

// ── Toast & Actions ────────────────────────────────────────────────────────
function toast(msg, type='success') {
    const t = document.createElement('div');
    t.className = \`toast \${type}\`;
    t.innerHTML = (type==='success'?'✓':type==='warn'?'⚠':'⚠') + ' ' + msg;
    document.getElementById('toastContainer').appendChild(t);
    setTimeout(()=>t.remove(), 3500);
}
function refresh()  { toast('Refreshing…'); vscode.postMessage({command:'refresh'}); }
function exportCSV(){ vscode.postMessage({command:'exportCSV', blocks:filteredBlocks}); }
function exportPDF(){ window.print(); }

window.addEventListener('message', e => {
    if (e.data.command === 'loading') toast('Loading data…');
});

// ── Init ───────────────────────────────────────────────────────────────────
initCharts();
applyFilters();
</script>
</body>
</html>`;
}
