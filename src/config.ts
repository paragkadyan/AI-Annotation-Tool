import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AnnotatorConfig } from './types';

const SECTION = 'aiAnnotator';

/**
 * Reads extension configuration from VS Code settings.
 */
export function getConfig(): AnnotatorConfig {
  const cfg = vscode.workspace.getConfiguration(SECTION);
  return {
    enabled: cfg.get<boolean>('enabled', true),
    charsPerSecondThreshold: cfg.get<number>('charsPerSecondThreshold', 10),
    minCharsForDetection: cfg.get<number>('minCharsForDetection', 8),
    envFileName: cfg.get<string>('envFileName', '.env'),
  };
}

/**
 * Parses a .env file into a key-value map.
 * Handles quoted values, inline comments, and blank lines.
 */
function parseEnvFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) { continue; }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) { continue; }

    const key = line.substring(0, eqIdx).trim();
    let val = line.substring(eqIdx + 1).trim();

    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    // Strip inline comment (only if not inside quotes originally)
    const commentIdx = val.indexOf(' #');
    if (commentIdx !== -1) {
      val = val.substring(0, commentIdx).trim();
    }

    result.set(key, val);
  }
  return result;
}

/**
 * Resolves the EMPLOYEE_ID from the .env file in the workspace root.
 * Returns undefined if not found, with a warning logged.
 */
export function readEmployeeId(envFileName: string): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage(
      'AI Annotator: No workspace folder open. Cannot read .env file.'
    );
    return undefined;
  }

  // Search all workspace roots; first match wins
  for (const folder of folders) {
    const envPath = path.join(folder.uri.fsPath, envFileName);
    if (!fs.existsSync(envPath)) { continue; }

    try {
      const content = fs.readFileSync(envPath, 'utf-8');
      const vars = parseEnvFile(content);
      const id = vars.get('EMPLOYEE_ID');
      if (id) { return id; }
    } catch (err) {
      console.error(`AI Annotator: Failed to read ${envPath}:`, err);
    }
  }

  vscode.window.showWarningMessage(
    `AI Annotator: EMPLOYEE_ID not found in ${envFileName}. Annotations will use "UNKNOWN".`
  );
  return undefined;
}