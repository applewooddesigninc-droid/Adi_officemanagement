/**
 * WhatsApp.gs — provider-agnostic WhatsApp notification service.
 *
 * Supported providers:
 *   twilio — Twilio WhatsApp API.  WA_API_KEY = "ACXXXXX:authToken", WA_FROM = "whatsapp:+1415…"
 *   wati   — WATI (chat-api.com). WA_API_KEY = Bearer token, WA_API_URL = tenant base URL
 *   meta   — Meta Cloud API.       WA_API_KEY = system access token, WA_FROM = phone_number_id
 *
 * All messages are written to WhatsAppLog and retried up to 3 times on failure.
 * Internal helpers (wa*_) are never exposed via google.script.run; only the
 * public admin functions at the bottom are callable from the client.
 *
 * One-time setup (run once from the Apps Script editor as the Director):
 *   setupWhatsApp({ provider:'twilio', apiKey:'SID:token', from:'whatsapp:+91…', enabled:true });
 */

var WA_MAX_ATTEMPTS_ = 3;

/* ------------------------------------------------------------------ helpers */

function waEnabled_() {
  return PropertiesService.getScriptProperties().getProperty(CONFIG.PROP.WA_ENABLED) === 'true';
}

function waConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {
    provider: p.getProperty(CONFIG.PROP.WA_PROVIDER) || 'twilio',
    apiKey:   p.getProperty(CONFIG.PROP.WA_API_KEY)  || '',
    apiUrl:   p.getProperty(CONFIG.PROP.WA_API_URL)  || '',
    from:     p.getProperty(CONFIG.PROP.WA_FROM)     || ''
  };
}

/** Read phone from the Users sheet for a given email. */
function waGetPhone_(email) {
  var u = Db.findBy(CONFIG.TAB.USERS, 'email', lc(email));
  return u ? String(u.phone || '').trim() : '';
}

/* ---------------------------------------------------------------- providers */

function waSend_(phone, message) {
  var cfg = waConfig_();
  if (!cfg.apiKey) throw new Error('WhatsApp API key not configured. Run setupWhatsApp() first.');
  switch (cfg.provider) {
    case 'twilio': return waTwilio_(cfg, phone, message);
    case 'wati':   return waWati_(cfg, phone, message);
    case 'meta':   return waMeta_(cfg, phone, message);
    default:       throw new Error('Unknown provider: ' + cfg.provider + '. Use twilio, wati, or meta.');
  }
}

function waTwilio_(cfg, phone, message) {
  var parts  = cfg.apiKey.split(':');
  var sid    = parts[0];
  var token  = parts.slice(1).join(':');
  var url    = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
  var resp   = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
    payload: { From: cfg.from, To: 'whatsapp:' + phone, Body: message },
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code < 200 || code > 299) {
    throw new Error('Twilio HTTP ' + code + ': ' + resp.getContentText().slice(0, 300));
  }
}

function waWati_(cfg, phone, message) {
  if (!cfg.apiUrl) throw new Error('WA_API_URL is required for WATI (your tenant base URL).');
  var clean = phone.replace(/[^0-9]/g, '');
  var url   = cfg.apiUrl.replace(/\/$/, '') + '/api/v1/sendSessionMessage/' + clean;
  var resp  = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ messageText: message }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code < 200 || code > 299) {
    throw new Error('WATI HTTP ' + code + ': ' + resp.getContentText().slice(0, 300));
  }
}

function waMeta_(cfg, phone, message) {
  var base  = (cfg.apiUrl || 'https://graph.facebook.com/v19.0').replace(/\/$/, '');
  var url   = base + '/' + cfg.from + '/messages';
  var resp  = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + cfg.apiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone.replace(/[^0-9]/g, ''),
      type: 'text',
      text: { body: message }
    }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code < 200 || code > 299) {
    throw new Error('Meta HTTP ' + code + ': ' + resp.getContentText().slice(0, 300));
  }
}

/* -------------------------------------------------------- retry + log */

/**
 * Send with up to WA_MAX_ATTEMPTS_ attempts (exponential back-off: 2 s, 4 s).
 * Always writes one row to WhatsAppLog regardless of outcome.
 */
