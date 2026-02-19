import * as vscode from 'vscode';
import { getConfig, readEmployeeId } from './config';
import { ClipboardDetector } from './clipboardDetector';
import { DetectionEngine } from './detectionEngine';
import { EventListener } from './eventListener';
import { AnnotationWriter } from './annotationWriter';
import { StatusBarManager } from './statusBar';

let clipboardDetector: ClipboardDetector;
let detectionEngine: DetectionEngine;
let eventListener: EventListener;
let annotationWriter: AnnotationWriter;
let statusBar: StatusBarManager;

export function activate(ctx: vscode.ExtensionContext): void {
  console.log('[AI Annotator] Activating…');

  const config = getConfig();
  const employeeId = readEmployeeId(config.envFileName) ?? 'UNKNOWN';

  // ── Instantiate modules ──────────────────────────────────
  clipboardDetector = new ClipboardDetector();
  detectionEngine = new DetectionEngine(clipboardDetector, config);
  annotationWriter = new AnnotationWriter(employeeId, detectionEngine);
  statusBar = new StatusBarManager();
  statusBar.setEnabled(config.enabled);

  // Wire: detection → annotation
  detectionEngine.onResult(async (result) => {
    try {
      await annotationWriter.annotate(result);
      statusBar.flashAnnotation();
    } catch (err) {
      console.error('[AI Annotator] Annotation failed:', err);
    }
  });

  // Start listening
  eventListener = new EventListener(detectionEngine);

  // ── Commands ─────────────────────────────────────────────
  const toggleCmd = vscode.commands.registerCommand('aiAnnotator.toggle', () => {
    const cfg = vscode.workspace.getConfiguration('aiAnnotator');
    const current = cfg.get<boolean>('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(
      `AI Annotator: ${!current ? 'ENABLED' : 'DISABLED'}`
    );
  });

  const statusCmd = vscode.commands.registerCommand('aiAnnotator.status', () => {
    const cfg = getConfig();
    const id = readEmployeeId(cfg.envFileName) ?? 'UNKNOWN';
    vscode.window.showInformationMessage(
      `AI Annotator: ${cfg.enabled ? 'ACTIVE' : 'DISABLED'} | ` +
      `Min chars: ${cfg.minCharsForDetection} | Employee: ${id}`
    );
  });

  // ── React to config changes ──────────────────────────────
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('aiAnnotator')) { return; }
    const newCfg = getConfig();
    detectionEngine.updateConfig(newCfg);
    statusBar.setEnabled(newCfg.enabled);
    console.log('[AI Annotator] Configuration updated');
  });

  // ── Watch .env for changes ───────────────────────────────
  const envDisposables = createEnvWatcher(config.envFileName);

  // ── Cleanup on document close ────────────────────────────
  const docCloseWatcher = vscode.workspace.onDidCloseTextDocument((doc) => {
    annotationWriter.onDocumentClosed(doc.uri.toString());
  });

  // ── Push all disposables ─────────────────────────────────
  ctx.subscriptions.push(
    clipboardDetector,
    eventListener,
    statusBar,
    toggleCmd,
    statusCmd,
    configWatcher,
    docCloseWatcher,
    ...envDisposables,
  );

  console.log(
    `[AI Annotator] Active — Employee: ${employeeId}, ` +
    `MinChars: ${config.minCharsForDetection}`
  );
  vscode.window.showInformationMessage('AI Annotator is active');
}

export function deactivate(): void {
  console.log('[AI Annotator] Deactivated');
}

function createEnvWatcher(envFileName: string): vscode.Disposable[] {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return []; }

  const pattern = new vscode.RelativePattern(folder, envFileName);
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const reload = () => {
    const id = readEmployeeId(envFileName) ?? 'UNKNOWN';
    annotationWriter.setEmployeeId(id);
    console.log(`[AI Annotator] .env reloaded — Employee: ${id}`);
  };

  return [watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload)];
}