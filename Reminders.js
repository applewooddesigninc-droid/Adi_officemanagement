/**
 * Reminders.gs — scheduled jobs (run as the owner, no signed-in viewer).
 *   • dailyDigest  — each morning, one email per person of pending + overdue work.
 *   • dueSoonSweep — a nudge the day before, on the due date, and once when overdue.
 *   • Triggers are installed by installTriggers() (called from Setup).
 * These functions must not call requireUser() — there is no viewer at trigger time.
 */

function dailyDigest() {
  var users = Db.filter(CONFIG.TAB.USERS, function (u) { return asBool(u.active); });
  var tasks = Db.readAll(CONFIG.TAB.TASKS);
  var projects = {};
  Db.readAll(CONFIG.TAB.PROJECTS).forEach(function (p) { projects[p.id] = p.name; });

  users.forEach(function (u) {
    var email = lc(u.email);
    var rank = CONFIG.ROLE_RANK[u.level] || 0;
    var mine = tasks.filter(function (t) {
      return lc(t.assignee_email) === email && t.stage !== CONFIG.STAGE.DONE;
    });
    var overdue = mine.filter(function (t) { return t.due_date && String(t.due_date) < today(); });
    var toApprove = tasks.filter(function (t) {
      return t.stage === CONFIG.STAGE.REVIEW &&
        (lc(t.creator_email) === email || rank > (rankOf_(t.creator_email)));
    });
    if (!mine.length && !toApprove.length) return; // nothing to say

    var html = digestHtml_(u.name || email, mine, overdue, toApprove, projects);
    if (emailEnabled_()) {
      try {
        MailApp.sendEmail({ to: email, subject: '[' + CONFIG.APP_NAME + '] Your daily work digest',
          htmlBody: html, name: CONFIG.COMPANY });
      } catch (e) { Logger.log('Digest email failed for ' + email + ': ' + e); }
    }
    try { waDigest_(u.name || email, email, mine, overdue, toApprove, projects); }
    catch (e) { Logger.log('WA digest failed for ' + email + ': ' + e); }

    Db.insert(CONFIG.TAB.NOTIFICATIONS, {
      id: genId('N'), recipient_email: email, type: CONFIG.NOTIF.DIGEST,
      title: 'Daily digest', body: mine.length + ' pending · ' + overdue.length + ' overdue · ' +
        toApprove.length + ' awaiting your approval', task_id: '', read: false, emailed: true,
      created_at: nowIso()
    });
  });
}

function digestHtml_(name, mine, overdue, toApprove, projects) {
  var B = CONFIG.BRAND;
  function row(t) {
    var od = t.due_date && String(t.due_date) < today();
    return '<tr><td style="padding:6px 8px;border-bottom:1px solid #f0e7d8">' + escapeHtml_(t.title) +
      '<div style="color:' + B.MUTED + ';font-size:11px">' + escapeHtml_(projects[t.project_id] || '') +
      ' · ' + t.stage + '</div></td>' +
      '<td style="padding:6px 8px;border-bottom:1px solid #f0e7d8;text-align:right;font-size:12px;color:' +
      (od ? '#b3261e' : B.MUTED) + '">' + (t.due_date ? (od ? 'overdue ' : 'due ') + t.due_date : '—') + '</td></tr>';
  }
  function section(label, list) {
    if (!list.length) return '';
    return '<h3 style="margin:18px 0 6px;font-size:14px;color:' + B.PRIMARY_DARK + '">' + label +
      ' (' + list.length + ')</h3><table style="width:100%;border-collapse:collapse;font-size:13px">' +
      list.map(row).join('') + '</table>';
  }
  var url = getWebAppUrl();
  return '<div style="font-family:Arial,Helvetica,sans-serif;background:' + B.BG + ';padding:24px;color:' + B.TEXT + '">' +
    '<div style="max-width:600px;margin:auto;background:#fff;border:1px solid #eadfce;border-radius:12px;overflow:hidden">' +
      '<div style="background:' + B.PRIMARY + ';padding:16px 22px;color:#fff">' +
        '<b>ADI</b><span style="color:' + B.ACCENT + '"> Designs</span>' +
        '<div style="font-size:12px;color:#f3e9d6">Good morning, ' + escapeHtml_(name) + '</div></div>' +
      '<div style="padding:8px 22px 22px">' +
        section('Overdue', overdue) +
        section('Pending', mine.filter(function (t) { return !(t.due_date && String(t.due_date) < today()); })) +
        section('Awaiting your approval', toApprove) +
        (url ? '<p style="margin-top:18px"><a href="' + url + '" style="background:' + B.ACCENT +
          ';color:#3a2a10;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px;font-size:14px">Open the app →</a></p>' : '') +
      '</div></div></div>';
}

function dueSoonSweep() {
  var tasks = Db.filter(CONFIG.TAB.TASKS, function (t) {
    return t.stage !== CONFIG.STAGE.DONE && t.due_date;
  });
  var tmw = dateOffset_(1), yst = dateOffset_(-1), tdy = today();
  tasks.forEach(function (t) {
    var d = String(t.due_date);
    if (d === tmw) {
      notifyUser(t.assignee_email, CONFIG.NOTIF.DUE, 'Due tomorrow: ' + t.title,
        '"' + t.title + '" is due tomorrow (' + d + ').', t.id);
    } else if (d === tdy) {
      notifyUser(t.assignee_email, CONFIG.NOTIF.DUE, 'Due today: ' + t.title,
        '"' + t.title + '" is due today.', t.id);
    } else if (d === yst) {
      notifyUser(t.assignee_email, CONFIG.NOTIF.DUE, 'Overdue: ' + t.title,
        '"' + t.title + '" was due ' + d + ' and is now overdue.', t.id);
    }
  });
}

function dateOffset_(days) {
  var d = new Date();
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/* ---------------- Trigger management ---------------- */

function installTriggers() {
  removeAppTriggers_();
  ScriptApp.newTrigger('dailyDigest').timeBased().everyDays(1).atHour(CONFIG.REMINDER.DIGEST_HOUR).create();
  ScriptApp.newTrigger('dueSoonSweep').timeBased().everyDays(1).atHour(CONFIG.REMINDER.DUE_SOON_HOUR).create();
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(2).create();
  return 'Triggers installed: dailyDigest, dueSoonSweep, backupNow.';
}

function removeAppTriggers_() {
  var handlers = { dailyDigest: 1, dueSoonSweep: 1, backupNow: 1 };
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (handlers[tr.getHandlerFunction()]) ScriptApp.deleteTrigger(tr);
  });
}
