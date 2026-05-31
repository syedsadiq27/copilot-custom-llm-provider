import * as vscode from 'vscode';
import type { ProviderConfig } from '../types';

const secretKey = (providerId: string) => `customLlm.provider.${providerId}.apiKey`;

export async function getProviderApiKey(
  secrets: vscode.SecretStorage,
  providerId: string
): Promise<string> {
  return (await secrets.get(secretKey(providerId))) ?? '';
}

export async function setProviderApiKey(
  secrets: vscode.SecretStorage,
  providerId: string,
  apiKey: string
): Promise<void> {
  if (apiKey) {
    await secrets.store(secretKey(providerId), apiKey);
  } else {
    await secrets.delete(secretKey(providerId));
  }
}

export async function deleteProviderApiKey(
  secrets: vscode.SecretStorage,
  providerId: string
): Promise<void> {
  await secrets.delete(secretKey(providerId));
}

export async function resolveProviderApiKey(
  secrets: vscode.SecretStorage,
  provider: ProviderConfig
): Promise<string> {
  const fromSecret = await getProviderApiKey(secrets, provider.id);
  if (fromSecret) {
    return fromSecret;
  }
  return provider.apiKey ?? '';
}

export async function migrateApiKeysToSecrets(
  secrets: vscode.SecretStorage,
  providers: ProviderConfig[]
): Promise<ProviderConfig[]> {
  const migrated: ProviderConfig[] = [];
  let changed = false;

  for (const p of providers) {
    if (p.apiKey?.trim()) {
      await setProviderApiKey(secrets, p.id, p.apiKey.trim());
      migrated.push({ id: p.id, name: p.name, baseUrl: p.baseUrl });
      changed = true;
    } else {
      migrated.push(p);
    }
  }

  if (changed) {
    await vscode.workspace
      .getConfiguration('customLlm')
      .update('providers', migrated, vscode.ConfigurationTarget.Global);
  }

  return migrated;
}
