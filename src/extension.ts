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

  // ── Instantiate modules ──
  clipboardDetector = new ClipboardDetector();
  detectionEngine = new DetectionEngine(clipboardDetector, config);
  annotationWriter = new AnnotationWriter(employeeId, detectionEngine);
  statusBar = new StatusBarManager();
  statusBar.setEnabled(config.enabled);

  const log = detectionEngine.getLog();
  log.appendLine(`[STARTUP] Employee: ${employeeId}`);

  // Wire: detection → annotation
  detectionEngine.onResult(async (result) => {
    try {
      await annotationWriter.annotate(result);
      statusBar.flashAnnotation();
    } catch (err) {
      log.appendLine(`[ERROR] ${err}`);
    }
  });

  // ── Primary: text document change listener ──
  eventListener = new EventListener(detectionEngine);

  // ── Snapshot: track file content before AI edits ──
  // Snapshot on open
  const openWatcher = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.uri.scheme === 'file') {
      annotationWriter.takeSnapshot(doc.uri.toString(), doc.getText());
    }
  });

  // Snapshot all currently open files
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file') {
      annotationWriter.takeSnapshot(doc.uri.toString(), doc.getText());
    }
  }

  // Snapshot on manual save (human-initiated saves update the "before" state)
  // We use a flag: only snapshot if the save was NOT triggered by our annotation writer
  const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') { return; }
    const uri = doc.uri.toString();

    // If this doc is currently suppressed, it means WE just saved it
    // after annotating — don't update the snapshot
    if (detectionEngine.suppressedDocs.has(uri)) { return; }

    annotationWriter.takeSnapshot(uri, doc.getText());
    log.appendLine(`[SNAPSHOT] Updated snapshot for ${doc.fileName}`);
  });

  // Snapshot on editor focus change (user switches tabs)
  const editorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (!editor) { return; }
    const doc = editor.document;
    if (doc.uri.scheme === 'file' && !detectionEngine.suppressedDocs.has(doc.uri.toString())) {
      annotationWriter.takeSnapshot(doc.uri.toString(), doc.getText());
    }
  });

  // ── Fallback: File system watcher ──
  const fileWatcherDisposables = createFileWatchers(detectionEngine, log);

  // ── Also detect on save (Copilot Chat may save after apply) ──
  const saveDetectWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (doc.uri.scheme !== 'file') { return; }
    if (detectionEngine.suppressedDocs.has(doc.uri.toString())) { return; }

    log.appendLine(`[SAVE] file="${doc.fileName}"`);
    setTimeout(() => {
      detectionEngine.processFileChange(doc.uri);
    }, 500);
  });

  // ── Commands ──
  const toggleCmd = vscode.commands.registerCommand('aiAnnotator.toggle', () => {
    const cfg = vscode.workspace.getConfiguration('aiAnnotator');
    const current = cfg.get<boolean>('enabled', true);
    cfg.update('enabled', !current, vscode.ConfigurationTarget.Workspace);
    vscode.window.showInformationMessage(`AI Annotator: ${!current ? 'ENABLED' : 'DISABLED'}`);
  });

  const statusCmd = vscode.commands.registerCommand('aiAnnotator.status', () => {
    const cfg = getConfig();
    const id = readEmployeeId(cfg.envFileName) ?? 'UNKNOWN';
    vscode.window.showInformationMessage(
      `AI Annotator: ${cfg.enabled ? 'ACTIVE' : 'DISABLED'} | Min chars: ${cfg.minCharsForDetection} | Employee: ${id}`
    );
  });

  const forceCmd = vscode.commands.registerCommand('aiAnnotator.forceAnnotate', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    log.appendLine(`[FORCE] Manual trigger`);
    detectionEngine.processFileChange(editor.document.uri);
  });

  // ── Config watcher ──
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('aiAnnotator')) { return; }
    const newCfg = getConfig();
    detectionEngine.updateConfig(newCfg);
    statusBar.setEnabled(newCfg.enabled);
  });

  // ── .env watcher ──
  const envDisposables = createEnvWatcher(config.envFileName, log);

  // ── Document close cleanup ──
  const docCloseWatcher = vscode.workspace.onDidCloseTextDocument((doc) => {
    annotationWriter.onDocumentClosed(doc.uri.toString());
  });

  // ── Register all ──
  ctx.subscriptions.push(
    clipboardDetector,
    eventListener,
    statusBar,
    openWatcher,
    saveWatcher,
    editorWatcher,
    saveDetectWatcher,
    toggleCmd,
    statusCmd,
    forceCmd,
    configWatcher,
    docCloseWatcher,
    ...envDisposables,
    ...fileWatcherDisposables,
  );

  log.appendLine('[STARTUP] AI Annotator activated');
  vscode.window.showInformationMessage(`AI Annotator active — Employee: ${employeeId}`);
}

export function deactivate(): void {
  console.log('[AI Annotator] Deactivated');
}

function createFileWatchers(engine: DetectionEngine, log: vscode.OutputChannel): vscode.Disposable[] {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) { return []; }

  const disposables: vscode.Disposable[] = [];
  const patterns = [
    '**/*.{js,ts,jsx,tsx,py,rb,go,rs,java,kt,swift}',
    '**/*.{c,cpp,h,hpp,cs,html,css,scss,less}',
    '**/*.{sql,sh,bash,ps1,yaml,yml,json,xml}',
  ];

  for (const glob of patterns) {
    const pattern = new vscode.RelativePattern(folder, glob);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const recent = new Map<string, number>();

    const handle = (uri: vscode.Uri) => {
      const k = uri.toString();
      const now = Date.now();
      if (now - (recent.get(k) ?? 0) < 3000) { return; }
      recent.set(k, now);

      if (uri.fsPath.includes('node_modules') || uri.fsPath.includes('.git')) { return; }
      if (engine.suppressedDocs.has(k)) { return; }

      log.appendLine(`[FS_WATCH] ${uri.fsPath}`);
      setTimeout(() => engine.processFileChange(uri), 600);
    };

    disposables.push(watcher, watcher.onDidChange(handle), watcher.onDidCreate(handle));
  }

  return disposables;
}

function createEnvWatcher(envFileName: string, log: vscode.OutputChannel): vscode.Disposable[] {
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