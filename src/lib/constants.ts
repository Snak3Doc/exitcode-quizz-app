/** Tunable numbers, each defined once. SPEC 3.10, 11, 12. */

export const MAX_PLAYERS = 30;
export const MAX_QUESTIONS_PER_QUIZ = 50;

export const DISCONNECT_GRACE_MS = 10_000;
/**
 * How long to let presence settle before believing a leave.
 *
 * A reload is a leave on the old connection and a join on the new one under
 * the same key, and they can arrive in either order. Presence itself knows
 * who is there, but not at the instant the leave fires -- asking then still
 * reports the leaver as present, which is why this waits.
 *
 * It only has to outlast that, not a whole reconnect: the grace above covers
 * the rest.
 */
export const PRESENCE_SETTLE_MS = 1_500;
export const HOST_GONE_GRACE_MS = 10_000;

/** How long a joining student waits for the host's presence, then for its reply. */
export const JOIN_PRESENCE_TIMEOUT_MS = 5_000;
export const JOIN_REPLY_TIMEOUT_MS = 5_000;

export const AUTOSAVE_DELAY_MS = 1_000;

export const BASE_POINTS = 1000;
export const MAX_SPEED_BONUS = 500;

export const MIN_TIME_LIMIT_SECONDS = 5;
export const MAX_TIME_LIMIT_SECONDS = 300;
export const DEFAULT_TIME_LIMIT_SECONDS = 30;
export const TIME_QUICK_PICKS = [10, 20, 30, 60, 120] as const;

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

export const MIN_ACCEPTED_ANSWERS = 1;
export const MAX_ACCEPTED_ANSWERS = 10;
export const MAX_ACCEPTED_ANSWER_LENGTH = 100;

export const MAX_BLANKS = 6;
export const MIN_WORD_BANK = 2;
export const MAX_WORD_BANK = 12;
export const MAX_WORD_LENGTH = 30;

export const MIN_LINES = 2;
export const MAX_LINES = 12;
export const MAX_LINE_LENGTH = 120;

export const MAX_PROMPT_LENGTH = 2000;
export const MAX_CODE_LENGTH = 4000;
export const MAX_SNIPPET_LENGTH = 2000;
export const MAX_EXPLANATION_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 100;
export const MAX_OPTION_TEXT_LENGTH = 500;
export const MAX_OPTION_CODE_LENGTH = 1000;

export const MAX_NAME_LENGTH = 20;

export const SHARE_CODE_LENGTH = 6;
/** No I, L, O, 0 or 1 — they are too easy to misread on a projector. */
export const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const MAX_IMPORT_BYTES = 1_000_000;
export const QUIZ_FILE_FORMAT = 'classroom-quiz';
export const QUIZ_FILE_VERSION = 1;

export const SESSION_MARKER_KEY = 'exitcode.game';
