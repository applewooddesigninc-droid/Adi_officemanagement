/**
 * Tasks.gs — tasks + unlimited subtask depth, the four-stage workflow, and the
 * gated Review → Completed approval. All transitions are permission-checked.
 *
 * Workflow:  To Do → In Progress → Review → Completed
 *   • Assignee advances To Do → In Progress → Review.
 *   • Review → Completed is the approval gate (creator, or anyone above the
 *     creator's level, approves or sends back).
 *   • A self-created subtask is exempt from the gate.
 *
 * Each shaped task carries its project NAME, the viewer's edit permissions, and
 * the valid next-stage options — so the dashboard/My-Tasks screens can show
 * names and offer quick inline changes without extra round-trips.
 */

function getTask(id) {
  if (!id) return null;
  return Db.findBy(CONFIG.TAB.TASKS, 'id', id);
}

function nameOf_(email, users) {
  email = lc(email);
  if (!email) return '';
  return (users[email] || {}).name || email;
}

/* -------------------- Subtask tree helpers -------------------- */

/**
 * Build a map of { parentId → [child raw task rows] } from any flat task list.
 * Passed into shapeTask_ so callers that already have the full list can compute
 * rollup progress without extra Db reads.
 */
function buildChildrenIndex_(rawTasks) {
  var idx = {};
  rawTasks.forEach(function (t) {
    var pid = t.parent_task_id;
    if (pid) {
      if (!idx[pid]) idx[pid] = [];
      idx[pid].push(t);
    }
  });
  return idx;
}

/**
 * Recursive rollup: returns 0–100 progress for a task's whole subtree.
 * Leaf nodes contribute their own stage weight; parent nodes average children.
 */
function computeSubtreeProgress_(id, childrenOf) {
  var children = childrenOf[id] || [];
  if (!children.length) return null; // leaf — caller uses stage weight directly
  var sum = children.reduce(function (acc, c) {
    var cp = computeSubtreeProgress_(c.id, childrenOf);
    return acc + (cp !== null ? cp : (CONFIG.STAGE_WEIGHT[c.stage] || 0) * 100);
  }, 0);
  return Math.round(sum / children.length);
}

/**
 * BFS over the task graph to collect every descendant ID (avoids call-stack
 * limits on very deep trees). Builds the parent→children index once, then walks
 * it, instead of re-scanning the whole task table at every node.
 */
function collectAllDescendantIds_(taskId) {
  var childrenOf = buildChildrenIndex_(Db.readAll(CONFIG.TAB.TASKS));
  var ids = [], queue = [taskId];
  while (queue.length) {
    var cur = queue.shift();
    (childrenOf[cur] || []).forEach(function (c) { ids.push(c.id); queue.push(c.id); });
  }
  return ids;
}

/**
 * Recursively load visible subtasks for the task-detail modal. The parent→children
 * index is built once at the top of the recursion and threaded down, so each level
 * is an O(1) map hit rather than a full task-table scan.
 */
function loadSubtasksRecursive_(parentId, users, me, childrenOf) {
  if (!childrenOf) childrenOf = buildChildrenIndex_(Db.readAll(CONFIG.TAB.TASKS));
  return (childrenOf[parentId] || [])
    .filter(function (x) { return canViewTask(me, x); })
    .map(function (x) {
      var s = shapeTask_(x, users, me);
      s.subtasks = loadSubtasksRecursive_(x.id, users, me, childrenOf);
      return s;
    });
}

/* -------------------- Shaping -------------------- */

function shapeTask_(t, users, me, childrenOf) {
  var s = {
    id: t.id,
    project_id: t.project_id,
    project_name: projectLabel_(getProject(t.project_id)) || t.project_id,
    parent_task_id: t.parent_task_id || '',
    title: t.title,
    description: t.description,
    assignee_email: lc(t.assignee_email),
    assignee_name: t.assignee_email ? nameOf_(t.assignee_email, users) : '',
    creator_email: lc(t.creator_email),
    creator_name: nameOf_(t.creator_email, users),
    priority: t.priority || '',
    due_date: t.due_date,
    stage: t.stage,
    weight: CONFIG.STAGE_WEIGHT[t.stage] || 0,
    overdue: isOverdue_(t),
    created_at: t.created_at,
    updated_at: t.updated_at
  };
  if (me) {
    s.nextStages = allowedNextStages_(me, t);
    s.canEditDef = canEditDefinition(me, t);
    s.canReassign = canReassign(me, t);
  }
  if (childrenOf) {
    var ch = childrenOf[t.id] || [];
    s.subtaskCount = ch.length;
    s.subtasksDone = ch.filter(function (c) { return c.stage === CONFIG.STAGE.DONE; }).length;
    s.subtaskProgress = ch.length ? computeSubtreeProgress_(t.id, childrenOf) : null;
  }
  return s;
}

