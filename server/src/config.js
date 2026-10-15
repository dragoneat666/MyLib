// config.js — every setting comes from an environment variable so the same
// image runs in Docker and in a local test environment.

import path from 'path';

const env = process.env;

const DATA_DIR = path.resolve(env.DATA_DIR || '/data');

export const config = {
  port: parseInt(env.PORT || '3000', 10),
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, 'mylib.db'),
  coversDir: path.join(DATA_DIR, 'covers'),
  backupDir: path.resolve(env.BACKUP_DIR || '/backups'),
  backupCron: env.BACKUP_CRON || '0 2 * * *',
  backupKeepDays: parseInt(env.BACKUP_KEEP_DAYS || '30', 10),
  timezone: env.TZ || 'America/Detroit',
  // Built React app (copied into the image at build time).
  webDir: path.resolve(env.WEB_DIR || path.join(process.cwd(), 'public')),
  // Android APK served for download from Settings, if present.
  apkFile: path.resolve(env.APK_FILE || path.join(process.cwd(), 'apk', 'mylib.apk')),
  // Number of reverse proxies in front of the app (for correct client IPs / https detection).
  trustProxy: env.TRUST_PROXY ?? '1',
  googleBooksKey: env.GOOGLE_BOOKS_API_KEY || '',
  isbndbKey: env.ISBNDB_API_KEY || '',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  userAgent: 'MyLib/1.0 (self-hosted home library; https://github.com/dragoneat666/MyLib)',
  version: env.APP_VERSION || 'dev',
};
