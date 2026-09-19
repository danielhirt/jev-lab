/**
 * Codenames clue legality, decided in code. A clue must be one word, and it may not be a word
 * visible on the board, contain one, be contained in one, or be another form of one.
 * The inflection check is a deliberately crude stem: it errs toward rejecting.
 * A clue of three letters or fewer inside a longer board word ("ban" with BANK) is allowed,
 * since that is a substring rather than a compound.
 */
export function normalize(word: string): string {
  return word.trim().toLowerCase();
}

export function stem(word: string): string {
  const w = normalize(word);
  let base = w;
  for (const suffix of ["ing", "ers", "er", "es", "ed", "s"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      base = w.slice(0, -suffix.length);
      break;
    }
  }
  return base.length > 3 && base.endsWith("e") ? base.slice(0, -1) : base;
}

export function clueRejection(clue: string, visibleWords: readonly string[]): string | null {
  const c = normalize(clue);
  if (!/^[a-z][a-z'-]*$/.test(c)) return "a clue is one word of letters";
  for (const raw of visibleWords) {
    const w = normalize(raw);
    if (c === w) return `"${raw}" is on the board`;
    if (c.length >= 4 && w.includes(c)) return `"${raw}" contains it`;
    if (w.length >= 3 && c.includes(w)) return `it contains "${raw}"`;
    if (stem(c) === stem(w)) return `it is a form of "${raw}"`;
  }
  return null;
}

export function isLegalClue(clue: string, visibleWords: readonly string[]): boolean {
  return clueRejection(clue, visibleWords) === null;
}
