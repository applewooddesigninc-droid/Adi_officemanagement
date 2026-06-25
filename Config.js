/**
 * Config.gs
 * ADI Designs — Office Work & Task Management System
 * Central constants. Nothing here touches data; pure configuration.
 *
 * Implements decisions from ADI-Work-Management-Requirement-Brief-v1.0:
 *  - Roles strictly by level (L1 > L2 > L3) firm-wide.
 *  - Fixed four-stage workflow with a gated Review step.
 *  - Stage-weighted completion %.
 *  - IST throughout, English, ADI warm palette branding.
 */

var CONFIG = {
  APP_NAME: 'ADI Work Management',
  COMPANY: 'ADI Designs Pvt. Ltd.',
  TIMEZONE: 'Asia/Kolkata',

  // ---- Script Property keys (set during Setup) ----
  PROP: {
    DATA_SHEET_ID:    'DATA_SHEET_ID',
    ROOT_FOLDER_ID:   'ROOT_FOLDER_ID',
    ATTACH_FOLDER_ID: 'ATTACH_FOLDER_ID',
    BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID',
    SETUP_DONE:       'SETUP_DONE',
    // WhatsApp
    EMAIL_ENABLED: 'EMAIL_ENABLED', // 'true' (default) / 'false'
    WA_ENABLED:  'WA_ENABLED',   // 'true' / 'false'
    WA_PROVIDER: 'WA_PROVIDER',  // 'twilio' | 'wati' | 'meta'
    WA_API_KEY:  'WA_API_KEY',   // SID:token (Twilio) | Bearer token (WATI/Meta)
    WA_API_URL:  'WA_API_URL',   // base URL (WATI / Meta)
    WA_FROM:     'WA_FROM'       // sender number / phone_number_id
  },

  // ---- Drive folder names ----
  FOLDER: {
    ROOT: 'ADI Work Management',
    ATTACHMENTS: 'Attachments',
    BACKUPS: 'Backups'
  },

  // ---- Sheet tab names (the database) ----
  TAB: {
    USERS:         'Users',
    PROJECTS:      'Projects',
    TASKS:         'Tasks',
    CHECKLIST:     'ChecklistItems',
    COMMENTS:      'Comments',
    ATTACHMENTS:   'AttachmentsIndex',
    NOTIFICATIONS: 'NotificationLog',
    ACTIVITY:      'ActivityLog',
    WA_LOG:        'WhatsAppLog'
  },

  // ---- Column headers per tab (order matters; Setup writes these) ----
  HEADERS: {
    Users:           ['email', 'name', 'level', 'active', 'created_at', 'phone'],
    Projects:        ['id', 'name', 'description', 'status', 'owner_email', 'created_at', 'updated_at'],
    Tasks:           ['id', 'project_id', 'parent_task_id', 'title', 'description', 'assignee_email',
                      'creator_email', 'priority', 'due_date', 'stage', 'created_at', 'updated_at'],
    ChecklistItems:  ['id', 'task_id', 'text', 'done', 'position', 'created_at'],
    Comments:        ['id', 'task_id', 'author_email', 'body', 'mentions', 'created_at', 'edited_at', 'deleted'],
    AttachmentsIndex:['id', 'task_id', 'project_id', 'file_name', 'drive_url', 'drive_file_id', 'kind', 'uploaded_by', 'created_at'],
    NotificationLog: ['id', 'recipient_email', 'type', 'title', 'body', 'task_id', 'read', 'emailed', 'created_at'],
    ActivityLog:     ['id', 'actor_email', 'action', 'entity_type', 'entity_id', 'details', 'created_at'],
    WhatsAppLog:     ['id', 'recipient_email', 'recipient_phone', 'message', 'status',
                      'provider', 'attempts', 'error', 'created_at', 'sent_at']
  },

  // ---- Roles & hierarchy (strict by level) ----
  ROLES: { L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4' },
  ROLE_LABEL: { L1: 'Director / Admin', L2: 'Project Lead', L3: 'Team Member', L4: 'Junior Member' },
  ROLE_RANK: { L1: 4, L2: 3, L3: 2, L4: 1 }, // higher rank = more authority

  // ---- Project status ----
  PROJECT_STATUS: ['Active', 'On-hold', 'Completed'],

  // ---- Task workflow stages (fixed, in order) ----
  STAGES: ['To Do', 'In Progress', 'Review', 'Completed'],
  STAGE: { TODO: 'To Do', IN_PROGRESS: 'In Progress', REVIEW: 'Review', DONE: 'Completed' },

  // ---- Stage-weighted completion (partial credit per stage) ----
  STAGE_WEIGHT: { 'To Do': 0, 'In Progress': 0.34, 'Review': 0.67, 'Completed': 1 },

  // ---- Priorities ----
  PRIORITIES: ['Low', 'Medium', 'High'],

  // ---- Notification types ----
  NOTIF: {
    ASSIGNED: 'assigned',
    DUE: 'due',
    REVIEW: 'review',
    COMMENT: 'comment',
    MENTION: 'mention',
    DIGEST: 'digest',
    SYSTEM: 'system'
  },

  // ---- Reminder windows ----
  REMINDER: {
    DIGEST_HOUR: 8,        // daily digest sent ~08:00 IST
    DUE_SOON_HOUR: 9,      // due-soon / overdue sweep ~09:00 IST
    DUE_SOON_DAYS: 1       // nudge 1 day before due date
  },

  // ---- Backup ----
  BACKUP: { KEEP_COPIES: 30 }, // retain last N daily backups

  // ---- Branding (ADI warm palette, from logo) ----
  BRAND: {
    PRIMARY: '#77361A',     // warm brown (ADI / Designs wordmark)
    PRIMARY_DARK: '#5C2912',
    ACCENT: '#C1A051',      // gold (border + accents)
    ACCENT_DARK: '#A8893E',
    BG: '#FBF8F4',
    SURFACE: '#FFFFFF',
    TEXT: '#2B2118',
    MUTED: '#8A7B6B'
  }
};
