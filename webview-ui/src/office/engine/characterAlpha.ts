import { HEADLESS_CHARACTER_ALPHA, STALE_CHARACTER_ALPHA } from '../../constants.js';

/** The two flags that can make a character translucent. Structural rather than
 *  `Character` so this module — and its test — never reach a type that drags
 *  CanvasRenderingContext2D into a project with no DOM lib. */
export interface AlphaInputs {
  isHeadless?: boolean;
  isStale?: boolean;
}

/**
 * How solid to draw a character (Tacit patch for the stale half).
 *
 * Two independent reasons to fade, and they mean different things. Headless is
 * a preference: the operator asked to be shown which agents have no terminal
 * to focus, and turning the setting off restores them. Stale is the office
 * reporting a fact — it has heard nothing from this session for an hour — so
 * it fades regardless of any setting, and fades further than a headless agent
 * so the two never read as the same state on one screen.
 */
export function characterAlpha(ch: AlphaInputs, ghostHeadlessAgents: boolean): number {
  if (ch.isStale) return STALE_CHARACTER_ALPHA;
  if (ch.isHeadless && ghostHeadlessAgents) return HEADLESS_CHARACTER_ALPHA;
  return 1;
}