function shapeTaskRow_(id, me) {
  var t = getTask(id);
  if (!t) return null;
  return shapeTask_(t, indexUsers_(), me);
}

function isOverdue_(t) {
  if (!t.due_date || t.stage === CONFIG.STAGE.DONE) return false;
  return String(t.due_date) < today();
}

/** Valid next stages this viewer may move this task to (drives quick dropdowns). */
function allowedNextStages_(me, t) {
  var S = CONFIG.STAGE, from = t.stage, out = {};
  if (from === S.TODO && canAdvanceStage(me, t)) out[S.IN_PROGRESS] = 1;
  if (from === S.IN_PROGRESS && canAdvanceStage(me, t)) out[S.REVIEW] = 1;
  if (from === S.REVIEW && canApprove(me, t)) { out[S.DONE] = 1; out[S.IN_PROGRESS] = 1; }
  if (from === S.DONE && canApprove(me, t)) out[S.IN_PROGRESS] = 1;
  if (isSelfSubtask(me, t) && from !== S.DONE && canEditExecution(me, t)) out[S.DONE] = 1;
  return CONFIG.STAGES.filter(function (s) { return out[s] && s !== from; });
}

/* -------------------- Reads / scoping -------------------- */

/** Tasks in a project that the viewer is allowed to see, with subtask rollup. */
function listProjectTasks(projectId) {
  var me = requireUser();
  var users = indexUsers_();
  var rows = Db.filter(CONFIG.TAB.TASKS, function (t) { return t.project_id === projectId; })
    .filter(function (t) { return canViewTask(me, t); });
  var childrenOf = buildChildrenIndex_(rows);
  return rows.map(function (t) { return shapeTask_(t, users, me, childrenOf); });
}

/** Everything the viewer can see. */
function listVisibleTasks() {
  var me = requireUser();
  var users = indexUsers_();
  return Db.readAll(CONFIG.TAB.TASKS)
    .filter(function (t) { return canViewTask(me, t); })
    .map(function (t) { return shapeTask_(t, users, me); });
}

/** Tasks assigned to the current viewer. */
function listMyTasks() {
  var me = requireUser();
  var users = indexUsers_();
  return Db.filter(CONFIG.TAB.TASKS, function (t) { return lc(t.assignee_email) === me.email; })
    .map(function (t) { return shapeTask_(t, users, me); });
}

/** Full task detail incl. checklist/comments/attachments, perms and history. */
function getTaskDetail(id) {
  var me = requireUser();
  var t = getTask(id);
  if (!t) throw new Error('Task not found.');
  if (!canViewTask(me, t)) throw new Error('You do not have access to this task.');
  var users = indexUsers_();
  var detail = shapeTask_(t, users, me);

  detail.subtasks = loadSubtasksRecursive_(id, users, me);

  detail.checklist = Db.filter(CONFIG.TAB.CHECKLIST, function (c) { return c.task_id === id; })
    .sort(function (a, b) { return (a.position || 0) - (b.position || 0); })
    .map(function (c) { return { id: c.id, text: c.text, done: asBool(c.done), position: c.position }; });

  detail.comments = Db.filter(CONFIG.TAB.COMMENTS, function (c) { return c.task_id === id && !asBool(c.deleted); })
    .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
    .map(function (c) {
      return {
        id: c.id, author_email: lc(c.author_email), author_name: nameOf_(c.author_email, users),
        body: c.body, mentions: c.mentions, created_at: c.created_at, edited_at: c.edited_at,
        mine: lc(c.author_email) === me.email
      };
    });

  detail.attachments = Db.filter(CONFIG.TAB.ATTACHMENTS, function (a) { return a.task_id === id; })
    .map(function (a) {
      return { id: a.id, file_name: a.file_name, drive_url: a.drive_url, kind: a.kind,
               uploaded_by: lc(a.uploaded_by), created_at: a.created_at };
    });

  detail.activity = Db.filter(CONFIG.TAB.ACTIVITY, function (a) {
      return a.entity_type === 'task' && a.entity_id === id;
    })
    .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); })
    .slice(0, 25)
    .map(function (a) {
      return {
        actor_name: nameOf_(a.actor_email, users),
        action: a.action,
        text: formatActivity_(a, users),
        created_at: a.created_at
      };
    });

  detail.perms = {
    editDefinition: canEditDefinition(me, t),
    editExecution: canEditExecution(me, t),
    advance: canAdvanceStage(me, t),
    approve: canApprove(me, t),
    reassign: canReassign(me, t),
    comment: canComment(me, t),
    isAssignee: lc(t.assignee_email) === me.email,
    selfSubtask: isSelfSubtask(me, t),
    canCreateSubtask: canCreateSubtask(me, t)
  };
  detail.assignable = listAssignableUsers();
  return detail;
}

