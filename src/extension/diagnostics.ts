import * as vscode from 'vscode';
import { getIssueReporter, type DiagnosticsSnapshot } from '../issueReporter';
import { getOutputChannel, logLine } from '../shared/logger';
import type { ProviderConfig } from '../types';
import { resolveProviderApiKey } from '../provider/secrets';

export async function buildDiagnosticsSnapshot(
  context: vscode.ExtensionContext,
  providers: ProviderConfig[],
  modelCount: number
): Promise<DiagnosticsSnapshot> {
  let apiKeyConfigured = false;
  for (const p of providers) {
    const key = await resolveProviderApiKey(context.secrets, p);
    if (key.trim()) {
      apiKeyConfigured = true;
      break;
    }
  }

  const reporter = getIssueReporter();
  return {
    extensionVersion: context.extension.packageJSON.version ?? 'unknown',
    vscodeVersion: vscode.version,
    platform: `${process.platform} ${process.arch}`,
    providerCount: providers.length,
    modelCount,
    apiKeyConfigured,
    baseUrlConfigured: providers.some((p) => !!p.baseUrl),
    latestError: reporter.getLatestError(),
    recentLogs: reporter.getRecentLogs(),
  };
}

export function registerDiagnosticsCommands(
  context: vscode.ExtensionContext,
  getProviders: () => ProviderConfig[],
  getModelCount: () => number
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('custom-llm.showDiagnostics', async () => {
      const providers = getProviders();
      const snapshot = await buildDiagnosticsSnapshot(context, providers, getModelCount());
      const ch = getOutputChannel();
      ch.show(true);
      logLine('--- Diagnostics snapshot ---');
      logLine(`Providers: ${snapshot.providerCount}, Models: ${snapshot.modelCount}`);
      logLine(`API key: ${snapshot.apiKeyConfigured ? 'yes' : 'no'}`);
      if (snapshot.latestError) {
        logLine(`Latest error: ${snapshot.latestError.message}`);
      }
      vscode.window.showInformationMessage('Copilot Custom LLM: diagnostics written to Output panel.');
    }),
    vscode.commands.registerCommand('custom-llm.reportIssue', async () => {
      const providers = getProviders();
      const snapshot = await buildDiagnosticsSnapshot(context, providers, getModelCount());
      await getIssueReporter().openIssue(snapshot);
    }),
    vscode.commands.registerCommand('custom-llm.helpAndFeedback', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: '$(output) Show diagnostics', id: 'diag' },
          { label: '$(bug) Report issue on GitHub', id: 'issue' },
          { label: '$(book) Open documentation', id: 'docs' },
        ],
        { title: 'Copilot Custom LLM — Help & Feedback' }
      );
      if (!pick) return;
      if (pick.id === 'diag') {
        await vscode.commands.executeCommand('custom-llm.showDiagnostics');
      } else if (pick.id === 'issue') {
        await vscode.commands.executeCommand('custom-llm.reportIssue');
      } else {
        await vscode.env.openExternal(
          vscode.Uri.parse('https://github.com/syedsadiq27/copilot-custom-llm-provider#readme')
        );
      }
    })
  );
}
