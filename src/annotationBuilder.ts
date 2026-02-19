import { CommentStyle } from './types';

/** Marker to identify the START of an AI annotation block. */
export const ANNOTATION_MARKER = 'AI_ASSISTED: true';

/** Marker to identify the END of an AI annotation block. */
export const ANNOTATION_END_MARKER = 'AI_ASSISTED_END';

const COMMENT_STYLES: Record<string, CommentStyle> = {
  // C-family
  javascript:      { linePrefix: '//' },
  typescript:      { linePrefix: '//' },
  javascriptreact: { linePrefix: '//' },
  typescriptreact: { linePrefix: '//' },
  java:            { linePrefix: '//' },
  c:               { linePrefix: '//' },
  cpp:             { linePrefix: '//' },
  csharp:          { linePrefix: '//' },
  go:              { linePrefix: '//' },
  rust:            { linePrefix: '//' },
  swift:           { linePrefix: '//' },
  kotlin:          { linePrefix: '//' },
  dart:            { linePrefix: '//' },
  scala:           { linePrefix: '//' },
  php:             { linePrefix: '//' },

  // Hash-style
  python:          { linePrefix: '#' },
  ruby:            { linePrefix: '#' },
  shellscript:     { linePrefix: '#' },
  bash:            { linePrefix: '#' },
  perl:            { linePrefix: '#' },
  r:               { linePrefix: '#' },
  yaml:            { linePrefix: '#' },
  dockerfile:      { linePrefix: '#' },
  makefile:        { linePrefix: '#' },
  powershell:      { linePrefix: '#' },
  coffeescript:    { linePrefix: '#' },
  elixir:          { linePrefix: '#' },

  // Dash-dash
  sql:             { linePrefix: '--' },
  lua:             { linePrefix: '--' },
  haskell:         { linePrefix: '--' },

  // Semicolon
  clojure:         { linePrefix: ';;' },
  lisp:            { linePrefix: ';;' },
  scheme:          { linePrefix: ';;' },

  // Block comments only
  html:            { linePrefix: '', blockStart: '<!--', blockEnd: '-->' },
  xml:             { linePrefix: '', blockStart: '<!--', blockEnd: '-->' },
  svg:             { linePrefix: '', blockStart: '<!--', blockEnd: '-->' },
  css:             { linePrefix: '', blockStart: '/*', blockEnd: '*/' },

  // Other
  scss:            { linePrefix: '//' },
  less:            { linePrefix: '//' },
  matlab:          { linePrefix: '%' },
  latex:           { linePrefix: '%' },
  erlang:          { linePrefix: '%' },
  fortran:         { linePrefix: '!' },
  vb:              { linePrefix: "'" },
};

const DEFAULT_STYLE: CommentStyle = { linePrefix: '//' };

/**
 * Builds the START annotation block to insert BEFORE the AI code.
 */
export function buildAnnotationStart(languageId: string, employeeId: string): string {
  const style = COMMENT_STYLES[languageId] ?? DEFAULT_STYLE;

  const lines = [
    'AI_ASSISTED: true',
    'AI_TOOL: GitHub Copilot',
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
 * Builds the END annotation marker to insert AFTER the AI code.
 */
export function buildAnnotationEnd(languageId: string): string {
  const style = COMMENT_STYLES[languageId] ?? DEFAULT_STYLE;

  if (style.blockStart && style.blockEnd) {
    return `${style.blockStart} AI_ASSISTED_END ${style.blockEnd}\n`;
  }

  return `${style.linePrefix} AI_ASSISTED_END\n`;
}

/**
 * Checks whether the region near `targetLine` already has a start annotation.
 * Scans up to 6 lines above for the marker.
 */
export function hasExistingAnnotation(
  getText: (line: number) => string,
  lineCount: number,
  targetLine: number,
): boolean {
  const scanStart = Math.max(0, targetLine - 6);
  for (let i = targetLine; i >= scanStart; i--) {
    if (i >= lineCount) { continue; }
    const line = getText(i);
    if (line.includes(ANNOTATION_MARKER) || line.includes(ANNOTATION_END_MARKER)) {
      return true;
    }
  }
  return false;
}