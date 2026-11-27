import { randomInt } from 'node:crypto';

// Unambiguous uppercase alphanumeric characters (excludes 0, O, 1, I)
const BOOKING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOOKING_CODE_PREFIX = 'MHF';
const BOOKING_CODE_LENGTH = 6;

export function generateBookingCode(): string {
  let suffix = '';
  for (let i = 0; i < BOOKING_CODE_LENGTH; i += 1) {
    suffix += BOOKING_CODE_ALPHABET[randomInt(0, BOOKING_CODE_ALPHABET.length)];
  }
  return `${BOOKING_CODE_PREFIX}-${suffix}`;
}
