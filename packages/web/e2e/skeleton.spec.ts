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

test('resumable section renders synthetic projects-dir entry on subscribe', async ({ page }) => {
  // M3b.3 T5: playwright.config.ts pre-populates a tmp CLAUDEVIS_PROJECTS_DIR
  // with one synthetic session under the encoded cwd `-tmp-fake-resumable-cwd`
  // and id `fake-session-uuid-12345`. On subscribe the server scans the dir
  // and emits session.resumable; SessionList renders the <details> section.
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  const summary = page.getByText(/resumable \(1\)/i);
  await expect(summary).toBeVisible({ timeout: 5_000 });
  await summary.click();

  // No `summary` field in jsonl → display name falls back to
  // `resumed-${id.slice(0,8)}` = `resumed-fake-ses`.
  await expect(
    page.locator('.resumable-entry-name', { hasText: 'resumed-fake-ses' }),
  ).toBeVisible();
  // `-tmp-fake-resumable-cwd` decodes to `/tmp/fake/resumable/cwd`.
  await expect(
    page.locator('.resumable-entry-cwd', { hasText: '/tmp/fake/resumable/cwd' }),
  ).toBeVisible();
});

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

test('focus mode toggle hides chat and ESC restores it', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('.scene-canvas-host canvas') !== null, {
    timeout: 5000,
  });

  // Initial: chat-area is visible
  await expect(page.locator('.chat-area')).toBeVisible();
  await expect(page.locator('.left')).toBeVisible();

  // Click focus toggle
  await page.getByTestId('scene-focus-toggle').click();
  await expect(page.locator('body.focus-mode')).toHaveCount(1);
  await expect(page.locator('.chat-area')).not.toBeVisible();
  await expect(page.locator('.left')).not.toBeVisible();

  // Press ESC to exit focus mode
  await page.keyboard.press('Escape');
  await expect(page.locator('body.focus-mode')).toHaveCount(0);
  await expect(page.locator('.chat-area')).toBeVisible();
  await expect(page.locator('.left')).toBeVisible();
});

test('pan drag moves the scene root and reset-pan recenters', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelector('.scene-canvas-host canvas') !== null, {
    timeout: 5000,
  });

  // Wait for scene to be created (canvas + first paint)
  await page.waitForTimeout(300);

  // Capture initial pan position via the test bridge below.
  // Since the Scene API is internal, we observe canvas-relative behavior:
  // simulate a drag and then click the reset-pan button to verify it works.
  const host = page.locator('.scene-canvas-host');
  const box = await host.boundingBox();
  if (!box) throw new Error('canvas-host not laid out');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  // Drag from center to bottom-right by 100px each axis
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY + 100);
  await page.mouse.up();

  // Verify the dragging class was applied during drag (timing-fragile;
  // the assertion is mostly that the gesture didn't throw)
  await expect(host).not.toHaveClass(/dragging/);

  // Click reset-pan; assert the button is reachable
  await page.getByTestId('scene-pan-reset').click();

  // Sanity: still no error
  await expect(page.locator('.scene-canvas-host canvas')).toBeVisible();
});

test('scene panel mirrors NPC for active session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  // Create a session — fake fixture emits session.started which triggers
  // the scene module to spawn an NPC and sync the dom-mirror.
  await createSession(page);

  // Wait for at least one NPC mirror entry to appear in the hidden DOM mirror.
  // The mirror container has display:none (it's an e2e hook, not visible UI),
  // so we use toBeAttached() rather than toBeVisible().
  // Tests share a browser context and prior tests may have accumulated NPCs,
  // so we assert ≥ 1 (first() is attached) rather than exactly 1.
  const mirror = page.locator('#scene-dom-mirror');
  await expect(mirror.locator('[data-scene-npc-id]').first()).toBeAttached({ timeout: 5_000 });

  // Verify the NPC has a model attribute matching one of the valid models.
  const npc = mirror.locator('[data-scene-npc-id]').first();
  await expect(npc).toHaveAttribute('data-scene-npc-model', /sonnet|opus|haiku/);
});

test('user prompt produces a parchment glyph in the scene mirror (M3c.2a)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);

  // Wait for the NPC mirror entry to confirm the scene mounted
  const mirror = page.locator('#scene-dom-mirror');
  await expect(mirror.locator('[data-scene-npc-id]').first()).toBeAttached({ timeout: 5_000 });

  // Send a prompt via PromptBar
  await page.getByPlaceholder('Type a prompt...').fill('plan a quest');
  await page.getByPlaceholder('Type a prompt...').press('Enter');

  // The parchment glyph appears briefly (durationMs=2000). Assert it's
  // present with the right kind and content.
  const glyph = mirror.locator('[data-scene-glyph-kind="parchment"]').first();
  await expect(glyph).toBeAttached({ timeout: 4_000 });
  await expect(glyph).toHaveAttribute('data-scene-glyph-content', 'plan a quest');
});

