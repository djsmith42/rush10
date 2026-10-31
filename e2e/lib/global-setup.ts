import { chromium } from '@playwright/test';
import { WEB_URL } from './env';

/** Load the app once so the first tests don't pay for a cold browser and server. */
export default async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const path of ['/', '/new', '/game/ABCD']) {
    await page.goto(`${WEB_URL}${path}`);
    await page.waitForLoadState('networkidle');
  }
  await browser.close();
}
