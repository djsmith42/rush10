import path from 'node:path';

export const API_PORT = 3031;
export const WEB_PORT = 5191;
export const API_URL = `http://127.0.0.1:${API_PORT}`;
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const ROOT = path.resolve(__dirname, '../..');
/** The suite's private database, recreated on every run. */
export const DATABASE_PATH = path.join(ROOT, '.data/e2e/rush10.db');
export const REPORT_DIR = path.join(ROOT, 'e2e-report');
/** The frontend build the suite serves. */
export const WEB_DIR = path.join(ROOT, '.data/e2e-web');
