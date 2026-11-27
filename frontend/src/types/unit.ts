export type UnitType = "REGULER" | "VIP";

export type BookingMode =
  | "HOURLY_UNIT"
  | "NIGHTLY_UNIT"
  | "FLEET_RENTAL"
  | "SERVICE_APPOINTMENT"
  | "FACILITY_RESERVATION"
  | "SESSION_QUOTA";

export interface UnitDto {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: UnitType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUnitDto {
  code: string;
  name: string;
  type: UnitType;
  isActive?: boolean;
}

export interface UpdateUnitDto {
  code?: string;
  name?: string;
  type?: UnitType;
  isActive?: boolean;
}
