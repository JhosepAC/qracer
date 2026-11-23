/** Same-PC monotonic timestamps. Reserve one 25 ms watchdog tick within the 250 ms deadline. */
export function expiredInput(receivedAt: number, now: number): boolean {
  return !Number.isFinite(receivedAt) || now < receivedAt || now - receivedAt >= 225;
}
