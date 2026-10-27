import { BadRequestException } from '@nestjs/common';

export function localParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(value);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new BadRequestException('Choose a valid calendar date.');
  return value;
}
export function dateAfter(date: string, days: number) { return new Date(Date.parse(`${validDate(date)}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function clinicInstant(date: string, minute: number, timezone: string): Date {
  validDate(date);
  if (minute === 1440) return clinicInstant(dateAfter(date, 1), 0, timezone);
  const wall = Date.parse(`${date}T00:00:00Z`) + minute * 60000;
  // Iterate the zone offset, then verify the round trip: nonexistent DST times fail closed.
  let guess = wall;
  for (let n = 0; n < 4; n++) {
    const local = localParts(new Date(guess), timezone);
    const represented = Date.parse(`${local.date}T00:00:00Z`) + local.minute * 60000;
    const next = guess + wall - represented;
    if (next === guess) break;
    guess = next;
  }
  const result = new Date(guess), check = localParts(result, timezone);
  if (check.date !== date || check.minute !== minute) throw new BadRequestException('This local time does not exist in the clinic time zone.');
  return result;
}
export function localInput(value: string, timezone: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new BadRequestException('Enter a date and time in the clinic time zone.');
  return clinicInstant(match[1]!, Number(match[2]) * 60 + Number(match[3]), timezone);
}
export function dateInWindow(date: string, timezone: string, now = new Date()) {
  validDate(date);
  const today = localParts(now, timezone).date;
  if (date < today || date > dateAfter(today, 90)) throw new BadRequestException('Choose a date from today through the next 90 days.');
}
export function generateSlots(date: string, timezone: string, minutes: number, hours: { startMinute: number; endMinute: number } | undefined, blocks: { startsAt: Date; endsAt: Date }[], now = new Date()) {
  if (!hours) return [];
  const result: { startsAt: string; endsAt: string; label: string }[] = [];
  const label = new Intl.DateTimeFormat('en-IN', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  for (let minute = hours.startMinute; minute + minutes <= hours.endMinute; minute += minutes) {
    let start: Date, end: Date;
    try { start = clinicInstant(date, minute, timezone); end = clinicInstant(date, minute + minutes, timezone); } catch { continue; }
    if (start <= now || end.getTime() - start.getTime() !== minutes * 60000 || blocks.some(b => b.startsAt < end && b.endsAt > start)) continue;
    result.push({ startsAt: start.toISOString(), endsAt: end.toISOString(), label: `${label.format(start)} – ${label.format(end)}` });
  }
  return result;
}
