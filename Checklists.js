/**
 * Checklists.gs — lightweight tick-off items on a task (distinct from subtasks).
 * Editing a checklist is an Execution action: assignee, a superior, or Director.
 */

function checklistGuard_(taskId) {
  var me = requireUser();
  var t = getTask(taskId);
  if (!t) throw new Error('Task not found.');
  if (!canEditExecution(me, t)) throw new Error('You cannot change this checklist.');
  return { me: me, task: t };
}

function addChecklistItem(taskId, text) {
  var ctx = checklistGuard_(taskId);
  if (!text || !String(text).trim()) throw new Error('Checklist item text is required.');
  var existing = Db.filter(CONFIG.TAB.CHECKLIST, function (c) { return c.task_id === taskId; });
  var id = genId('C');
  Db.insert(CONFIG.TAB.CHECKLIST, {
    id: id, task_id: taskId, text: String(text).trim(), done: false,
    position: existing.length + 1, created_at: nowIso()
  });
  logActivity(ctx.me.email, 'checklist.add', 'task', taskId, text);
  return getTaskDetail(taskId);
}

function toggleChecklistItem(itemId, done) {
  var item = Db.findBy(CONFIG.TAB.CHECKLIST, 'id', itemId);
  if (!item) throw new Error('Checklist item not found.');
  var ctx = checklistGuard_(item.task_id);
  Db.update(CONFIG.TAB.CHECKLIST, 'id', itemId, { done: !!done });
  logActivity(ctx.me.email, 'checklist.toggle', 'task', item.task_id, item.text + '=' + (!!done));
  return getTaskDetail(item.task_id);
}

function updateChecklistItem(itemId, text) {
  var item = Db.findBy(CONFIG.TAB.CHECKLIST, 'id', itemId);
  if (!item) throw new Error('Checklist item not found.');
  checklistGuard_(item.task_id);
  Db.update(CONFIG.TAB.CHECKLIST, 'id', itemId, { text: String(text).trim() });
  return getTaskDetail(item.task_id);
}

function deleteChecklistItem(itemId) {
  var item = Db.findBy(CONFIG.TAB.CHECKLIST, 'id', itemId);
  if (!item) throw new Error('Checklist item not found.');
  checklistGuard_(item.task_id);
  Db.remove(CONFIG.TAB.CHECKLIST, 'id', itemId);
  return getTaskDetail(item.task_id);
}
