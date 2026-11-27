import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CLOSE_TIME_HHMM_REGEX = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @Matches(TIME_HHMM_REGEX, { message: 'openTime harus berformat HH:mm' })
  openTime?: string;

  @IsOptional()
  @Matches(CLOSE_TIME_HHMM_REGEX, {
    message: 'closeTime harus berformat HH:mm (maksimal 24:00)',
  })
  closeTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  dpHoldMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  gracePeriodMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  maxGraceExtensionMinutes?: number;
}
