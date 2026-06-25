/**
 * Attachments.gs — files live in Drive under  …/Attachments/{Project}/{Task}/
 * so they are browsable outside the app too. The Sheet stores only the links.
 *
 * Two ways to attach (per brief 5.8):
 *   • Upload  — small files pushed through the web app (drawings, PDFs, images, docs).
 *   • Link    — point to an existing Drive file (the route for large CAD files).
 */

function attachRoot_() {
  var id = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP.ATTACH_FOLDER_ID);
  if (!id) throw new Error('Attachments folder not configured. Run Setup.');
  return DriveApp.getFolderById(id);
}

function childFolder_(parent, name) {
  name = String(name).replace(/[\\/]+/g, '-').slice(0, 120) || 'untitled';
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Folder for a project (created eagerly when the project is created). */
function ensureProjectFolder_(projectId, projectName) {
  return childFolder_(attachRoot_(), (projectName || 'Project') + ' [' + projectId + ']');
}

function ensureTaskFolder_(task) {
  var project = getProject(task.project_id) || { name: 'Project', id: task.project_id };
  var pf = ensureProjectFolder_(project.id, project.name);
  return childFolder_(pf, (task.title || 'Task') + ' [' + task.id + ']');
}

/** Upload a base64 file from the browser and index it. */
function uploadAttachment(taskId, base64, fileName, mimeType) {
  var me = requireUser();
  var t = getTask(taskId);
  if (!t) throw new Error('Task not found.');
  if (!canComment(me, t)) throw new Error('You cannot attach files to this task.');
  if (!base64 || !fileName) throw new Error('Missing file data.');

  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName);
  var folder = ensureTaskFolder_(t);
  var file = folder.createFile(blob);
  return indexAttachment_(me, t, file, 'upload');
}

/** Attach an existing Drive file by its share URL (large-file friendly). */
function linkAttachment(taskId, driveUrl, label) {
  var me = requireUser();
  var t = getTask(taskId);
  if (!t) throw new Error('Task not found.');
  if (!canComment(me, t)) throw new Error('You cannot attach files to this task.');
  var fileId = extractDriveId_(driveUrl);
  if (!fileId) throw new Error('That does not look like a Google Drive link.');
  var file;
  try { file = DriveApp.getFileById(fileId); }
  catch (e) { throw new Error('Cannot access that Drive file. Make sure it is shared with the app owner.'); }
  return indexAttachment_(me, t, file, 'link', label);
}

function indexAttachment_(me, t, file, kind, label) {
  var id = genId('A');
  Db.insert(CONFIG.TAB.ATTACHMENTS, {
    id: id, task_id: t.id, project_id: t.project_id,
    file_name: label || file.getName(), drive_url: file.getUrl(), drive_file_id: file.getId(),
    kind: kind, uploaded_by: me.email, created_at: nowIso()
  });
  logActivity(me.email, 'attachment.' + kind, 'task', t.id, file.getName());
  // notify assignee/creator of the new attachment (counts as activity on their task)
  [t.assignee_email, t.creator_email].forEach(function (email) {
    email = lc(email);
    if (email && email !== me.email) {
      notifyUser(email, CONFIG.NOTIF.COMMENT, 'New attachment on ' + t.title,
        me.name + ' attached "' + (label || file.getName()) + '".', t.id);
    }
  });
  return getTaskDetail(t.id);
}

function deleteAttachment(attachmentId) {
  var me = requireUser();
  var a = Db.findBy(CONFIG.TAB.ATTACHMENTS, 'id', attachmentId);
  if (!a) throw new Error('Attachment not found.');
  var t = getTask(a.task_id);
  var mayModerate = lc(a.uploaded_by) === me.email || isDirector(me) || (t && me.rank > rankOf_(t.creator_email));
  if (!mayModerate) throw new Error('You cannot remove this attachment.');
  // Only trash files the app uploaded; never trash a linked original.
  if (a.kind === 'upload') {
    try { DriveApp.getFileById(a.drive_file_id).setTrashed(true); } catch (e) {}
  }
  Db.remove(CONFIG.TAB.ATTACHMENTS, 'id', attachmentId);
  logActivity(me.email, 'attachment.delete', 'task', a.task_id, a.file_name);
  return getTaskDetail(a.task_id);
}

function extractDriveId_(url) {
  if (!url) return '';
  var s = String(url);
  var pats = [/\/d\/([A-Za-z0-9_\-]{15,})/, /[?&]id=([A-Za-z0-9_\-]{15,})/, /^([A-Za-z0-9_\-]{15,})$/];
  for (var i = 0; i < pats.length; i++) { var m = s.match(pats[i]); if (m) return m[1]; }
  return '';
}
