/**
 * Auth.gs
 * Identity + whitelist.
 *
 * The web app is deployed to **execute as the user accessing it**, so the active
 * user IS the real visitor (this works for personal/consumer Gmail too). We must
 * therefore identify people by Session.getActiveUser() ONLY — never fall back to
 * the effective/owner user, which would make every visitor look like the Director.
 * The Director-owned data Sheet + Attachments folder are shared with each member
 * (done automatically in Users.gs) so the app, running as them, can read/write.
 */

/** The verified email of the person currently using the web app (lowercased). */
function getViewerEmail() {
  var email = '';
  try { email = Session.getActiveUser().getEmail() || ''; } catch (e) {}
  return lc(email);
}

/**
 * Returns the full user record for the current viewer, or null if not whitelisted
 * / inactive. Shape: { email, name, level, active, rank, label }.
 */
function getCurrentUser() {
  var email = getViewerEmail();
  if (!email) return null;
  return getUserByEmail(email);
}

function getUserByEmail(email) {
  email = lc(email);
  var u = Db.findBy(CONFIG.TAB.USERS, 'email', email);
  if (!u) return null;
  if (!asBool(u.active)) return null;
  return decorateUser_(u);
}

function decorateUser_(u) {
  return {
    email: lc(u.email),
    name: u.name || u.email,
    level: u.level,
    active: asBool(u.active),
    rank: CONFIG.ROLE_RANK[u.level] || 0,
    label: CONFIG.ROLE_LABEL[u.level] || u.level
  };
}

/** Throws if the viewer is not an active whitelisted user. Returns the user. */
function requireUser() {
  var u = getCurrentUser();
  if (!u) {
    var who = getViewerEmail() || '(could not read your Google sign-in)';
    throw new Error('ACCESS_DENIED: ' + who + ' is not on the ADI team whitelist. ' +
      'Ask the Director to add you in Team.');
  }
  return u;
}

function isDirector(user) { return user && user.level === CONFIG.ROLES.L1; }
function isLead(user)     { return user && user.level === CONFIG.ROLES.L2; }
function isMember(user)   { return user && user.level === CONFIG.ROLES.L3; }
