import * as vscode from 'vscode';
import { CustomLlmProvider } from './provider';
import { registerChatParticipant } from './participant';
import { registerDiagnosticsCommands } from './extension/diagnostics';
import { fetchModelsForProvider, normalizeModelConfig } from './extension/discovery';
import {
  migrateApiKeysToSecrets,
  setProviderApiKey,
  deleteProviderApiKey,
  resolveProviderApiKey,
} from './provider/secrets';
import { buildExposedModelId } from './provider/route';
import type { ProviderConfig, ModelConfig } from './types';

export type { ProviderConfig, ModelConfig } from './types';

const DEFAULT_PROVIDER: Omit<ProviderConfig, 'id'> = {
  name: 'Alibaba DashScope',
  baseUrl: 'https://coding-intl.dashscope.aliyuncs.com/v1',
};

const DEFAULT_MODELS_RAW = [
  { name: 'Qwen3 Coder Plus', rawModelId: 'qwen3-coder-plus', maxInputTokens: 131072, maxOutputTokens: 16384, toolCalling: true, imageInput: false },
  { name: 'Qwen3.6 Plus', rawModelId: 'qwen3.6-plus', maxInputTokens: 1000000, maxOutputTokens: 65536, toolCalling: true, imageInput: false },
];

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function uniqueSlug(name: string, existingIds: string[]): string {
  const base = toSlug(name);
  if (!existingIds.includes(base)) return base;
  for (let i = 2; i < 100; i++) {
    const c = `${base}-${i}`;
    if (!existingIds.includes(c)) return c;
  }
  return `${base}-${Date.now()}`;
}

function getProviders(): ProviderConfig[] {
  const raw = vscode.workspace.getConfiguration('customLlm').get<Partial<ProviderConfig>[]>('providers') ?? [];
  const existingIds: string[] = raw.filter((p) => p.id).map((p) => p.id!);
  return raw.map((p) => {
    if (p.id) return p as ProviderConfig;
    const id = uniqueSlug(p.name ?? 'provider', existingIds);
    existingIds.push(id);
    return { ...p, id } as ProviderConfig;
  });
}

async function saveProviders(providers: ProviderConfig[]): Promise<void> {
  const stripped = providers.map(({ apiKey: _k, ...rest }) => rest);
  await vscode.workspace.getConfiguration('customLlm').update('providers', stripped, vscode.ConfigurationTarget.Global);
}

function getModels(): ModelConfig[] {
  const count = getProviders().length;
  const raw = vscode.workspace.getConfiguration('customLlm').get<ModelConfig[]>('models') ?? [];
  return raw.map((m) => normalizeModelConfig(m, count));
}

async function saveModels(models: ModelConfig[]): Promise<void> {
  await vscode.workspace.getConfiguration('customLlm').update('models', models, vscode.ConfigurationTarget.Global);
}

async function migrateLegacySettings(secrets: vscode.SecretStorage): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('customLlm');
  const legacyUrl: string = cfg.get('baseUrl') ?? '';
  const legacyKey: string = cfg.get('apiKey') ?? '';
  if (!legacyUrl && !legacyKey) return;

  const providers = getProviders();
  if (providers.length > 0) {
    await cfg.update('baseUrl', undefined, vscode.ConfigurationTarget.Global);
    await cfg.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
    return;
  }

  const name = legacyUrl.includes('dashscope') ? 'Alibaba DashScope' : 'Custom Provider';
  const id = toSlug(name);
  const provider: ProviderConfig = { id, name, baseUrl: legacyUrl || DEFAULT_PROVIDER.baseUrl };
  if (legacyKey) await setProviderApiKey(secrets, id, legacyKey);
  await saveProviders([provider]);
  await cfg.update('baseUrl', undefined, vscode.ConfigurationTarget.Global);
  await cfg.update('apiKey', undefined, vscode.ConfigurationTarget.Global);
}

async function migrateToSlugIds(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('customLlm');
  const rawProviders = cfg.get<any[]>('providers') ?? [];
  const rawModels = cfg.get<any[]>('models') ?? [];
  const needsProvider = rawProviders.some((p) => !p.id);
  const needsModel = rawModels.some((m) => m.providerUrl && !m.providerId);
  if (!needsProvider && !needsModel) return;

  const existingIds: string[] = rawProviders.filter((p) => p.id).map((p) => p.id);
  const migratedProviders = rawProviders.map((p) => {
    if (p.id) return p;
    const id = uniqueSlug(p.name ?? 'provider', existingIds);
    existingIds.push(id);
    return { ...p, id };
  });
  if (needsProvider) {
    await cfg.update('providers', migratedProviders, vscode.ConfigurationTarget.Global);
  }
  if (needsModel) {
    const urlToId = new Map(migratedProviders.map((p: any) => [p.baseUrl, p.id]));
    const migratedModels = rawModels.map((m) => {
      if (!m.providerUrl || m.providerId) return m;
      const { providerUrl, ...rest } = m;
      return { ...rest, providerId: urlToId.get(providerUrl) ?? '' };
    });
    await cfg.update('models', migratedModels, vscode.ConfigurationTarget.Global);
  }
}

