/** Renders the shareable result card to a canvas and exports it.
 *
 * All layout lives in `src/result-card.ts` and is unit-tested; this executes draw
 * commands and handles the three export routes:
 *   - Web Share with a file, on mobile browsers that support it
 *   - clipboard image, where that is permitted
 *   - download, which always works, including every desktop browser
 */
import {useEffect, useRef, useState} from 'react';
import {CARD, composeResultCard, resultCardText} from '../../dist/src/result-card.js';
import type {CardCommand, ResultCardInput} from '../../src/result-card.js';

const PALETTE = {
  frameBg: '#0b0d16',
  frameEdge: '#8e9bb3',
  inset: '#161a2b',
  title: '#f4f2ea',
  body: '#dfe3ee',
  muted: '#8e9bb3',
  win: '#78e0a0',
  loss: '#ff8585',
  star: '#ffd36a',
  starEmpty: '#3a3f55',
  meterBack: '#2b1620',
  meterFront: '#d2566e',
} as const;

function paintCard(ctx: CanvasRenderingContext2D, commands: CardCommand[]) {
  ctx.clearRect(0, 0, CARD.width, CARD.height);
  for (const command of commands) {
    switch (command.kind) {
      case 'panel': {
        ctx.fillStyle = command.palette === 'frame' ? PALETTE.frameBg : PALETTE.inset;
        ctx.fillRect(command.x, command.y, command.width, command.height);
        ctx.strokeStyle = PALETTE.frameEdge;
        ctx.lineWidth = command.palette === 'frame' ? 6 : 2;
        ctx.strokeRect(
          command.x + ctx.lineWidth / 2, command.y + ctx.lineWidth / 2,
          command.width - ctx.lineWidth, command.height - ctx.lineWidth,
        );
        break;
      }
      case 'text': {
        ctx.font = `${command.size}px ui-monospace, "Courier New", monospace`;
        ctx.textAlign = command.align;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = PALETTE[command.palette] ?? PALETTE.body;
        ctx.fillText(command.text, command.x, command.y);
        break;
      }
      case 'stars': {
        ctx.font = `${command.size}px ui-monospace, "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const glyphs: string[] = [];
        for (let i = 0; i < command.total; i++) glyphs.push(i < command.filled ? '★' : '☆');
        // Drawn per glyph so filled and empty stars can differ in colour.
        const spacing = command.size * 1.2;
        const start = command.x - ((command.total - 1) * spacing) / 2;
        glyphs.forEach((glyph, index) => {
          ctx.fillStyle = index < command.filled ? PALETTE.star : PALETTE.starEmpty;
          ctx.fillText(glyph, start + index * spacing, command.y);
        });
        break;
      }
      case 'meter': {
        ctx.fillStyle = PALETTE.meterBack;
        ctx.fillRect(command.x, command.y, command.width, command.height);
        ctx.fillStyle = PALETTE.meterFront;
        ctx.fillRect(command.x, command.y, Math.round(command.width * command.fraction), command.height);
        ctx.strokeStyle = PALETTE.frameEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(command.x + 0.5, command.y + 0.5, command.width - 1, command.height - 1);
        break;
      }
    }
  }
}

const FILENAME = (day: string) => `daily-boss-battle-${day}.png`;

export function ShareCard({input}: {input: ResultCardInput}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (context) paintCard(context, composeResultCard(input));
  }, [input]);

  const toBlob = (): Promise<Blob | null> =>
    new Promise(resolve => {
      const canvas = canvasRef.current;
      if (!canvas) { resolve(null); return; }
      canvas.toBlob(blob => resolve(blob), 'image/png');
    });

  const share = async () => {
    const blob = await toBlob();
    if (!blob) { setStatus('Could not render the card'); return; }
    const file = new File([blob], FILENAME(input.day), {type: 'image/png'});
    const navigatorWithShare = navigator as Navigator & {
      canShare?: (data: {files?: File[]}) => boolean;
      share?: (data: {files?: File[]; text?: string; title?: string}) => Promise<void>;
    };
    if (navigatorWithShare.canShare?.({files: [file]}) && navigatorWithShare.share) {
      try {
        await navigatorWithShare.share({
          files: [file], title: 'Daily Boss Battle', text: resultCardText(input),
        });
        setStatus(null);
        return;
      } catch {
        // Share sheet dismissed, or not permitted: fall through to download.
      }
    }
    download(blob);
  };

  const download = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = FILENAME(input.day);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Image saved');
  };

  const copyImage = async () => {
    const blob = await toBlob();
    if (!blob) return;
    try {
      const clipboard = navigator.clipboard as Clipboard & {write?: (items: unknown[]) => Promise<void>};
      const ClipboardItemCtor = (window as unknown as {ClipboardItem?: new (data: Record<string, Blob>) => unknown}).ClipboardItem;
      if (clipboard?.write && ClipboardItemCtor) {
        await clipboard.write([new ClipboardItemCtor({'image/png': blob})]);
        setStatus('Image copied');
        return;
      }
      throw new Error('unsupported');
    } catch {
      // Clipboard images are widely restricted; text always works.
      await copyText();
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(resultCardText(input));
      setStatus('Result copied as text');
    } catch {
      setStatus('Copying is blocked in this browser — use Save image');
    }
  };

  return (
    <div className="dbb-share">
      <canvas
        ref={canvasRef}
        className="dbb-share-canvas"
        width={CARD.width}
        height={CARD.height}
        aria-label={`Result card for ${input.day}`}
        role="img"
      />
      <div className="dbb-share-actions">
        <button className="rpg-menu-item" onClick={() => void share()}>Share image</button>
        <button className="rpg-menu-item" onClick={() => void copyImage()}>Copy image</button>
        <button className="rpg-menu-item" onClick={() => void copyText()}>Copy text</button>
      </div>
      {status && <div className="dbb-share-status" role="status">{status}</div>}
    </div>
  );
}
