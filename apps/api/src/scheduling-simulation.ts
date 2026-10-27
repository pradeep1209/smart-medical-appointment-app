import { LogisticAttendancePredictor } from './attendance-model';

export function acceptsExtra(attendance: number[], candidate: number) {
  return attendance.length < 2 && Number.isFinite(candidate) && candidate >= 0 && candidate <= 1 && attendance.every(p => Number.isFinite(p) && p >= 0 && p <= 1) && attendance.reduce((a, b) => a + b, candidate) <= 1.2;
}
function random(seed: number) { let state = seed >>> 0; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }; }
export function simulateScheduling(predictor: LogisticAttendancePredictor | null, seed: number, sessions: number, overbookingEnabled: boolean) {
  if (overbookingEnabled && !predictor) throw Error('Prediction-dependent simulation is unavailable. Standard scheduling remains available.');
  const rng = random(seed), totals = { standard: empty(), comparison: empty() };
  const assign = (probabilities: number[], enabled: boolean) => {
    const slots: number[][] = Array.from({ length: 12 }, () => []);
    probabilities.forEach((p, i) => {
      const available = slots.find(s => s.length === 0) ?? (enabled ? slots.find(s => acceptsExtra(s.map(index => probabilities[index]!), p)) : undefined);
      available?.push(i);
    });
    return slots;
  };
  for (let session = 0; session < sessions; session++) {
    const candidates = Array.from({ length: 18 }, (_, i) => {
      const leadDays = Math.floor(rng() * 61), priorAppointments = Math.floor(rng() * 21);
      // Deliberately include high-missed-history stress cases; this is not a clinic demand estimate.
      const missRate = i % 3 === 0 ? 0.8 : 0.24;
      const priorMissed = Array.from({ length: priorAppointments }, () => Number(rng() < missRate)).reduce((a, b) => a + b, 0);
      const f = { leadDays, priorAppointments, priorMissed, reminderPlanned: false };
      const truth = 1 / (1 + Math.exp(-(-2 + .025 * leadDays + 2 * (priorMissed + 1) / (priorAppointments + 4) - .025 * priorAppointments)));
      return { attendance: predictor ? 1 - predictor.noShowProbability(f) : 1, arrived: rng() >= truth, service: 20 + 20 * rng() };
    });
    const probability = candidates.map(c => c.attendance);
    for (const policy of ['standard', 'comparison'] as const) {
      const slots = assign(probability, policy === 'comparison' && overbookingEnabled);
      let end = 0, wait = 0, attended = 0, unusedSlots = 0, collisionSlots = 0;
      slots.forEach((ids, slot) => {
        const present = ids.filter(i => candidates[i]!.arrived);
        if (!present.length) unusedSlots++;
        if (present.length > 1) collisionSlots++;
        present.forEach(i => { const start = Math.max(end, slot * 30); wait += start - slot * 30; end = start + candidates[i]!.service; attended++; });
      });
      const t = totals[policy];
      t.booked += slots.reduce((n, s) => n + s.length, 0); t.attended += attended; t.unusedSlots += unusedSlots; t.collisionSlots += collisionSlots;
      t.meanWaitMinutes += attended ? wait / attended : 0; t.overtimeMinutes += Math.max(0, end - 360);
    }
  }
  return {
    seed, sessions, overbookingEnabled, affectsLiveAppointments: false, synthetic: true,
    modelVersion: predictor?.data.version ?? null, modelSha256: predictor?.sha256 ?? null,
    constraints: { maxBookingsPerSlot: overbookingEnabled ? 2 : 1, maxCombinedExpectedAttendance: 1.2 },
    assumptions: '18 synthetic candidates; 12 slots of 30 minutes; every third candidate has an 0.8 prior missed-outcome generator, others 0.24; reminder feature false; attendance generated independently from the original synthetic equation; U(20,40) minute consultations; arrival at slot start; identical candidates, attendance draws and service durations for both policies; order-preserving greedy assignment, not ILP.',
    policies: Object.fromEntries(Object.entries(totals).map(([name, value]) => [name, Object.fromEntries(Object.entries(value).map(([key, sum]) => [key, sum / sessions]))])),
  };
}
function empty() { return { booked: 0, attended: 0, unusedSlots: 0, collisionSlots: 0, meanWaitMinutes: 0, overtimeMinutes: 0 }; }
