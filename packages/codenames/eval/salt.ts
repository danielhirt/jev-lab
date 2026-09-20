/**
 * Convert the SALT-NLP Codenames Duet data (Shaikh et al. 2023, "Modeling Cross-Cultural Pragmatic
 * Inference with Codenames Duet", arXiv:2306.02475) into `ClueRow`s.
 *
 * Two task files are row-aligned per turn: `generate_guess_task` (board the guesser saw, the clue,
 * the guess) and `clue_generation_task` (the giver's targets and the words they had to avoid:
 * Duet has 3 assassins, "black", and 13 bystanders, "tan"). We join by index and assert the clue
 * matches on every row. The repo states no license, so the derived file stays out of git.
 *
 *   bun run eval/salt.ts /path/to/SALT-NLP/codenames data/salt-duet.jsonl
 */
import { writeRows, type ClueRow } from "./dataset";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function pyList(text: string, key: string): string[] | undefined {
  const m = text.match(new RegExp(`${key}: (\\[[^\\]]*\\])`));
  if (!m) return undefined;
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

function scalar(text: string, key: string): string | undefined {
  return text.match(new RegExp(`${key}: ([^,\\]]+?)\\s*(?:,|$)`))?.[1]?.trim();
}

async function loadTask(root: string, task: string): Promise<{ base: string; output: string }[]> {
  const text = await Bun.file(`${root}/data/${task}/all.csv`).text();
  const [header, ...body] = parseCsv(text);
  const bi = header!.indexOf("base_text");
  const oi = header!.indexOf("output");
  return body.filter((r) => r.length > oi).map((r) => ({ base: r[bi]!, output: r[oi]! }));
}

export async function convertSalt(root: string): Promise<ClueRow[]> {
  const guesses = await loadTask(root, "generate_guess_task");
  const clues = await loadTask(root, "clue_generation_task");
  if (guesses.length !== clues.length) throw new Error(`row counts differ: ${guesses.length} vs ${clues.length}`);
  const rows: ClueRow[] = [];
  guesses.forEach((g, i) => {
    const c = clues[i]!;
    const clue = scalar(g.base, "hint");
    if (clue === undefined || clue !== c.output) throw new Error(`row ${i}: clue mismatch "${clue}" vs "${c.output}"`);
    const board = pyList(g.base, "remaining") ?? [];
    const targets = pyList(c.base, "targets") ?? [];
    const black = pyList(c.base, "black") ?? [];
    const tan = pyList(c.base, "tan") ?? [];
    if (board.length === 0 || !board.includes(g.output)) return;
    rows.push({
      source: "salt-nlp/codenames duet",
      game: String(i),
      board,
      clue,
      number: targets.length,
      guesses: [g.output],
      targets,
      avoid: [...black, ...tan].filter((w) => board.includes(w)),
      assassin: black.find((w) => board.includes(w)),
      assassins: black.filter((w) => board.includes(w)),
    });
  });
  return rows;
}

if (import.meta.main) {
  const [root, out = "data/salt-duet.jsonl"] = Bun.argv.slice(2);
  if (!root) {
    console.error("usage: bun run eval/salt.ts <path to SALT-NLP/codenames clone> [out.jsonl]");
    process.exit(2);
  }
  const rows = await convertSalt(root);
  await writeRows(out, rows);
  console.log(`${rows.length} rows -> ${out}`);
}
