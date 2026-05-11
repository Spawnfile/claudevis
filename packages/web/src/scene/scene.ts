import type { Event, PermissionMode } from '@claudevis/shared';
// packages/web/src/scene/scene.ts
import { type Application, Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import { ANIM, animator, easeOutQuad } from './animator';
import { mirrorState } from './dom-mirror';
import { eventToMutations } from './event-mapper';
import { npcLayoutSlot, tileToScreen } from './grid';
import { MODEL_COLORS, MODE_COLORS, STAMINA_GLYPH } from './lore-colors';
import {
  AGENT_SPRITE_KEY,
  MODE_ICON,
  SPRITES,
  type SpriteName,
  TOOL_SPRITE_KEY,
} from './sprite-manifest';
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
  // M4.1: mode-icon sprite shown above the NPC. Re-instantiated by
  // swapModeIcon when session.mode.changed fires.
  modeIcon: Sprite;
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
  setHoverHandler(cb: ((sessionId: string | null) => void) | null): void;
  destroy(): void;
}

const THOUGHT_RECENCY_MS = 3000;

function createVillageBackdrop(
  tileLayer: Container,
  spriteLayer: Container,
): { lanterns: Sprite[] } {
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
  const lanterns: Sprite[] = [];
  for (const slot of lanternSlots) {
    const lantern = Sprite.from(SPRITES.lanternPost);
    lantern.anchor.set(0.5, 1);
    lantern.width = 12;
    lantern.height = 60;
    const pos = tileToScreen(slot.col, slot.row);
    lantern.position.set(pos.x, pos.y + TILE.h / 2);
    lantern.zIndex = (slot.col + slot.row) * 10 + 2;
    spriteLayer.addChild(lantern);
    lanterns.push(lantern);
  }

  const well = Sprite.from(SPRITES.well);
  well.anchor.set(0.5, 1);
  well.width = 44;
  well.height = 40;
  const wellPos = tileToScreen(0, 3);
  well.position.set(wellPos.x, wellPos.y + TILE.h / 2);
  well.zIndex = 3 * 10 + 3;
  spriteLayer.addChild(well);

  return { lanterns };
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

  const { lanterns: lanternSprites } = createVillageBackdrop(tileLayer, spriteLayer);

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
  // M3c.3 ambient: per-NPC ticker callbacks for idle bob. Keyed by sessionId so
  // removeNpc can stop the ticker before destroying the container.
  const idleBobTickers = new Map<string, (ticker: Ticker) => void>();
  // M3c.3 ring rotation tickers — keyed by parentCallId, paired with subagentRings.
  const ringTickers = new Map<string, (ticker: Ticker) => void>();
  // M3c.3 sigil pulse tickers — keyed by requestId, paired with sigils.
  const sigilTickers = new Map<string, (ticker: Ticker) => void>();
  // M3c.3 ambient tickers (lantern flicker + ember-particle spawn) — held in
  // a single array since they don't need keyed access; cleared in destroy().
  const ambientTickers: Array<(ticker: Ticker) => void> = [];
  const ambientIntervals: ReturnType<typeof setInterval>[] = [];
  // Active ember particles (for cleanup on scene destroy).
  const emberParticles = new Set<Sprite>();
  let activeSessionId: string | null = null;
  void activeSessionId;
  let hoverHandler: ((sessionId: string | null) => void) | null = null;

  startLanternFlicker();
  startEmberSpawner();

  function modelTint(model: string): number {
    return MODEL_COLORS[model as keyof typeof MODEL_COLORS] ?? 0xffffff;
  }

  function spawnNpc(sessionId: string, model: string, name: string, mode: PermissionMode): void {
    if (npcs.has(sessionId)) return;

    const slot = npcLayoutSlot(nextSlotIdx++);
    const screen = tileToScreen(slot.col, slot.row);

    const container = new Container();
    container.position.set(screen.x, screen.y);
    container.zIndex = slot.col + slot.row;
    container.eventMode = 'static';
    container.cursor = 'pointer';
    container.on('pointerover', () => hoverHandler?.(sessionId));
    container.on('pointerout', () => hoverHandler?.(null));

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

    // M4.1: mode-icon — small sprite above the NPC's head identifying the
    // current PermissionMode. Re-instantiated by swapModeIcon when the
    // session changes mode mid-flight.
    const modeIcon = Sprite.from(SPRITES[MODE_ICON[mode]]);
    modeIcon.anchor.set(0.5, 1);
    modeIcon.position.set(8, -SPRITE.npcH - 6);
    modeIcon.width = SPRITE.staminaGlyph;
    modeIcon.height = SPRITE.staminaGlyph;
    container.addChild(modeIcon);

    spriteLayer.addChild(container);

    npcs.set(sessionId, {
      snapshot: { sessionId, model, name, costUsd: 0, state: 'idle', mode, idle: false },
      container,
      body,
      npcSprite,
      tile,
      staminaGlyph,
      staminaSegments,
      modeIcon,
    });
    subagentDepths.set(sessionId, 0);

    container.alpha = 0;
    animator.tween(container as unknown as Record<string, number>, 'alpha', 0, 1, ANIM.fadeIn);
    startIdleBob(sessionId);
  }

  function removeNpc(sessionId: string): void {
    stopIdleBob(sessionId);
    // Clear any glyphs / tool icons attached to this NPC before destroying.
    for (const [key, gv] of glyphs) {
      if (gv.sessionId === sessionId) clearGlyphByKey(key);
    }
    for (const [callId, tv] of toolIcons) {
      if (tv.sessionId === sessionId) retractToolIcon(callId);
    }

    const view = npcs.get(sessionId);
    if (!view) return;
    // Detach from npcs map immediately so a new spawn for the same id wouldn't
    // conflict with the in-flight fade-out. The container stays in the scene
    // graph until the tween completes.
    npcs.delete(sessionId);
    subagentDepths.delete(sessionId);
    subagentChildOrder.delete(sessionId);
    const container = view.container;
    animator.tween(
      container as unknown as Record<string, number>,
      'alpha',
      container.alpha,
      0,
      ANIM.fadeOut,
      {
        onDone: () => {
          if (container.parent) container.parent.removeChild(container);
          container.destroy({ children: true });
        },
      },
    );
    syncMirror();
  }

  function swapModeIcon(sessionId: string, mode: PermissionMode): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    if (view.snapshot.mode === mode) return;
    // Destroy the old icon, attach a new one at the same slot.
    const oldX = view.modeIcon.position.x;
    const oldY = view.modeIcon.position.y;
    if (view.modeIcon.parent) view.modeIcon.parent.removeChild(view.modeIcon);
    view.modeIcon.destroy();
    const fresh = Sprite.from(SPRITES[MODE_ICON[mode]]);
    fresh.anchor.set(0.5, 1);
    fresh.position.set(oldX, oldY);
    fresh.width = SPRITE.staminaGlyph;
    fresh.height = SPRITE.staminaGlyph;
    view.container.addChild(fresh);
    view.modeIcon = fresh;
    view.snapshot.mode = mode;
  }

  function setIdle(sessionId: string, idle: boolean): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    if (view.snapshot.idle === idle) return;
    view.snapshot.idle = idle;
    // Dim/restore the stamina segments. Bob slowdown is read per-frame by
    // the existing idle-bob ticker via view.snapshot.idle (no ticker swap).
    view.staminaSegments.alpha = idle ? 0.6 : 1.0;
  }

  function startIdleBob(sessionId: string): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    if (idleBobTickers.has(sessionId)) return; // idempotent
    const restY = view.npcSprite.position.y;
    const startMs = performance.now();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const cb = (_ticker: Ticker) => {
      if (document.body.classList.contains('reduced-motion')) {
        view.npcSprite.position.y = restY;
        return;
      }
      // M4.1: when view is idle, halve amplitude AND double period.
      const period = view.snapshot.idle ? ANIM.npcIdleBob * 2 : ANIM.npcIdleBob;
      const amplitude = view.snapshot.idle ? 1 : 2;
      const t = ((performance.now() - startMs) % period) / period;
      view.npcSprite.position.y = restY - amplitude * Math.sin(t * Math.PI * 2);
    };
    Ticker.shared.add(cb);
    idleBobTickers.set(sessionId, cb);
  }

  function stopIdleBob(sessionId: string): void {
    const cb = idleBobTickers.get(sessionId);
    if (!cb) return;
    Ticker.shared.remove(cb);
    idleBobTickers.delete(sessionId);
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

  function errorFlash(_message: string, sessionId: string | undefined, recoverable: boolean): void {
    // Scene-wide ember flash for unrecoverable errors (per design §4.5). The
    // village root tints toward ember briefly then back. Localized NPC flash
    // also runs if sessionId is set, so the user gets both signals.
    if (!recoverable) {
      animator.tween(
        root as unknown as Record<string, number>,
        'alpha',
        1,
        0.6,
        ANIM.errorFlash / 2,
        {
          onDone: () => {
            animator.tween(
              root as unknown as Record<string, number>,
              'alpha',
              0.6,
              1,
              ANIM.errorFlash / 2,
            );
          },
        },
      );
    }

    if (!sessionId) return;
    const view = npcs.get(sessionId);
    if (!view) return;
    view.snapshot.state = 'errored';
    // NPC body alpha flash 1 → 0.4 → 1 to localize the error to a session.
    animator.tween(
      view.body as unknown as Record<string, number>,
      'alpha',
      1,
      0.4,
      ANIM.errorFlash / 2,
      {
        onDone: () => {
          animator.tween(
            view.body as unknown as Record<string, number>,
            'alpha',
            0.4,
            1,
            ANIM.errorFlash / 2,
          );
        },
      },
    );
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

    // Float upward by 4px over the float duration. Animator short-circuits
    // when reduced-motion is on. Independent of the fade-timeout below.
    animator.tween(
      sprite.position as unknown as Record<string, number>,
      'y',
      yOffset,
      yOffset - 4,
      ANIM.glyphFloat,
      { ease: easeOutQuad },
    );

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
    const restX = SPRITE.npcW / 2 + 2;
    const restY = TILE.h / 2 - 4;
    // Slide-in: start tucked behind the NPC body, slide right to rest.
    sprite.position.set(restX - 6, restY);
    sprite.alpha = 0;
    sprite.width = 12;
    sprite.height = 12;
    view.container.addChild(sprite);
    animator.tween(
      sprite.position as unknown as Record<string, number>,
      'x',
      restX - 6,
      restX,
      ANIM.fadeIn,
      { ease: easeOutQuad },
    );
    animator.tween(sprite as unknown as Record<string, number>, 'alpha', 0, 1, ANIM.fadeIn);
    toolIcons.set(callId, { callId, sessionId, name, sprite });
  }

  function retractToolIcon(callId: string): void {
    const tv = toolIcons.get(callId);
    if (!tv) return;
    // Detach from map immediately so a new attach for the same callId would
    // not collide with this fading sprite. The sprite stays in the scene graph
    // until the fade-out completes.
    toolIcons.delete(callId);
    const sprite = tv.sprite;
    const startX = sprite.position.x;
    animator.tween(
      sprite.position as unknown as Record<string, number>,
      'x',
      startX,
      startX - 6,
      ANIM.fadeOut,
    );
    animator.tween(
      sprite as unknown as Record<string, number>,
      'alpha',
      sprite.alpha,
      0,
      ANIM.fadeOut,
      {
        onDone: () => {
          if (sprite.parent) sprite.parent.removeChild(sprite);
          sprite.destroy();
        },
      },
    );
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
    // moonlit-village visual grammar. Width/height start at 0 and tween up.
    ring.zIndex = -1; // behind the NPC body
    parent.container.addChildAt(ring, 0);
    subagentRings.set(parentCallId, ring);

    // "Summon" gesture: scale-in from 0 to full size over ANIM.summonRing.
    // Width and height tween in lockstep — the iso-flat aspect ratio (64×32)
    // is preserved throughout. easeOutQuad gives a slight overshoot feel.
    ring.width = 0;
    ring.height = 0;
    animator.tween(ring as unknown as Record<string, number>, 'width', 0, TILE.w, ANIM.summonRing, {
      ease: easeOutQuad,
    });
    animator.tween(
      ring as unknown as Record<string, number>,
      'height',
      0,
      TILE.h,
      ANIM.summonRing,
      { ease: easeOutQuad },
    );

    // Slow continuous rotation while the subagent is in-flight (signals
    // "agent at work"). Persists until removeSubagentRing.
    const startMs = performance.now();
    const rotationPeriodMs = 2400;
    const cb = (_ticker: Ticker) => {
      if (document.body.classList.contains('reduced-motion')) {
        ring.rotation = 0;
        return;
      }
      const t = ((performance.now() - startMs) % rotationPeriodMs) / rotationPeriodMs;
      ring.rotation = t * Math.PI * 2;
    };
    Ticker.shared.add(cb);
    ringTickers.set(parentCallId, cb);
  }

  function removeSubagentRing(parentCallId: string): void {
    const cb = ringTickers.get(parentCallId);
    if (cb) {
      Ticker.shared.remove(cb);
      ringTickers.delete(parentCallId);
    }
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

    container.alpha = 0;
    animator.tween(container as unknown as Record<string, number>, 'alpha', 0, 1, ANIM.fadeIn);

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
      // Detach from map immediately so a re-spawn would not collide with the
      // fading container.
      subagentNpcs.delete(childSessionId);
      const container = view.container;
      animator.tween(
        container as unknown as Record<string, number>,
        'alpha',
        container.alpha,
        0,
        ANIM.fadeOut,
        {
          onDone: () => {
            if (container.parent) container.parent.removeChild(container);
            container.destroy({ children: true });
          },
        },
      );
    }
    removeSubagentRing(parentCallId);
    subagentDepths.delete(childSessionId);
    // Sibling slot counter intentionally NOT decremented — would require tracking
    // per-parent siblings; new dispatches just take the next slot.
    syncMirror();
  }

  function flyFileToArchive(sessionId: string, _path: string, plus = 0, minus = 0): void {
    // M3c.3: single shared file-glyph (parchment sprite) flies from the source
    // NPC's screen position to the bottom-right archive corner, then counter
    // increments + sprite destroys. Per-path differentiation (group by
    // directory, etc.) is out of M3c.3 scope.
    const view = npcs.get(sessionId);
    if (!view) {
      archiveCount += 1;
      syncMirror();
      return;
    }
    const sprite = Sprite.from(SPRITES.glyphParchment);
    sprite.anchor.set(0.5, 0.5);
    sprite.width = 10;
    sprite.height = 12;
    // Fly is at root level (not inside the NPC container) so the path is in
    // the same space as our target corner.
    const startX = view.container.position.x;
    const startY = view.container.position.y - SPRITE.npcH;
    sprite.position.set(startX, startY);
    spriteLayer.addChild(sprite);

    // M4.2: optional +N -M label flying alongside the sprite. Skipped when
    // both counts are 0 (e.g. real-mode parser fallback when git numstat
    // returned null, or non-git repos).
    let label: Text | null = null;
    if (plus > 0 || minus > 0) {
      label = new Text({
        text: `+${plus} -${minus}`,
        style: {
          fontFamily: 'monospace',
          fontSize: 10,
          fill: 0xc8e1ff,
          stroke: { color: 0x000000, width: 1 },
        },
      });
      label.anchor.set(0, 0.5);
      label.position.set(startX + 12, startY - 6);
      spriteLayer.addChild(label);
    }

    // Bottom-right corner relative to the scene root's coordinate space. The
    // root is centered on the viewport (defaultRootX/Y above); offset to
    // approximate the visible bottom-right at 1× zoom.
    const targetX = app.screen.width / 2 - 40;
    const targetY = app.screen.height / 2 - 30;

    animator.tween(
      sprite.position as unknown as Record<string, number>,
      'x',
      startX,
      targetX,
      ANIM.fileFly,
      { ease: easeOutQuad },
    );
    animator.tween(
      sprite.position as unknown as Record<string, number>,
      'y',
      startY,
      targetY,
      ANIM.fileFly,
      {
        ease: easeOutQuad,
        onDone: () => {
          if (sprite.parent) sprite.parent.removeChild(sprite);
          sprite.destroy();
          if (label) {
            if (label.parent) label.parent.removeChild(label);
            label.destroy();
          }
          archiveCount += 1;
          syncMirror();
        },
      },
    );
    if (label) {
      animator.tween(
        label.position as unknown as Record<string, number>,
        'x',
        startX + 12,
        targetX + 12,
        ANIM.fileFly,
        { ease: easeOutQuad },
      );
      animator.tween(
        label.position as unknown as Record<string, number>,
        'y',
        startY - 6,
        targetY - 6,
        ANIM.fileFly,
        { ease: easeOutQuad },
      );
    }
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

    // Pulse: alpha cycles 1↔0.7 (interactive) or 0.6↔0.4 (auto-deny readonly).
    const peak = autoDeny ? 0.6 : 1.0;
    const trough = autoDeny ? 0.4 : 0.7;
    const startMs = performance.now();
    const cb = (_ticker: Ticker) => {
      if (document.body.classList.contains('reduced-motion')) {
        sprite.alpha = peak;
        return;
      }
      const t = ((performance.now() - startMs) % ANIM.sigilPulse) / ANIM.sigilPulse;
      // Sine wave between trough and peak.
      const u = (Math.sin(t * Math.PI * 2) + 1) / 2; // 0..1
      sprite.alpha = trough + (peak - trough) * u;
    };
    Ticker.shared.add(cb);
    sigilTickers.set(requestId, cb);

    syncMirror();
  }

  function dismissPermissionSigil(requestId: string): void {
    const cb = sigilTickers.get(requestId);
    if (cb) {
      Ticker.shared.remove(cb);
      sigilTickers.delete(requestId);
    }
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
    const restY = -SPRITE.npcH - 32; // above the parchment glyph slot
    sprite.position.set(0, restY);
    sprite.width = 14;
    sprite.height = 18;
    view.container.addChild(sprite);
    animator.tween(
      sprite.position as unknown as Record<string, number>,
      'y',
      restY,
      restY - 4,
      ANIM.glyphFloat,
      { ease: easeOutQuad },
    );
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

  function shakeNpc(sessionId: string): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    const sprite = view.npcSprite;
    const restX = sprite.position.x;
    // Reduce-motion: do NOT install the per-frame ticker. The animator's
    // short-circuit on the scratch tween below fires onDone synchronously,
    // resetting position — visible result is a no-op, which is correct.
    if (document.body.classList.contains('reduced-motion')) {
      sprite.position.x = restX;
      return;
    }
    // Per-frame ticker callback writes the shake offset onto the sprite.
    // Removes itself when elapsed >= duration. Self-cleaning; no Map needed.
    const startMs = performance.now();
    const cb = (_ticker: Ticker) => {
      const elapsed = performance.now() - startMs;
      if (elapsed >= ANIM.bellShake) {
        sprite.position.x = restX;
        Ticker.shared.remove(cb);
        return;
      }
      // 4 oscillations across the duration, ±3px amplitude.
      const u = elapsed / ANIM.bellShake;
      sprite.position.x = restX + 3 * Math.sin(u * Math.PI * 8);
    };
    Ticker.shared.add(cb);
  }

  function applyMutation(m: Mutation): void {
    // M4.1: any mutation that targets a specific session implicitly wakes
    // the session from idle. The setIdle case is the ONE exception — it
    // sets the latch — so we skip the auto-clear when m.kind === 'setIdle'.
    // Mutations without a sessionId (e.g. dismissSigil, removeSubagentNpc,
    // summonRing's parentSessionId-only shape) skip the clear because they
    // don't pertain to any single NPC's idle state.
    if (m.kind !== 'setIdle') {
      // Use a runtime check + cast: 'sessionId' in m narrows to variants
      // that declare the field, but errorFlash declares it optional. The
      // typeof check excludes the undefined branch.
      const maybeWithSession = m as { sessionId?: unknown };
      if (typeof maybeWithSession.sessionId === 'string') {
        const view = npcs.get(maybeWithSession.sessionId);
        if (view?.snapshot.idle) {
          view.snapshot.idle = false;
          view.staminaSegments.alpha = 1.0;
        }
      }
    }
    switch (m.kind) {
      case 'spawnNpc':
        spawnNpc(m.sessionId, m.model, m.name, m.mode);
        break;
      case 'removeNpc':
        removeNpc(m.sessionId);
        break;
      case 'updateStamina':
        updateStamina(m.sessionId, m.costUsd, m.model);
        break;
      case 'errorFlash':
        errorFlash(m.message, m.sessionId, m.recoverable);
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
          if (view) {
            view.snapshot.state = 'errored';
            // Ember flash: drop body alpha to 0.4, then back to 1.
            animator.tween(
              view.body as unknown as Record<string, number>,
              'alpha',
              1,
              0.4,
              ANIM.errorFlash / 2,
              {
                onDone: () => {
                  animator.tween(
                    view.body as unknown as Record<string, number>,
                    'alpha',
                    0.4,
                    1,
                    ANIM.errorFlash / 2,
                  );
                },
              },
            );
          }
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
        flyFileToArchive(m.sessionId, m.path, m.plus, m.minus);
        break;
      case 'permissionSigil':
        attachPermissionSigil(m.sessionId, m.requestId, m.autoDeny, m.toolName);
        break;
      case 'dismissSigil': {
        // Flash the sigil tint before dismissal: trusting-green (autoAccept key
        // in MODE_COLORS — the lore name "Trusting" lives in the comment, the
        // wire mode-string is "autoAccept") for allow/always, ember-red for
        // deny. Then remove. Reduced-motion short-circuits (the animator's
        // onDone fires synchronously, so the flash is invisible but the
        // dismissal still happens).
        const sg = sigils.get(m.requestId);
        if (sg) {
          const flashTint = m.decision === 'deny' ? PALETTE.ember : MODE_COLORS.autoAccept;
          sg.sprite.tint = flashTint;
          // Hold for half the flash duration, then dismiss. Use a sentinel
          // tween on a scratch object so reduced-motion still routes through
          // animator's short-circuit.
          const scratch: Record<string, number> = { t: 0 };
          animator.tween(scratch, 't', 0, 1, ANIM.errorFlash, {
            onDone: () => dismissPermissionSigil(m.requestId),
          });
        } else {
          dismissPermissionSigil(m.requestId);
        }
        break;
      }
      case 'skillParchment':
        attachSkillParchment(m.sessionId, m.skillName);
        break;
      case 'shake':
        shakeNpc(m.sessionId);
        break;
      case 'swapModeIcon':
        swapModeIcon(m.sessionId, m.mode);
        break;
      case 'setIdle':
        setIdle(m.sessionId, m.idle);
        break;
      default: {
        const _exhaustive: never = m;
        void _exhaustive;
        break;
      }
    }
  }

  function startLanternFlicker(): void {
    for (const lantern of lanternSprites) {
      const startMs = performance.now() + Math.random() * 1000; // phase offset per lantern
      const cb = (_ticker: Ticker) => {
        if (document.body.classList.contains('reduced-motion')) {
          lantern.alpha = 1;
          return;
        }
        const t = ((performance.now() - startMs) % ANIM.lanternFlicker) / ANIM.lanternFlicker;
        const u = (Math.sin(t * Math.PI * 2) + 1) / 2; // 0..1
        lantern.alpha = 0.85 + u * 0.15; // 0.85..1.0
      };
      Ticker.shared.add(cb);
      ambientTickers.push(cb);
    }
  }

  function spawnEmberAt(x: number, y: number): void {
    const ember = Sprite.from(SPRITES.emberParticle);
    ember.anchor.set(0.5, 0.5);
    ember.width = 4;
    ember.height = 4;
    ember.position.set(x + (Math.random() * 4 - 2), y);
    ember.alpha = 1;
    spriteLayer.addChild(ember);
    emberParticles.add(ember);
    animator.tween(
      ember.position as unknown as Record<string, number>,
      'y',
      y,
      y - 24,
      ANIM.emberRise,
      { ease: easeOutQuad },
    );
    animator.tween(ember as unknown as Record<string, number>, 'alpha', 1, 0, ANIM.emberRise, {
      onDone: () => {
        if (ember.parent) ember.parent.removeChild(ember);
        ember.destroy();
        emberParticles.delete(ember);
      },
    });
  }

  function startEmberSpawner(): void {
    // Each lantern emits one ember every ~2000ms. setInterval is fine here —
    // the ambient cadence isn't frame-precise.
    for (const lantern of lanternSprites) {
      const lanternX = lantern.position.x;
      const lanternY = lantern.position.y - 50; // near the lamp head, not the post base
      const interval = setInterval(
        () => {
          if (document.body.classList.contains('reduced-motion')) return;
          spawnEmberAt(lanternX, lanternY);
        },
        2000 + Math.random() * 500,
      ); // jitter so the four lanterns don't pulse in lockstep
      ambientIntervals.push(interval);
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
    setHoverHandler(cb) {
      hoverHandler = cb;
    },
    destroy(): void {
      animator.cancelAll();
      for (const cb of idleBobTickers.values()) Ticker.shared.remove(cb);
      idleBobTickers.clear();
      for (const cb of ringTickers.values()) Ticker.shared.remove(cb);
      ringTickers.clear();
      for (const cb of sigilTickers.values()) Ticker.shared.remove(cb);
      sigilTickers.clear();
      for (const cb of ambientTickers) Ticker.shared.remove(cb);
      ambientTickers.length = 0;
      for (const interval of ambientIntervals) clearInterval(interval);
      ambientIntervals.length = 0;
      for (const ember of emberParticles) {
        if (ember.parent) ember.parent.removeChild(ember);
        ember.destroy();
      }
      emberParticles.clear();
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
