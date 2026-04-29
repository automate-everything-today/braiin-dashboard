/**
 * Shared visual constants. Keep this file tiny - the dashboard's design
 * system lives in `tailwind.config.ts` + the Braiin component primitives.
 * This file is for one-off classnames that were being copy-pasted across
 * pages.
 */

// Small pill: 18px tall, 10px text, tighter padding, normal weight. Used
// everywhere a Badge appears next to an action button so the badge doesn't
// compete with the button for the operator's eye.
export const PILL_SM =
  "text-[10px] px-1.5 py-0 leading-[18px] h-[18px] font-normal tracking-normal";