async function discoverAllModels(context: vscode.ExtensionContext, silent = false): Promise<void> {
  const providers = await migrateApiKeysToSecrets(context.secrets, getProviders());
  const count = providers.length;

  if (count === 0) {
    if (getModels().length === 0) {
      const defaultProviderId = toSlug(DEFAULT_PROVIDER.name);
      const models = DEFAULT_MODELS_RAW.map((m) =>
        normalizeModelConfig({
          ...m,
          id: buildExposedModelId(m.rawModelId, defaultProviderId, 1),
          providerId: defaultProviderId,
        } as ModelConfig, 1)
      );
      await saveModels(models);
    }
    return;
  }

  const results = await Promise.all(
    providers.map((p) => fetchModelsForProvider(p, context.secrets, count))
  );

  const merged = new Map(getModels().map((m) => [m.id, m]));
  let discovered = 0;
  for (const list of results) {
    if (!list) continue;
    for (const m of list) {
      merged.set(m.id, m);
      discovered++;
    }
  }
  await saveModels([...merged.values()]);

  if (!silent && discovered > 0) {
    vscode.window.showInformationMessage(
      `Custom LLM: ${discovered} models loaded from ${providers.map((p) => p.name).join(', ')}`
    );
  }
}

async function cleanupLegacyByokEntries(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('github.copilot.chat');
  const existing = cfg.get<Record<string, object>>('customOAIModels');
  if (!existing) return;
  const ourIds = new Set(getModels().map((m) => m.id));
  const cleaned: Record<string, object> = {};
  let removed = 0;
  for (const [id, val] of Object.entries(existing)) {
    if (ourIds.has(id)) removed++;
    else cleaned[id] = val;
  }
  if (removed === 0) return;
  try {
    await cfg.update('customOAIModels', cleaned, vscode.ConfigurationTarget.Global);
  } catch { /* ignore */ }
}

async function providerHasApiKey(context: vscode.ExtensionContext, p: ProviderConfig): Promise<boolean> {
  return !!(await resolveProviderApiKey(context.secrets, p)).trim();
}

async function promptForApiKey(
  context: vscode.ExtensionContext,
  providerName: string,
  providerId: string
): Promise<string | undefined> {
  const mask = vscode.workspace.getConfiguration('customLlm').get('maskApiKeyInput', true);
  const current = await resolveProviderApiKey(context.secrets, { id: providerId, name: providerName, baseUrl: '' });
  return vscode.window.showInputBox({
    title: `API Key for "${providerName}"`,
    prompt: 'Paste your API key (stored securely, not in settings.json).',
    placeHolder: 'sk-...',
    password: mask,
    value: current ? '••••••••' : '',
    ignoreFocusOut: true,
  });
}

async function cmdAddProvider(context: vscode.ExtensionContext, provider?: CustomLlmProvider): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 200));

  const name = await vscode.window.showInputBox({
    title: 'Add provider',
    prompt: 'e.g. Alibaba DashScope or OpenRouter',
    ignoreFocusOut: true,
  });
  if (!name) return;

  const baseUrl = await vscode.window.showInputBox({
    title: 'Base URL',
    prompt: 'OpenAI-compatible URL ending with /v1',
    placeHolder: 'https://coding-intl.dashscope.aliyuncs.com/v1',
    ignoreFocusOut: true,
  });
  if (!baseUrl) return;

  const providers = getProviders();
  const idx = providers.findIndex((p) => p.baseUrl === baseUrl);
  const id = idx >= 0 ? providers[idx].id : uniqueSlug(name, providers.map((p) => p.id));

  const apiKeyInput = await promptForApiKey(context, name, id);
  if (apiKeyInput === undefined) return;
  const apiKey = apiKeyInput === '••••••••' ? await resolveProviderApiKey(context.secrets, { id, name, baseUrl }) : apiKeyInput;
  if (apiKey) await setProviderApiKey(context.secrets, id, apiKey);

  if (idx >= 0) {
    providers[idx] = { id, name, baseUrl };
  } else {
    providers.push({ id, name, baseUrl });
  }
  await saveProviders(providers);
  await discoverAllModels(context, false);
  await cleanupLegacyByokEntries();
  provider?.notifyModelsChanged();
}