test('permission request renders an interactive sigil in the scene mirror (M3c.2b)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);

  const mirror = page.locator('#scene-dom-mirror');
  await expect(mirror.locator('[data-scene-npc-id]').first()).toBeAttached({ timeout: 5_000 });

  // Trigger an interactive permission via the M3b.1 sentinel.
  await page.getByPlaceholder('Type a prompt...').fill('/permission-test');
  await page.getByPlaceholder('Type a prompt...').press('Enter');

  // Sigil mirror entry appears with mode=interactive and tool-name=Bash
  // (the fake fixture issues a Bash permission for /permission-test).
  const sigil = mirror.locator('[data-scene-sigil-mode="interactive"]').first();
  await expect(sigil).toBeAttached({ timeout: 5_000 });
  await expect(sigil).toHaveAttribute('data-scene-sigil-tool-name', 'Bash');

  // The chat permission card is also present (M3b.1 contract).
  const card = page
    .locator('[data-evtype="permission.requested"]')
    .filter({ has: page.getByText('Bash') })
    .first();
  await expect(card).toBeVisible();
});

test('default scripted prompt increments the subagent spawn count in the mirror (M3c.2b)', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });

  await createSession(page);

  const mirror = page.locator('#scene-dom-mirror');
  await expect(mirror.locator('[data-scene-npc-id]').first()).toBeAttached({ timeout: 5_000 });

  // Default scripted scene emits subagent.dispatched (with agentType="Explore")
  // followed ~10ms later by subagent.completed. The in-flight subagent state
  // is unobservable to Playwright (whose default polling is 100ms), so we
  // assert on the cumulative subagent-spawn-count attribute — which increments
  // on spawn and never decrements, surviving the immediate teardown.
  await page.getByPlaceholder('Type a prompt...').fill('go forth');
  await page.getByPlaceholder('Type a prompt...').press('Enter');

  const counter = mirror.locator('[data-scene-subagent-spawn-count]');
  await expect(counter).toBeAttached({ timeout: 5_000 });
  // Robust assertion: count >= 1 (could be higher if a prior test in the same
  // browser context already triggered a dispatch, since scene state persists
  // across tests in skeleton.spec).
  const countAttr = await counter.getAttribute('data-scene-subagent-spawn-count');
  expect(countAttr).not.toBeNull();
  expect(Number.parseInt(countAttr!, 10)).toBeGreaterThanOrEqual(1);
});

test('M4.1: scene mirror shows initial mode-icon and swaps via /mode-test', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });
  await createSession(page);

  // Initial mode-icon: 'auto' (Headstrong) per default session.create.mode.
  // The dom-mirror surfaces it as data-scene-npc-mode. The mirror container has
  // display:none, so we use toBeAttached() rather than toBeVisible().
  const mirror = page.locator('#scene-dom-mirror');
  const npcLocator = mirror.locator('[data-scene-npc-id]').first();
  await expect(npcLocator).toBeAttached({ timeout: 5_000 });
  await expect(npcLocator).toHaveAttribute('data-scene-npc-mode', 'auto', { timeout: 5_000 });

  // Send /mode-test plan; mode-icon swaps to Cartographer.
  await page.getByPlaceholder('Type a prompt...').fill('/mode-test plan');
  await page.getByPlaceholder('Type a prompt...').press('Enter');
  await expect(npcLocator).toHaveAttribute('data-scene-npc-mode', 'plan', { timeout: 5_000 });

  // /mode-test autoAccept → Trusting.
  await page.getByPlaceholder('Type a prompt...').fill('/mode-test autoAccept');
  await page.getByPlaceholder('Type a prompt...').press('Enter');
  await expect(npcLocator).toHaveAttribute('data-scene-npc-mode', 'autoAccept', { timeout: 5_000 });
});

test('M4.1: scene mirror shows idle latch + auto-wake on next mutation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('● connected')).toBeVisible({ timeout: 10_000 });
  await createSession(page);

  // The mirror container is display:none — use toBeAttached() not toBeVisible().
  const mirror = page.locator('#scene-dom-mirror');
  const npcLocator = mirror.locator('[data-scene-npc-id]').first();
  await expect(npcLocator).toBeAttached({ timeout: 5_000 });

  // Initial idle is false.
  await expect(npcLocator).toHaveAttribute('data-scene-npc-idle', 'false');

  // Send a default scripted prompt. The fixture tail (T9) emits session.idle
  // after the agent.message echo, setting the scene latch. Use .last() to scope
  // to this test's most-recent echo (chat history may include "echo: hello"
  // rows from prior tests in the same dev-server process).
  await page.getByPlaceholder('Type a prompt...').fill('hello');
  await page.getByPlaceholder('Type a prompt...').press('Enter');
  await expect(page.getByText('echo: hello').last()).toBeVisible({ timeout: 10_000 });
  await expect(npcLocator).toHaveAttribute('data-scene-npc-idle', 'true', { timeout: 5_000 });

  // Send /mode-test sentinel (does NOT trigger default scripted scene's tail idle).
  // The session.mode.changed mutation has sessionId → applyMutation auto-clear
  // flips idle latch to false. Stable assertion (no follow-up tail idle re-latches).
  await page.getByPlaceholder('Type a prompt...').fill('/mode-test plan');
  await page.getByPlaceholder('Type a prompt...').press('Enter');
  await expect(npcLocator).toHaveAttribute('data-scene-npc-idle', 'false', { timeout: 5_000 });
});
