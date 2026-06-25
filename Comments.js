/**
 * Comments.gs — flat comments per task with @-mention notifications.
 * You may edit/delete your own; a superior (or Director) may moderate any.
 */

function addComment(taskId, body) {
  var me = requireUser();
  var t = getTask(taskId);
  if (!t) throw new Error('Task not found.');
  if (!canComment(me, t)) throw new Error('You cannot comment on this task.');
  if (!body || !String(body).trim()) throw new Error('Comment cannot be empty.');

  var users = Db.readAll(CONFIG.TAB.USERS);
  var mentions = parseMentions_(body, users);
  var id = genId('M');
  Db.insert(CONFIG.TAB.COMMENTS, {
    id: id, task_id: taskId, author_email: me.email, body: String(body),
    mentions: mentions.join(','), created_at: nowIso(), edited_at: '', deleted: false
  });
  logActivity(me.email, 'comment.add', 'task', taskId, '');

  // @-mention notifications
  var notified = {};
  mentions.forEach(function (email) {
    if (lc(email) === me.email) return;
    notified[lc(email)] = true;
    notifyUser(email, CONFIG.NOTIF.MENTION, me.name + ' mentioned you',
      me.name + ' mentioned you on "' + t.title + '": ' + snippet_(body), taskId);
  });
  // "a comment on my task" → notify assignee & creator (if not author / not already pinged)
  [t.assignee_email, t.creator_email].forEach(function (email) {
    email = lc(email);
    if (!email || email === me.email || notified[email]) return;
    notified[email] = true;
    notifyUser(email, CONFIG.NOTIF.COMMENT, 'New comment on ' + t.title,
      me.name + ' commented on "' + t.title + '": ' + snippet_(body), taskId);
  });
  return getTaskDetail(taskId);
}

function editComment(commentId, body) {
  var me = requireUser();
  var c = Db.findBy(CONFIG.TAB.COMMENTS, 'id', commentId);
  if (!c) throw new Error('Comment not found.');
  if (lc(c.author_email) !== me.email) throw new Error('You can only edit your own comments.');
  var users = Db.readAll(CONFIG.TAB.USERS);
  Db.update(CONFIG.TAB.COMMENTS, 'id', commentId, {
    body: String(body), mentions: parseMentions_(body, users).join(','), edited_at: nowIso()
  });
  return getTaskDetail(c.task_id);
}

function deleteComment(commentId) {
  var me = requireUser();
  var c = Db.findBy(CONFIG.TAB.COMMENTS, 'id', commentId);
  if (!c) throw new Error('Comment not found.');
  if (!canModerateComment_(me, c)) throw new Error('You cannot delete this comment.');
  Db.update(CONFIG.TAB.COMMENTS, 'id', commentId, { deleted: true });
  logActivity(me.email, 'comment.delete', 'task', c.task_id, commentId);
  return getTaskDetail(c.task_id);
}

function canModerateComment_(me, comment) {
  if (lc(comment.author_email) === me.email) return true;       // own
  if (isDirector(me)) return true;                              // director moderates any
  return me.rank > rankOf_(comment.author_email);              // a superior moderates
}

/** Extract @-mentions: matches @email and @DisplayName / @FirstName of known users. */
function parseMentions_(body, users) {
  var found = {};
  var text = String(body);

  // 1) explicit @email
  var re = /@([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, m;
  while ((m = re.exec(text)) !== null) found[lc(m[1])] = true;

  // 2) @Name or @FirstName matching the roster (case-insensitive)
  var lower = text.toLowerCase();
  users.forEach(function (u) {
    if (!asBool(u.active)) return;
    var name = String(u.name || '').toLowerCase();
    var first = name.split(/\s+/)[0];
    if (name && lower.indexOf('@' + name) >= 0) found[lc(u.email)] = true;
    else if (first && lower.indexOf('@' + first) >= 0) found[lc(u.email)] = true;
  });
  return Object.keys(found);
}

function snippet_(body) {
  var s = String(body).replace(/\s+/g, ' ').trim();
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}
