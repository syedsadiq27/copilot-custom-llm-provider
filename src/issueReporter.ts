import * as vscode from 'vscode';

const GITHUB_REPO_URL = 'https://github.com/syedsadiq27/copilot-custom-llm-provider/issues/new';
const MAX_LOG_ENTRIES = 50;
const MAX_BODY_LENGTH = 1500;
const MAX_URL_LENGTH = 8000;

export interface ErrorContext {
  source: string;
  message: string;
  stack?: string;
  timestamp: string;
}

export interface DiagnosticsSnapshot {
  extensionVersion: string;
  vscodeVersion: string;
  platform: string;
  providerCount: number;
  modelCount: number;
  apiKeyConfigured: boolean;
  baseUrlConfigured: boolean;
  latestError?: ErrorContext;
  recentLogs: string[];
}

export class IssueReporter {
  private _logBuffer: string[] = [];
  private _latestError?: ErrorContext;

  appendLog(message: string): void {
    this._logBuffer.push(message);
    if (this._logBuffer.length > MAX_LOG_ENTRIES) {
      this._logBuffer.shift();
    }
  }

  recordError(source: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this._latestError = { source, message, stack, timestamp: new Date().toISOString() };
  }

  getLatestError(): ErrorContext | undefined {
    return this._latestError;
  }

  getRecentLogs(): string[] {
    return [...this._logBuffer];
  }

  buildIssueUrl(snapshot: DiagnosticsSnapshot): string {
    const title = snapshot.latestError
      ? `[Bug] ${snapshot.latestError.source}: ${redactSecrets(snapshot.latestError.message.split('\n')[0]).slice(0, 80)}`
      : '[Bug] Copilot Custom LLM Provider';

    let body = this.buildBody(snapshot);
    if (body.length > MAX_BODY_LENGTH) {
      body = body.slice(0, MAX_BODY_LENGTH) + '\n\n...(truncated)';
    }

    const params = new URLSearchParams({ title, body });
    let url = `${GITHUB_REPO_URL}?${params.toString()}`;
    if (url.length > MAX_URL_LENGTH) {
      body = body.slice(0, 800) + '\n\n...(truncated)';
      url = `${GITHUB_REPO_URL}?${new URLSearchParams({ title, body }).toString()}`;
    }
    return url;
  }

  buildBody(snapshot: DiagnosticsSnapshot): string {
    const lines = [
      '## Environment',
      `- Extension: ${snapshot.extensionVersion}`,
      `- VS Code: ${snapshot.vscodeVersion}`,
      `- Platform: ${snapshot.platform}`,
      `- Providers: ${snapshot.providerCount}`,
      `- Models: ${snapshot.modelCount}`,
      `- API key configured: ${snapshot.apiKeyConfigured}`,
      `- Base URL configured: ${snapshot.baseUrlConfigured}`,
    ];
    if (snapshot.latestError) {
      lines.push('', '## Latest error', `- Source: ${snapshot.latestError.source}`);
      lines.push(`- Message: ${redactSecrets(snapshot.latestError.message)}`);
    }
    if (snapshot.recentLogs.length > 0) {
      lines.push('', '## Recent logs', '```', ...snapshot.recentLogs.slice(-20).map(redactSecrets), '```');
    }
    return lines.join('\n');
  }

  async openIssue(snapshot: DiagnosticsSnapshot): Promise<void> {
    const fullBody = this.buildBody(snapshot);
    const url = this.buildIssueUrl(snapshot);
    if (fullBody.length > MAX_BODY_LENGTH) {
      await vscode.env.clipboard.writeText(fullBody);
    }
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(Bearer\s+)\S+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key[=:\s]+)\S+/gi, '$1[REDACTED]')
    .replace(/(sk-[a-zA-Z0-9]{4})[a-zA-Z0-9]+/g, '$1[REDACTED]');
}

let _reporter: IssueReporter | undefined;

export function getIssueReporter(): IssueReporter {
  if (!_reporter) {
    _reporter = new IssueReporter();
  }
  return _reporter;
}
