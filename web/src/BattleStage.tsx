/** Canvas stage renderer.
 *
 * Deliberately dumb: all layout, shake and float maths lives in `src/stage.ts` and is
 * unit-tested headlessly. This file only executes draw commands and runs the clock.
 *
 * The canvas is sized to the fixed internal resolution and scaled up by whole numbers
 * with `image-rendering: pixelated`, so pixel art stays crisp instead of blurring.
 */
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {mediaUrl} from './media-url.js';
import {STAGE, composeFrame, integerScale, tintForRole} from '../../dist/src/stage.js';
import type {DrawCommand, Frame} from '../../src/stage.js';
import type {BeatScript} from '../../src/presentation.js';
import type {BattleState} from '../../src/types.js';
import type {AbilityInfo, SpriteSheet} from '../../src/animation.js';
import type {EffectLibrary} from '../../src/effects.js';

const PALETTE = {
  backdrop: '#0b0d16',
  ground: '#1b2033',
  hp: ['#2b1620', '#d2566e'],
  mp: ['#141f33', '#5b8fd4'],
  atb: ['#1a2030', '#d8c04a'],
  text: '#f4f2ea',
  damage: '#ff6a6a',
  heal: '#78e0a0',
  warning: '#ffd36a',
  flash: '#ffffff',
  dim: '#000000',
} as const;

export type BattleStageProps = {
  state: BattleState;
  /** Animation sheets per actor; absent actors fall back to silhouettes. */
  sheets?: Record<string, SpriteSheet>;
  /** Choreography for the batch currently playing, or null when idle. */
  script: BeatScript | null;
  /** Playback position, owned by the screen so the canvas and the DOM meters share
   * one clock and cannot disagree about how far a tween has run. */
  timeMs: number;
  /** Monotonic clock for looping clips, so idle keeps running between turns. */
  idleMs?: number;
  /** Role per hero id, used to tint placeholder silhouettes. */
  roles?: Record<string, string>;
  /** Ability kinds, so an action picks the clip that matches what it is. */
  abilityInfo?: AbilityInfo;
  /** Hit effect sheets that have art. Empty means no effect layer. */
  effects?: EffectLibrary;
  /** Backdrop image filename for this arena, when its art exists. Omitted, the stage
   * draws its flat backdrop and ground band. */
  backgroundFile?: string;
};

/** Images, loaded once and cached by URL. One cache for sprite sheets, effect sheets and
 * backdrops: they load the same way, and keying on the full URL keeps a `slash.png` effect
 * from colliding with a hypothetical sprite of the same name. An image that fails to load
 * stays absent, and whatever draws it falls back — a silhouette for an actor, nothing at all
 * for an effect, a flat colour for a backdrop. */
const imageCache = new Map<string, HTMLImageElement>();

/** Repaint callbacks for whichever stages are mounted.
 *
 * Module-level, because the image cache is too. A sheet whose request was started by one
 * mount can land after that mount is gone — the screen remounts at local midnight — and the
 * stage that is mounted *then* is the one that needs telling. Keying the notification to
 * the requesting component would silently lose that repaint. */
const repaintListeners = new Set<() => void>();
const notifyRepaint = (): void => { for (const listener of repaintListeners) listener(); };


/** Resolves a URL to a loaded image, starting the request on first ask. Returns null until
 * it is decoded, and forever if it fails. */
function imageAt(url: string): HTMLImageElement | null {
  const cached = imageCache.get(url);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  const image = new Image();
  // `once` matters: paint runs per animation frame, so a listener added per call would
  // pile up for as long as the request is in flight.
  image.addEventListener('load', notifyRepaint, {once: true});
  image.src = url;
  imageCache.set(url, image);
  return null;
}

const sheetImage = (file: string): HTMLImageElement | null =>
  imageAt(mediaUrl('battle-sprites', file));
const effectImage = (file: string): HTMLImageElement | null =>
  imageAt(mediaUrl('battle-effects', file));
const backdropImage = (file: string): HTMLImageElement | null =>
  imageAt(mediaUrl('battle-backgrounds', file));

