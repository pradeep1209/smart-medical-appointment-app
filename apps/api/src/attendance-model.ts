import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const FEATURE_SCHEMA = ['lead_days', 'smoothed_prior_noshow_rate', 'prior_appointments', 'reminder_planned'];
export type AttendanceFeatures = { leadDays: number; priorAppointments: number; priorMissed: number; reminderPlanned: boolean };
type Model = { version: string; training_data: string; positive_class: string; features: string[]; mean: number[]; scale: number[]; weights: number[]; intercept: number; history_smoothing: string; feature_bounds: { lead_days: number[]; prior_appointments: number[] } };
export class LogisticAttendancePredictor {
  readonly data: Model;
  readonly sha256: string;
  constructor(json: string) {
    const model = JSON.parse(json) as Model;
    if (!model || typeof model.version !== 'string' || !model.version.trim() || model.version.length > 100 || model.training_data !== 'synthetic' || model.positive_class !== 'no_show' || JSON.stringify(model.features) !== JSON.stringify(FEATURE_SCHEMA)) throw Error('Unsupported attendance model metadata');
    for (const key of ['mean', 'scale', 'weights'] as const) if (!Array.isArray(model[key]) || model[key].length !== 4 || model[key].some(n => typeof n !== 'number' || !Number.isFinite(n))) throw Error('Invalid attendance model parameters');
    if (model.scale.some(n => n <= 0) || !Number.isFinite(model.intercept) || model.history_smoothing !== '(prior_missed + 1) / (prior_appointments + 4)' || JSON.stringify(model.feature_bounds) !== JSON.stringify({ lead_days: [0, 60], prior_appointments: [0, 20] })) throw Error('Unsupported attendance feature contract');
    this.data = model; this.sha256 = createHash('sha256').update(json).digest('hex');
  }
  noShowProbability(f: AttendanceFeatures) {
    if (!Number.isInteger(f.leadDays) || f.leadDays < 0 || f.leadDays > 60 || !Number.isInteger(f.priorAppointments) || f.priorAppointments < 0 || f.priorAppointments > 20 || !Number.isInteger(f.priorMissed) || f.priorMissed < 0 || f.priorMissed > f.priorAppointments || typeof f.reminderPlanned !== 'boolean') throw Error('Invalid attendance features');
    const x = [f.leadDays, (f.priorMissed + 1) / (f.priorAppointments + 4), f.priorAppointments, Number(f.reminderPlanned)];
    const z = x.reduce((sum, value, i) => sum + (value - this.data.mean[i]!) / this.data.scale[i]! * this.data.weights[i]!, this.data.intercept);
    if (!Number.isFinite(z)) throw Error('Attendance model produced a non-finite score');
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  }
}
@Injectable()
export class AttendanceModel {
  readonly predictor: LogisticAttendancePredictor | null;
  constructor() {
    try { this.predictor = process.env.ATTENDANCE_MODEL_ENABLED === 'false' ? null : new LogisticAttendancePredictor(readFileSync(resolve(__dirname, '../models/attendance_model.json'), 'utf8')); }
    catch { this.predictor = null; }
  }
  metadata() { return { available: !!this.predictor, source: 'SERVER', trainingData: 'synthetic', version: this.predictor?.data.version ?? null, sha256: this.predictor?.sha256 ?? null, liveScheduling: 'STANDARD', overbooking: 'SIMULATION_ONLY' }; }
}
