/**
 * Perf.gs — TEMPORARY performance-audit harness.
 *
 * Run perfProbe() from the Apps Script editor while signed in as a whitelisted
 * user (ideally the Director, so every code path is exercised). It times the
 * major server operations and prints a table to the execution log
 * (View → Logs / Executions).
 *
 * Nothing in the app depends on this file — it is safe to DELETE the whole file
 * after you have captured your numbers. It adds no overhead to normal requests
 * because it is never called from doGet() or any client function.
 *
 * To compare BEFORE vs AFTER: run it once on the old code (git stash / previous
 * deployment), note the numbers, then run it again on the optimized code.
 */
function perfProbe() {
  var lines = ['=== ADI perf probe @ ' + nowIso() + ' ==='];

  function bench(label, fn, reps) {
    reps = reps || 1;
    var t0 = Date.now();
    var sample;
    for (var i = 0; i < reps; i++) sample = fn();
    var ms = Date.now() - t0;
    var n = '';
    if (sample && sample.length != null) n = ' · ' + sample.length + ' items';
    else if (sample && sample.tasks) n = ' · ' + sample.tasks.length + ' tasks';
    lines.push(pad_(label, 34) + rjust_(ms + ' ms', 10) +
      (reps > 1 ? rjust_('(' + (ms / reps).toFixed(2) + ' ms/op)', 16) : '') + n);
    return sample;
  }

  // Warm caches so we measure compute, not the cold first sheet read.
  try { Db.readAll(CONFIG.TAB.TASKS); Db.readAll(CONFIG.TAB.USERS); Db.readAll(CONFIG.TAB.PROJECTS); }
  catch (e) { lines.push('WARN warm-up failed: ' + e); }

  var taskCount = (Db.readAll(CONFIG.TAB.TASKS) || []).length;
  var userCount = (Db.readAll(CONFIG.TAB.USERS) || []).length;
  lines.push('dataset: ' + taskCount + ' tasks · ' + userCount + ' users');
  lines.push('');

  bench('getBootstrap', function () { return getBootstrap(); });
  bench('getDashboard (full)', function () { return getDashboard({}); });
  bench('getDashboardTasks (light)', function () { return getDashboardTasks({}); });
  bench('getDashboardTasks (search "a")', function () { return getDashboardTasks({ q: 'a' }); });
  bench('listProjects', function () { return listProjects(); });
  bench('listMyWork', function () { return listMyWork(); });

  // Lookup micro-benchmarks: the indexed findBy vs a deliberate linear scan, 2000 reps.
  var probeEmail = userCount ? Db.readAll(CONFIG.TAB.USERS)[0].email : 'none@none';
  bench('Db.findBy USERS (indexed) x2000', function () {
    return Db.findBy(CONFIG.TAB.USERS, 'email', probeEmail);
  }, 2000);
  bench('linear scan USERS x2000 (baseline)', function () {
    var all = Db.readAll(CONFIG.TAB.USERS), hit = null;
    for (var i = 0; i < all.length; i++) if (String(all[i].email) === String(probeEmail)) { hit = all[i]; break; }
    return hit;
  }, 2000);

  Logger.log(lines.join('\n'));
  return lines.join('\n');
}

function pad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function rjust_(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
