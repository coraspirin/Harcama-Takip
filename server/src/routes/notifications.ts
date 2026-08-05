import { Router } from 'express';
import { asyncHandler } from '../middleware/error.ts';
import { requireUser, currentUser } from '../middleware/auth.ts';
import { notFound } from '../lib/errors.ts';
import { idParamSchema } from '../lib/validation.ts';
import {
  countUnread,
  deleteNotification,
  listNotifications,
  markAllRead,
  markRead,
  type NotificationRow,
} from '../db/notifications.ts';

export const notificationsRouter: Router = Router();

notificationsRouter.use(requireUser);

function serialize(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    relatedType: row.related_type,
    relatedId: row.related_id,
    dueDate: row.due_date,
    read: row.read_at !== null,
    createdAt: row.created_at,
  };
}

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({
      notifications: listNotifications(user.id).map(serialize),
      unreadCount: countUnread(user.id),
    });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    // Zaten okunmus olabilir; asil onemli olan kaydin bu kullaniciya ait olmasi
    const found = listNotifications(user.id, 500).some((n) => n.id === id);
    if (!found) throw notFound('Bildirim bulunamadi');

    markRead(user.id, id);
    res.json({ ok: true, unreadCount: countUnread(user.id) });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ ok: true, marked: markAllRead(user.id), unreadCount: 0 });
  }),
);

notificationsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const id = idParamSchema.parse(req.params.id);

    if (!deleteNotification(user.id, id)) throw notFound('Bildirim bulunamadi');
    res.json({ deleted: true, unreadCount: countUnread(user.id) });
  }),
);
