import * as vscode from 'vscode';

export enum InsertionClassification {
  HUMAN = 'HUMAN',
  AI_LIKELY = 'AI_LIKELY',
  PASTED = 'PASTED',
  IGNORED = 'IGNORED',
}

export interface DetectionResult {
  readonly classification: InsertionClassification;
  readonly document: vscode.TextDocument;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

export interface AnnotatorConfig {
  readonly enabled: boolean;
  readonly charsPerSecondThreshold: number;
  readonly minCharsForDetection: number;
  readonly envFileName: string;
}

export interface CommentStyle {
  readonly linePrefix: string;
  readonly blockStart?: string;
  readonly blockEnd?: string;
}