function formatActivity_(a, users) {
  var d = a.details || '';
  switch (a.action) {
    case 'task.create':    return 'created this task';
    case 'subtask.create': return 'added a subtask';
    case 'task.delete':    return 'deleted this task';
    case 'task.update':    return 'edited title / description';
    case 'task.stage': {
      var sp = d.split(' → ');
      return 'changed status: ' + (sp[0] || d) + ' → ' + (sp[1] || '');
    }
    case 'task.reassign': {
      var rp = d.split(' → ');
      if (rp.length === 2) {
        var fromName = rp[0] === 'none' ? 'unassigned' : (nameOf_(rp[0], users) || rp[0]);
        var toName   = rp[1] === 'none' ? 'unassigned' : (nameOf_(rp[1], users) || rp[1]);
        return 'changed assignee: ' + fromName + ' → ' + toName;
      }
      return 'assigned to ' + (nameOf_(d, users) || d || 'unassigned');
    }
    case 'task.priority': {
      var pp = d.split(' → ');
      return 'changed priority: ' + (pp[0] || 'none') + ' → ' + (pp[1] || 'none');
    }
    case 'task.due_date': {
      var dp = d.split(' → ');
      return 'changed due date: ' + (dp[0] || 'none') + ' → ' + (dp[1] || 'none');
    }
    case 'comment.add':       return 'added a comment';
    case 'comment.delete':    return 'deleted a comment';
    case 'checklist.add':     return 'added checklist item: ' + d;
    case 'checklist.toggle':  return 'checked off: ' + d;
    case 'attachment.upload': return 'uploaded: ' + d;
    case 'attachment.link':   return 'linked Drive file: ' + d;
    case 'attachment.delete': return 'removed an attachment';
    default:                  return a.action;
  }
}

/* -------------------- Create (assignee/priority/due are optional) -------------------- */

function createTask(projectId, fields) {
  var me = requireUser();
  var project = getProject(projectId);
  if (!project) throw new Error('Project not found.');
  if (!canCreateTopLevelTask(me, project)) throw new Error('You cannot create tasks in this project.');
  return insertTask_(me, project, '', fields);
}

function createSubtask(parentId, fields) {
  var me = requireUser();
  var parent = getTask(parentId);
  if (!parent) throw new Error('Parent task not found.');
  if (!canCreateSubtask(me, parent)) throw new Error('You cannot add a subtask here.');
  return insertTask_(me, getProject(parent.project_id), parentId, fields);
}

function insertTask_(me, project, parentId, fields) {
  fields = fields || {};
  var title = String(fields.title || '').trim();
  if (!title) throw new Error('Task title is required.');
  var assignee = lc(fields.assignee_email || '');                 // optional → unassigned
  if (assignee && !canAssignTo(me, assignee)) {
    throw new Error('You can only assign work to someone at your level or below.');
  }
  var priority = CONFIG.PRIORITIES.indexOf(fields.priority) >= 0 ? fields.priority : ''; // optional
  var due = fields.due_date ? String(fields.due_date) : '';        // optional
  var id = genId('T');
  Db.insert(CONFIG.TAB.TASKS, {
    id: id, project_id: project.id, parent_task_id: parentId || '',
    title: title, description: fields.description || '',
    assignee_email: assignee, creator_email: me.email,
    priority: priority, due_date: due, stage: CONFIG.STAGE.TODO,
    created_at: nowIso(), updated_at: nowIso()
  });
  logActivity(me.email, parentId ? 'subtask.create' : 'task.create', 'task', id, title);
  if (assignee && assignee !== me.email) {
    notifyUser(assignee, CONFIG.NOTIF.ASSIGNED, 'New task assigned: ' + title,
      me.name + ' assigned you "' + title + '" in ' + project.name + '.', id);
    try { waNotifyAssigned_(assignee, title, project.name, me.name, priority, due); } catch (e) { Logger.log('WA assign notify failed: ' + e); }
  }
  return shapeTaskRow_(id, me);
}

