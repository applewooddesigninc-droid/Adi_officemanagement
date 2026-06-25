/**
 * Permissions.gs
 * The permission matrix — extended to FOUR levels with same-level collaboration.
 *
 * Levels (strict): L1 Director (4) > L2 Project Lead (3) > L3 Team Member (2) >
 * L4 Junior Member (1).
 *
 * Assignment rule: you may assign work to anyone at YOUR level or BELOW
 *   (rank <= yours). Top-down assignment still holds; peers can now assign to
 *   one another (e.g. L1↔L1, L3↔L3).
 * Creation: projects and top-level tasks are still created by L1 & L2. L3 & L4
 *   collaborate by creating SUBTASKS under a task they're on and assigning those
 *   to peers/below.
 * Review gate: the task's creator (any level) — or anyone above the creator's
 *   level — approves. A self-assigned task needs no gate.
 *
 * Each task splits into Definition (title, description, due date, assignee,
 * priority) and Execution (stage, checklist, comments, attachments).
 */

function rankOf_(email) {
  var u = Db.findBy(CONFIG.TAB.USERS, 'email', lc(email));
  if (!u || !asBool(u.active)) return 0;
  return CONFIG.ROLE_RANK[u.level] || 0;
}

function levelOf_(email) {
  var u = Db.findBy(CONFIG.TAB.USERS, 'email', lc(email));
  return u ? u.level : null;
}

function isSelf_(user, email) { return lc(user.email) === lc(email); }

/* ---------------- Users ---------------- */

function canManageUsers(user) {
  return isDirector(user);
}

/* ---------------- Projects ---------------- */

function canCreateProject(user) {
  return isDirector(user) || isLead(user); // L1 + L2
}

function canEditProject(user, project) {
  if (!project) return false;
  if (isDirector(user)) return true;
  if (isLead(user)) return isSelf_(user, project.owner_email);
  return false;
}

function canDeleteProject(user, project) {
  return canEditProject(user, project);
}

/* ---------------- Task creation ---------------- */

/** Create a top-level task in a project (L1 anywhere; L2 own or a lower-owned project). */
function canCreateTopLevelTask(user, project) {
  if (!project) return false;
  if (isDirector(user)) return true;
  if (isLead(user)) {
    if (isSelf_(user, project.owner_email)) return true;
    return rankOf_(project.owner_email) < user.rank; // a project owned by someone below
  }
  return false; // L3 / L4 do not create top-level tasks
}

/**
 * Create a subtask under a parent. Leads/Directors anywhere; otherwise the
 * parent's assignee or creator — so anyone can break down work they're on and
 * delegate the pieces (to peers or below, per canAssignTo).
 */
function canCreateSubtask(user, parentTask) {
  if (!parentTask) return false;
  if (isDirector(user) || isLead(user)) return true;
  return isSelf_(user, parentTask.assignee_email) || isSelf_(user, parentTask.creator_email);
}

/** Assignment follows the hierarchy: anyone at your level or below it. */
function canAssignTo(user, assigneeEmail) {
  var r = rankOf_(assigneeEmail);
  return r > 0 && r <= user.rank;
}

/* ---------------- Task editing ---------------- */

/** Edit Definition: the creator (any level), or anyone above the creator. */
function canEditDefinition(user, task) {
  if (!task) return false;
  if (isDirector(user)) return true;
  if (isSelf_(user, task.creator_email)) return true;
  return user.rank > rankOf_(task.creator_email);
}

/** Edit Execution: the assignee does the work; a superior may override. */
function canEditExecution(user, task) {
  if (!task) return false;
  if (isDirector(user)) return true;
  if (isSelf_(user, task.assignee_email)) return true;
  return user.rank > rankOf_(task.creator_email);
}

/** Move To Do → In Progress → Review (the assignee drives the task forward). */
function canAdvanceStage(user, task) {
  if (!task) return false;
  if (isDirector(user)) return true;
  return isSelf_(user, task.assignee_email);
}

/**
 * Review → Completed (approve) or send back. The approver is the task's creator
 * (any level) or anyone above the creator's level. A self-assigned task is
 * exempt from the gate (handled via isSelfSubtask in Tasks.moveStage).
 */
function canApprove(user, task) {
  if (!task) return false;
  if (isDirector(user)) return true;
  if (isSelf_(user, task.creator_email)) return true;
  return user.rank > rankOf_(task.creator_email);
}

/** A user completing their own self-created subtask (no gate required). */
function isSelfSubtask(user, task) {
  return !!task.parent_task_id &&
         isSelf_(user, task.creator_email) &&
         isSelf_(user, task.assignee_email);
}

/** Reassign: the creator (any level) or anyone above; target via canAssignTo. */
function canReassign(user, task) {
  if (!task) return false;
  if (isDirector(user)) return true;
  return isSelf_(user, task.creator_email) || user.rank > rankOf_(task.creator_email);
}

/* ---------------- Visibility ---------------- */

function canViewTask(user, task) {
  if (!task) return false;
  if (isDirector(user)) return true;
  if (isSelf_(user, task.assignee_email) || isSelf_(user, task.creator_email)) return true;
  if (user.rank > rankOf_(task.creator_email)) return true;   // oversight of lower levels
  if (user.rank > rankOf_(task.assignee_email)) return true;
  var proj = getProject(task.project_id);
  return !!(proj && isSelf_(user, proj.owner_email));          // your own projects
}

function canComment(user, task) {
  return canViewTask(user, task);
}

/** Master project list is visible to everyone (task detail stays scoped). */
function canViewProjectList() { return true; }
