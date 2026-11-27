import type { UnitType } from "./unit";

export type RateDayType = "WEEKDAY" | "SUNDAY";

export interface RateMatrixDto {
  id: string;
  tenantId: string;
  unitType: UnitType;
  dayType: RateDayType;
  hourlyRate: number;
  updatedAt: string;
}

export interface UpdateRateMatrixDto {
  unitType: UnitType;
  dayType: RateDayType;
  hourlyRate: number;
}