/* -------------------- Edit definition (used by the modal AND quick inline edits) -------------------- */

function updateTaskDefinition(id, patch) {
  var me = requireUser();
  var t = getTask(id);
  if (!canEditDefinition(me, t)) throw new Error('You cannot edit this task\'s details.');
  var clean = {};
  var textChanged = false;
  if (patch.title !== undefined && String(patch.title).trim()) {
    clean.title = String(patch.title).trim();
    if (clean.title !== t.title) textChanged = true;
  }
  if (patch.description !== undefined) {
    clean.description = patch.description;
    if (clean.description !== (t.description || '')) textChanged = true;
  }
  if (patch.priority !== undefined) {
    if (patch.priority !== '' && CONFIG.PRIORITIES.indexOf(patch.priority) < 0) throw new Error('Invalid priority.');
    clean.priority = patch.priority;
  }
  if (patch.due_date !== undefined) clean.due_date = patch.due_date ? String(patch.due_date) : '';
  clean.updated_at = nowIso();
  Db.update(CONFIG.TAB.TASKS, 'id', id, clean);
  // Log a separate history event for each tracked field that actually changed.
  if (patch.priority !== undefined && patch.priority !== (t.priority || '')) {
    logActivity(me.email, 'task.priority', 'task', id,
      (t.priority || 'none') + ' → ' + (patch.priority || 'none'));
  }
  if (patch.due_date !== undefined) {
    var oldDue = String(t.due_date || '').slice(0, 10) || 'none';
    var newDue = patch.due_date ? String(patch.due_date).slice(0, 10) : 'none';
    if (oldDue !== newDue) {
      logActivity(me.email, 'task.due_date', 'task', id, oldDue + ' → ' + newDue);
    }
  }
  if (textChanged) logActivity(me.email, 'task.update', 'task', id, 'title/description');
  return shapeTaskRow_(id, me);
}

function reassignTask(id, newAssignee) {
  var me = requireUser();
  var t = getTask(id);
  if (!canReassign(me, t)) throw new Error('You cannot reassign this task.');
  var oldAssignee = lc(t.assignee_email || '');
  newAssignee = lc(newAssignee || '');                            // '' → unassign
  if (newAssignee && !canAssignTo(me, newAssignee)) {
    throw new Error('You can only assign to someone at your level or below.');
  }
  Db.update(CONFIG.TAB.TASKS, 'id', id, { assignee_email: newAssignee, updated_at: nowIso() });
  logActivity(me.email, 'task.reassign', 'task', id,
    (oldAssignee || 'none') + ' → ' + (newAssignee || 'none'));
  if (newAssignee && newAssignee !== me.email) {
    notifyUser(newAssignee, CONFIG.NOTIF.ASSIGNED, 'Task reassigned to you: ' + t.title,
      me.name + ' assigned you "' + t.title + '".', id);
    try {
      var proj_ = getProject(t.project_id);
      waNotifyAssigned_(newAssignee, t.title, (proj_ || {}).name || '', me.name, t.priority, t.due_date);
    } catch (e) { Logger.log('WA reassign notify failed: ' + e); }
  }
  return shapeTaskRow_(id, me);
}

/* -------------------- Workflow transitions -------------------- */

/** Core transition + guard, shared by moveStage (modal) and setStageQuick (lists). */
function applyStageTransition_(me, t, target, comment) {
  if (CONFIG.STAGES.indexOf(target) < 0) throw new Error('Unknown stage.');
  var from = t.stage;
  if (from === target) return;
  var id = t.id;

  switch (target) {
    case CONFIG.STAGE.IN_PROGRESS:
      if (from === CONFIG.STAGE.TODO) {
        if (!canAdvanceStage(me, t)) throw new Error('Only the assignee can start this task.');
      } else if (from === CONFIG.STAGE.REVIEW) {            // send back
        if (!canApprove(me, t)) throw new Error('Only an approver can send this back.');
        notifyUser(t.assignee_email, CONFIG.NOTIF.REVIEW, 'Sent back: ' + t.title,
          me.name + ' sent "' + t.title + '" back to In Progress.' + (comment ? ' Note: ' + comment : ''), id);
      } else if (from === CONFIG.STAGE.DONE) {              // reopen
        if (!canApprove(me, t)) throw new Error('Only an approver can reopen this task.');
      }
      break;

    case CONFIG.STAGE.REVIEW:                               // submit for review
      if (!canAdvanceStage(me, t)) throw new Error('Only the assignee can submit for review.');
      if (from !== CONFIG.STAGE.IN_PROGRESS) throw new Error('Move to In Progress first.');
      notifyReviewers_(t, me);
      break;

    case CONFIG.STAGE.DONE:                                 // complete
      if (isSelfSubtask(me, t)) {
        if (!canEditExecution(me, t)) throw new Error('You cannot complete this.');
      } else {
        if (from !== CONFIG.STAGE.REVIEW) throw new Error('Task must be in Review before completion.');
        if (!canApprove(me, t)) throw new Error('Only the creator or a superior can approve.');
        notifyUser(t.assignee_email, CONFIG.NOTIF.REVIEW, 'Approved: ' + t.title,
          me.name + ' approved "' + t.title + '". It is now Completed.', id);
      }
      break;

    case CONFIG.STAGE.TODO:                                 // reset
      if (!canEditDefinition(me, t) && !isDirector(me)) throw new Error('You cannot reset this task.');
      break;
  }

  Db.update(CONFIG.TAB.TASKS, 'id', id, { stage: target, updated_at: nowIso() });
  logActivity(me.email, 'task.stage', 'task', id, from + ' → ' + target);
}

