/**
 * Backup.gs — continuity safeguard. A nightly trigger copies the whole data
 * Sheet into …/Backups, keeping the most recent CONFIG.BACKUP.KEEP_COPIES.
 * Pair this with proper account recovery on the owning Gmail (see deploy guide).
 */

function backupNow() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(CONFIG.PROP.DATA_SHEET_ID);
  var backupFolderId = props.getProperty(CONFIG.PROP.BACKUP_FOLDER_ID);
  if (!sheetId || !backupFolderId) throw new Error('Backup not configured. Run Setup.');

  var folder = DriveApp.getFolderById(backupFolderId);
  var stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd_HHmm');
  var copy = DriveApp.getFileById(sheetId).makeCopy('ADI Data Backup ' + stamp, folder);
  pruneBackups_(folder, CONFIG.BACKUP.KEEP_COPIES);
  logActivity('system', 'backup.create', 'system', copy.getId(), copy.getName());
  return copy.getName();
}

function pruneBackups_(folder, keep) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); files.push({ id: f.getId(), date: f.getDateCreated().getTime() }); }
  files.sort(function (a, b) { return b.date - a.date; }); // newest first
  for (var i = keep; i < files.length; i++) {
    try { DriveApp.getFileById(files[i].id).setTrashed(true); } catch (e) {}
  }
}
