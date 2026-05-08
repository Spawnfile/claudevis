import type { Event } from '@claudevis/shared';
// packages/web/src/scene/scene.ts
import { type Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { mirrorState } from './dom-mirror';
import { eventToMutations } from './event-mapper';
import { npcLayoutSlot, tileToScreen } from './grid';
import { MODEL_COLORS, STAMINA_GLYPH } from './lore-colors';
import { AGENT_SPRITE_KEY, SPRITES, type SpriteName, TOOL_SPRITE_KEY } from './sprite-manifest';
import { costToSegments } from './stamina';
import { PALETTE, SPRITE, TILE } from './theme';
import type { Mutation, NpcSnapshot } from './types';

interface NpcView {
  snapshot: NpcSnapshot;
  container: Container;
  body: Graphics;
  npcSprite: Sprite;
  tile: Sprite;
  staminaGlyph: Sprite;
  staminaSegments: Container;
}

type GlyphKind = 'parchment' | 'thought' | 'speech' | 'skill';

interface GlyphView {
  kind: GlyphKind;
  sessionId: string;
  content?: string;
  sprite: Sprite;
  timer: ReturnType<typeof setTimeout>;
}

interface ToolIconView {
  callId: string;
  sessionId: string;
  name: string;
  sprite: Sprite;
}

interface SubagentNpcView {
  childSessionId: string;
  parentSessionId: string;
  agentType: string;
  sprite: Sprite;
  badgeSprite: Sprite | null;
  container: Container;
  deepDispatch: boolean;
}

interface SigilView {
  requestId: string;
  sessionId: string;
  toolName: string;
  autoDeny: boolean;
  sprite: Sprite;
}

export interface Scene {
  applyEventsFrom(events: Event[], lastIndex: number): number;
  setActiveSession(id: string | null): void;
  setZoom(scale: number): void;
  getZoom(): number;
  panBy(dx: number, dy: number): void;
  resetPan(): void;
  getPan(): { x: number; y: number };
  destroy(): void;
}

const THOUGHT_RECENCY_MS = 3000;

function createVillageBackdrop(tileLayer: Container, spriteLayer: Container): void {
  // 5×5 grass tile grid, col/row in -2..2 (25 tiles total). Each tile is a
  // separate Sprite for clean z-sort (later tiles render on top of earlier).
  for (let row = -2; row <= 2; row++) {
    for (let col = -2; col <= 2; col++) {
      const tile = Sprite.from(SPRITES.tileGrass);
      tile.anchor.set(0.5, 0.5);
      tile.width = TILE.w;
      tile.height = TILE.h;
      const pos = tileToScreen(col, row);
      tile.position.set(pos.x, pos.y + TILE.h / 2);
      tile.zIndex = (col + row) * 10;
      tileLayer.addChild(tile);
    }
  }

  const cottageSlots: ReadonlyArray<{ col: number; row: number }> = [
    { col: -3, row: -2 },
    { col: 3, row: -2 },
    { col: 0, row: -3 },
    { col: -3, row: 3 },
    { col: 3, row: 3 },
    { col: -4, row: 0 },
  ];
  for (const slot of cottageSlots) {
    const cottage = Sprite.from(SPRITES.cottageSmall);
    cottage.anchor.set(0.5, 1);
    cottage.width = 40;
    cottage.height = 56;
    const pos = tileToScreen(slot.col, slot.row);
    cottage.position.set(pos.x, pos.y + TILE.h / 2);
    cottage.zIndex = (slot.col + slot.row) * 10 + 1;
    spriteLayer.addChild(cottage);
  }

  const lanternSlots: ReadonlyArray<{ col: number; row: number }> = [
    { col: -2, row: -1 },
    { col: 2, row: -1 },
    { col: -2, row: 2 },
    { col: 2, row: 2 },
  ];
  for (const slot of lanternSlots) {
    const lantern = Sprite.from(SPRITES.lanternPost);
    lantern.anchor.set(0.5, 1);
    lantern.width = 12;
    lantern.height = 60;
    const pos = tileToScreen(slot.col, slot.row);
    lantern.position.set(pos.x, pos.y + TILE.h / 2);
    lantern.zIndex = (slot.col + slot.row) * 10 + 2;
    spriteLayer.addChild(lantern);
  }

  const well = Sprite.from(SPRITES.well);
  well.anchor.set(0.5, 1);
  well.width = 44;
  well.height = 40;
  const wellPos = tileToScreen(0, 3);
  well.position.set(wellPos.x, wellPos.y + TILE.h / 2);
  well.zIndex = 3 * 10 + 3;
  spriteLayer.addChild(well);
}

export function createScene(app: Application): Scene {
  const root = new Container();
  root.sortableChildren = true;
  app.stage.addChild(root);

  const tileLayer = new Container();
  tileLayer.zIndex = 100;
  const spriteLayer = new Container();
  spriteLayer.sortableChildren = true;
  spriteLayer.zIndex = 200;
  const hudLayer = new Container();
  hudLayer.zIndex = 300;
  root.addChild(tileLayer, spriteLayer, hudLayer);

  const defaultRootX = app.screen.width / 2;
  const defaultRootY = app.screen.height / 2 - 30;
  root.position.set(defaultRootX, defaultRootY);

  createVillageBackdrop(tileLayer, spriteLayer);

  const npcs = new Map<string, NpcView>();
  // M3c.2a: glyphs keyed by `${kind}:${sessionId}`; toolIcons keyed by callId.
  const glyphs = new Map<string, GlyphView>();
  const toolIcons = new Map<string, ToolIconView>();
  let nextSlotIdx = 0;
  // M3c.2b state: subagent recursion + sigils + archive
  const subagentNpcs = new Map<string, SubagentNpcView>();
  const subagentRings = new Map<string, Sprite>(); // keyed by parentCallId — paired with matching subagent.completed
  const subagentDepths = new Map<string, number>(); // sessionId → depth in dispatch chain (root = 0)
  const subagentChildOrder = new Map<string, number>(); // parentSessionId → next sibling slot offset
  const sigils = new Map<string, SigilView>(); // requestId → SigilView
  let archiveCount = 0;
  let subagentSpawnCount = 0; // cumulative spawn counter; never decrements (timing-robust e2e signal)
  let activeSessionId: string | null = null;
  void activeSessionId;

  function modelTint(model: string): number {
    return MODEL_COLORS[model as keyof typeof MODEL_COLORS] ?? 0xffffff;
  }

  function spawnNpc(sessionId: string, model: string, name: string): void {
    if (npcs.has(sessionId)) return;

    const slot = npcLayoutSlot(nextSlotIdx++);
    const screen = tileToScreen(slot.col, slot.row);

    const container = new Container();
    container.position.set(screen.x, screen.y);
    container.zIndex = slot.col + slot.row;

    const tile = Sprite.from(SPRITES.tileGrass);
    tile.anchor.set(0.5, 0.5);
    tile.position.set(0, TILE.h / 2);
    tile.width = TILE.w;
    tile.height = TILE.h;
    container.addChild(tile);

    const body = new Graphics();
    body.rect(2 - SPRITE.npcW / 2, 7 - SPRITE.npcH, 12, 11);
    body.fill(modelTint(model));
    body.position.set(0, TILE.h / 2);
    container.addChild(body);

    const npcSprite = Sprite.from(SPRITES.npc);
    npcSprite.anchor.set(0.5, 1);
    npcSprite.position.set(0, TILE.h / 2);
    npcSprite.width = SPRITE.npcW;
    npcSprite.height = SPRITE.npcH;
    container.addChild(npcSprite);

    const glyphKey = STAMINA_GLYPH[model as keyof typeof STAMINA_GLYPH];
    const glyphSprite = glyphKey ? SPRITES[glyphKey] : SPRITES.glyphStaminaCoin;
    const staminaGlyph = Sprite.from(glyphSprite);
    staminaGlyph.anchor.set(0.5, 1);
    staminaGlyph.position.set(-14, -SPRITE.npcH - 2);
    staminaGlyph.width = SPRITE.staminaGlyph;
    staminaGlyph.height = SPRITE.staminaGlyph;

    const staminaSegments = new Container();
    staminaSegments.position.set(-8, -SPRITE.npcH - 6);

    for (let i = 0; i < 5; i++) {
      const seg = new Sprite(Texture.WHITE);
      seg.tint = PALETTE.torch;
      seg.width = 4;
      seg.height = 3;
      seg.position.set(i * 5, 0);
      seg.visible = false;
      staminaSegments.addChild(seg);
    }

    container.addChild(staminaGlyph, staminaSegments);

    spriteLayer.addChild(container);

    npcs.set(sessionId, {
      snapshot: { sessionId, model, name, costUsd: 0, state: 'idle' },
      container,
      body,
      npcSprite,
      tile,
      staminaGlyph,
      staminaSegments,
    });
    subagentDepths.set(sessionId, 0);
  }

  function removeNpc(sessionId: string): void {
    // Clear any glyphs / tool icons attached to this NPC before destroying.
    for (const [key, gv] of glyphs) {
      if (gv.sessionId === sessionId) clearGlyphByKey(key);
    }
    for (const [callId, tv] of toolIcons) {
      if (tv.sessionId === sessionId) retractToolIcon(callId);
    }

    const view = npcs.get(sessionId);
    if (!view) return;
    spriteLayer.removeChild(view.container);
    view.container.destroy({ children: true });
    subagentDepths.delete(sessionId);
    subagentChildOrder.delete(sessionId);
    npcs.delete(sessionId);
    syncMirror();
  }

  function updateStamina(sessionId: string, costUsd: number, _model: string): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    view.snapshot.costUsd = costUsd;
    const segCount = costToSegments(costUsd);
    for (let i = 0; i < view.staminaSegments.children.length; i++) {
      const seg = view.staminaSegments.children[i] as Sprite;
      seg.visible = i < segCount;
    }
  }

  function errorFlash(_message: string, sessionId?: string): void {
    if (!sessionId) return;
    const view = npcs.get(sessionId);
    if (!view) return;
    view.snapshot.state = 'errored';
  }

  function clearGlyphByKey(key: string): void {
    const gv = glyphs.get(key);
    if (!gv) return;
    clearTimeout(gv.timer);
    if (gv.sprite.parent) gv.sprite.parent.removeChild(gv.sprite);
    gv.sprite.destroy();
    glyphs.delete(key);
    syncMirror();
  }

  function attachGlyph(
    kind: GlyphKind,
    sessionId: string,
    spriteKey: keyof typeof SPRITES,
    durationMs: number,
    content: string | undefined,
  ): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    const key = `${kind}:${sessionId}`;
    // Replace existing glyph of same kind for same session (also resets timer)
    const prior = glyphs.get(key);
    if (prior) {
      clearTimeout(prior.timer);
      if (prior.sprite.parent) prior.sprite.parent.removeChild(prior.sprite);
      prior.sprite.destroy();
      glyphs.delete(key);
    }
    const sprite = Sprite.from(SPRITES[spriteKey]);
    sprite.anchor.set(0.5, 1);
    // Stack glyphs vertically above the NPC head: parchment highest, thought
    // middle, speech lowest. y offsets relative to container origin (NPC top
    // is at y = -SPRITE.npcH = -24 because tile mid is y=TILE.h/2=16 and NPC
    // anchor is bottom-center at that mid). M3c.3 polish may revisit positioning.
    const yOffset =
      kind === 'parchment'
        ? -SPRITE.npcH - 28
        : kind === 'thought'
          ? -SPRITE.npcH - 18
          : -SPRITE.npcH - 8;
    sprite.position.set(0, yOffset);
    if (kind === 'parchment') {
      sprite.width = 12;
      sprite.height = 16;
    } else if (kind === 'thought') {
      sprite.width = 16;
      sprite.height = 12;
    } else {
      sprite.width = 20;
      sprite.height = 12;
    }
    view.container.addChild(sprite);

    const timer = setTimeout(() => clearGlyphByKey(key), durationMs);
    glyphs.set(key, { kind, sessionId, content, sprite, timer });
  }

  function attachToolIcon(sessionId: string, callId: string, name: string): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    if (toolIcons.has(callId)) return; // idempotent on duplicate tool.started
    const spriteKey = (TOOL_SPRITE_KEY[name] ?? 'toolGeneric') as SpriteName;
    const sprite = Sprite.from(SPRITES[spriteKey]);
    sprite.anchor.set(0, 1);
    sprite.position.set(SPRITE.npcW / 2 + 2, TILE.h / 2 - 4);
    sprite.width = 12;
    sprite.height = 12;
    view.container.addChild(sprite);
    toolIcons.set(callId, { callId, sessionId, name, sprite });
  }

  function retractToolIcon(callId: string): void {
    const tv = toolIcons.get(callId);
    if (!tv) return;
    if (tv.sprite.parent) tv.sprite.parent.removeChild(tv.sprite);
    tv.sprite.destroy();
    toolIcons.delete(callId);
  }

  function spawnSubagentRing(parentSessionId: string, parentCallId: string): void {
    const parent = npcs.get(parentSessionId);
    if (!parent) return;
    if (subagentRings.has(parentCallId)) return; // idempotent on duplicate dispatch
    const ring = Sprite.from(SPRITES.summonRing);
    ring.anchor.set(0.5, 0.5);
    ring.position.set(0, TILE.h / 2);
    // Iso-correct flat ellipse: 64×32 follows the village's 2:1 iso projection.
    // A 64×64 ring would look like a screen-space circle and break the
    // moonlit-village visual grammar.
    ring.width = TILE.w;
    ring.height = TILE.h;
    ring.zIndex = -1; // behind the NPC body
    parent.container.addChildAt(ring, 0);
    subagentRings.set(parentCallId, ring);
  }

  function removeSubagentRing(parentCallId: string): void {
    const ring = subagentRings.get(parentCallId);
    if (!ring) return;
    if (ring.parent) ring.parent.removeChild(ring);
    ring.destroy();
    subagentRings.delete(parentCallId);
  }

  function spawnSubagentNpc(
    childSessionId: string,
    parentSessionId: string,
    agentType: string,
  ): void {
    if (subagentNpcs.has(childSessionId)) return; // idempotent on duplicate dispatch
    const parent = npcs.get(parentSessionId);
    if (!parent) return;
    const parentDepth = subagentDepths.get(parentSessionId) ?? 0;
    const childDepth = parentDepth + 1;
    subagentDepths.set(childSessionId, childDepth);

    // Recursion cap per design §4.5: depth ≥ 4 marks the child as a deep-
    // dispatch placeholder. M3c.2b structural form: smaller sprite, no agent
    // badge, mirror entry flagged deepDispatch=true so e2e can detect. Each
    // deep-dispatch child still gets its own container — true "single per-chain
    // placeholder" collapse with the 🌀 Deep dispatch PIXI.Text label is
    // M3c.3 polish (depends on the animator landing first).
    const deepDispatch = childDepth >= 4;

    const container = new Container();
    // Stack child above parent: same screen col, y -= 24 logical per depth.
    // Multiple children of same parent shift left/right by 16 px (sibling slot).
    const siblingIdx = subagentChildOrder.get(parentSessionId) ?? 0;
    subagentChildOrder.set(parentSessionId, siblingIdx + 1);
    const xOffset = (siblingIdx % 2 === 0 ? 1 : -1) * Math.ceil(siblingIdx / 2) * 16;
    const yOffset = -24 * childDepth;
    container.position.set(
      parent.container.position.x + xOffset,
      parent.container.position.y + yOffset,
    );
    container.zIndex = parent.container.zIndex - childDepth;

    const sprite = Sprite.from(SPRITES.npc);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(0, 0);
    // Smaller scale for child NPCs to differentiate from root villagers.
    sprite.width = SPRITE.npcW * 0.7;
    sprite.height = SPRITE.npcH * 0.7;
    container.addChild(sprite);

    let badgeSprite: Sprite | null = null;
    if (!deepDispatch) {
      const badgeKey = (AGENT_SPRITE_KEY[agentType] ?? 'badgeWanderer') as SpriteName;
      badgeSprite = Sprite.from(SPRITES[badgeKey]);
      badgeSprite.anchor.set(0.5, 1);
      badgeSprite.position.set(0, -SPRITE.npcH * 0.7 - 2);
      badgeSprite.width = 10;
      badgeSprite.height = 10;
      container.addChild(badgeSprite);
    }

    spriteLayer.addChild(container);

    subagentNpcs.set(childSessionId, {
      childSessionId,
      parentSessionId,
      agentType,
      sprite,
      badgeSprite,
      container,
      deepDispatch,
    });
    subagentSpawnCount += 1;
    syncMirror();
  }

  function removeSubagentNpc(childSessionId: string, parentCallId: string): void {
    const view = subagentNpcs.get(childSessionId);
    if (view) {
      if (view.container.parent) view.container.parent.removeChild(view.container);
      view.container.destroy({ children: true });
      subagentNpcs.delete(childSessionId);
    }
    removeSubagentRing(parentCallId);
    subagentDepths.delete(childSessionId);
    // Sibling slot counter intentionally NOT decremented — would require tracking
    // per-parent siblings; new dispatches just take the next slot.
    syncMirror();
  }

  function flyFileToArchive(_sessionId: string, _path: string): void {
    // M3c.2b: counter-only. The actual fly tween from the source NPC to the
    // archive corner stack is M3c.3 polish. We retain the function signature
    // so M3c.3 can drop in animation without an event-mapper change. Path
    // parameter is reserved for M3c.3 (e.g. group glyphs by directory).
    archiveCount += 1;
    syncMirror();
  }

  function attachPermissionSigil(
    sessionId: string,
    requestId: string,
    autoDeny: boolean,
    toolName: string,
  ): void {
    if (sigils.has(requestId)) return; // idempotent on duplicate
    const view = npcs.get(sessionId);
    if (!view) return;

    const sprite = Sprite.from(SPRITES.sigilPermission);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(SPRITE.npcW / 2 + 10, -SPRITE.npcH);
    sprite.width = 14;
    sprite.height = 14;
    // Auto-deny: the user can't interact with these (server already answered
    // 'deny' before emitting). Render at lower alpha to communicate readonly.
    sprite.alpha = autoDeny ? 0.6 : 1.0;

    if (!autoDeny) {
      // Interactive mode: clicking the sigil focuses the M3b.1 chat permission
      // card so the user can Allow/Deny/Always. The card is keyed by
      // data-request-id (Chat.tsx). The Allow button is identified by text
      // content (case-insensitive "allow"), which is robust to button reorder
      // and resilient to future markup tweaks. If text matching fails (e.g.
      // future i18n), the card still scrolls into view.
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      sprite.on('pointertap', () => {
        // CSS.escape protects against requestId values that contain selector
        // metacharacters (quotes, brackets, etc.). Protocol declares
        // requestId as z.string() with no format constraint, so we cannot
        // assume it's alphanumeric.
        const card = document.querySelector<HTMLElement>(
          `[data-request-id="${CSS.escape(requestId)}"]`,
        );
        if (!card) return;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const buttons = card.querySelectorAll<HTMLButtonElement>('button');
        const allowBtn = Array.from(buttons).find((b) => /allow/i.test(b.textContent ?? ''));
        allowBtn?.focus();
      });
    }

    view.container.addChild(sprite);
    sigils.set(requestId, { requestId, sessionId, toolName, autoDeny, sprite });
    syncMirror();
  }

  function dismissPermissionSigil(requestId: string): void {
    const sg = sigils.get(requestId);
    if (!sg) return;
    sg.sprite.removeAllListeners();
    if (sg.sprite.parent) sg.sprite.parent.removeChild(sg.sprite);
    sg.sprite.destroy();
    sigils.delete(requestId);
    syncMirror();
  }

  function attachSkillParchment(sessionId: string, skillName: string): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    const key = `skill:${sessionId}:${skillName}`;
    const prior = glyphs.get(key);
    if (prior) {
      clearTimeout(prior.timer);
      if (prior.sprite.parent) prior.sprite.parent.removeChild(prior.sprite);
      prior.sprite.destroy();
      glyphs.delete(key);
    }
    const sprite = Sprite.from(SPRITES.glyphParchment);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(0, -SPRITE.npcH - 32); // above the parchment glyph slot
    sprite.width = 14;
    sprite.height = 18;
    view.container.addChild(sprite);
    const timer = setTimeout(() => {
      const gv = glyphs.get(key);
      if (!gv) return;
      clearTimeout(gv.timer);
      if (gv.sprite.parent) gv.sprite.parent.removeChild(gv.sprite);
      gv.sprite.destroy();
      glyphs.delete(key);
      syncMirror();
    }, 2400);
    glyphs.set(key, { kind: 'skill', sessionId, content: skillName, sprite, timer });
  }

  function applyMutation(m: Mutation): void {
    switch (m.kind) {
      case 'spawnNpc':
        spawnNpc(m.sessionId, m.model, m.name);
        break;
      case 'removeNpc':
        removeNpc(m.sessionId);
        break;
      case 'updateStamina':
        updateStamina(m.sessionId, m.costUsd, m.model);
        break;
      case 'errorFlash':
        errorFlash(m.message, m.sessionId);
        break;
      case 'glyph':
        attachGlyph('parchment', m.sessionId, m.sprite, m.durationMs, m.content);
        break;
      case 'thoughtCloud':
        // Recency-based: lifetime extends to 3s after the latest fire.
        attachGlyph('thought', m.sessionId, 'glyphThought', THOUGHT_RECENCY_MS, m.content);
        break;
      case 'speechBubble':
        attachGlyph('speech', m.sessionId, 'glyphSpeech', m.durationMs, m.content);
        break;
      case 'attachTool':
        attachToolIcon(m.sessionId, m.callId, m.name);
        break;
      case 'retractTool': {
        retractToolIcon(m.callId);
        if (m.status === 'error') {
          const view = npcs.get(m.sessionId);
          if (view) view.snapshot.state = 'errored';
        }
        break;
      }
      case 'summonRing':
        // Ring keyed by parentCallId so the matching subagent.completed
        // (which carries the same parentCallId) can clean it up via
        // removeSubagentNpc. Each handler does one job.
        spawnSubagentRing(m.parentSessionId, m.parentCallId);
        break;
      case 'spawnSubagentNpc':
        spawnSubagentNpc(m.childSessionId, m.parentSessionId, m.agentType);
        break;
      case 'removeSubagentNpc':
        removeSubagentNpc(m.childSessionId, m.parentCallId);
        break;
      case 'fileFly':
        flyFileToArchive(m.sessionId, m.path);
        break;
      case 'permissionSigil':
        attachPermissionSigil(m.sessionId, m.requestId, m.autoDeny, m.toolName);
        break;
      case 'dismissSigil':
        // Decision (allow/deny/always) is in m.decision; M3c.3 polish renders a
        // green/red flash before the sigil dismisses. M3c.2b just removes it.
        dismissPermissionSigil(m.requestId);
        break;
      case 'skillParchment':
        attachSkillParchment(m.sessionId, m.skillName);
        break;
      default: {
        const _exhaustive: never = m;
        void _exhaustive;
        break;
      }
    }
  }

  function syncMirror(): void {
    const npcSnapshots = new Map<string, NpcSnapshot>();
    for (const [id, view] of npcs) npcSnapshots.set(id, view.snapshot);
    const glyphMirror = new Map<string, { kind: string; sessionId: string; content?: string }>();
    for (const [key, gv] of glyphs) {
      glyphMirror.set(key, { kind: gv.kind, sessionId: gv.sessionId, content: gv.content });
    }
    const toolMirror = new Map<string, { name: string; sessionId: string }>();
    for (const [callId, tv] of toolIcons) {
      toolMirror.set(callId, { name: tv.name, sessionId: tv.sessionId });
    }
    const subagentMirror = new Map<
      string,
      { parentSessionId: string; agentType?: string; deepDispatch?: boolean }
    >();
    for (const [id, sv] of subagentNpcs) {
      subagentMirror.set(id, {
        parentSessionId: sv.parentSessionId,
        agentType: sv.agentType,
        deepDispatch: sv.deepDispatch,
      });
    }
    const sigilMirror = new Map<
      string,
      { requestId: string; autoDeny?: boolean; toolName?: string }
    >();
    for (const [reqId, sg] of sigils) {
      sigilMirror.set(reqId, {
        requestId: sg.requestId,
        autoDeny: sg.autoDeny,
        toolName: sg.toolName,
      });
    }
    mirrorState({
      npcs: npcSnapshots,
      subagentNpcs: subagentMirror,
      sigils: sigilMirror,
      glyphs: glyphMirror,
      toolIcons: toolMirror,
      archive: { count: archiveCount },
      subagentSpawnCount,
    });
  }

  return {
    applyEventsFrom(events: Event[], lastIndex: number): number {
      for (let i = lastIndex; i < events.length; i++) {
        const evt = events[i];
        if (!evt) continue;
        const muts = eventToMutations(evt);
        for (const m of muts) applyMutation(m);
      }
      syncMirror();
      return events.length;
    },
    setActiveSession(id: string | null): void {
      activeSessionId = id;
    },
    setZoom(scale: number): void {
      const clamped = Math.max(0.5, Math.min(3, scale));
      root.scale.set(clamped);
    },
    getZoom(): number {
      return root.scale.x;
    },
    panBy(dx: number, dy: number): void {
      root.position.set(root.position.x + dx, root.position.y + dy);
    },
    resetPan(): void {
      root.position.set(defaultRootX, defaultRootY);
    },
    getPan(): { x: number; y: number } {
      return { x: root.position.x, y: root.position.y };
    },
    destroy(): void {
      for (const gv of glyphs.values()) {
        clearTimeout(gv.timer);
        if (gv.sprite.parent) gv.sprite.parent.removeChild(gv.sprite);
        gv.sprite.destroy();
      }
      glyphs.clear();
      for (const tv of toolIcons.values()) {
        if (tv.sprite.parent) tv.sprite.parent.removeChild(tv.sprite);
        tv.sprite.destroy();
      }
      toolIcons.clear();
      for (const sv of subagentNpcs.values()) {
        if (sv.container.parent) sv.container.parent.removeChild(sv.container);
        sv.container.destroy({ children: true });
      }
      subagentNpcs.clear();
      for (const ring of subagentRings.values()) {
        if (ring.parent) ring.parent.removeChild(ring);
        ring.destroy();
      }
      subagentRings.clear();
      subagentDepths.clear();
      subagentChildOrder.clear();
      for (const sg of sigils.values()) {
        if (sg.sprite.parent) sg.sprite.parent.removeChild(sg.sprite);
        sg.sprite.destroy();
      }
      sigils.clear();
      for (const view of npcs.values()) {
        view.container.destroy({ children: true });
      }
      npcs.clear();
    },
  };
}
