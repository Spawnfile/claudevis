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

test('skill drawer renders catalog and click prepends to prompt + skill.invoked fires', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  // Create a fake-mode session — fake fixture emits system/init at startup
  // → server broadcasts skill.catalog → frontend store populates catalog.
  await createSession(page);

  // Open the skill drawer.
  const toggle = page.locator('.skill-drawer-toggle');
  await expect(toggle).toBeVisible({ timeout: 5_000 });
  await toggle.click();

  // Scope DOM lookups to the drawer body — prior fake-mode tests in the
  // same dev-server process may have left chat history matching these texts.
  const drawer = page.locator('.skill-drawer-body');

  // Three section headings render (catalog has 1 of each kind).
  await expect(drawer.getByRole('heading', { name: /slash commands/i })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /^skills$/i })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /agents/i })).toBeVisible();

  // Hardcoded fixture entries appear.
  const skillEntry = drawer.locator('.skill-drawer-entry-button', {
    hasText: 'plugin-a:test-skill',
  });
  await expect(skillEntry).toBeVisible();
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'plugin-a:test-cmd' }),
  ).toBeVisible();
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'test-agent' }),
  ).toBeVisible();

  // Click the skill entry — pendingPromptPrefix → PromptBar input prepend.
  await skillEntry.click();

  // Prompt input now starts with "/plugin-a:test-skill ".
  const promptInput = page.getByPlaceholder('Type a prompt...');
  await expect(promptInput).toHaveValue(/^\/plugin-a:test-skill /);

  // Type some args after the prefix and send (Enter key, matching M3b.1's pattern).
  await promptInput.press('End');
  await promptInput.type('with these args');
  await promptInput.press('Enter');

  // skill.invoked Event row arrives in chat BEFORE user.prompt row.
  await expect(page.locator('[data-evtype="skill.invoked"]')).toBeVisible({ timeout: 5_000 });
});

test('skill drawer filter narrows visible entries', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);

  await page.locator('.skill-drawer-toggle').click();

  // Scope selectors to the drawer body — chat history from prior tests in
  // the same dev-server process may also contain "plugin-a:test-skill".
  const drawer = page.locator('.skill-drawer-body');

  // All three entries visible initially (scoped to drawer entry buttons).
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'plugin-a:test-skill' }),
  ).toBeVisible();
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'test-agent' }),
  ).toBeVisible();

  // Filter to a string that matches only test-skill.
  const filter = page.getByPlaceholder(/filter by name/i);
  await filter.fill('test-skill');
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'plugin-a:test-skill' }),
  ).toBeVisible();
  await expect(drawer.locator('.skill-drawer-entry-button', { hasText: 'test-agent' })).toHaveCount(
    0,
  );

  // Clear filter — both visible again.
  await filter.fill('');
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'plugin-a:test-skill' }),
  ).toBeVisible();
  await expect(
    drawer.locator('.skill-drawer-entry-button', { hasText: 'test-agent' }),
  ).toBeVisible();
});
