import * as vscode from 'vscode';
import { getIssueReporter } from '../issueReporter';

let _logChannel: vscode.OutputChannel | undefined;

function channel(): vscode.OutputChannel {
  if (!_logChannel) {
    _logChannel = vscode.window.createOutputChannel('Copilot Custom LLM');
  }
  return _logChannel;
}

export function logLine(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  channel().appendLine(line);
  getIssueReporter().appendLog(line);
}

export function getOutputChannel(): vscode.OutputChannel {
  return channel();
}
