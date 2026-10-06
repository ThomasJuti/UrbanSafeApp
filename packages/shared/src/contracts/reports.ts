import { z } from 'zod';
import { incidentTypeSchema } from '../catalog';
import { urbanPointSchema } from '../geo';
import { mapIncidentSchema } from './incidents';

export const nicknameSchema = z.string().trim().min(2).max(30);

export const createReportBodySchema = z.object({
  // Lo genera el cliente: si reintenta el envío, el servidor no cuenta el reporte dos veces.
  clientId: z.uuid(),
  deviceId: z.uuid(),
  nickname: nicknameSchema,
  type: incidentTypeSchema,
  point: urbanPointSchema,
});
export type CreateReportBody = z.infer<typeof createReportBodySchema>;

export const REPORT_OUTCOMES = ['created', 'confirmed', 'already_counted'] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export const createReportResponseSchema = z.object({
  outcome: z.enum(REPORT_OUTCOMES),
  incident: mapIncidentSchema,
});
export type CreateReportResponse = z.infer<typeof createReportResponseSchema>;

export const VOTES = ['confirm', 'deny'] as const;
export type Vote = (typeof VOTES)[number];

// F4: "¿Sigue ahí?". Sí confirma, no niega.
export const castVoteBodySchema = z.object({
  incidentId: z.uuid(),
  deviceId: z.uuid(),
  nickname: nicknameSchema,
  vote: z.enum(VOTES),
});
export type CastVoteBody = z.infer<typeof castVoteBodySchema>;

export const VOTE_OUTCOMES = ['counted', 'already_voted', 'own_report'] as const;
export type VoteOutcome = (typeof VOTE_OUTCOMES)[number];

export const castVoteResponseSchema = z.object({ outcome: z.enum(VOTE_OUTCOMES) });
export type CastVoteResponse = z.infer<typeof castVoteResponseSchema>;

export const REPORT_ERRORS = { rateLimited: 'rate_limited', incidentNotAvailable: 'incident_not_available' } as const;