async function cmdManageProviders(context: vscode.ExtensionContext, provider: CustomLlmProvider): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 200));
  const providers = getProviders();
  if (providers.length === 0) {
    await cmdAddProvider(context, provider);
    return;
  }

  const items = [
    ...await Promise.all(providers.map(async (p, i) => ({
      label: p.name,
      description: p.baseUrl,
      detail: (await providerHasApiKey(context, p)) ? 'API key set (secret storage)' : 'No API key',
      index: i,
    }))),
    { label: '$(add) Add new provider', description: '', detail: '', index: -1 },
  ];

  const pick = await vscode.window.showQuickPick(items, { title: 'Manage providers' });
  if (!pick) return;
  if (pick.index === -1) {
    await cmdAddProvider(context, provider);
    return;
  }

  const action = await vscode.window.showQuickPick(
    ['Edit name', 'Edit endpoint URL', 'Edit API key', 'Remove'],
    { title: `Provider: ${pick.label}` }
  );
  if (!action) return;

  const p = providers[pick.index];
  if (action === 'Remove') {
    providers.splice(pick.index, 1);
    await deleteProviderApiKey(context.secrets, p.id);
    await saveProviders(providers);
    await saveModels(getModels().filter((m) => m.providerId !== p.id));
    vscode.window.showInformationMessage(`Provider "${pick.label}" removed.`);
  } else if (action === 'Edit name') {
    const newName = await vscode.window.showInputBox({ title: 'Edit name', value: p.name, ignoreFocusOut: true });
    if (newName === undefined) return;
    providers[pick.index].name = newName;
    await saveProviders(providers);
  } else if (action === 'Edit endpoint URL') {
    const newUrl = await vscode.window.showInputBox({ title: 'Edit URL', value: p.baseUrl, ignoreFocusOut: true });
    if (newUrl === undefined) return;
    providers[pick.index].baseUrl = newUrl;
    await saveProviders(providers);
    await discoverAllModels(context, true);
  } else {
    const key = await promptForApiKey(context, p.name, p.id);
    if (key === undefined) return;
    if (key !== '••••••••') await setProviderApiKey(context.secrets, p.id, key);
    await discoverAllModels(context, true);
  }

  await cleanupLegacyByokEntries();
  provider.notifyModelsChanged();
}

async function cmdTestConnection(context: vscode.ExtensionContext): Promise<void> {
  const providers = getProviders();
  if (providers.length === 0) {
    vscode.window.showWarningMessage('No providers configured.', 'Add provider').then((c) => {
      if (c) vscode.commands.executeCommand('custom-llm.addProvider');
    });
    return;
  }

  let selected = providers[0];
  if (providers.length > 1) {
    const pick = await vscode.window.showQuickPick(
      await Promise.all(providers.map(async (p, i) => ({
        label: p.name,
        description: p.baseUrl,
        detail: (await providerHasApiKey(context, p)) ? 'API key set' : 'No API key',
        index: i,
      }))),
      { title: 'Test connection' }
    );
    if (!pick) return;
    selected = providers[pick.index];
  }

  const apiKey = await resolveProviderApiKey(context.secrets, selected);
  const baseUrl = selected.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Testing "${selected.name}"...`, cancellable: false },
    async () => {
      try {
        const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const j = await res.json() as { data?: unknown[] };
          vscode.window.showInformationMessage(
            `Connected: ${j.data?.length ?? 0} models from ${selected.name}`
          );
        } else {
          vscode.window.showWarningMessage(`Reachable but models returned ${res.status}`);
        }
      } catch (e) {
        vscode.window.showErrorMessage(`${selected.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  );
}

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.text = '$(check) Custom LLM';
  statusBar.tooltip = 'Copilot Custom LLM Provider';
  statusBar.command = 'custom-llm.manageProviders';
  statusBar.show();

  const provider = new CustomLlmProvider(context, statusBar);
  const registration = vscode.lm.registerLanguageModelChatProvider('custom-llm', provider);

  (async () => {
    await migrateLegacySettings(context.secrets);
    await migrateToSlugIds();
    await discoverAllModels(context, true);
    await cleanupLegacyByokEntries();
    setTimeout(() => provider.notifyModelsChanged(), 2000);
  })();

  registerDiagnosticsCommands(context, getProviders, () => getModels().length);
  registerChatParticipant(context);

  context.subscriptions.push(
    registration,
    provider,
    statusBar,
    vscode.commands.registerCommand('custom-llm.addProvider', () => cmdAddProvider(context, provider)),
    vscode.commands.registerCommand('custom-llm.manageProviders', () => cmdManageProviders(context, provider)),
    vscode.commands.registerCommand('custom-llm.refreshModels', async () => {
      await discoverAllModels(context, false);
      await cleanupLegacyByokEntries();
      provider.notifyModelsChanged();
    }),
    vscode.commands.registerCommand('custom-llm.testConnection', () => cmdTestConnection(context)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('customLlm.providers')) {
        discoverAllModels(context, true).then(() => provider.notifyModelsChanged());
      } else if (e.affectsConfiguration('customLlm.models')) {
        provider.notifyModelsChanged();
      }
    })
  );
}

export function deactivate() {}
