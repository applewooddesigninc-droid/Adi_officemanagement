/**
 * Dashboard.gs — role-aware summary + filter/search, and the personal work lists.
 * Scope falls out of canViewTask(). Project NAMES travel with each task (so the
 * dashboard never shows raw IDs), and per-task viewer permissions + next-stage
 * options are computed in shapeTask_.
 */

function getDashboard(filters) {
  var me = requireUser();
  filters = filters || {};
  var users = indexUsers_();
  var projects = listProjects();                 // master list (everyone)
  var allVisible = Db.readAll(CONFIG.TAB.TASKS)
    .filter(function (t) { return canViewTask(me, t); });

  var myPending = allVisible.filter(function (t) {
    return lc(t.assignee_email) === me.email && t.stage !== CONFIG.STAGE.DONE;
  });
  var myOverdue = myPending.filter(function (t) { return t.due_date && String(t.due_date) < today(); });
  var awaitingCount = allVisible.filter(function (t) {
    return t.stage === CONFIG.STAGE.REVIEW && canApprove(me, t);
  }).length;

  var stageCounts = {};
  CONFIG.STAGES.forEach(function (s) { stageCounts[s] = 0; });
  allVisible.forEach(function (t) { stageCounts[t.stage] = (stageCounts[t.stage] || 0) + 1; });

  var filtered = applyFilters_(allVisible, filters).map(function (t) { return shapeTask_(t, users, me); });

  var avg = projects.length
    ? Math.round(projects.reduce(function (s, p) { return s + p.completion; }, 0) / projects.length) : 0;

  return {
    stats: {
      projects: projects.length,
      openTasks: allVisible.filter(function (t) { return t.stage !== CONFIG.STAGE.DONE; }).length,
      myPending: myPending.length,
      myOverdue: myOverdue.length,
      awaitingApproval: awaitingCount,
      completionAvg: avg
    },
    stageCounts: stageCounts,
    projects: projects,
    tasks: filtered
  };
}

/**
 * Lightweight personal lists for the My Tasks / Assigned-by-me views — far less
 * data than the whole dashboard, so these screens load quickly.
 *   assignedToMe   : open tasks assigned to me
 *   awaiting       : tasks in Review that I can approve
 *   assignedByMe   : open tasks I created for someone else (delegated work)
 */
function listMyWork() {
  var me = requireUser();
  var users = indexUsers_();
  var all = Db.readAll(CONFIG.TAB.TASKS);
  function shape(t) { return shapeTask_(t, users, me); }
  return {
    assignedToMe: all.filter(function (t) {
      return lc(t.assignee_email) === me.email && t.stage !== CONFIG.STAGE.DONE;
    }).map(shape),
    awaiting: all.filter(function (t) {
      return t.stage === CONFIG.STAGE.REVIEW && canApprove(me, t);
    }).map(shape),
    assignedByMe: all.filter(function (t) {
      return lc(t.creator_email) === me.email && lc(t.assignee_email) !== me.email && t.stage !== CONFIG.STAGE.DONE;
    }).map(shape)
  };
}

function applyFilters_(tasks, f) {
  var users = indexUsers_();
  return tasks.filter(function (t) {
    if (f.project && t.project_id !== f.project) return false;
    if (f.assignee && lc(t.assignee_email) !== lc(f.assignee)) return false;
    if (f.stage && t.stage !== f.stage) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.due === 'overdue' && !(t.due_date && String(t.due_date) < today() && t.stage !== CONFIG.STAGE.DONE)) return false;
    if (f.due === 'today' && String(t.due_date) !== today()) return false;
    if (f.due === 'week') {
      var wk = dateOffset_(7);
      if (!(t.due_date && String(t.due_date) >= today() && String(t.due_date) <= wk)) return false;
    }
    if (f.q) {
      var hay = (t.title + ' ' + t.description + ' ' +
        ((getProject(t.project_id) || {}).name || '') + ' ' +
        ((users[lc(t.assignee_email)] || {}).name || '')).toLowerCase();
      if (hay.indexOf(String(f.q).toLowerCase()) < 0) return false;
    }
    return true;
  });
}
