import { expect, test } from '@playwright/test';

const RUN = process.env.CLAUDEVIS_RUN_REAL === '1';

test.describe('real claude (CLAUDEVIS_RUN_REAL=1)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', (d) => d.accept('.'));
  });

  test('real claude responds to a basic prompt', async ({ page }) => {
    test.skip(!RUN, 'requires CLAUDEVIS_RUN_REAL=1');

    await page.goto('/');
    await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /New Session/ }).click();
    await page.locator('.session').first().click();
    await page.getByPlaceholder('Type a prompt...').fill('Reply with exactly: ok');
    await page.getByPlaceholder('Type a prompt...').press('Enter');

    // session.started arrives almost immediately from system/init mapping.
    await expect(page.locator('[data-evtype="session.started"]').first()).toBeVisible({
      timeout: 15_000,
    });
    // agent.message must arrive — generous timeout because we're hitting a real model.
    await expect(page.locator('[data-evtype="agent.message"]').first()).toBeVisible({
      timeout: 90_000,
    });
    // tokens.updated proves the result line was parsed.
    await expect(page.locator('[data-evtype="tokens.updated"]').first()).toBeVisible({
      timeout: 90_000,
    });
  });
});