export function BattleStage({state, script, timeMs, idleMs, roles, sheets, abilityInfo,
  effects, backgroundFile}: BattleStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  // Bumped when a sheet finishes loading, so the next frame paints with it. This has to be
  // read, not just set: it is a paint dependency. Discarding the value meant a sheet that
  // arrived while the stage was idle re-rendered the component but never re-ran the paint
  // effect, so the art sat decoded in the cache while the canvas kept showing silhouettes
  // until the first action happened to change `script`.
  const [loadTick, setLoadTick] = useState(0);

  // Repaint when any sheet finishes loading, including one requested before this mount.
  useEffect(() => {
    const listener = () => setLoadTick(tick => tick + 1);
    repaintListeners.add(listener);
    return () => { repaintListeners.delete(listener); };
  }, []);

  // Whole-number scaling against the available width.
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const {width} = wrap.getBoundingClientRect();
      setScale(integerScale(width, (width * STAGE.height) / STAGE.width));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Paint on every change of clock or state. The screen drives the clock, so this
  // component holds no animation state of its own.
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    paint(context, composeFrame({state, script, timeMs, idleMs, sheets, roles, abilityInfo,
      effects, backgroundFile}), state, roles,
      {sprite: sheetImage, effect: effectImage, backdrop: backdropImage});
  }, [state, script, timeMs, idleMs, roles, sheets, abilityInfo, effects, backgroundFile,
    scale, loadTick]);

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        width={STAGE.width}
        height={STAGE.height}
        style={{width: STAGE.width * scale, height: STAGE.height * scale}}
        aria-label="Battle stage"
        role="img"
      />
    </div>
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  state: BattleState,
  roles: Record<string, string> | undefined,
  resolve: {sprite: (file: string) => HTMLImageElement | null;
            effect: (file: string) => HTMLImageElement | null;
            backdrop: (file: string) => HTMLImageElement | null},
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, STAGE.width, STAGE.height);
  ctx.translate(frame.shakeX, frame.shakeY);

  for (const command of frame.commands as DrawCommand[]) {
    switch (command.kind) {
      case 'background': {
        // Fill first regardless. The art is authored at exactly the stage size, so this is
        // normally covered, but it means a backdrop that is still loading, missing, or
        // undersized shows the flat stage rather than whatever the canvas held before.
        ctx.fillStyle = PALETTE.backdrop;
        ctx.fillRect(-8, -8, STAGE.width + 16, STAGE.height + 16);
        const art = command.file ? resolve.backdrop(command.file) : null;
        if (art) {
          // Undo the shake for the backdrop only. The whole stage is translated by up to
          // 6px during a heavy hit, and a 320x180 image drawn inside that translation
          // leaves a strip of bare fill along one edge. Holding the scenery still also
          // reads better: the characters jolt against it instead of the world sliding.
          ctx.save();
          ctx.translate(-frame.shakeX, -frame.shakeY);
          // Drawn 1:1 at the internal resolution, so there is no resampling here and the
          // whole canvas is integer-scaled afterwards. That is why the catalog's
          // per-arena imageRendering hint no longer has anything to do: a painted
          // backdrop and a pixel-art one are both already at native size.
          ctx.drawImage(art, 0, 0, STAGE.width, STAGE.height);
          ctx.restore();
          break;
        }
        // No art: a ground band reads as a stage without pretending to be final art.
        ctx.fillStyle = PALETTE.ground;
        ctx.fillRect(-8, 118, STAGE.width + 16, STAGE.height - 110);
        break;
      }
      case 'effect': {
        // Nothing to draw if the art is absent or still loading. The hit flash and shake
        // carry the moment on their own, which is how the stage reads today.
        const image = resolve.effect(command.sheet.file);
        if (!image) break;
        const {sx, sy, sw, sh} = command.sheet;
        ctx.globalAlpha = 1;
        ctx.drawImage(image, sx, sy, sw, sh, command.x, command.y, command.width, command.height);
        ctx.globalAlpha = 1;
        break;
      }
      case 'sprite': {
        const y = command.y + command.offsetY;
        const image = command.sheet ? resolve.sprite(command.sheet.file) : null;
        ctx.globalAlpha = command.dim ? 0.35 : 1;

        if (image && command.sheet) {
          const {sx, sw, sh} = command.sheet;
          // Clamp the row to what the loaded image actually holds.
          //
          // `drawImage` with a source rect past the bottom edge draws *nothing* and raises
          // nothing, so a manifest indexing a row the image lacks makes a character vanish
          // with no clue why. That is exactly what a stale cached sheet caused once the
          // sheets grew an eighth row. Falling back to the first row shows the idle pose
          // instead -- wrong, but visible, and visibly wrong is what gets reported.
          const sy = inSheet(image, command.sheet) ? command.sheet.sy : 0;
          // Sheets are authored facing RIGHT, which is the usual convention and what the
          // art actually arrives as. The boss stands on the left and faces right, so it
          // draws unflipped; heroes stand on the right and face the boss, so they mirror.
          // This is a presentation-only convention and the only place it is applied.
          const mirror = command.facing === 'left';
          if (mirror) {
            ctx.save();
            ctx.translate(command.x + command.width, y);
            ctx.scale(-1, 1);
            ctx.drawImage(image, sx, sy, sw, sh, 0, 0, command.width, command.height);
            ctx.restore();
          } else {
            ctx.drawImage(image, sx, sy, sw, sh, command.x, y, command.width, command.height);
          }
          if (command.flash > 0) {
            // Tint the sprite's own pixels rather than a rectangle over it.
            ctx.globalAlpha = (command.dim ? 0.35 : 1) * command.flash;
            ctx.globalCompositeOperation = 'lighter';
            if (mirror) {
              ctx.save();
              ctx.translate(command.x + command.width, y);
              ctx.scale(-1, 1);
              ctx.drawImage(image, sx, sy, sw, sh, 0, 0, command.width, command.height);
              ctx.restore();
            } else {
              ctx.drawImage(image, sx, sy, sw, sh, command.x, y, command.width, command.height);
            }
            ctx.globalCompositeOperation = 'source-over';
          }
        } else {
          // No sheet yet: a flat silhouette keeps the game playable and readable.
          const isHero = command.actorId !== state.bossId;
          ctx.fillStyle = isHero ? tintForRole(roles?.[command.actorId]) : command.tint;
          ctx.fillRect(command.x, y, command.width, command.height);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(command.x, y, command.width, Math.max(2, Math.round(command.height * 0.22)));
          if (command.flash > 0) {
            ctx.globalAlpha = command.dim ? 0.35 : command.flash;
            ctx.fillStyle = PALETTE.flash;
            ctx.fillRect(command.x, y, command.width, command.height);
          }
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'bar': {
        const [back, front] = PALETTE[command.palette];
        ctx.fillStyle = back;
        ctx.fillRect(command.x, command.y, command.width, command.height);
        ctx.fillStyle = front;
        ctx.fillRect(command.x, command.y, Math.round(command.width * command.fraction), command.height);
        // Chunky outline, in keeping with the window system.
        ctx.strokeStyle = 'rgba(244,242,234,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(command.x + 0.5, command.y + 0.5, command.width - 1, command.height - 1);
        break;
      }
      case 'text': {
        ctx.font = '10px monospace';
        ctx.textAlign = command.align;
        ctx.textBaseline = 'alphabetic';
        const colour = command.palette === 'damage' ? PALETTE.damage
          : command.palette === 'heal' ? PALETTE.heal
          : command.palette === 'warning' ? PALETTE.warning : PALETTE.text;
        // Hard outline instead of a blurred shadow, so it stays legible on any backdrop.
        ctx.fillStyle = '#000000';
        // Explicit tuple type: destructured elements are possibly-undefined under
        // noUncheckedIndexedAccess.
        const outline: readonly [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dx, dy] of outline) {
          ctx.fillText(command.text, command.x + dx, command.y + dy);
        }
        ctx.fillStyle = colour;
        ctx.fillText(command.text, command.x, command.y);
        break;
      }
      case 'overlay': {
        ctx.globalAlpha = command.alpha;
        ctx.fillStyle = command.palette === 'flash' ? PALETTE.flash : PALETTE.dim;
        ctx.fillRect(-8, -8, STAGE.width + 16, STAGE.height + 16);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }
  ctx.restore();
}
