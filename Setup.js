/**
 * Setup.gs — one-time bootstrap. Run setupApp() once from the editor (as the
 * Director). Idempotent: safe to re-run. It creates the Drive home + subfolders,
 * the data Sheet with all tabs/headers, seeds the running user as L1 Director,
 * and installs the scheduled triggers.
 */

function setupApp() {
  var props = PropertiesService.getScriptProperties();

  // 1) Drive: home + Attachments + Backups
  var root = findOrCreateFolder_(CONFIG.FOLDER.ROOT, null);
  var attach = findOrCreateFolder_(CONFIG.FOLDER.ATTACHMENTS, root);
  var backups = findOrCreateFolder_(CONFIG.FOLDER.BACKUPS, root);
  props.setProperty(CONFIG.PROP.ROOT_FOLDER_ID, root.getId());
  props.setProperty(CONFIG.PROP.ATTACH_FOLDER_ID, attach.getId());
  props.setProperty(CONFIG.PROP.BACKUP_FOLDER_ID, backups.getId());

  // 2) Data Sheet
  var sheetId = props.getProperty(CONFIG.PROP.DATA_SHEET_ID);
  var ss;
  if (sheetId) {
    try { ss = SpreadsheetApp.openById(sheetId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(CONFIG.APP_NAME + ' — Data');
    DriveApp.getFileById(ss.getId()).moveTo(root);
    props.setProperty(CONFIG.PROP.DATA_SHEET_ID, ss.getId());
  }

  // 3) Tabs + headers
  ensureSchema_(ss);

  // 4) Seed the running user as the first Director if no active L1 exists
  seedDirector_();

  // 5) Scheduled triggers
  installTriggers();

  props.setProperty(CONFIG.PROP.SETUP_DONE, 'yes');

  var summary = {
    ok: true,
    dataSheetUrl: ss.getUrl(),
    homeFolderUrl: root.getUrl(),
    attachmentsFolderUrl: attach.getUrl(),
    backupsFolderUrl: backups.getUrl(),
    webAppUrl: getWebAppUrl() || '(deploy the web app to get its URL)',
    director: Session.getEffectiveUser().getEmail()
  };
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function ensureSchema_(ss) {
  Object.keys(CONFIG.HEADERS).forEach(function (tab) {
    var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
    var headers = CONFIG.HEADERS[tab];
    var range = sh.getRange(1, 1, 1, headers.length);
    range.setValues([headers]).setFontWeight('bold').setBackground(CONFIG.BRAND.PRIMARY).setFontColor('#ffffff');
    sh.setFrozenRows(1);
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && Object.keys(CONFIG.HEADERS).indexOf('Sheet1') < 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(def);
  }
  return 'Schema ensured.';
}

/** Idempotent schema repair you can run any time. */
function repairSchema() {
  return ensureSchema_(Db.ss());
}

function seedDirector_() {
  var hasDirector = Db.filter(CONFIG.TAB.USERS, function (u) {
    return u.level === CONFIG.ROLES.L1 && asBool(u.active);
  }).length > 0;
  if (hasDirector) return;
  var email = lc(Session.getEffectiveUser().getEmail());
  if (!email) return;
  if (!Db.findBy(CONFIG.TAB.USERS, 'email', email)) {
    Db.insert(CONFIG.TAB.USERS, {
      email: email, name: 'Director', level: CONFIG.ROLES.L1, active: true, created_at: nowIso()
    });
  } else {
    Db.update(CONFIG.TAB.USERS, 'email', email, { level: CONFIG.ROLES.L1, active: true });
  }
}

function findOrCreateFolder_(name, parent) {
  var it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

/**
 * Diagnostic — open the deployed web app URL with ?diag=1, or run from editor,
 * to confirm the server can read the signed-in viewer's email under your chosen
 * deployment settings.
 */
function whoami() {
  var out = {
    activeUser: (function () { try { return Session.getActiveUser().getEmail(); } catch (e) { return '(blocked)'; } })(),
    effectiveUser: (function () { try { return Session.getEffectiveUser().getEmail(); } catch (e) { return '(blocked)'; } })(),
    webAppUrl: getWebAppUrl()
  };
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}

/** DANGER: wipes all data rows (keeps headers). For testing only. */
function resetAllData() {
  Object.keys(CONFIG.HEADERS).forEach(function (tab) {
    var sh = Db.ss().getSheetByName(tab);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  return 'All data rows cleared.';
}
