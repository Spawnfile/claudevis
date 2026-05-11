import type { Event } from '@claudevis/shared';
import { Application, Assets } from 'pixi.js';
// packages/web/src/scene/SceneCanvas.tsx
import { useCallback, useEffect, useRef } from 'react';
import { CostTooltip } from '../CostTooltip';
import { useConnection, useEventStream } from '../store/connection';
import { type Scene, createScene } from './scene';
import { SPRITES } from './sprite-manifest';

export function SceneCanvas({ activeSessionId }: { activeSessionId: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const appRef = useRef<Application | null>(null);

  // Mount: create PIXI app, load sprites, build scene
  useEffect(() => {
    if (!hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;

    (async () => {
      const app = new Application();
      await app.init({
        background: 0x060814, // --bg-deep
        antialias: false,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        resizeTo: host,
      });
      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        return;
      }
      appRef.current = app;
      host.appendChild(app.canvas);

      await Assets.load(Object.values(SPRITES));
      if (cancelled) {
        app.destroy(true, { children: true, texture: true });
        appRef.current = null;
        return;
      }

      sceneRef.current = createScene(app);
      // Read setHoveredSession lazily via getState() so this effect's [] deps
      // array stays valid (Zustand setters are stable but referencing them
      // explicitly here would still produce a noisy lint warning).
      sceneRef.current.setHoverHandler(useConnection.getState().setHoveredSession);
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      appRef.current?.destroy(true, { children: true, texture: true });
      appRef.current = null;
    };
  }, []);

  // Apply event deltas to the scene
  const applyDeltas = useCallback((events: Event[], lastIndex: number): number => {
    const scene = sceneRef.current;
    if (!scene) return lastIndex;
    return scene.applyEventsFrom(events, lastIndex);
  }, []);
  useEventStream(applyDeltas);

  // Active session highlight
  useEffect(() => {
    sceneRef.current?.setActiveSession(activeSessionId);
  }, [activeSessionId]);

  // ESC exits focus mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        document.body.classList.remove('focus-mode');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Mouse drag pan (left-click drag)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // left button only
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      host.classList.add('dragging');
    };
    const onMove = (e: MouseEvent) => {
      if (!isDragging || !sceneRef.current) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      sceneRef.current.panBy(dx, dy);
    };
    const onUp = () => {
      if (!isDragging) return;
      isDragging = false;
      host.classList.remove('dragging');
    };
    const onLeave = () => {
      if (!isDragging) return;
      isDragging = false;
      host.classList.remove('dragging');
    };

    host.addEventListener('mousedown', onDown);
    // mousemove + mouseup on window so dragging continues even when cursor
    // leaves the host element briefly
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    host.addEventListener('mouseleave', onLeave);
    return () => {
      host.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      host.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // Mouse wheel zoom on canvas (zoom-only, no pan)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = (e: WheelEvent) => {
      if (!sceneRef.current) return;
      e.preventDefault();
      const current = sceneRef.current.getZoom();
      // Wheel up (negative deltaY) zooms in; wheel down zooms out
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      sceneRef.current.setZoom(current * factor);
    };
    host.addEventListener('wheel', handler, { passive: false });
    return () => host.removeEventListener('wheel', handler);
  }, []);

  return (
    <div className="scene-canvas-wrap">
      <div ref={hostRef} className="scene-canvas-host" data-testid="scene-canvas-host" />
      <div className="scene-controls">
        <button
          type="button"
          className="scene-control-btn"
          onClick={() => sceneRef.current?.setZoom(1)}
          title="Reset zoom"
          data-testid="scene-zoom-reset"
        >
          1×
        </button>
        <button
          type="button"
          className="scene-control-btn"
          onClick={() => sceneRef.current?.resetPan()}
          title="Reset pan (recenter view)"
          data-testid="scene-pan-reset"
        >
          ⊕
        </button>
        <button
          type="button"
          className="scene-control-btn"
          onClick={() => document.body.classList.toggle('focus-mode')}
          title="Toggle focus mode (ESC to exit)"
          data-testid="scene-focus-toggle"
        >
          ⛶
        </button>
      </div>
      <CostTooltip />
    </div>
  );
}
