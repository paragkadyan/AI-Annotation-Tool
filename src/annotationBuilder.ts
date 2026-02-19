import { CommentStyle } from './types';

/** The marker used to identify existing annotations (prevents doubles). */
export const ANNOTATION_MARKER = 'AI_ASSISTED: true';

/**
 * Maps VS Code language IDs to their comment syntax.
 * Falls back to `//` style for unknown languages.
 */
const COMMENT_STYLES: Record<string, CommentStyle> = {
  // C-family
  javascript:   { linePrefix: '//' },
  typescript:   { linePrefix: '//' },
  javascriptreact: { linePrefix: '//' },
  typescriptreact: { linePrefix: '//' },
  java:         { linePrefix: '//' },
  c:            { linePrefix: '//' },
  cpp:          { linePrefix: '//' },
  csharp:       { linePrefix: '//' },
  go:           { linePrefix: '//' },
  rust:         { linePrefix: '//' },
  swift:        { linePrefix: '//' },
  kotlin:       { linePrefix: '//' },
  dart:         { linePrefix: '//' },
  scala:        { linePrefix: '//' },
  php:          { linePrefix: '//' },

  // Hash-style
  python:       { linePrefix: '#' },
  ruby:         { linePrefix: '#' },
  shellscript:  { linePrefix: '#' },
  bash:         { linePrefix: '#' },
  perl:         { linePrefix: '#' },
  r:            { linePrefix: '#' },
  yaml:         { linePrefix: '#' },
  dockerfile:   { linePrefix: '#' },
  makefile:     { linePrefix: '#' },
  powershell:   { linePrefix: '#' },
  coffeescript: { linePrefix: '#' },
  elixir:       { linePrefix: '#' },

  // Dash-dash
  sql:          { linePrefix: '--' },
  lua:          { linePrefix: '--' },
  haskell:      { linePrefix: '--' },

  // Semicolon
  clojure:      { linePrefix: ';;' },
  lisp:         { linePrefix: ';;' },
  scheme:       { linePrefix: ';;' },

  // HTML / XML — use block comments
  html:         { linePrefix: '', blockStart: '<!--', blockEnd: '-->' },
  xml:          { linePrefix: '', blockStart: '<!--', blockEnd: '-->' },
  svg:          { linePrefix: '', blockStart: '<!--', blockEnd: '-->' },

  // CSS
  css:          { linePrefix: '', blockStart: '/*', blockEnd: '*/' },
  scss:         { linePrefix: '//' },
  less:         { linePrefix: '//' },

  // Other
  matlab:       { linePrefix: '%' },
  latex:        { linePrefix: '%' },
  erlang:       { linePrefix: '%' },
  fortran:      { linePrefix: '!' },
  vb:           { linePrefix: "'" },
};

const DEFAULT_STYLE: CommentStyle = { linePrefix: '//' };

/**
 * Builds the full annotation block for a given language.
 *
 * @param languageId  VS Code language identifier
 * @param employeeId  Value from .env (or "UNKNOWN")
 * @returns The annotation string including a trailing newline
 */
export function buildAnnotation(languageId: string, employeeId: string): string {
  const style = COMMENT_STYLES[languageId] ?? DEFAULT_STYLE;

  const lines = [
    `AI_ASSISTED: true`,
    `AI_TOOL: GitHub Copilot`,
    `EMPLOYEE_ID: ${employeeId}`,
  ];

  if (style.blockStart && style.blockEnd) {
    return [
      style.blockStart,
      ...lines.map(l => `  ${l}`),
      style.blockEnd,
      '',
    ].join('\n');
  }

  return lines.map(l => `${style.linePrefix} ${l}`).join('\n') + '\n';
}

/**
 * Checks whether the region immediately above `line` already has an annotation.
 * Scans up to 6 lines above for the marker.
 */
export function hasExistingAnnotation(
  getText: (line: number) => string,
  lineCount: number,
  targetLine: number,
): boolean {
  const scanStart = Math.max(0, targetLine - 6);
  for (let i = targetLine - 1; i >= scanStart; i--) {
    if (i >= lineCount) { continue; }
    if (getText(i).includes(ANNOTATION_MARKER)) {
      return true;
    }
  }
  return false;
}