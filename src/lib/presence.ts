/**
 * Presence & time-window helpers. Kept out of component render paths so
 * server components stay pure under react-hooks/purity.
 */

const ONLINE_WINDOW_MS = 5 * 60_000;

export function isOnline(lastActiveAt: Date): boolean {
  return Date.now() - lastActiveAt.getTime() < ONLINE_WINDOW_MS;
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600 * 1000);
}

export function daysAgo(days: number): Date {
  return hoursAgo(days * 24);
}
