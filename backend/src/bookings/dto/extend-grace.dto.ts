import { IsInt, Min } from 'class-validator';

export class ExtendGraceDto {
  @IsInt()
  @Min(1)
  extraMinutes: number;
}
