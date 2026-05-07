import { expect, test } from '@playwright/test';

// Helper: open the new-session form, accept defaults, click Create.
// Returns once a session card with the model badge has appeared.
async function createSession(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /New Session/ }).click();
  await page.getByRole('button', { name: /Create/ }).click();
  await expect(page.locator('.session').first()).toBeVisible();
  await expect(page.locator('.model-badge').first()).toBeVisible();
  await page.locator('.session').first().click();
}

test('walking skeleton: create session, send prompt, receive echo', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);

  await page.getByPlaceholder('Type a prompt...').fill('hello');
  await page.getByPlaceholder('Type a prompt...').press('Enter');

  await expect(page.getByText('hello').first()).toBeVisible();
  await expect(page.getByText('echo: hello')).toBeVisible({ timeout: 5_000 });
});

test('full event vocabulary reaches the UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);
  await page.getByPlaceholder('Type a prompt...').fill('coverage');
  await page.getByPlaceholder('Type a prompt...').press('Enter');

  // Wait for the final agent.message which is the last event in the
  // scripted scene — once visible, every preceding event must already
  // be in the DOM.
  await expect(page.getByText('echo: coverage')).toBeVisible({ timeout: 10_000 });

  // Chat-side assertions: each event type renders a row with its
  // data-evtype attribute.
  for (const t of [
    'user.prompt',
    'agent.thinking',
    'tool.started',
    'tool.completed',
    'subagent.dispatched',
    'subagent.completed',
    'file.changed',
    'tokens.updated',
    'agent.message',
    'session.started',
  ]) {
    await expect(page.locator(`[data-evtype="${t}"]`).first()).toBeVisible();
  }

  // Raw Events tab: contract coverage pills present.
  await page.getByTestId('tab-raw').click();
  for (const t of [
    'session.started',
    'user.prompt',
    'agent.thinking',
    'tool.started',
    'tool.completed',
    'subagent.dispatched',
    'subagent.completed',
    'file.changed',
    'tokens.updated',
    'agent.message',
  ]) {
    await expect(page.locator(`.raw-pill[data-event-type="${t}"]`)).toBeVisible();
  }
});

test('permission round-trip via /permission-test sentinel', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);

  // The fake fixture's /permission-test sentinel emits a single
  // permission.requested with a "req-fake-*" requestId (NOT "auto-deny-*"),
  // so Chat.tsx renders the interactive three-button card.
  await page.getByPlaceholder('Type a prompt...').fill('/permission-test');
  await page.getByPlaceholder('Type a prompt...').press('Enter');

  const card = page.locator('[data-evtype="permission.requested"]').first();
  await expect(card).toBeVisible({ timeout: 5_000 });

  // Pending interactive card: three Allow/Deny/Always buttons.
  await expect(card.locator('button:has-text("Allow")')).toBeVisible();
  await expect(card.locator('button:has-text("Deny")')).toBeVisible();
  await expect(card.locator('button:has-text("Always")')).toBeVisible();

  // Click Allow — round-trip writes permission_response to the fake
  // fixture's stdin, which emits permission.resolved.
  await card.locator('button:has-text("Allow")').click();

  // Resolved state: wrapper gets `.msg.permission.resolved`, the actions
  // are replaced with a `.permission-resolution` line containing the decision,
  // and the action buttons are gone from this card.
  await expect(page.locator('.msg.permission.resolved')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.permission-resolution')).toContainText('allow');
  await expect(card.locator('button:has-text("Allow")')).toHaveCount(0);
});
