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

  var childrenOf = buildChildrenIndex_(allVisible);

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

  // When a filter is active, also include ancestor tasks of matched subtasks so
  // the client can display them with their parent context in the tree view.
  var filtered = applyFiltersWithAncestors_(allVisible, filters)
    .map(function (t) { return shapeTask_(t, users, me, childrenOf); });

  var avg = projects.length
    ? Math.round(projects.reduce(function (s, p) { return s + p.completion; }, 0) / projects.length) : 0;

  var projectMap = {};
  projects.forEach(function (p) { projectMap[p.id] = p; });

  var tdy = today();
  var wk  = dateOffset_(7);
  var open = allVisible.filter(function (t) { return t.stage !== CONFIG.STAGE.DONE; });

  function miniShape_(t) {
    return {
      id: t.id,
      title: t.title,
      stage: t.stage,
      due_date: String(t.due_date).slice(0, 10) || '',
      assignee_name: (users[lc(t.assignee_email)] || {}).name || t.assignee_email,
      project_name: (projectMap[t.project_id] || {}).name || ''
    };
  }

  var overdueList = open
    .filter(function (t) { return t.due_date && String(t.due_date).slice(0, 10) < tdy; })
    .sort(function (a, b) { return String(a.due_date) < String(b.due_date) ? -1 : 1; })
    .slice(0, 8).map(miniShape_);

  var dueTodayList = open
    .filter(function (t) { return String(t.due_date).slice(0, 10) === tdy; })
    .map(miniShape_);

  var dueWeekList = open
    .filter(function (t) {
      var d = String(t.due_date).slice(0, 10);
      return t.due_date && d > tdy && d <= wk;
    })
    .sort(function (a, b) { return String(a.due_date) < String(b.due_date) ? -1 : 1; })
    .slice(0, 8).map(miniShape_);

  var byEmployee = Db.readAll(CONFIG.TAB.USERS)
    .filter(function (u) { return u.active === true || String(u.active).toLowerCase() === 'true'; })
    .map(function (u) {
      var email = lc(u.email);
      var assigned = open.filter(function (t) { return lc(t.assignee_email) === email; });
      var late = assigned.filter(function (t) { return t.due_date && String(t.due_date).slice(0, 10) < tdy; });
      return { name: u.name, email: u.email, open: assigned.length, overdue: late.length };
    })
    .filter(function (u) { return u.open > 0; })
    .sort(function (a, b) { return b.open - a.open; });

  var recentlyUpdated = allVisible
    .filter(function (t) { return t.updated_at; })
    .sort(function (a, b) { return String(b.updated_at) > String(a.updated_at) ? 1 : -1; })
    .slice(0, 8).map(miniShape_);

  var unassigned = open
    .filter(function (t) { return !t.assignee_email || !String(t.assignee_email).trim(); })
    .sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; })
    .slice(0, 8).map(miniShape_);

  return {
    stats: {
      projects: projects.length,
      openTasks: open.length,
      myPending: myPending.length,
      myOverdue: myOverdue.length,
      awaitingApproval: awaitingCount,
      completionAvg: avg
    },
    stageCounts: stageCounts,
    projects: projects,
    tasks: filtered,
    widgets: {
      overdue: overdueList,
      dueToday: dueTodayList,
      dueWeek: dueWeekList,
      byEmployee: byEmployee,
      recentlyUpdated: recentlyUpdated,
      unassigned: unassigned
    }
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
  var visible = all.filter(function (t) { return canViewTask(me, t); });
  var childrenOf = buildChildrenIndex_(visible);
  function shape(t) { return shapeTask_(t, users, me, childrenOf); }

  // For "assigned to me" and "assigned by me", include parent tasks as context
  // so the client can render the full ancestry chain with indentation.
  var assignedToMe = visible.filter(function (t) {
    return lc(t.assignee_email) === me.email && t.stage !== CONFIG.STAGE.DONE;
  });
  var awaiting = visible.filter(function (t) {
    return t.stage === CONFIG.STAGE.REVIEW && canApprove(me, t);
  });
  var assignedByMe = visible.filter(function (t) {
    return lc(t.creator_email) === me.email && lc(t.assignee_email) !== me.email && t.stage !== CONFIG.STAGE.DONE;
  });

  return {
    assignedToMe: withAncestors_(visible, assignedToMe).map(shape),
    awaiting:     withAncestors_(visible, awaiting).map(shape),
    assignedByMe: withAncestors_(visible, assignedByMe).map(shape)
  };
}

/**
 * Given a base list and a filtered subset, return the subset plus every
 * ancestor task that appears in the base list but not already in the subset.
 * Ancestors are included so the client can display proper tree indentation.
 */
function withAncestors_(allTasks, subset) {
  var byId = {};
  allTasks.forEach(function (t) { byId[t.id] = t; });
  var toInclude = {};
  subset.forEach(function (t) { toInclude[t.id] = true; });
  subset.forEach(function (t) {
    var pid = t.parent_task_id;
    while (pid && !toInclude[pid]) {
      toInclude[pid] = true;
      var p = byId[pid];
      pid = p ? p.parent_task_id : null;
    }
  });
  return allTasks.filter(function (t) { return toInclude[t.id]; });
}

/**
 * Apply filters and also pull in ancestor tasks of every matched subtask so the
 * client always receives a complete lineage for tree rendering.  When no filter
 * is active the full visible list is returned unchanged.
 */
function applyFiltersWithAncestors_(allTasks, f) {
  var matched = applyFilters_(allTasks, f);
  if (matched.length === allTasks.length) return allTasks; // no filter active
  return withAncestors_(allTasks, matched);
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
