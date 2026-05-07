import type { Event } from '@claudevis/shared';
// packages/web/src/scene/scene.ts
import { type Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { mirrorState } from './dom-mirror';
import { eventToMutations } from './event-mapper';
import { npcLayoutSlot, tileToScreen } from './grid';
import { MODEL_COLORS, STAMINA_GLYPH } from './lore-colors';
import { SPRITES } from './sprite-manifest';
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
      tile.zIndex = (col + row) * 10; // earlier tiles further "back"
      tileLayer.addChild(tile);
    }
  }

  // Cottages — 6 placements around the village edge.
  // Sprite anchor 0.5, 1 means bottom-center of cottage rests at the tile's
  // diamond-center y. Position y is shifted by TILE.h / 2 to plant the cottage
  // on top of the underlying tile.
  const cottageSlots: ReadonlyArray<{ col: number; row: number }> = [
    { col: -3, row: -2 }, // back-left
    { col: 3, row: -2 }, // back-right
    { col: 0, row: -3 }, // far back-center
    { col: -3, row: 3 }, // front-left
    { col: 3, row: 3 }, // front-right
    { col: -4, row: 0 }, // far left side
  ];
  for (const slot of cottageSlots) {
    const cottage = Sprite.from(SPRITES.cottageSmall);
    cottage.anchor.set(0.5, 1);
    cottage.width = 40; // cottage-small viewBox 40×56
    cottage.height = 56;
    const pos = tileToScreen(slot.col, slot.row);
    cottage.position.set(pos.x, pos.y + TILE.h / 2);
    cottage.zIndex = (slot.col + slot.row) * 10 + 1;
    spriteLayer.addChild(cottage);
  }

  // Lantern posts — 4 placements around the central area.
  const lanternSlots: ReadonlyArray<{ col: number; row: number }> = [
    { col: -2, row: -1 }, // back-left lantern
    { col: 2, row: -1 }, // back-right lantern
    { col: -2, row: 2 }, // front-left lantern
    { col: 2, row: 2 }, // front-right lantern
  ];
  for (const slot of lanternSlots) {
    const lantern = Sprite.from(SPRITES.lanternPost);
    lantern.anchor.set(0.5, 1);
    lantern.width = 12; // lantern-post viewBox 12×60
    lantern.height = 60;
    const pos = tileToScreen(slot.col, slot.row);
    lantern.position.set(pos.x, pos.y + TILE.h / 2);
    lantern.zIndex = (slot.col + slot.row) * 10 + 2;
    spriteLayer.addChild(lantern);
  }

  // Well — front-center foreground.
  const well = Sprite.from(SPRITES.well);
  well.anchor.set(0.5, 1);
  well.width = 44; // well viewBox 44×40
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

  // Layered containers — z-order: tile < sprites < HUD
  const tileLayer = new Container();
  tileLayer.zIndex = 100;
  const spriteLayer = new Container();
  spriteLayer.sortableChildren = true;
  spriteLayer.zIndex = 200;
  const hudLayer = new Container();
  hudLayer.zIndex = 300;
  root.addChild(tileLayer, spriteLayer, hudLayer);

  // Center the world once. resizeTo on Application keeps canvas dimensions
  // in sync with the host; world recentering on resize is M3c.3 polish.
  // The village extends roughly y -104 (back cottage tops) to y +64 (well bottom);
  // vertically center: place root.y at canvas mid - 30 so the village fits comfortably.
  const defaultRootX = app.screen.width / 2;
  const defaultRootY = app.screen.height / 2 - 30;
  root.position.set(defaultRootX, defaultRootY);

  createVillageBackdrop(tileLayer, spriteLayer);

  const npcs = new Map<string, NpcView>();
  let nextSlotIdx = 0;
  // activeSessionId reserved for M3c.2a (NPC highlight ring); recorded here.
  let activeSessionId: string | null = null;
  void activeSessionId; // silence unused-var lint until M3c.2a consumes it

  function modelTint(model: string): number {
    return MODEL_COLORS[model as keyof typeof MODEL_COLORS] ?? 0xffffff;
  }

  function spawnNpc(sessionId: string, model: string, name: string): void {
    if (npcs.has(sessionId)) return; // idempotent

    const slot = npcLayoutSlot(nextSlotIdx++);
    const screen = tileToScreen(slot.col, slot.row);

    const container = new Container();
    container.position.set(screen.x, screen.y);
    container.zIndex = slot.col + slot.row;

    // Tile under NPC
    const tile = Sprite.from(SPRITES.tileGrass);
    tile.anchor.set(0.5, 0.5);
    tile.position.set(0, TILE.h / 2);
    tile.width = TILE.w;
    tile.height = TILE.h;
    container.addChild(tile);

    // NPC body — drawn as Graphics with EXACT model color (no tint multiply).
    // Body region in npc.svg local coords: x 2..14, y 7..18 (12w × 11h).
    // We anchor the npcSprite at bottom-center (anchor 0.5, 1) so its bottom
    // sits at container y = TILE.h/2 (the tile's mid-line). Body is drawn in
    // the same coordinate system: shift by (-SPRITE.npcW/2, -SPRITE.npcH).
    const body = new Graphics();
    body.rect(2 - SPRITE.npcW / 2, 7 - SPRITE.npcH, 12, 11);
    body.fill(modelTint(model));
    body.position.set(0, TILE.h / 2);
    container.addChild(body);

    // NPC sprite (head + legs + shadow) layered ON TOP of the body Graphics.
    const npcSprite = Sprite.from(SPRITES.npc);
    npcSprite.anchor.set(0.5, 1);
    npcSprite.position.set(0, TILE.h / 2);
    npcSprite.width = SPRITE.npcW;
    npcSprite.height = SPRITE.npcH;
    container.addChild(npcSprite);

    // Stamina HUD: glyph icon + 5 segment placeholders above the NPC head.
    const glyphKey = STAMINA_GLYPH[model as keyof typeof STAMINA_GLYPH];
    const glyphSprite = glyphKey ? SPRITES[glyphKey] : SPRITES.glyphStaminaCoin;
    const staminaGlyph = Sprite.from(glyphSprite);
    staminaGlyph.anchor.set(0.5, 1);
    staminaGlyph.position.set(-14, -SPRITE.npcH - 2);
    staminaGlyph.width = SPRITE.staminaGlyph;
    staminaGlyph.height = SPRITE.staminaGlyph;

    const staminaSegments = new Container();
    staminaSegments.position.set(-8, -SPRITE.npcH - 6);

    // Pre-create 5 segment rects (white texture tinted to torch).
    // M3c.1 starts all hidden; updateStamina sets visibility.
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
  }

  function removeNpc(sessionId: string): void {
    const view = npcs.get(sessionId);
    if (!view) return;
    spriteLayer.removeChild(view.container);
    view.container.destroy({ children: true });
    npcs.delete(sessionId);
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
    // M3c.1: simple state mark; M3c.2a/M3c.3 add ember flash visual
    view.snapshot.state = 'errored';
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
    mirrorState({
      npcs: npcSnapshots,
      subagentNpcs: new Map(),
      sigils: new Map(),
      glyphs: new Map(),
      toolIcons: new Map(),
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
      // M3c.2a/M3c.3 add a visual halo on the active NPC; M3c.1 just records.
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
      for (const view of npcs.values()) {
        view.container.destroy({ children: true });
      }
      npcs.clear();
    },
  };
}
