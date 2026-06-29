/**
 * Projects.gs — projects master list (visible to everyone) + stage-weighted %.
 */

/** Internal lookup (no auth) — used by Permissions and other modules. */
function getProject(id) {
  if (!id) return null;
  return Db.findBy(CONFIG.TAB.PROJECTS, 'id', id);
}

/** Display label for a project: "Name | Type | Year" (omits missing parts). */
function projectLabel_(p) {
  if (!p) return '';
  var bits = [];
  if (p.type) bits.push(p.type);
  if (p.year) bits.push(p.year);
  return bits.length ? (p.name || '') + ' | ' + bits.join(' | ') : (p.name || '');
}

/** Coerce a year value to a 4-digit string, or '' if invalid. */
function normalizeYear_(y) {
  y = String(y == null ? '' : y).trim();
  return /^\d{4}$/.test(y) ? y : '';
}

/** Lazily add the type/year columns to the Projects sheet (safe to re-run). */
function ensureProjectColumns_() {
  var sh = Db.sheet(CONFIG.TAB.PROJECTS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  ['type', 'year'].forEach(function (col) {
    if (headers.indexOf(col) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(col); headers.push(col); }
  });
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
      type: p.type || '',
      year: p.year ? String(p.year) : '',
      label: projectLabel_(p),
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

function createProject(name, description, status, type, year) {
  var me = requireUser();
  if (!canCreateProject(me)) throw new Error('Only Directors and Project Leads can create projects.');
  if (!name || !String(name).trim()) throw new Error('Project name is required.');
  status = CONFIG.PROJECT_STATUS.indexOf(status) >= 0 ? status : 'Active';
  type = CONFIG.PROJECT_TYPES.indexOf(type) >= 0 ? type : '';
  year = normalizeYear_(year);
  ensureProjectColumns_();
  var id = genId('P');
  Db.insert(CONFIG.TAB.PROJECTS, {
    id: id, name: String(name).trim(), description: description || '',
    status: status, owner_email: me.email, created_at: nowIso(), updated_at: nowIso(),
    type: type, year: year
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
  if (patch.type !== undefined) clean.type = CONFIG.PROJECT_TYPES.indexOf(patch.type) >= 0 ? patch.type : '';
  if (patch.year !== undefined) clean.year = normalizeYear_(patch.year);
  clean.updated_at = nowIso();
  if (clean.type !== undefined || clean.year !== undefined) ensureProjectColumns_();
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

// Memoised { lowercased email → user row } map for the current request.
// Db.readAll returns the same array reference while the Users tab is cached, so we
// rebuild only when that reference changes (i.e. after a write invalidates it).
var _usersIdx_ = { src: null, map: null };
function indexUsers_() {
  var rows = Db.readAll(CONFIG.TAB.USERS);
  if (_usersIdx_.src === rows && _usersIdx_.map) return _usersIdx_.map;
  var map = {};
  rows.forEach(function (u) { map[lc(u.email)] = u; });
  _usersIdx_.src = rows;
  _usersIdx_.map = map;
  return map;
}