function waSendWithRetry_(recipientEmail, phone, message) {
  if (!phone) return false;
  var logId   = genId('W');
  var status  = 'failed';
  var lastErr = '';
  var sentAt  = '';
  var attempts = 0;
  var delay = 2000;

  for (var i = 0; i < WA_MAX_ATTEMPTS_; i++) {
    attempts++;
    if (i > 0) Utilities.sleep(delay);
    delay *= 2;
    try {
      waSend_(phone, message);
      status = 'sent';
      sentAt = nowIso();
      lastErr = '';
      break;
    } catch (e) {
      lastErr = e.message || String(e);
      Logger.log('WA attempt ' + attempts + ' failed (' + phone + '): ' + lastErr);
    }
  }

  try {
    Db.insert(CONFIG.TAB.WA_LOG, {
      id:              logId,
      recipient_email: recipientEmail,
      recipient_phone: phone,
      message:         message.slice(0, 500),
      status:          status,
      provider:        waConfig_().provider,
      attempts:        attempts,
      error:           lastErr.slice(0, 400),
      created_at:      nowIso(),
      sent_at:         sentAt
    });
  } catch (e) {
    Logger.log('WA log write failed: ' + e);
  }

  return status === 'sent';
}

/* ------------------------------------------------ notification builders */

/**
 * Called from Tasks.gs after a task is assigned or reassigned.
 * No-ops silently if WA is disabled or the assignee has no phone.
 */
function waNotifyAssigned_(assigneeEmail, taskTitle, projectName, assignerName, priority, dueDate) {
  if (!waEnabled_()) return;
  var phone = waGetPhone_(assigneeEmail);
  if (!phone) return;

  var url = getWebAppUrl();
  var lines = [
    '*[' + CONFIG.APP_NAME + ']*',
    'Hi! You have been assigned a task.',
    '',
    '*' + taskTitle + '*',
    'Project: ' + projectName,
    'Assigned by: ' + assignerName
  ];
  if (priority)  lines.push('Priority: ' + priority);
  if (dueDate)   lines.push('Due: ' + String(dueDate).slice(0, 10));
  if (url)       lines.push('', 'Open app: ' + url);

  waSendWithRetry_(assigneeEmail, phone, lines.join('\n'));
}

/**
 * Called from Reminders.gs inside dailyDigest() for each user.
 * Mirrors the email digest as a WhatsApp message.
 */
function waDigest_(userName, userEmail, mine, overdue, toApprove, projects) {
  if (!waEnabled_()) return;
  var phone = waGetPhone_(userEmail);
  if (!phone) return;
  if (!mine.length && !toApprove.length) return;

  function taskLine(t) {
    var proj = projects[t.project_id] ? ' [' + projects[t.project_id] + ']' : '';
    var due  = t.due_date ? ' · due ' + String(t.due_date).slice(0, 10) : '';
    return '• ' + t.title + proj + due;
  }

  var sections = [];
  if (overdue.length) {
    sections.push('*Overdue (' + overdue.length + ')*\n' + overdue.slice(0, 5).map(taskLine).join('\n'));
  }
  var pending = mine.filter(function (t) { return !(t.due_date && String(t.due_date) < today()); });
  if (pending.length) {
    sections.push('*Pending (' + pending.length + ')*\n' + pending.slice(0, 5).map(taskLine).join('\n'));
  }
  if (toApprove.length) {
    sections.push('*Awaiting approval (' + toApprove.length + ')*\n' + toApprove.slice(0, 5).map(taskLine).join('\n'));
  }

  var url = getWebAppUrl();
  var msg = '*[' + CONFIG.APP_NAME + ']* — Good morning, ' + userName + '!\n\n' +
    sections.join('\n\n') +
    (url ? '\n\nOpen app: ' + url : '');

  waSendWithRetry_(userEmail, phone, msg);
}

/* ------------------------------------------------ public admin functions */

/**
 * One-time setup. Can be called from the Apps Script editor (no viewer needed)
 * or from the admin panel. Example:
 *   setupWhatsApp({ provider:'twilio', apiKey:'ACXXX:authToken',
 *                   from:'whatsapp:+14155238886', enabled:true });
 */
function setupWhatsApp(config) {
  // Auth: skip when called directly from the editor (no active user session)
  var email = getViewerEmail ? getViewerEmail() : '';
  if (email) {
    var me = getUserByEmail(email);
    if (me && !canManageUsers(me)) throw new Error('Only the Director can configure WhatsApp.');
  }
  config = config || {};
  var p = PropertiesService.getScriptProperties();
  if (config.provider !== undefined) p.setProperty(CONFIG.PROP.WA_PROVIDER, String(config.provider));
  if (config.apiKey   !== undefined) p.setProperty(CONFIG.PROP.WA_API_KEY,  String(config.apiKey));
  if (config.apiUrl   !== undefined) p.setProperty(CONFIG.PROP.WA_API_URL,  String(config.apiUrl));
  if (config.from     !== undefined) p.setProperty(CONFIG.PROP.WA_FROM,     String(config.from));
  if (config.enabled  !== undefined) p.setProperty(CONFIG.PROP.WA_ENABLED,  config.enabled ? 'true' : 'false');

  ensureWaLogTab_();
  ensureUsersPhoneColumn_();
  return getWhatsAppConfig();
}

