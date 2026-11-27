import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class ResolveConflictDto {
  @IsIn(['REFUND', 'REASSIGN'], {
    message: 'action hanya mendukung REFUND atau REASSIGN',
  })
  action: 'REFUND' | 'REASSIGN';

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date harus berformat YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime harus berformat HH:mm',
  })
  startTime?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
