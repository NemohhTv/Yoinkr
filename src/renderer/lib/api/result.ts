import type { Result } from '@shared/types/common';

export const unwrapResult = <T>(result: Result<T>): T => {
  if (!result.ok) {
    const error = new Error(result.error.message) as Error & { code?: string; details?: string };
    error.name = result.error.code;
    error.code = result.error.code;
    error.details = result.error.details;
    throw error;
  }

  return result.data;
};
