import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { DayCategory, UnitType } from '../../generated/prisma/client.js';

export class RateRuleItemDto {
  @IsEnum(UnitType)
  unitType: UnitType;

  @IsEnum(DayCategory)
  dayCategory: DayCategory;

  @IsInt()
  @Min(1)
  hourlyRate: number;
}

export class UpdateRateRulesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RateRuleItemDto)
  rules: RateRuleItemDto[];
}
