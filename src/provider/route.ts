export function buildExposedModelId(
  rawModelId: string,
  providerId: string,
  providerCount: number
): string {
  if (providerCount <= 1) {
    return rawModelId;
  }
  return `${providerId}/${rawModelId}`;
}

export function parseExposedModelId(
  exposedId: string,
  providerIds: string[]
): { providerId?: string; rawModelId: string } {
  const slash = exposedId.indexOf('/');
  if (slash > 0) {
    const prefix = exposedId.slice(0, slash);
    if (providerIds.includes(prefix)) {
      return { providerId: prefix, rawModelId: exposedId.slice(slash + 1) };
    }
  }
  return { rawModelId: exposedId };
}
