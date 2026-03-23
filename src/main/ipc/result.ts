import type { Result } from '@shared/types/common';

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

export const fail = (code: string, message: string, details?: string): Result<never> => ({
  ok: false,
  error: { code, message, details },
});