/** Used by the task dialog — returns the full refreshed detail. */
function moveStage(id, target, comment) {
  var me = requireUser();
  var t = getTask(id);
  if (!t) throw new Error('Task not found.');
  applyStageTransition_(me, t, target, comment);
  return getTaskDetail(id);
}

/** Used by the My-Tasks quick dropdown — returns just the light row. */
function setStageQuick(id, target) {
  var me = requireUser();
  var t = getTask(id);
  if (!t) throw new Error('Task not found.');
  applyStageTransition_(me, t, target, '');
  return shapeTaskRow_(id, me);
}

// Thin, intention-revealing wrappers (modal)
function submitForReview(id) { return moveStage(id, CONFIG.STAGE.REVIEW); }
function approveTask(id)      { return moveStage(id, CONFIG.STAGE.DONE); }
function sendBack(id, note)   { return moveStage(id, CONFIG.STAGE.IN_PROGRESS, note); }
function startTask(id)        { return moveStage(id, CONFIG.STAGE.IN_PROGRESS); }

function notifyReviewers_(t, me) {
  var creatorRank = rankOf_(t.creator_email);
  var recipients = {};
  recipients[lc(t.creator_email)] = true;
  Db.filter(CONFIG.TAB.USERS, function (u) {
    return asBool(u.active) && (CONFIG.ROLE_RANK[u.level] || 0) > creatorRank;
  }).forEach(function (u) { recipients[lc(u.email)] = true; });
  delete recipients[me.email];
  Object.keys(recipients).forEach(function (email) {
    notifyUser(email, CONFIG.NOTIF.REVIEW, 'Review needed: ' + t.title,
      me.name + ' submitted "' + t.title + '" for your review.', t.id);
  });
}

/* -------------------- Delete -------------------- */

function deleteTask(id) {
  var me = requireUser();
  var t = getTask(id);
  if (!t) throw new Error('Task not found.');
  if (!canEditDefinition(me, t)) throw new Error('You cannot delete this task.');
  // Collect every descendant at any depth before any rows are deleted (BFS avoids
  // stack limits; collecting first avoids reading a partially-deleted table).
  var descendantIds = collectAllDescendantIds_(id);
  descendantIds.forEach(function (did) {
    cascadeDeleteTaskData_(did);
    Db.remove(CONFIG.TAB.TASKS, 'id', did);
  });
  cascadeDeleteTaskData_(id);
  Db.remove(CONFIG.TAB.TASKS, 'id', id);
  logActivity(me.email, 'task.delete', 'task', id, t.title);
  return { ok: true, removedSubtasks: descendantIds.length };
}

function cascadeDeleteTaskData_(taskId) {
  Db.filter(CONFIG.TAB.CHECKLIST, function (c) { return c.task_id === taskId; })
    .forEach(function (c) { Db.remove(CONFIG.TAB.CHECKLIST, 'id', c.id); });
  Db.filter(CONFIG.TAB.COMMENTS, function (c) { return c.task_id === taskId; })
    .forEach(function (c) { Db.remove(CONFIG.TAB.COMMENTS, 'id', c.id); });
  Db.filter(CONFIG.TAB.ATTACHMENTS, function (a) { return a.task_id === taskId; })
    .forEach(function (a) { Db.remove(CONFIG.TAB.ATTACHMENTS, 'id', a.id); });
}
