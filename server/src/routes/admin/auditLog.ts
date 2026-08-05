import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.ts';
import { requireSuperAdmin } from '../../middleware/auth.ts';
import { countAuditLogs, listAuditLogs, type AuditLogRow } from '../../db/audit.ts';

export const adminAuditLogRouter: Router = Router();

adminAuditLogRouter.use(requireSuperAdmin);

function serialize(row: AuditLogRow) {
  let details: unknown = null;
  if (row.details !== null) {
    try {
      details = JSON.parse(row.details);
    } catch {
      details = row.details;
    }
  }

  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorUsername: row.actor_username,
    action: row.action,
    targetUserId: row.target_user_id,
    targetUsername: row.target_username,
    details,
    ip: row.ip,
    createdAt: row.created_at,
  };
}

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

adminAuditLogRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, pageSize } = querySchema.parse(req.query);

    res.json({
      logs: listAuditLogs(pageSize, (page - 1) * pageSize).map(serialize),
      pagination: { page, pageSize, total: countAuditLogs() },
    });
  }),
);
