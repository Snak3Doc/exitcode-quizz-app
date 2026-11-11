/**
 * What a generated quiz ends up called.
 *
 * The teacher's topic is a brief, not a name. It used to become the title and
 * be cut at 60 characters with the rest thrown away, so a list of quizzes read
 * like a list of half-sentences and the missing half was gone from the
 * database, not just from the screen.
 */

import { describe, expect, it } from 'vitest';
import { quizTitle, titleFor } from './generate';
import { MAX_TITLE_LENGTH } from './constants';

const LONG_TOPIC = 'Python for loops using lists and enumerate() for intermediate students';

describe('naming a generated quiz', () => {
  it('uses the short name the model gave', () => {
    expect(quizTitle('Python for loops', LONG_TOPIC)).toBe('Python for loops');
  });

  it('capitalises it without otherwise rewriting it', () => {
    expect(quizTitle('list methods and slicing', LONG_TOPIC)).toBe('List methods and slicing');
  });

  it('tidies the spacing a model sometimes leaves behind', () => {
    expect(quizTitle('  Python   dictionaries  ', LONG_TOPIC)).toBe('Python dictionaries');
  });

  it('falls back to the topic when the model gives no name', () => {
    expect(quizTitle(null, 'Python dictionaries')).toBe('Python dictionaries');
    expect(quizTitle('', 'Python dictionaries')).toBe('Python dictionaries');
    expect(quizTitle('   ', 'Python dictionaries')).toBe('Python dictionaries');
  });

  it('falls back rather than cutting a name that ignored the request', () => {
    // A "short name" long enough to need cutting is not a short name, and
    // half of one reads worse than the topic it came from.
    const rambling =
      'A comprehensive quiz about Python for loops, the range function, and enumerate';
    expect(quizTitle(rambling, 'Python for loops')).toBe('Python for loops');
  });
});

describe('falling back to the teacher topic', () => {
  it('keeps the whole topic when it fits the column', () => {
    // 70 characters: cut at the old limit of 60, kept now.
    expect(LONG_TOPIC.length).toBeGreaterThan(60);
    expect(LONG_TOPIC.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(titleFor(LONG_TOPIC)).toBe(LONG_TOPIC);
    expect(titleFor(LONG_TOPIC)).not.toContain('…');
  });

  it('cuts only at what the column will hold', () => {
    const huge = 'a'.repeat(MAX_TITLE_LENGTH + 50);
    const title = titleFor(huge);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.endsWith('…')).toBe(true);
  });

  it('names an empty topic rather than leaving it blank', () => {
    expect(titleFor('   ')).not.toBe('');
  });
});
