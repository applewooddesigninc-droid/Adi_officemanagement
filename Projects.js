/**
 * Projects.gs — projects master list (visible to everyone) + stage-weighted %.
 */

/** Internal lookup (no auth) — used by Permissions and other modules. */
function getProject(id) {
  if (!id) return null;
  return Db.findBy(CONFIG.TAB.PROJECTS, 'id', id);
}

/** Stage-weighted completion for a set of task rows → integer percent. */
function completionOf_(taskRows) {
  if (!taskRows.length) return 0;
  var sum = 0;
  for (var i = 0; i < taskRows.length; i++) {
    sum += (CONFIG.STAGE_WEIGHT[taskRows[i].stage] || 0);
  }
  return Math.round((sum / taskRows.length) * 100);
}

/** Master list — everyone sees it (task detail stays scoped elsewhere). */
function listProjects() {
  requireUser();
  var allTasks = Db.readAll(CONFIG.TAB.TASKS);
  var users = indexUsers_();
  return Db.readAll(CONFIG.TAB.PROJECTS).map(function (p) {
    var tasks = allTasks.filter(function (t) { return t.project_id === p.id; });
    var open = tasks.filter(function (t) { return t.stage !== CONFIG.STAGE.DONE; });
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      status: p.status,
      owner_email: lc(p.owner_email),
      owner_name: (users[lc(p.owner_email)] || {}).name || p.owner_email,
      completion: completionOf_(tasks),
      taskCount: tasks.length,
      openCount: open.length,
      created_at: p.created_at,
      updated_at: p.updated_at
    };
  });
}

function createProject(name, description, status) {
  var me = requireUser();
  if (!canCreateProject(me)) throw new Error('Only Directors and Project Leads can create projects.');
  if (!name || !String(name).trim()) throw new Error('Project name is required.');
  status = CONFIG.PROJECT_STATUS.indexOf(status) >= 0 ? status : 'Active';
  var id = genId('P');
  Db.insert(CONFIG.TAB.PROJECTS, {
    id: id, name: String(name).trim(), description: description || '',
    status: status, owner_email: me.email, created_at: nowIso(), updated_at: nowIso()
  });
  ensureProjectFolder_(id, name); // create the Drive attachments subfolder up front
  logActivity(me.email, 'project.create', 'project', id, name);
  return getProject(id);
}

function updateProject(id, patch) {
  var me = requireUser();
  var p = getProject(id);
  if (!canEditProject(me, p)) throw new Error('You cannot edit this project.');
  var clean = {};
  if (patch.name !== undefined && String(patch.name).trim()) clean.name = String(patch.name).trim();
  if (patch.description !== undefined) clean.description = patch.description;
  if (patch.status !== undefined) {
    if (CONFIG.PROJECT_STATUS.indexOf(patch.status) < 0) throw new Error('Invalid status.');
    clean.status = patch.status;
  }
  clean.updated_at = nowIso();
  Db.update(CONFIG.TAB.PROJECTS, 'id', id, clean);
  logActivity(me.email, 'project.update', 'project', id, JSON.stringify(clean));
  return getProject(id);
}

/** Delete a project and cascade its tasks, checklist items, comments, attachment index. */
function deleteProject(id) {
  var me = requireUser();
  var p = getProject(id);
  if (!canDeleteProject(me, p)) throw new Error('You cannot delete this project.');
  var tasks = Db.filter(CONFIG.TAB.TASKS, function (t) { return t.project_id === id; });
  tasks.forEach(function (t) { cascadeDeleteTaskData_(t.id); });
  tasks.forEach(function (t) { Db.remove(CONFIG.TAB.TASKS, 'id', t.id); });
  Db.remove(CONFIG.TAB.PROJECTS, 'id', id);
  logActivity(me.email, 'project.delete', 'project', id, p ? p.name : '');
  return { ok: true, removedTasks: tasks.length };
}

function indexUsers_() {
  var map = {};
  Db.readAll(CONFIG.TAB.USERS).forEach(function (u) { map[lc(u.email)] = u; });
  return map;
}