/** Returns current config (API key presence only, never the actual key). */
function getWhatsAppConfig() {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  var p = PropertiesService.getScriptProperties();
  return {
    enabled:   p.getProperty(CONFIG.PROP.WA_ENABLED) === 'true',
    provider:  p.getProperty(CONFIG.PROP.WA_PROVIDER) || 'twilio',
    apiUrl:    p.getProperty(CONFIG.PROP.WA_API_URL)  || '',
    from:      p.getProperty(CONFIG.PROP.WA_FROM)     || '',
    hasApiKey: !!(p.getProperty(CONFIG.PROP.WA_API_KEY) || '').trim()
  };
}

/** Toggle WhatsApp on/off from the admin panel. */
function toggleWhatsApp(enabled) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  PropertiesService.getScriptProperties().setProperty(CONFIG.PROP.WA_ENABLED, enabled ? 'true' : 'false');
  logActivity(me.email, 'wa.toggle', 'system', 'whatsapp', enabled ? 'enabled' : 'disabled');
  return { enabled: !!enabled };
}

/** Save full WhatsApp config from the admin panel. */
function saveWhatsAppConfig(cfg) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  cfg = cfg || {};
  var p = PropertiesService.getScriptProperties();
  if (cfg.provider) p.setProperty(CONFIG.PROP.WA_PROVIDER, cfg.provider);
  if (cfg.apiKey)   p.setProperty(CONFIG.PROP.WA_API_KEY,  cfg.apiKey);
  if (cfg.apiUrl !== undefined) p.setProperty(CONFIG.PROP.WA_API_URL, cfg.apiUrl || '');
  if (cfg.from  !== undefined)  p.setProperty(CONFIG.PROP.WA_FROM,    cfg.from   || '');
  ensureWaLogTab_();
  ensureUsersPhoneColumn_();
  logActivity(me.email, 'wa.config', 'system', 'whatsapp', cfg.provider || '');
  return getWhatsAppConfig();
}

/** Set / clear a team member's WhatsApp phone number (Director only). */
function updateUserPhone(email, phone) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  phone = String(phone || '').trim();
  ensureUsersPhoneColumn_(); // creates column if setupWhatsApp() was never run
  Db.update(CONFIG.TAB.USERS, 'email', lc(email), { phone: phone });
  logActivity(me.email, 'user.phone', 'user', lc(email), phone ? 'set' : 'cleared');
  return { ok: true };
}

/** Last N WhatsApp log entries (Director only). */
function listWaLogs(limit) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  return Db.readAll(CONFIG.TAB.WA_LOG)
    .sort(function (a, b) { return String(b.created_at) > String(a.created_at) ? 1 : -1; })
    .slice(0, limit || 50)
    .map(function (r) {
      return {
        id: r.id, recipient_email: r.recipient_email, recipient_phone: r.recipient_phone,
        message: String(r.message || '').slice(0, 80) + (r.message && r.message.length > 80 ? '…' : ''),
        status: r.status, provider: r.provider, attempts: r.attempts,
        error: r.error || '', created_at: r.created_at, sent_at: r.sent_at
      };
    });
}

/** Send a test message to any phone number (Director only). */
function testWhatsApp(phone) {
  var me = requireUser();
  if (!canManageUsers(me)) throw new Error('Director only.');
  if (!phone) throw new Error('Phone number is required.');
  if (!waEnabled_()) throw new Error('WhatsApp is currently disabled. Enable it first.');
  var msg = '*[' + CONFIG.APP_NAME + ']* Test message — WhatsApp integration is working! Sent by ' + me.name + '.';
  var ok = waSendWithRetry_(me.email, String(phone).trim(), msg);
  return { ok: ok };
}

/* ------------------------------------------------ schema helpers */

function ensureWaLogTab_() {
  var ss  = Db.ss();
  var tab = CONFIG.TAB.WA_LOG;
  if (!ss.getSheetByName(tab)) {
    var sh = ss.insertSheet(tab);
    sh.appendRow(CONFIG.HEADERS[tab]);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 120);  // id
    sh.setColumnWidth(3, 130);  // phone
    sh.setColumnWidth(4, 300);  // message
  }
}

function ensureUsersPhoneColumn_() {
  var sh      = Db.sheet(CONFIG.TAB.USERS);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('phone') < 0) {
    var nextCol = sh.getLastColumn() + 1;
    sh.getRange(1, nextCol).setValue('phone');
  }
}
