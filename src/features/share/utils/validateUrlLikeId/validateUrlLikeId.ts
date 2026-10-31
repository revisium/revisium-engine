import { BadRequestException } from '@nestjs/common';
import { VALIDATE_URL_LIKE_ID_ERROR_MESSAGE } from 'src/features/share/utils/validateUrlLikeId/url-like-id-error-message';

export { VALIDATE_URL_LIKE_ID_ERROR_MESSAGE };

export const validateUrlLikeId = (id: string) => {
  const validPattern = /^(?!__)[a-zA-Z_][a-zA-Z0-9-_]*$/;
  const maxLength = 64;

  if (id.length < 1 || id.length > maxLength || !validPattern.test(id)) {
    throw new BadRequestException(VALIDATE_URL_LIKE_ID_ERROR_MESSAGE);
  }
};
