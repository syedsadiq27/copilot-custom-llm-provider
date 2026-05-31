import * as vscode from 'vscode';
import type { ModelConfig, ModelRoute, ProviderConfig } from './types';
import { logLine } from './shared/logger';
import { toOpenAIMessages } from './shared/messages';
import { convertTools } from './shared/tools';
import { estimateMessagesTokens } from './shared/tokens';
import { getIssueReporter } from './issueReporter';
import { fetchWithRetry } from './provider/client';
import { resolveMaxOutputTokens } from './provider/config';
import { buildRequestBody } from './provider/requestBuild';
import { parseExposedModelId } from './provider/route';
import { getModelParamsForRequest } from './provider/request';
import { resolveProviderApiKey } from './provider/secrets';
import { createRequestStats, processStreamingResponse } from './provider/streaming';
import { normalizeModelConfig } from './extension/discovery';

export { logLine } from './shared/logger';

export class CustomLlmProvider implements vscode.LanguageModelChatProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this._onDidChange.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private statusBar?: vscode.StatusBarItem
  ) {
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('customLlm')) {
        this._onDidChange.fire();
      }
    });
  }

  private getProviders(): ProviderConfig[] {
    const raw = vscode.workspace.getConfiguration('customLlm').get<ProviderConfig[]>('providers') ?? [];
    return raw.filter((p) => p.id && p.baseUrl);
  }

  private getModels(): ModelConfig[] {
    const providers = this.getProviders();
    const raw = vscode.workspace.getConfiguration('customLlm').get<ModelConfig[]>('models') ?? [];
    return raw.map((m) => normalizeModelConfig(m, providers.length));
  }

  provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.LanguageModelChatInformation[]> {
    const modelConfigs = this.getModels();
    const providers = this.getProviders();

    if (options.silent) {
      const hasUsable = providers.some((p) => !!p.baseUrl);
      if (!hasUsable || modelConfigs.length === 0) {
        return [];
      }
    }

    const nameMap = new Map<string, string>([
      ...providers.filter((p) => p.id).map((p) => [p.id, p.name] as [string, string]),
      ...providers.map((p) => [p.baseUrl, p.name] as [string, string]),
    ]);

    return modelConfigs.map((m) => {
      const providerLabel = nameMap.get(m.providerId) ?? nameMap.get(m.providerUrl ?? '') ?? 'Custom LLM';
      return {
        id: m.id,
        name: m.name,
        family: (m.rawModelId ?? m.id).split(/[-:.]/)[0],
        version: '1',
        detail: providerLabel,
        maxInputTokens: m.maxInputTokens,
        maxOutputTokens: m.maxOutputTokens,
        showInModelPicker: true,
        capabilities: {
          toolCalling: m.toolCalling !== false,
          imageInput: m.imageInput === true,
        },
      };
    });
  }

  private resolveRoute(exposedModelId: string, models: ModelConfig[]): {
    modelCfg?: ModelConfig;
    route: ModelRoute;
    provider?: ProviderConfig;
  } {
    const providers = this.getProviders();
    const providerIds = providers.map((p) => p.id);
    const parsed = parseExposedModelId(exposedModelId, providerIds);

    const modelCfg = models.find((m) => m.id === exposedModelId)
      ?? models.find((m) => m.rawModelId === parsed.rawModelId && (!parsed.providerId || m.providerId === parsed.providerId));

    const providerId = parsed.providerId ?? modelCfg?.providerId;
    let provider = providerId ? providers.find((p) => p.id === providerId) : undefined;
    if (!provider && providers.length === 1) {
      provider = providers[0];
    }

    const providerLabel = provider?.name ?? 'Custom LLM';
    const route: ModelRoute = {
      providerId: provider?.id ?? '',
      rawModelId: modelCfg?.rawModelId ?? parsed.rawModelId,
      providerLabel,
    };

    return { modelCfg, route, provider };
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const models = this.getModels();
    const { modelCfg, route, provider } = this.resolveRoute(model.id, models);

    if (!provider) {
      const msg = `Copilot Custom LLM: model '${model.id}' has no matching provider. Run "Custom LLM: Refresh model list from API".`;
      getIssueReporter().recordError('provideLanguageModelChatResponse', new Error(msg));
      throw new Error(msg);
    }

    const apiKey = await resolveProviderApiKey(this.context.secrets, provider);
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const toolConfig = convertTools(options);
    const maxTokens = resolveMaxOutputTokens(modelCfg?.maxOutputTokens ?? model.maxOutputTokens);
    const modelParams = getModelParamsForRequest(model.id, route);

    const oaiMessages = toOpenAIMessages(messages);
    const body = buildRequestBody({
      rawModelId: route.rawModelId,
      openaiMessages: oaiMessages,
      maxTokens,
      modelParams,
      toolConfig,
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (baseUrl.includes('dashscope')) {
      headers['X-DashScope-SSE'] = 'enable';
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const abortController = new AbortController();
    const cancelDisposable = token.onCancellationRequested(() => abortController.abort());
    const reqId = Math.random().toString(36).slice(2, 8);
    const stats = createRequestStats();
    const startedAt = Date.now();

    logLine(`[${reqId}] → POST ${baseUrl}/chat/completions model=${route.rawModelId} exposed=${model.id} max_tokens=${maxTokens}`);

    if (this.statusBar) {
      this.statusBar.text = '$(sync~spin) Custom LLM';
    }
    try {
      const response = await fetchWithRetry(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        const err = await response.text();
        throw new Error(`Copilot Custom LLM (${response.status}): ${err.substring(0, 4000)}`);
      }

      await processStreamingResponse(
        response.body,
        progress,
        token,
        stats,
        reqId,
        model,
        startedAt,
        abortController
      );
    } catch (e) {
      getIssueReporter().recordError('chat', e);
      logLine(`[${reqId}] ✗ ${e instanceof Error ? e.message : String(e)}`);
      if (this.statusBar) {
        this.statusBar.text = '$(warning) Custom LLM';
      }
      throw e;
    } finally {
      cancelDisposable.dispose();
      if (this.statusBar) {
        this.statusBar.text = '$(check) Custom LLM';
      }
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    if (typeof text === 'string') {
      return Math.ceil(text.length / 4);
    }
    return estimateMessagesTokens([text]);
  }

  notifyModelsChanged(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
