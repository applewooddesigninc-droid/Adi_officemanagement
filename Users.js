/**
 * Users.gs — team & whitelist management (Director only for writes).
 * The whitelist IS the access control: only active rows here can sign in.
 *
 * Because the web app runs as each accessing user, every member needs read/write
 * access to the Director-owned data Sheet (and the Attachments folder, for
 * uploads). addUser() therefore auto-shares those with the member's email; the
 * Backups folder is NOT shared, so it stays private to the Director.
 */

/** Everyone may read the roster (needed for assignee pickers & @-mentions). */
function listUsers() {
  requireUser();
  return Db.readAll(CONFIG.TAB.USERS).map(function (u) {
    return {
      email: lc(u.email),
      name: u.name || u.email,
      level: u.level,
      label: CONFIG.ROLE_LABEL[u.level] || u.level,
      active: asBool(u.active),
      created_at: u.created_at
    };
  });
}

/** Full roster including phone — Director only (used by admin panel). */
function listUsersAdmin() {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  return Db.readAll(CONFIG.TAB.USERS).map(function (u) {
    return {
      email: lc(u.email), name: u.name || u.email, level: u.level,
      label: CONFIG.ROLE_LABEL[u.level] || u.level,
      active: asBool(u.active), phone: u.phone || '', created_at: u.created_at
    };
  });
}

/** People this user is allowed to assign work to (strictly below their level). */
function listAssignableUsers() {
  var me = requireUser();
  return listUsers().filter(function (u) {
    return u.active && canAssignTo(me, u.email);
  });
}

/** Validate international phone format (+country digits). Empty string is allowed (no phone). */
function validatePhone_(phone) {
  if (!phone) return; // optional
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new Error('Invalid mobile number "' + phone + '". Use international format: +91XXXXXXXXXX (+ then 7–15 digits).');
  }
}

function addUser(email, name, level, phone) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Only the Director can manage users.');
  email = lc(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Invalid email: ' + email);
  if (CONFIG.ROLES[level] !== level) throw new Error('Level must be L1, L2 or L3.');
  phone = String(phone || '').trim();
  validatePhone_(phone);
  ensureUsersPhoneColumn_(); // safe no-op if column already exists
  var existing = Db.findBy(CONFIG.TAB.USERS, 'email', email);
  if (existing) {
    var upd = { name: name || existing.name, level: level, active: true };
    if (phone !== undefined) upd.phone = phone;
    Db.update(CONFIG.TAB.USERS, 'email', email, upd);
    shareDataWith_(email);
    logActivity(me.email, 'user.update', 'user', email, level);
    return getUserByEmail(email);
  }
  Db.insert(CONFIG.TAB.USERS, {
    email: email, name: name || email, level: level, active: true, created_at: nowIso(), phone: phone
  });
  shareDataWith_(email);
  logActivity(me.email, 'user.add', 'user', email, level);
  notifyUser(email, CONFIG.NOTIF.SYSTEM, 'Welcome to ' + CONFIG.APP_NAME,
    'You have been added to the ADI work system as ' + (CONFIG.ROLE_LABEL[level] || level) +
    '. Open the app with your own Google account and you will see your tasks.', '');
  return decorateUser_(Db.findBy(CONFIG.TAB.USERS, 'email', email));
}

function updateUser(email, patch) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Only the Director can manage users.');
  email = lc(email);
  var clean = {};
  if (patch.name !== undefined) clean.name = patch.name;
  if (patch.level !== undefined) {
    if (CONFIG.ROLES[patch.level] !== patch.level) throw new Error('Invalid level.');
    clean.level = patch.level;
  }
  if (patch.active !== undefined) clean.active = !!patch.active;
  // Never allow removing/ demoting the last active Director.
  if ((clean.active === false || (clean.level && clean.level !== CONFIG.ROLES.L1))) {
    guardLastDirector_(email);
  }
  Db.update(CONFIG.TAB.USERS, 'email', email, clean);
  if (clean.active === true) shareDataWith_(email);
  if (clean.active === false) unshareDataWith_(email);
  logActivity(me.email, 'user.update', 'user', email, JSON.stringify(clean));
  return getUserByEmail(email) || { email: email, deactivated: true };
}

/** Deactivate (preferred over delete — preserves history & references). */
function deactivateUser(email) {
  return updateUser(email, { active: false });
}

function guardLastDirector_(email) {
  var directors = Db.filter(CONFIG.TAB.USERS, function (u) {
    return u.level === CONFIG.ROLES.L1 && asBool(u.active);
  });
  if (directors.length <= 1 && directors.some(function (d) { return lc(d.email) === lc(email); })) {
    throw new Error('Cannot remove or demote the last active Director.');
  }
}

/* ---------------- Drive sharing (so the app, running as each user, can read/write) ---------------- */

/** Grant a member edit access to the data Sheet + Attachments folder. */
function shareDataWith_(email) {
  email = lc(email);
  if (!email) return;
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(CONFIG.PROP.DATA_SHEET_ID);
  var attachId = props.getProperty(CONFIG.PROP.ATTACH_FOLDER_ID);
  if (sheetId) { try { DriveApp.getFileById(sheetId).addEditor(email); } catch (e) { Logger.log('Share sheet failed for ' + email + ': ' + e); } }
  if (attachId) { try { DriveApp.getFolderById(attachId).addEditor(email); } catch (e) { Logger.log('Share folder failed for ' + email + ': ' + e); } }
}

/** Revoke a member's access (on deactivate). */
function unshareDataWith_(email) {
  email = lc(email);
  if (!email) return;
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(CONFIG.PROP.DATA_SHEET_ID);
  var attachId = props.getProperty(CONFIG.PROP.ATTACH_FOLDER_ID);
  if (sheetId) { try { DriveApp.getFileById(sheetId).removeEditor(email); } catch (e) {} }
  if (attachId) { try { DriveApp.getFolderById(attachId).removeEditor(email); } catch (e) {} }
}

/**
 * One-time helper: re-share the data with everyone already on the team.
 * Run this once from the editor after upgrading (Director only), so members
 * added before this fix also get access. Safe to re-run.
 */
function shareWithAllActiveUsers() {
  var me = getCurrentUser();
  if (!me || !canManageUsers(me)) throw new Error('Run this as the Director.');
  var owner = lc(Session.getEffectiveUser().getEmail());
  var n = 0;
  Db.filter(CONFIG.TAB.USERS, function (u) { return asBool(u.active); }).forEach(function (u) {
    if (lc(u.email) === owner) return; // skip the owner
    shareDataWith_(u.email);
    n++;
  });
  return 'Shared data with ' + n + ' active member(s).';
}
