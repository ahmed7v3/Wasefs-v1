/*
 * Word-level diff for the revision history (CONTENT-PLATFORM §4.5). Works on tokens of "word plus
 * the whitespace that follows it", so the output concatenates back to the new text (equal and added
 * runs) or the old one (equal and removed runs) with spacing intact, and never looks at script
 * direction: Arabic and English words are just non-space runs.
 *
 * Speed: the common prefix and suffix are trimmed first (an edit to a 30,000-word article touches a
 * few words), then Myers' O(ND) algorithm runs on what is left. Past MAX_EDIT_DISTANCE the middle is
 * reported as one removal and one addition instead of exhausting memory on a rewrite.
 */

export type DiffOp = { type: "equal" | "add" | "del"; text: string };

/** Trace memory is about D^2 ints; 2,500 keeps the worst case near 25 MB. */
const MAX_EDIT_DISTANCE = 2_500;

/** Leading whitespace is its own token; every other token is a word with its trailing whitespace. */
function tokenize(text: string): string[] {
  return text.match(/^\s+|\S+\s*/g) ?? [];
}

const keyOf = (token: string): string => token.trimEnd();

function myers(a: readonly number[], b: readonly number[]): ("equal" | "add" | "del")[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    // State at the start of round d is what the backtrack needs: indices k-1 and k+1 for k in [-d, d].
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0;
      } else {
        x = (v[offset + k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;

  const ops: ("equal" | "add" | "del")[] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const snapshot = trace[d];
    if (snapshot === undefined) return null;
    const at = (k: number): number => snapshot[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push("equal");
      x -= 1;
      y -= 1;
    }
    if (d > 0) ops.push(down ? "add" : "del");
    x = prevX;
    y = prevY;
  }
  return ops.reverse();
}

function push(out: DiffOp[], type: DiffOp["type"], text: string): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last !== undefined && last.type === type) last.text += text;
  else out.push({ type, text });
}

export function diffWords(a: string, b: string): DiffOp[] {
  if (a === b) return a === "" ? [] : [{ type: "equal", text: a }];
  const left = tokenize(a);
  const right = tokenize(b);

  let start = 0;
  const shortest = Math.min(left.length, right.length);
  while (start < shortest && keyOf(left[start] ?? "") === keyOf(right[start] ?? "")) start += 1;
  let endLeft = left.length;
  let endRight = right.length;
  while (
    endLeft > start &&
    endRight > start &&
    keyOf(left[endLeft - 1] ?? "") === keyOf(right[endRight - 1] ?? "")
  ) {
    endLeft -= 1;
    endRight -= 1;
  }

  const out: DiffOp[] = [];
  // Equal runs are emitted from the NEW text so whitespace edits show as the editor typed them.
  push(out, "equal", right.slice(0, start).join(""));

  const midLeft = left.slice(start, endLeft);
  const midRight = right.slice(start, endRight);
  if (midLeft.length === 0 || midRight.length === 0) {
    push(out, "del", midLeft.join(""));
    push(out, "add", midRight.join(""));
  } else {
    const ids = new Map<string, number>();
    const toIds = (tokens: string[]): number[] =>
      tokens.map((token) => {
        const key = keyOf(token);
        let id = ids.get(key);
        if (id === undefined) {
          id = ids.size;
          ids.set(key, id);
        }
        return id;
      });
    const script = myers(toIds(midLeft), toIds(midRight));
    if (script === null) {
      push(out, "del", midLeft.join(""));
      push(out, "add", midRight.join(""));
    } else {
      let i = 0;
      let j = 0;
      for (const op of script) {
        if (op === "equal") {
          push(out, "equal", midRight[j] ?? "");
          i += 1;
          j += 1;
        } else if (op === "del") {
          push(out, "del", midLeft[i] ?? "");
          i += 1;
        } else {
          push(out, "add", midRight[j] ?? "");
          j += 1;
        }
      }
    }
  }

  push(out, "equal", right.slice(endRight).join(""));
  return out;
}

/** Words added and removed (whitespace is not counted). */
export function diffStats(ops: readonly DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    const count = op.text.match(/\S+/g)?.length ?? 0;
    if (op.type === "add") added += count;
    else if (op.type === "del") removed += count;
  }
  return { added, removed };
}
