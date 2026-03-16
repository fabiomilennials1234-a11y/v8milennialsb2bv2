/**
 * Playwright auth setup — logs in once and saves session state.
 * Other tests reuse the saved state to avoid logging in every time.
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../../.playwright-auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  // Fill login form
  await page.getByPlaceholder(/email/i).fill(process.env.E2E_USER_EMAIL || 'admin@test.com');
  await page.getByPlaceholder(/senha|password/i).fill(process.env.E2E_USER_PASSWORD || 'Test123!@#');

  // Submit
  await page.getByRole('button', { name: /entrar|login|sign in/i }).click();

  // Wait for navigation to dashboard or main page
  await page.waitForURL(/\/(dashboard|leads|follow-ups|$)/, { timeout: 15_000 });

  // Save signed-in state
  await page.context().storageState({ path: authFile });
});
