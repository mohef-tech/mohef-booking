import { IsUUID } from 'class-validator';

export class MoveUnitDto {
  @IsUUID()
  targetUnitId: string;
}
