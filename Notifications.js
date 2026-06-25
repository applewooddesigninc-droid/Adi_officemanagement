/**
 * Notifications.gs — in-app feed + email, plus the shared activity log.
 * Real-time alerts (assigned · due/overdue · entered Review · comment/@-mention)
 * are written to the feed AND emailed immediately. The daily digest is composed
 * in Reminders.gs.
 */

/** Create one in-app notification and (for real-time types) email it. */
function notifyUser(email, type, title, body, taskId) {
  email = lc(email);
  if (!email) return;
  var id = genId('N');
  var emailed = false;
  if (type !== CONFIG.NOTIF.DIGEST) {
    emailed = sendMail_(email, title, body, taskId);
  }
  Db.insert(CONFIG.TAB.NOTIFICATIONS, {
    id: id, recipient_email: email, type: type, title: title, body: body,
    task_id: taskId || '', read: false, emailed: emailed, created_at: nowIso()
  });
}

/** The signed-in user's in-app feed (most recent first). */
function listMyNotifications(limit) {
  var me = requireUser();
  var rows = Db.filter(CONFIG.TAB.NOTIFICATIONS, function (n) { return lc(n.recipient_email) === me.email; })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  if (limit) rows = rows.slice(0, limit);
  return rows.map(function (n) {
    return { id: n.id, type: n.type, title: n.title, body: n.body, task_id: n.task_id,
             read: asBool(n.read), created_at: n.created_at };
  });
}

function unreadCount() {
  var me = requireUser();
  return Db.filter(CONFIG.TAB.NOTIFICATIONS, function (n) {
    return lc(n.recipient_email) === me.email && !asBool(n.read);
  }).length;
}

function markNotificationRead(id) {
  var me = requireUser();
  var n = Db.findBy(CONFIG.TAB.NOTIFICATIONS, 'id', id);
  if (n && lc(n.recipient_email) === me.email) Db.update(CONFIG.TAB.NOTIFICATIONS, 'id', id, { read: true });
  return unreadCount();
}

function markAllNotificationsRead() {
  var me = requireUser();
  Db.filter(CONFIG.TAB.NOTIFICATIONS, function (n) {
    return lc(n.recipient_email) === me.email && !asBool(n.read);
  }).forEach(function (n) { Db.update(CONFIG.TAB.NOTIFICATIONS, 'id', n.id, { read: true }); });
  return 0;
}

/* ---------------- Email ---------------- */

function getWebAppUrl() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; }
}

function sendMail_(email, subject, body, taskId) {
  try {
    var url = getWebAppUrl();
    var link = url ? (url + (taskId ? '?task=' + encodeURIComponent(taskId) : '')) : '';
    MailApp.sendEmail({
      to: email,
      subject: '[' + CONFIG.APP_NAME + '] ' + subject,
      htmlBody: emailShell_(subject, body, link),
      name: CONFIG.COMPANY
    });
    return true;
  } catch (e) {
    Logger.log('Email failed for ' + email + ': ' + e);
    return false;
  }
}

function emailShell_(title, body, link) {
  var B = CONFIG.BRAND;
  return '' +
    '<div style="font-family:Arial,Helvetica,sans-serif;background:' + B.BG + ';padding:24px;color:' + B.TEXT + '">' +
      '<div style="max-width:560px;margin:auto;background:' + B.SURFACE + ';border:1px solid #eadfce;border-radius:12px;overflow:hidden">' +
        '<div style="background:' + B.PRIMARY + ';padding:16px 22px">' +
          '<span style="color:#fff;font-size:18px;font-weight:bold;letter-spacing:.5px">ADI</span>' +
          '<span style="color:' + B.ACCENT + ';font-size:18px;font-weight:bold"> Designs</span>' +
          '<div style="color:#f3e9d6;font-size:12px;margin-top:2px">' + CONFIG.APP_NAME + '</div>' +
        '</div>' +
        '<div style="padding:22px">' +
          '<h2 style="margin:0 0 10px;font-size:17px;color:' + B.PRIMARY_DARK + '">' + escapeHtml_(title) + '</h2>' +
          '<p style="margin:0 0 18px;line-height:1.5;font-size:14px">' + escapeHtml_(body) + '</p>' +
          (link ? '<a href="' + link + '" style="display:inline-block;background:' + B.ACCENT +
            ';color:#3a2a10;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px;font-size:14px">Open in the app →</a>' : '') +
        '</div>' +
        '<div style="padding:12px 22px;border-top:1px solid #f0e7d8;color:' + B.MUTED + ';font-size:11px">' +
          'You are receiving this because you are on the ADI work team. Times are IST.' +
        '</div>' +
      '</div>' +
    '</div>';
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ---------------- Activity log ---------------- */

function logActivity(actor, action, entityType, entityId, details) {
  try {
    Db.insert(CONFIG.TAB.ACTIVITY, {
      id: genId('L'), actor_email: lc(actor), action: action, entity_type: entityType,
      entity_id: entityId, details: details || '', created_at: nowIso()
    });
  } catch (e) { Logger.log('Activity log failed: ' + e); }
}
