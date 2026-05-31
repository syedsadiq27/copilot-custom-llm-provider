import { findLongestPrefixMatch } from './modelDefaults';
import { getModelParameters } from './config';
import type { ModelRoute } from '../types';

export { buildRequestBody, type RequestBodyParams } from './requestBuild';

export function getModelParamsForRequest(
  exposedModelId: string,
  route?: ModelRoute
): Record<string, unknown> {
  const rawId = route?.rawModelId ?? exposedModelId;
  const config = getModelParameters();
  if (route?.providerId) {
    const scoped = findLongestPrefixMatch(`${route.providerId}/${rawId}`, config);
    if (scoped) {
      return { ...scoped };
    }
  }
  const match = findLongestPrefixMatch(rawId, config);
  return match ? { ...match } : {};
}
