import { HttpException } from '@nestjs/common';

export async function apiErrorCode(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof HttpException)) {
      throw error;
    }
    const response = error.getResponse();
    if (typeof response === 'object' && 'code' in response) {
      return response.code;
    }
    throw error;
  }
  return undefined;
}
