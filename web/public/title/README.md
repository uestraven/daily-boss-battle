# Title banner

Original artwork only. Nothing in this directory may be extracted, captured, or traced
from another company's game.

One file: **`banner.png`, exactly 320x112**.

## Why that size

320 is the stage's own width, so the banner sits on the same pixel grid as the game. The
two sizes it is ever shown at are x1 on a phone and x2 inside the 640px landing shell on
desktop. Any other authoring size lands on a fractional scale at one breakpoint, and
fractional nearest-neighbour makes some pixels wider than their neighbours — most visible on
lettering, which is most of what a banner is.

## No chroma key

Like the portraits and unlike the sprite sheets, a banner keeps its own background. There is
nothing to key out and none of the erosion risk that comes with it.

## Enabling it

Set `BANNER_SHIPPED = true` in `web/src/title-banner.ts`. Until then the landing screen
keeps its text header, which costs no failed request and no console noise — the same
arrangement used for hit effects and Codex portraits.

## If the lettering comes out wrong

Generators mangle text more often than not. If the title is misspelt or the kerning is
unusable, regenerate the scene **with no lettering at all** and say so here: the landing
screen can draw the title over it in the game's own pixel font, which is crisper anyway and
survives translation. That is the fallback, not the plan.
