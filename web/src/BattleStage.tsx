/** Canvas stage renderer.
 *
 * Deliberately dumb: all layout, shake and float maths lives in `src/stage.ts` and is
 * unit-tested headlessly. This file only executes draw commands and runs the clock.
 *
 * The canvas is sized to the fixed internal resolution and scaled up by whole numbers
 * with `image-rendering: pixelated`, so pixel art stays crisp instead of blurring.
 */
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {STAGE, composeFrame, integerScale, tintForRole} from '../../dist/src/stage.js';
import type {DrawCommand, Frame} from '../../src/stage.js';
import type {BeatScript} from '../../src/presentation.js';
import type {BattleState} from '../../src/types.js';

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
  /** Choreography for the batch currently playing, or null when idle. */
  script: BeatScript | null;
  /** Playback position, owned by the screen so the canvas and the DOM meters share
   * one clock and cannot disagree about how far a tween has run. */
  timeMs: number;
  /** Role per hero id, used to tint placeholder silhouettes. */
  roles?: Record<string, string>;
};

export function BattleStage({state, script, timeMs, roles}: BattleStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

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
    paint(context, composeFrame({state, script, timeMs}), state, roles);
  }, [state, script, timeMs, roles, scale]);

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
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, STAGE.width, STAGE.height);
  ctx.translate(frame.shakeX, frame.shakeY);

  for (const command of frame.commands as DrawCommand[]) {
    switch (command.kind) {
      case 'background': {
        // No artwork ships yet: a flat backdrop plus a ground band reads as a stage
        // without pretending to be final art.
        ctx.fillStyle = PALETTE.backdrop;
        ctx.fillRect(-8, -8, STAGE.width + 16, STAGE.height + 16);
        ctx.fillStyle = PALETTE.ground;
        ctx.fillRect(-8, 118, STAGE.width + 16, STAGE.height - 110);
        break;
      }
      case 'sprite': {
        const isHero = command.actorId !== state.bossId;
        const tint = isHero ? tintForRole(roles?.[command.actorId]) : command.tint;
        ctx.globalAlpha = command.dim ? 0.3 : 1;
        ctx.fillStyle = tint;
        const y = command.y + command.offsetY;
        ctx.fillRect(command.x, y, command.width, command.height);
        // A lighter top band suggests a head, so silhouettes read as figures.
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(command.x, y, command.width, Math.max(2, Math.round(command.height * 0.22)));
        if (command.flash > 0) {
          ctx.globalAlpha = command.dim ? 0.3 : command.flash;
          ctx.fillStyle = PALETTE.flash;
          ctx.fillRect(command.x, y, command.width, command.height);
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
