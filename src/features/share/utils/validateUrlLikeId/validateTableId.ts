import { BadRequestException } from '@nestjs/common';
import { findTableIdError } from 'src/features/share/utils/validateUrlLikeId/table-id-error';

export {
  TABLE_ID_ERROR_MESSAGE,
  TABLE_ID_SYSTEM_PREFIX_ERROR_MESSAGE,
} from 'src/features/share/utils/validateUrlLikeId/table-id-error';

export const validateTableId = (id: string): void => {
  const error = findTableIdError(id);

  if (error) {
    throw new BadRequestException(error);
  }
};
