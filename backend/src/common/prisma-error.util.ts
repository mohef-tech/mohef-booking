interface NestedErrorShape {
  code?: unknown;
  originalCode?: unknown;
  message?: unknown;
  meta?: {
    driverAdapterError?: {
      cause?: {
        originalCode?: unknown;
        code?: unknown;
        message?: unknown;
      };
    };
  };
  cause?: {
    code?: unknown;
    originalCode?: unknown;
    message?: unknown;
  };
}

export function isExclusionConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const err = error as NestedErrorShape;
  const codes = [
    err.code,
    err.originalCode,
    err.cause?.code,
    err.cause?.originalCode,
    err.meta?.driverAdapterError?.cause?.originalCode,
    err.meta?.driverAdapterError?.cause?.code,
  ];

  if (codes.some((code) => code === '23P01')) {
    return true;
  }

  const messages = [
    err.message,
    err.cause?.message,
    err.meta?.driverAdapterError?.cause?.message,
  ];

  return messages.some(
    (msg) =>
      typeof msg === 'string' &&
      (msg.includes('23P01') ||
        msg.includes('bookings_no_overlap_active_excl') ||
        msg.includes('exclusion constraint')),
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const err = error as NestedErrorShape;
  return (
    err.code === 'P2002' ||
    err.meta?.driverAdapterError?.cause?.originalCode === '23505'
  );
}
