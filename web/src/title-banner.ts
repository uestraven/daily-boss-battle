/** The title banner on the landing screen.
 *
 * Gated on a flag like the hit effects and the portraits, for the same reason: until the
 * art exists the landing screen keeps its text header, costing no failed request and no
 * console noise. Flip `BANNER_SHIPPED` when the PNG is in place.
 *
 * 320x112 is not arbitrary. It is the stage's own width, so the banner shares the game's
 * pixel grid, and the two sizes it is ever displayed at -- 320 on a phone, 640 in the
 * 640px-wide landing shell on desktop -- are exactly x1 and x2. Any other authoring size
 * would land on a fractional scale at one breakpoint or the other, and fractional
 * nearest-neighbour makes some pixels wider than their neighbours, which is most visible on
 * exactly the thing a banner is mostly made of: lettering.
 */
import {mediaUrl} from './media-url.js';

export const BANNER_WIDTH = 320;
export const BANNER_HEIGHT = 112;
export const BANNER_FILE = 'banner.png';

/** Set to true once web/public/title/banner.png exists. */
export const BANNER_SHIPPED = false;

export const bannerUrl = (): string => mediaUrl('title', BANNER_FILE);
