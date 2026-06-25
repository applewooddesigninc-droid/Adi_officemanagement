/**
 * Code.gs — web entry point + client bootstrap.
 * The HTML UI calls the top-level functions in the other .gs files via
 * google.script.run; every one of them re-checks permissions on the server.
 */

function doGet(e) {
  e = e || {};
  if (e.parameter && e.parameter.diag) {
    return ContentService
      .createTextOutput(JSON.stringify(whoami(), null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.deepLinkTask = (e.parameter && e.parameter.task) ? e.parameter.task : '';
  return tmpl.evaluate()
    .setTitle(CONFIG.APP_NAME + ' · ' + CONFIG.COMPANY)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://ssl.gstatic.com/docs/script/images/favicon.ico')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Lets HTML files pull in CSS/JS partials: <?!= include('Styles') ?> */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function isSetupDone_() {
  var p = PropertiesService.getScriptProperties();
  return p.getProperty(CONFIG.PROP.SETUP_DONE) === 'yes' &&
         !!p.getProperty(CONFIG.PROP.DATA_SHEET_ID);
}

/**
 * Everything the client needs on load. Returns {ok:false,...} for a friendly
 * access screen rather than throwing, so non-whitelisted visitors get a clear
 * message instead of a raw error.
 */
function getBootstrap() {
  if (!isSetupDone_()) {
    return { ok: false, setup: false, email: getViewerEmail(),
             message: 'The app has not been set up yet. The Director must run setupApp() once.' };
  }
  var email = getViewerEmail();
  var u = email ? getUserByEmail(email) : null;
  if (!u) {
    return { ok: false, setup: true, email: email,
             message: email ? (email + ' is not on the ADI team whitelist.')
                            : 'Could not read your Google sign-in. Open the app directly (not embedded).' };
  }
  return {
    ok: true,
    user: { email: u.email, name: u.name, level: u.level, label: u.label, rank: u.rank },
    brand: CONFIG.BRAND,
    meta: {
      appName: CONFIG.APP_NAME, company: CONFIG.COMPANY,
      stages: CONFIG.STAGES, stage: CONFIG.STAGE, priorities: CONFIG.PRIORITIES,
      projectStatus: CONFIG.PROJECT_STATUS, roleLabel: CONFIG.ROLE_LABEL,
      stageWeight: CONFIG.STAGE_WEIGHT
    },
    roster: listUsers(),
    canCreateProject: canCreateProject(u),
    canManageUsers: canManageUsers(u),
    webAppUrl: getWebAppUrl()
  };
}
