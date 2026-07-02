/**
 * ResourcePlan.gs — the L1-only resource-planning view (Feature #4/#5).
 *
 * Computes every employee's live workload from estimated hours + the working
 * calendar (WorkCal) + the on-leave flag. Estimation accuracy is left null until
 * the Phase-2 actual-time timer exists.
 *
 * Computed on demand: at a consultancy's team size this is a single task-table
 * read + arithmetic, so it's instant and always consistent. (A stored Workload
 * cache can be layered on later without changing this contract.)
 */

// Workload bands. "Full plate" baseline = 5 working days = 35h of pending work.
var PLAN_FULL_HOURS_ = 35;

function planBand_(pct) {
  if (pct <= 40) return 'light';
  if (pct <= 75) return 'moderate';
  if (pct <= 100) return 'heavy';
  return 'over';
}

function getResourcePlan() {
  var me = requireUser();
  if (!isDirector(me)) throw new Error('Resource planning is available to Directors (L1) only.');

  var users = Db.filter(CONFIG.TAB.USERS, function (u) { return asBool(u.active); });
  var tasks = Db.readAll(CONFIG.TAB.TASKS);
  var projLabel = {};
  Db.readAll(CONFIG.TAB.PROJECTS).forEach(function (p) { projLabel[p.id] = projectLabel_(p); });

  var now = new Date();
  var tdy = today();
  var DONE = CONFIG.STAGE.DONE, IP = CONFIG.STAGE.IN_PROGRESS;
  var prioRank = { High: 3, Medium: 2, Low: 1 };
  var hoursOf = function (t) { return (t.est_hours === '' || t.est_hours == null) ? 0 : (Number(t.est_hours) || 0); };

  var rows = users.map(function (u) {
    var email = lc(u.email);
    var mine = tasks.filter(function (t) { return lc(t.assignee_email) === email && t.stage !== DONE; });

    var pendingH = 0, byProject = {}, estimatedCount = 0;
    mine.forEach(function (t) {
      var h = hoursOf(t);
      pendingH += h;
      if (h > 0) { estimatedCount++; byProject[t.project_id] = (byProject[t.project_id] || 0) + h; }
    });

    var overdue = mine.filter(function (t) { return t.due_date && String(t.due_date).slice(0, 10) < tdy && t.stage !== DONE; });
    var inProgress = mine.filter(function (t) { return t.stage === IP; });
    var onLeave = asBool(u.on_leave);

    var capTodayH = onLeave ? 0 : WorkCal.remainingTodayHours(now);
    var allocTodayH = Math.min(pendingH, capTodayH);
    var pct = Math.round(pendingH / PLAN_FULL_HOURS_ * 100);

    // Expected time all current work is cleared (also = when free for new work).
    var startFrom = onLeave ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0) : now;
    var freeAt = pendingH > 0 ? WorkCal.addWorkingHours(startFrom, pendingH) : now;

    var top = mine.slice().sort(function (a, b) {
      var d = (prioRank[b.priority] || 0) - (prioRank[a.priority] || 0);
      if (d) return d;
      return (String(a.due_date || '9999-99-99')).localeCompare(String(b.due_date || '9999-99-99'));
    })[0];

    return {
      email: email,
      name: u.name || email,
      level: u.level,
      designation: CONFIG.ROLE_LABEL[u.level] || u.level,
      onLeave: onLeave,
      status: onLeave ? 'On leave' : ((inProgress.length || pendingH > 0) ? 'Busy' : 'Available'),
      pendingHours: Math.round(pendingH * 10) / 10,
      allocatedToday: Math.round(allocTodayH * 10) / 10,
      remainingToday: Math.round(capTodayH * 10) / 10,
      workloadPct: pct,
      band: planBand_(pct),
      activeCount: mine.length,
      inProgressCount: inProgress.length,
      overdueCount: overdue.length,
      topTask: top ? { title: top.title, priority: top.priority || '', due: top.due_date ? String(top.due_date).slice(0, 10) : '' } : null,
      byProject: Object.keys(byProject).map(function (pid) {
        return { project: projLabel[pid] || pid, hours: Math.round(byProject[pid] * 10) / 10 };
      }).sort(function (a, b) { return b.hours - a.hours; }),
      expectedFree: pendingH > 0 ? Utilities.formatDate(freeAt, CONFIG.TIMEZONE, 'EEE dd MMM, HH:mm') : 'Now',
      estimationAccuracy: null   // Phase 2: needs actual-time tracking
    };
  });

  // Most-loaded first, but keep on-leave people at the bottom.
  rows.sort(function (a, b) {
    if (a.onLeave !== b.onLeave) return a.onLeave ? 1 : -1;
    return b.workloadPct - a.workloadPct;
  });
  return { generatedAt: Utilities.formatDate(now, CONFIG.TIMEZONE, 'dd MMM yyyy HH:mm'), employees: rows };
}
