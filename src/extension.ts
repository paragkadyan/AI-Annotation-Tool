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
  const config = getConfig();
  const employeeId = readEmployeeId(config.envFileName) ?? 'UNKNOWN';

  // ── Instantiate modules ──────────────────────────────────
  clipboardDetector = new ClipboardDetector();
  detectionEngine = new DetectionEngine(clipboardDetector, config);
  annotationWriter = new AnnotationWriter(employeeId, detectionEngine);
  statusBar = new StatusBarManager();
  statusBar.setEnabled(config.enabled);

  const log = detectionEngine.getLog();
  log.appendLine(`[STARTUP] Employee: ${employeeId}, MinChars: ${config.minCharsForDetection}`);

  // Wire: detection → annotation
  detectionEngine.onResult(async (result) => {
    try {
      await annotationWriter.annotate(result);
      statusBar.flashAnnotation();
    } catch (err) {
      log.appendLine(`[ERROR] Annotation failed: ${err}`);
    }
  });

  // ── Primary: Listen to text document changes ─────────────
  eventListener = new EventListener(detectionEngine);

  // ── Fallback: File system watcher ────────────────────────
  // Copilot Chat "auto-apply" may write files directly without
  // triggering onDidChangeTextDocument. This catches that.
  const fileWatcherDisposables = createFileWatchers(detectionEngine, log);

  // ── Also catch document save (Copilot might save after apply) ──
  const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') { return; }
    log.appendLine(`[SAVE] file="${doc.fileName}"`);
    // Re-process as file change after a short delay
    setTimeout(() => {
      detectionEngine.processFileChange(doc.uri);
    }, 300);
  });

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

  // Force-annotate command for testing
  const forceCmd = vscode.commands.registerCommand('aiAnnotator.forceAnnotate', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor');
      return;
    }
    log.appendLine(`[FORCE] Manual annotation triggered`);
    detectionEngine.processFileChange(editor.document.uri);
  });

  // ── React to config changes ──────────────────────────────
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('aiAnnotator')) { return; }
    const newCfg = getConfig();
    detectionEngine.updateConfig(newCfg);
    statusBar.setEnabled(newCfg.enabled);
    log.appendLine('[CONFIG] Configuration updated');
  });

  // ── Watch .env for changes ───────────────────────────────
  const envDisposables = createEnvWatcher(config.envFileName, log);

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
    forceCmd,
    configWatcher,
    saveWatcher,
    docCloseWatcher,
    ...envDisposables,
    ...fileWatcherDisposables,
  );

  log.appendLine('[STARTUP] AI Annotator fully activated');
  vscode.window.showInformationMessage(`AI Annotator active — Employee: ${employeeId}`);
}

export function deactivate(): void {
  console.log('[AI Annotator] Deactivated');
}

/**
 * Creates filesystem watchers for common code file extensions.
 * This is the fallback that catches Copilot Chat auto-apply.
 */
function createFileWatchers(
  engine: DetectionEngine,
  log: vscode.OutputChannel,
): vscode.Disposable[] {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return []; }

  const disposables: vscode.Disposable[] = [];

  // Watch common code file types
  const patterns = [
    '**/*.{js,ts,jsx,tsx}',
    '**/*.{py,rb,go,rs,java,kt,swift}',
    '**/*.{c,cpp,h,hpp,cs}',
    '**/*.{html,css,scss,less}',
    '**/*.{sql,sh,bash,ps1}',
    '**/*.{yaml,yml,json,xml}',
  ];

  for (const glob of patterns) {
    const pattern = new vscode.RelativePattern(folder, glob);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Debounce: track recently processed files
    const recent = new Map<string, number>();

    const handleFile = (uri: vscode.Uri) => {
      const key = uri.toString();
      const now = Date.now();
      const last = recent.get(key) ?? 0;

      // Skip if processed within last 2 seconds
      if (now - last < 2000) { return; }
      recent.set(key, now);

      // Skip .env, node_modules, etc.
      const path = uri.fsPath;
      if (path.includes('node_modules') ||
          path.includes('.git') ||
          path.endsWith('.env')) {
        return;
      }

      log.appendLine(`[FS_WATCH] File changed: ${uri.fsPath}`);

      // Delay to let VS Code finish writing
      setTimeout(() => {
        engine.processFileChange(uri);
      }, 500);
    };

    disposables.push(
      watcher,
      watcher.onDidChange(handleFile),
      watcher.onDidCreate(handleFile),
    );
  }

  log.appendLine(`[STARTUP] File watchers active for ${patterns.length} patterns`);
  return disposables;
}

function createEnvWatcher(
  envFileName: string,
  log: vscode.OutputChannel,
): vscode.Disposable[] {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return []; }

  const pattern = new vscode.RelativePattern(folder, envFileName);
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const reload = () => {
    const id = readEmployeeId(envFileName) ?? 'UNKNOWN';
    annotationWriter.setEmployeeId(id);
    log.appendLine(`[ENV] Reloaded — Employee: ${id}`);
  };

  return [watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload)];
}