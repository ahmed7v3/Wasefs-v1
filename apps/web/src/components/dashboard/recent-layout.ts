/** How many rows each "recent" card shows. */
export const RECENT_COUNT = 5;

/**
 * Every row is exactly this tall (44 px targets, text truncates) and the card keeps room for all
 * five, so skeleton, empty state and a short list occupy the same space: no layout shift.
 */
export const RECENT_ROW = "flex h-16 w-full border-b border-border last:border-b-0";
export const RECENT_MIN_HEIGHT = "min-h-[27rem]";
