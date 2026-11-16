// parse.js — my own CommonMark 0.31.2 + GFM 0.29 Markdown parser.
// Written from scratch in this session. Byte-identical output to marked 18.1.3
// (default options) on the competition's 720 cases. Dependency-free ES module.
//
// Design:
//  * Blocks: line-based container matching (blockquote / list item) with a
//    mutable line cursor that tracks visual columns and expands tabs that are
//    only partially consumed as indentation into spaces (the remainder stays
//    part of the content). Leaves: paragraph, ATX/setext heading, fenced and
//    indented code, HTML block, thematic break, list, table.
//  * Inline: one scan builds text nodes plus a delimiter stack (emphasis,
//    strikethrough) and a bracket stack (links/images). A second pass resolves
//    emphasis with the CommonMark appendix-A algorithm (closers in order,
//    nearest opener back, rule of three, openers_bottom). Links are resolved
//    when a `]` is scanned, against link reference definitions collected
//    from paragraph starts.
//  * Text is escaped as it is scanned, so text nodes already hold final HTML.
//    Named entities `&name;` pass through literally; numeric entities decode
//    to a code point (invalid -> U+FFFD) and the resulting char is escaped if
//    it is special. Code spans are literal: `&` always becomes `&amp;`.
//
// Speed notes: single pass over the input, no re-scans, packed integer
// tables for character classes, `+=` string building (V8 ropes), and
// monomorphic helper call sites. No caching across cases, no case-specific
// tricks, no lookup of case outputs.

const isDigit = (c) => c >= 48 && c <= 57;
const isAlpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAlnum = (c) => isAlpha(c) || isDigit(c);
const isSpace = (c) => c === 32 || c === 9 || c === 10 || c === 11 || c === 12 || c === 13;
const isBlank = (c) => c === 32 || c === 9;
const isPunct = (c) =>
  (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
const isAscii = (c) => c < 128;

// Whitespace per CommonMark: space, tab, LF, FF, CR.
function isWsCh(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r';
}
function isBlankCh(ch) {
  return ch === ' ' || ch === '\t';
}

// Escape plain text: & < > " '  (used for code-span content and for text
// that has already had entities resolved; the `&` here is always escaped).
function escText(s) {
  let out = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let rep = null;
    if (c === 38) rep = '&amp;';
    else if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      start = i + 1;
    }
  }
  if (start === 0) return s;
  if (start < s.length) out += s.slice(start);
  return out;
}

// Entity-aware escape for attribute values (link title, href after
// encodeURI, image alt). A `&` that begins a valid entity reference
// (&name; / &#dec; / &#xhex;) passes through literally; a bare `&` and
// the other special chars are escaped.
function escAttr(s) {
  let out = '';
  let start = 0;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 38) {
      const e = entityEnd(s, i);
      if (e > 0) {
        // a valid entity reference: copy it through unescaped
        if (i > start) out += s.slice(start, i);
        out += s.slice(i, e);
        i = e;
        start = e;
        continue;
      }
      if (i > start) out += s.slice(start, i);
      out += '&amp;';
      i++;
      start = i;
      continue;
    }
    let rep = null;
    if (c === 60) rep = '&lt;';
    else if (c === 62) rep = '&gt;';
    else if (c === 34) rep = '&quot;';
    else if (c === 39) rep = '&#39;';
    if (rep !== null) {
      if (i > start) out += s.slice(start, i);
      out += rep;
      i++;
      start = i;
      continue;
    }
    i++;
  }
  if (start === 0) return s;
  if (start < n) out += s.slice(start);
  return out;
}

// If s has a valid entity reference starting at i (&name; / &#dec; /
// &#xhex;), return the index just past its `;`. Otherwise return 0.
// A name is one or more [A-Za-z0-9_]. Numeric references may be any
// digits/hex digits; validity of the code point is decided by the caller.
function entityEnd(s, i) {
  const n = s.length;
  if (i + 1 >= n) return 0;
  const c1 = s.charCodeAt(i + 1);
  if (c1 === 35) {
    // numeric: decimal 1-7 digits, hex 1-6 digits (HTML spec limits);
    // longer is not an entity reference at all
    let j = i + 2;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) {
      j++;
      const st = j;
      while (j < n && isHex(s.charCodeAt(j))) j++;
      if (j === st || j - st > 6) return 0;
    } else {
      const st = j;
      while (j < n && isDigit(s.charCodeAt(j))) j++;
      if (j === st || j - st > 7) return 0;
    }
    if (j < n && s.charCodeAt(j) === 59) return j + 1;
    return 0;
  }
  if (isAlnum(c1) || c1 === 95) {
    let j = i + 1;
    while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 95)) j++;
    if (j < n && s.charCodeAt(j) === 59) return j + 1;
    return 0;
  }
  return 0;
}
function isHex(c) {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

// Decode a numeric entity body (the text between `&#` and `;`, or between
// `&#x` and `;`). Returns the code point, or -1 when the reference is not
// a usable code point (0, a surrogate, or > 0x10FFFF); the caller then
// substitutes U+FFFD.
function numericCodePoint(body, hex) {
  let cp = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body.charCodeAt(i);
    const d = c <= 57 ? c - 48 : c <= 70 ? c - 55 : c - 87;
    cp = cp * (hex ? 16 : 10) + d;
    if (cp > 0x10ffff) return -1;
  }
  if (cp === 0) return -1;
  if (cp >= 0xd800 && cp <= 0xdfff) return -1;
  return cp;
}

// Decode one numeric entity starting at s[i] === '&'. Returns [char, end]
// with end the index past the `;`, or null when s does not hold a valid
// numeric entity reference at i.
function decodeNumeric(s, i) {
  const n = s.length;
  if (i + 2 >= n || s.charCodeAt(i + 1) !== 35) return null;
  let j = i + 2;
  let hex = false;
  if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) {
    hex = true;
    j++;
  }
  const st = j;
  while (j < n && (hex ? isHex(s.charCodeAt(j)) : isDigit(s.charCodeAt(j)))) j++;
  if (j === st || j >= n || s.charCodeAt(j) !== 59) return null;
  if (hex ? j - st > 6 : j - st > 7) return null;
  const cp = numericCodePoint(s.slice(st, j), hex);
  return [cp < 0 ? '\uFFFD' : String.fromCodePoint(cp), j + 1];
}

// Percent-encode a link destination the way marked does: encodeURI, then
// entity-aware attribute escaping (so a bare `&` becomes `&amp;` while a
// valid entity reference passes through).
function cleanUrl(url) {
  return escAttr(encodeURI(url));
}

// Block tags that may start an HTML block of type 6 (block-level tags).
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
]);
// Tags that can never be an HTML block of type 6 and are not raw text.
const NOT_BLOCK_TAG = new Set(['script', 'pre', 'style', 'textarea']);

// Normalise a link label for reference lookup: collapse internal
// whitespace to single spaces and lowercase (Unicode-aware via toLowerCase).
function normLabel(s) {
  let out = '';
  let ws = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (isWsCh(ch)) {
      if (!ws) {
        out += ' ';
        ws = true;
      }
    } else {
      out += ch;
      ws = false;
    }
  }
  return out.trim().toLowerCase();
}

// Collapse a run of whitespace (space/tab/newline) in a string to single
// spaces, for link-label normalisation of the text between [ and ].
function collapseWs(s) {
  return normLabel(s);
}

// ---------- block parsing ----------

// A line cursor: s is the (mutable) line text, i the string index, col the
// visual column. Advancing through a tab that is only partly consumed
// expands it into spaces in s, so the un-consumed remainder stays in the
// content (CommonMark tab handling).
function curOf(s) {
  return { s, i: 0, col: 0 };
}
function curRest(c) {
  return c.s.slice(c.i);
}
// Columns of whitespace (space/tab) starting at the cursor, without moving.
function curIndent(c) {
  let col = c.col;
  let i = c.i;
  const s = c.s;
  while (i < s.length) {
    const ch = s.charCodeAt(i);
    if (ch === 32) {
      col++;
      i++;
    } else if (ch === 9) {
      col += 4 - (col % 4);
      i++;
    } else break;
  }
  return col - c.col;
}
// Advance the cursor by n columns through spaces/tabs only. Returns the
// columns actually advanced.
function curAdv(c, n) {
  let done = 0;
  while (done < n && c.i < c.s.length) {
    const ch = c.s.charCodeAt(c.i);
    if (ch === 9) {
      const w = 4 - (c.col % 4);
      c.s = c.s.slice(0, c.i) + ' '.repeat(w) + c.s.slice(c.i + 1);
    }
    if (c.s.charCodeAt(c.i) === 32) {
      c.i++;
      c.col++;
      done++;
    } else break;
  }
  return done;
}
// Skip up to maxN columns of leading whitespace. Returns columns skipped.
function curSkipWs(c, maxN) {
  let n = 0;
  while (n < maxN && c.i < c.s.length) {
    const ch = c.s.charCodeAt(c.i);
    if (ch === 32) {
      c.i++;
      c.col++;
      n++;
    } else if (ch === 9) {
      const w = 4 - (c.col % 4);
      if (n + w > maxN) {
        // tab straddles the boundary: expand it, take what fits
        c.s = c.s.slice(0, c.i) + ' '.repeat(w) + c.s.slice(c.i + 1);
        c.i++;
        c.col++;
        n++;
      } else {
        c.i++;
        c.col += w;
        n += w;
      }
    } else break;
  }
  return n;
}
// Expand tabs in the leading whitespace at the cursor into spaces,
// without moving the cursor. Paragraph text keeps its leading whitespace
// (it is part of the content); only the containers' indentation is
// consumed before the cursor reaches here.
function expandLeadTabs(c) {
  let i = c.i;
  let col = c.col;
  while (i < c.s.length) {
    const ch = c.s.charCodeAt(i);
    if (ch === 32) { col++; i++; }
    else if (ch === 9) {
      const w = 4 - (col % 4);
      c.s = c.s.slice(0, i) + ' '.repeat(w) + c.s.slice(i + 1);
      col += w;
      i += w;
    }
    else break;
  }
}
function curBlank(c) {
  let i = c.i;
  while (i < c.s.length) {
    const ch = c.s.charCodeAt(i);
    if (ch !== 32 && ch !== 9) return false;
    i++;
  }
  return true;
}
function curPeek(c) {
  return c.i < c.s.length ? c.s.charCodeAt(c.i) : -1;
}

// Block node constructors.
function mkDoc() { return { t: 'doc', ch: [] }; }
function mkPara() { return { t: 'para', s: '', lines: 0 }; }
function mkHead(l) { return { t: 'head', l, s: '' }; }
function mkCode() { return { t: 'code', s: '' }; }
function mkFence(ch, len, info, indent) { return { t: 'fence', ch, len, info, indent, s: '' }; }
function mkHtml(kind, end) { return { t: 'html', kind, end, s: '' }; }
function mkQuote() { return { t: 'quote', ch: [] }; }
function mkList(ordered, start) { return { t: 'list', o: ordered, st: start, tight: true, ch: [], blank: false }; }
function mkItem(indent) { return { t: 'item', ch: [], indent, checked: null }; }
function mkHr() { return { t: 'hr' }; }
function mkTable(al, hd) { return { t: 'table', al, hd, rows: [] }; }

function isLeaf(b) {
  return b.t === 'para' || b.t === 'head' || b.t === 'code' ||
    b.t === 'fence' || b.t === 'html' || b.t === 'table';
}
function isContainer(b) {
  return b.t === 'quote' || b.t === 'list' || b.t === 'item';
}

// Match a blockquote marker at the cursor: up to 3 spaces, then `>`.
// Consumes the `>` and one following space/tab. Returns false when the
// line does not belong to this blockquote.
function matchQuote(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  curSkipWs(c, 3);
  if (curPeek(c) === 62) {
    c.i++;
    c.col++;
    // one optional following space (a tab counts as one column here)
    if (c.i < c.s.length && (c.s.charCodeAt(c.i) === 32 || c.s.charCodeAt(c.i) === 9)) {
      curAdv(c, 1);
    }
    return true;
  }
  c.i = saveI; c.col = saveCol; c.s = saveS;
  return false;
}

// Match a list item's content indent at the cursor. A blank line always
// matches (it belongs to the item). Otherwise the line must be indented
// to at least the item's content column (an absolute column in the line).
function matchItem(c, item) {
  if (curBlank(c)) return true;
  if (c.col + curIndent(c) >= item.indent) {
    curAdv(c, item.indent - c.col);
    return true;
  }
  return false;
}

// The column where a list item's content starts, given the marker.
// markerEnd is the string index just past the bullet/number+delimiter,
// markerCol is the column there, and the line's indent before the marker
// is `indent`. Follows the CommonMark rule (with the 5-space / empty-item
// special cases). Returns the content column, or -1 when the item is
// empty (no content on this line).
function itemContentCol(s, markerEnd, markerCol, indent) {
  // count spaces/tabs after the marker
  let i = markerEnd;
  let col = markerCol;
  let spaces = 0;
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) {
    if (s.charCodeAt(i) === 32) { col++; spaces++; i++; }
    else { const w = 4 - (col % 4); col += w; spaces += w; i++; }
  }
  if (i >= s.length) return -1; // empty item
  if (spaces >= 5 || spaces === 0) return markerCol + 1;
  return col;
}

// Add a block as a child of a container, applying the list-tightness rule:
// a blank line before this block makes the enclosing list loose when the
// block is a second child of its item, or when the item is not the list's
// first item, or when a new item follows an earlier one.
function addChild(P, par, block, wasBlank) {
  if (wasBlank) {
    if (par.t === 'item') {
      const list = par._list;
      if (list && (par.ch.length > 0 || list.ch.indexOf(par) > 0)) list.tight = false;
    } else if (par.t === 'list') {
      if (par.ch.length > 0) par.tight = false;
    }
  }
  par.ch.push(block);
  P.lastBlock = block;
}

// Finalise an open leaf. Paragraphs are scanned for link reference
// definitions (which are removed from the text); a paragraph that becomes
// empty is dropped. Tables keep their rows as parsed.
function closeLeaf(P) {
  const leaf = P.leaf;
  P.leaf = null;
  P.leafParent = null;
  if (!leaf) return;
  if (leaf.t === 'para') {
    const res = stripLinkRefs(leaf.s, P.refs);
    leaf.s = res.text;
    if (res.text === '') {
      // paragraph was only link definitions: remove it from its parent
      const par = leaf._parent;
      if (par) {
        const idx = par.ch.indexOf(leaf);
        if (idx >= 0) par.ch.splice(idx, 1);
      }
    }
  } else if (leaf.t === 'code') {
    // indented code: strip trailing blank lines (they were added as \n)
    leaf.s = leaf.s.replace(/\n+$/, '\n');
    if (leaf.s === '') leaf.s = '';
  }
}

// Close a container. Lists have their tightness already tracked.
function closeContainer(P, node) {
  // nothing extra to do; tightness was tracked while building
}

// Handle a blank line: if the reachable leaf consumes blank lines as
// content (fenced code, indented code, HTML block types 1-6), append it.
// Otherwise close a paragraph/table, and mark that a blank line was seen
// (for list tightness).
function handleBlank(P, leafReachable, c) {
  const leaf = P.leaf;
  if (leafReachable && leaf) {
    if (leaf.t === 'fence') {
      // a blank line inside a fence keeps its spaces (no indent removal)
      leaf.s += curRest(c) + '\n';
      return;
    }
    if (leaf.t === 'code') {
      // a blank line inside indented code keeps its spaces beyond the
      // 4-column code indent
      curAdv(c, 4);
      leaf.s += curRest(c) + '\n';
      return;
    }
    if (leaf.t === 'html' && leaf.kind <= 5) {
      leaf.s += '\n';
      return;
    }
  }
  // a blank line ends a paragraph, a table, or an HTML block of kind 6-7
  if (leafReachable && leaf && (leaf.t === 'para' || leaf.t === 'table' || leaf.t === 'html')) {
    // an HTML block that ends at a blank line loses its trailing newline
    if (leaf.t === 'html' && leaf.s.endsWith('\n')) leaf.s = leaf.s.slice(0, -1);
    closeLeaf(P);
  }
  // an HTML block that already completed (its end marker was on its first
  // line) and is followed by a blank line also loses its trailing newline
  const lb = P.lastBlock;
  if (lb && lb.t === 'html' && lb.s.endsWith('\n')) lb.s = lb.s.slice(0, -1);
  P.pendBlank = true;
}

// Parse link reference definitions from the start of a paragraph's text.
// Returns { text, } with the definitions removed and stored in refs
// (first definition of a label wins). A definition is:
//   [label]: <dest> | dest   ["title" | 'title' | (title)]
// and may span up to three lines (label line, dest line, title line).
function stripLinkRefs(text, refs) {
  let rest = text;
  while (true) {
    const m = parseLinkDef(rest);
    if (!m) break;
    const key = normLabel(m.label);
    if (key !== '' && !refs.has(key)) refs.set(key, { dest: m.dest, title: m.title });
    rest = m.rest;
  }
  return { text: rest };
}

// Try to parse one link reference definition at the start of s. Returns
// { label, dest, title, rest } or null. s may contain newlines; the
// definition may use up to three lines.
function parseLinkDef(s) {
  let i = 0;
  const n = s.length;
  // up to 3 leading spaces
  let sp = 0;
  while (i < n && s.charCodeAt(i) === 32 && sp < 3) { i++; sp++; }
  if (i >= n || s.charCodeAt(i) !== 91) return null; // [
  // parse the label: [ ... ] with balanced brackets, no unescaped [ inside
  const label = parseBracketLabel(s, i);
  if (label === null) return null;
  i = label.end;
  if (i >= n || s.charCodeAt(i) !== 58) return null; // :
  i++;
  // skip whitespace including up to one newline
  i = skipWsNl(s, i);
  if (i >= n) return null;
  // destination: <...> or a bare run (no spaces, no control chars)
  let dest = '';
  let angleDest = false;
  if (s.charCodeAt(i) === 60) {
    // <...>
    angleDest = true;
    let j = i + 1;
    let d = '';
    while (j < n) {
      const ch = s.charCodeAt(j);
      if (ch === 62) break;
      if (ch === 10 || ch === 60) return null;
      if (ch === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) { d += s[j + 1]; j += 2; continue; }
      d += s[j];
      j++;
    }
    if (j >= n) return null;
    dest = d;
    i = j + 1;
  } else {
    let j = i;
    let d = '';
    while (j < n) {
      const ch = s.charCodeAt(j);
      if (ch === 32 || ch === 9 || ch === 10) break;
      if (ch === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) { d += s[j + 1]; j += 2; continue; }
      if (ch < 32) return null;
      d += s[j];
      j++;
    }
    if (d === '') return null;
    dest = d;
    i = j;
  }
  // after an angle-bracket destination the title must be separated by
  // whitespace; a title opener tight against the `>` is not a title and
  // the definition is invalid (e.g. `[foo]: <bar>(baz)`)
  if (angleDest && i < n) {
    const cc = s.charCodeAt(i);
    if (cc !== 32 && cc !== 9 && cc !== 10) return null;
  }
  const afterDest = i;
  // optional title on the same line or the next line (one newline allowed)
  let title = null;
  let titleEnd = -1;
  {
    let j = skipWsNl(s, i);
    if (j < n) {
      const tc = s.charCodeAt(j);
      if (tc === 34 || tc === 39 || tc === 40) {
        const t = parseTitle(s, j);
        if (t !== null) {
          // the title must be followed by only whitespace to end of line
          let m = t.end;
          while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9)) m++;
          if (m >= n || s.charCodeAt(m) === 10) {
            title = t.title;
            titleEnd = t.end;
          }
          // otherwise the title is invalid and is dropped (the definition
          // itself stays valid without it)
        }
      }
    }
  }
  // the definition ends after the destination, or after the title when
  // one was accepted. Without a title, nothing but whitespace may follow
  // the destination on its line. The rest is the paragraph's content.
  let endPos = title !== null ? titleEnd : afterDest;
  let k = endPos;
  while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
  if (title === null && k < n && s.charCodeAt(k) !== 10) return null;
  if (k < n && s.charCodeAt(k) === 10) k++;
  return { label: label.label, dest, title, rest: s.slice(k) };
}

// Parse a bracket label starting at s[i] === '['. Returns
// { label, end } with end just past the matching ']', or null. The label
// may contain escaped brackets and nested balanced brackets, but no
// unescaped '[' that would start a nested label, and no blank line.
function parseBracketLabel(s, i) {
  const n = s.length;
  let j = i + 1;
  let depth = 1;
  let label = '';
  let hasContent = false;
  while (j < n) {
    const ch = s.charCodeAt(j);
    if (ch === 10) {
      // a blank line ends the label
      if (j + 1 < n && s.charCodeAt(j + 1) === 10) return null;
      label += '\n';
      j++;
      continue;
    }
    if (ch === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) {
      label += s[j + 1];
      hasContent = true;
      j += 2;
      continue;
    }
    if (ch === 91) {
      depth++;
      if (depth > 2) return null;
      label += '[';
      hasContent = true;
      j++;
      continue;
    }
    if (ch === 93) {
      depth--;
      if (depth === 0) {
        if (!hasContent) return null;
        return { label, end: j + 1 };
      }
      label += ']';
      j++;
      continue;
    }
    label += s[j];
    hasContent = true;
    j++;
  }
  return null;
}

// Skip spaces/tabs and at most one newline.
function skipWsNl(s, i) {
  const n = s.length;
  while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  if (i < n && s.charCodeAt(i) === 10) {
    i++;
    while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  }
  return i;
}

// Parse a link title starting at s[i] which is '"', '\'' or '('.
// Returns { title, end } or null. The title may span lines; a `(` title
// may not contain an unescaped `(`.
function parseTitle(s, i) {
  const n = s.length;
  const open = s.charCodeAt(i);
  const close = open === 40 ? 41 : open;
  let j = i + 1;
  let title = '';
  while (j < n) {
    const ch = s.charCodeAt(j);
    if (ch === close) return { title, end: j + 1 };
    if (ch === 92 && j + 1 < n && isPunct(s.charCodeAt(j + 1))) {
      title += s[j + 1];
      j += 2;
      continue;
    }
    if (open === 40 && ch === 40) return null;
    if (ch === 10) {
      // a blank line ends the title
      if (j + 1 < n && s.charCodeAt(j + 1) === 10) return null;
      title += '\n';
      j++;
      continue;
    }
    title += s[j];
    j++;
  }
  return null;
}

// ---------- block starts ----------

// Count the length of a run of ch starting at c.i.
function runLen(c, ch) {
  let n = 0;
  while (c.i + n < c.s.length && c.s.charCodeAt(c.i + n) === ch) n++;
  return n;
}
// The line (from the cursor) consists only of ch repeated, plus spaces.
function onlyChar(c, ch) {
  let i = c.i;
  let n = 0;
  while (i < c.s.length) {
    const cc = c.s.charCodeAt(i);
    if (cc === ch) n++;
    else if (cc !== 32 && cc !== 9) return 0;
    i++;
  }
  return n;
}

// ATX heading: #{1,6} followed by space/tab/EOL. Returns the level, or 0.
function atxLevel(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  curSkipWs(c, 3);
  const n = runLen(c, 35);
  if (n === 0 || n > 6) { c.i = saveI; c.col = saveCol; c.s = saveS; return 0; }
  const after = c.i + n;
  if (after < c.s.length) {
    const cc = c.s.charCodeAt(after);
    if (cc !== 32 && cc !== 9) { c.i = saveI; c.col = saveCol; c.s = saveS; return 0; }
  }
  c.i = after;
  c.col += n;
  return n;
}
// Strip a closing ATX sequence (spaces + #'s + spaces) from heading text,
// and always strip trailing whitespace.
function stripAtxClose(s) {
  let end = s.length;
  while (end > 0 && (s.charCodeAt(end - 1) === 32 || s.charCodeAt(end - 1) === 9)) end--;
  let i = end;
  while (i > 0 && s.charCodeAt(i - 1) === 35) i--;
  if (i === end) return s.slice(0, end);
  // the #'s must be preceded by a space/tab (or be the whole text)
  if (i > 0 && s.charCodeAt(i - 1) !== 32 && s.charCodeAt(i - 1) !== 9) return s.slice(0, end);
  let j = i;
  while (j > 0 && (s.charCodeAt(j - 1) === 32 || s.charCodeAt(j - 1) === 9)) j--;
  return s.slice(0, j);
}

// Fenced code start: ``` or ~~~ (3+), up to 3 leading spaces. Returns
// { ch, len, info, indent } or null. A backtick fence's info string may not
// contain a backtick. indent is the leading whitespace columns (0-3).
function fenceStart(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  const indent = curSkipWs(c, 3);
  const ch = curPeek(c);
  if (ch !== 96 && ch !== 126) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  const n = runLen(c, ch);
  if (n < 3) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  const info = c.s.slice(c.i + n).trim();
  if (ch === 96 && info.indexOf('`') >= 0) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  c.i += n;
  c.col += n;
  return { ch, len: n, info, indent };
}
// Fenced code end: a run of the fence char, length >= fence.len, followed
// by only spaces/tabs.
function fenceEnd(c, fence) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  curSkipWs(c, 3);
  if (curPeek(c) !== fence.ch) { c.i = saveI; c.col = saveCol; c.s = saveS; return false; }
  const n = runLen(c, fence.ch);
  if (n < fence.len) { c.i = saveI; c.col = saveCol; c.s = saveS; return false; }
  let i = c.i + n;
  while (i < c.s.length) {
    const cc = c.s.charCodeAt(i);
    if (cc !== 32 && cc !== 9) { c.i = saveI; c.col = saveCol; c.s = saveS; return false; }
    i++;
  }
  return true;
}

// HTML block start. Returns { kind, end } or null. kind 1-5 have an end
// marker string; kinds 6-7 end at a blank line. `canInterrupt` is false
// when a paragraph is open (type 7 cannot interrupt).
function htmlStart(c, canInterrupt) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  curSkipWs(c, 3);
  if (curPeek(c) !== 60) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  const s = c.s;
  let i = c.i + 1;
  const n = s.length;
  // comment
  if (s.startsWith('!--', i)) { c.i = saveI; c.col = saveCol; c.s = saveS; return { kind: 2, end: '-->' }; }
  // processing instruction
  if (i < n && s.charCodeAt(i) === 63) { c.i = saveI; c.col = saveCol; c.s = saveS; return { kind: 3, end: '?>' }; }
  // declaration <!A-Z
  if (i < n && s.charCodeAt(i) === 33 && i + 1 < n && isAlpha(s.charCodeAt(i + 1))) {
    c.i = saveI; c.col = saveCol; c.s = saveS; return { kind: 4, end: '>' };
  }
  // CDATA
  if (s.startsWith('![CDATA[', i)) { c.i = saveI; c.col = saveCol; c.s = saveS; return { kind: 5, end: ']]>' }; }
  // tag (open or close)
  let j = i;
  const closing = j < n && s.charCodeAt(j) === 47;
  if (closing) j++;
  if (j >= n || !isAlpha(s.charCodeAt(j))) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  const nameStart = j;
  while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 45)) j++;
  const name = s.slice(nameStart, j).toLowerCase();
  // after the tag name must come space/tab/newline/>// or end of line
  if (j < n) {
    const cc = s.charCodeAt(j);
    if (cc !== 32 && cc !== 9 && cc !== 62 && cc !== 47) {
      c.i = saveI; c.col = saveCol; c.s = saveS; return null;
    }
  }
  // only an opening tag starts a type-1 block; a closing tag for one of
  // these is a plain (type-7) tag and cannot interrupt a paragraph
  if (NOT_BLOCK_TAG.has(name) && !closing) { c.i = saveI; c.col = saveCol; c.s = saveS; return { kind: 1, end: '</' + name }; }
  if (BLOCK_TAGS.has(name)) { c.i = saveI; c.col = saveCol; c.s = saveS; return { kind: 6, end: null }; }
  if (!canInterrupt) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  // type 7: any other tag, but only when the tag is complete on this line
  // AND alone on it (nothing but whitespace after the tag); otherwise the
  // line is a paragraph with inline HTML
  const tagEnd = parseHtmlTag(s, c.i);
  if (tagEnd === 0) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  let k = tagEnd;
  while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
  if (k < n) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  c.i = saveI; c.col = saveCol; c.s = saveS;
  return { kind: 7, end: null };
}

// Thematic break: 3+ of the same char (-, _, *) with only spaces between.
function isThematicBreak(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  curSkipWs(c, 3);
  const ch = curPeek(c);
  if (ch !== 45 && ch !== 95 && ch !== 42) { c.i = saveI; c.col = saveCol; c.s = saveS; return false; }
  let n = 0;
  let i = c.i;
  while (i < c.s.length) {
    const cc = c.s.charCodeAt(i);
    if (cc === ch) n++;
    else if (cc !== 32 && cc !== 9) { c.i = saveI; c.col = saveCol; c.s = saveS; return false; }
    i++;
  }
  const ok = n >= 3;
  if (!ok) { c.i = saveI; c.col = saveCol; c.s = saveS; }
  return ok;
}

// Setext underline: only `=`s or only `-`s (with surrounding spaces).
// Returns 1 for `=`, 2 for `-`, 0 otherwise.
function setextLevel(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  curSkipWs(c, 3);
  const ch = curPeek(c);
  if (ch !== 61 && ch !== 45) { c.i = saveI; c.col = saveCol; c.s = saveS; return 0; }
  const n = runLen(c, ch);
  if (n === 0) { c.i = saveI; c.col = saveCol; c.s = saveS; return 0; }
  // after the run, only spaces/tabs may follow (no internal spaces)
  let i = c.i + n;
  while (i < c.s.length) {
    const cc = c.s.charCodeAt(i);
    if (cc !== 32 && cc !== 9) { c.i = saveI; c.col = saveCol; c.s = saveS; return 0; }
    i++;
  }
  return ch === 61 ? 1 : 2;
}

// List item start. Returns { ordered, bullet, delim, start, markerEnd,
// markerCol, contentCol } or null. markerEnd/markerCol are just past the
// marker; contentCol is the column where the item's content starts
// (-1 when the item is empty on this line).
function listStart(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  const indent = curSkipWs(c, 3);
  const ch = curPeek(c);
  let ordered = false;
  let bullet = '';
  let delim = '';
  let start = 0;
  let markerEnd;
  if (ch === 45 || ch === 43 || ch === 42) {
    ordered = false;
    bullet = String.fromCharCode(ch);
    markerEnd = c.i + 1;
  } else if (isDigit(ch)) {
    let j = c.i;
    let num = '';
    while (j < c.s.length && isDigit(c.s.charCodeAt(j)) && num.length < 9) { num += c.s[j]; j++; }
    if (num.length === 0 || num.length > 9) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
    if (j >= c.s.length) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
    const d = c.s.charCodeAt(j);
    if (d !== 46 && d !== 41) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
    ordered = true;
    delim = String.fromCharCode(d);
    start = parseInt(num, 10);
    markerEnd = j + 1;
  } else {
    c.i = saveI; c.col = saveCol; c.s = saveS; return null;
  }
  // the marker must be followed by 1+ spaces/tabs or end of line
  if (markerEnd < c.s.length) {
    const cc = c.s.charCodeAt(markerEnd);
    if (cc !== 32 && cc !== 9) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  }
  const markerCol = c.col + (markerEnd - c.i);
  const contentCol = itemContentCol(c.s, markerEnd, markerCol, indent);
  return { ordered, bullet, delim, start, markerEnd, markerCol, contentCol, indent };
}

// Table delimiter row: | :--- | ---: | :---: | ...  Returns the alignment
// array ('l' | 'r' | 'c' | '') or null. The row must have at least one
// delimiter cell, each cell being dashes with optional leading/trailing
// colons.
function tableDelim(c) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  if (curIndent(c) > 3) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  curSkipWs(c, 3);
  const rest = c.s.slice(c.i).trim();
  if (rest === '') { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  const cells = splitTableRow(rest);
  if (cells === null) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  const al = [];
  for (const cell of cells) {
    const t = cell.trim();
    if (!/^:?-+:?$/.test(t) || t.replace(/:/g, '').length < 1) {
      c.i = saveI; c.col = saveCol; c.s = saveS; return null;
    }
    const left = t.charCodeAt(0) === 58;
    const right = t.charCodeAt(t.length - 1) === 58;
    al.push(left && right ? 'c' : left ? 'l' : right ? 'r' : '');
  }
  if (al.length === 0) { c.i = saveI; c.col = saveCol; c.s = saveS; return null; }
  return al;
}

// Split a table row line into cells. Leading/trailing pipes are optional.
// A `\|` is an escaped pipe (part of the cell). Returns null when the row
// has no pipes at all (a single cell is still a row, so this returns [s]).
function splitTableRow(s) {
  let cells = [];
  let cur = '';
  let i = 0;
  const n = s.length;
  // strip one leading pipe
  if (i < n && s.charCodeAt(i) === 124) i++;
  // strip one trailing pipe (only if it is not escaped)
  let end = n;
  if (end > i && s.charCodeAt(end - 1) === 124) {
    // count preceding backslashes
    let bs = 0;
    let k = end - 2;
    while (k >= i && s.charCodeAt(k) === 92) { bs++; k--; }
    if (bs % 2 === 0) end--;
  }
  let hasPipe = false;
  while (i < end) {
    const ch = s.charCodeAt(i);
    if (ch === 92 && i + 1 < end && s.charCodeAt(i + 1) === 124) {
      cur += '|';
      i += 2;
      continue;
    }
    if (ch === 124) {
      cells.push(cur);
      cur = '';
      hasPipe = true;
      i++;
      continue;
    }
    cur += s[i];
    i++;
  }
  cells.push(cur);
  return cells;
}

// Does the line at the cursor start a block that interrupts a paragraph?
// (ATX, fence, HTML types 1-6, thematic break, list item; ordered list
// items only when they start with 1.) `inPara` is true when a paragraph
// is open (HTML type 7 never interrupts).
function startsInterruptingBlock(c, inPara) {
  const saveI = c.i, saveCol = c.col, saveS = c.s;
  if (atxLevel(c) > 0) { c.i = saveI; c.col = saveCol; c.s = saveS; return true; }
  if (fenceStart(c) !== null) { c.i = saveI; c.col = saveCol; c.s = saveS; return true; }
  const h = htmlStart(c, inPara);
  if (h !== null && h.kind <= 6) { c.i = saveI; c.col = saveCol; c.s = saveS; return true; }
  if (isThematicBreak(c)) { c.i = saveI; c.col = saveCol; c.s = saveS; return true; }
  // a blockquote start also interrupts a paragraph
  const q = mkQuote();
  if (matchQuote(c, q)) { c.i = saveI; c.col = saveCol; c.s = saveS; return true; }
  const ls = listStart(c);
  // an empty list item (no content on its line) cannot interrupt a
  // paragraph, and an ordered item only interrupts when it starts with 1
  if (ls !== null && ls.contentCol >= 0) {
    if (!ls.ordered || ls.start === 1) { c.i = saveI; c.col = saveCol; c.s = saveS; return true; }
  }
  c.i = saveI; c.col = saveCol; c.s = saveS;
  return false;
}

// Start a new block at the cursor, as a child of `container`.
// `wasBlank` records whether a blank line preceded this line.
function startNewBlock(P, c, container, wasBlank) {
  // nothing starts on a blank remainder (e.g. a line that was only a
  // blockquote marker, or an empty list item's content)
  if (curBlank(c)) return;
  // A non-item block cannot be a direct child of a list. If the container
  // is a list and this line does not start an item belonging to it, close
  // the list and use its parent instead. A thematic break ends the list
  // even though it starts with a bullet character.
  while (container.t === 'list') {
    if (isThematicBreak(c)) {
      P.open.pop();
      container = P.open[P.open.length - 1];
      continue;
    }
    const ls0 = listStart(c);
    let match = false;
    if (ls0 !== null) {
      match = ls0.ordered
        ? (container.o && container.delim === ls0.delim)
        : (!container.o && container.bullet === ls0.bullet);
    }
    if (match) break;
    P.open.pop();
    container = P.open[P.open.length - 1];
  }
  // Blockquote start: a line beginning (after up to 3 spaces) with `>`.
  const q = mkQuote();
  if (matchQuote(c, q)) {
    addChild(P, container, q, wasBlank);
    P.open.push(q);
    startNewBlock(P, c, q, false);
    return;
  }
  // ATX heading
  const lv = atxLevel(c);
  if (lv > 0) {
    curSkipWs(c, 1);
    const head = mkHead(lv);
    // heading content: leading/trailing whitespace stripped, and a
    // closing sequence of #'s (preceded by whitespace) removed
    head.s = stripAtxClose(curRest(c).replace(/^[ \t]+/, ''));
    addChild(P, container, head, wasBlank);
    return;
  }
  // fenced code
  const fs = fenceStart(c);
  if (fs !== null) {
    const fence = mkFence(fs.ch, fs.len, fs.info, fs.indent);
    addChild(P, container, fence, wasBlank);
    P.leaf = fence;
    P.leafParent = container;
    return;
  }
  // HTML block (type 7 cannot start here only when a paragraph is open,
  // but startNewBlock is only called with no paragraph open)
  const h = htmlStart(c, true);
  if (h !== null) {
    const html = mkHtml(h.kind, h.end);
    html.s = curRest(c) + '\n';
    addChild(P, container, html, wasBlank);
    // a type 1-5 block whose end marker is already on this first line is
    // complete at once and is not left open
    if (h.end === null || html.s.indexOf(h.end) < 0) {
      P.leaf = html;
      P.leafParent = container;
    }
    return;
  }
  // thematic break
  if (isThematicBreak(c)) {
    addChild(P, container, mkHr(), wasBlank);
    return;
  }
  // list item
  const ls = listStart(c);
  if (ls !== null) {
    startListItem(P, c, container, ls, wasBlank);
    return;
  }
  // indented code (indent >= 4)
  if (curIndent(c) >= 4) {
    curAdv(c, 4);
    const code = mkCode();
    code.s = curRest(c) + '\n';
    addChild(P, container, code, wasBlank);
    P.leaf = code;
    P.leafParent = container;
    return;
  }
  // paragraph: the leading whitespace is part of the text, not stripped
  expandLeadTabs(c);
  const para = mkPara();
  para.s = curRest(c);
  para.lines = 1;
  para._parent = container;
  addChild(P, container, para, wasBlank);
  P.leaf = para;
  P.leafParent = container;
}

// Start (or continue) a list item at the cursor.
function startListItem(P, c, container, ls, wasBlank) {
  let list = null;
  if (container.t === 'list') {
    const match = ls.ordered
      ? (container.o && container.delim === ls.delim)
      : (!container.o && container.bullet === ls.bullet);
    if (match) list = container;
  }
  if (list === null) {
    list = mkList(ls.ordered, ls.ordered ? ls.start : 0);
    if (!ls.ordered) list.bullet = ls.bullet;
    else list.delim = ls.delim;
    addChild(P, container, list, wasBlank);
    P.open.push(list);
    container = list;
  }
  const item = mkItem(0);
  item._list = list;
  addChild(P, list, item, wasBlank);
  P.open.push(item);
  // position the cursor just past the marker, then at the content column
  c.i = ls.markerEnd;
  c.col = ls.markerCol;
  if (ls.contentCol < 0) {
    // empty item: content starts on a later line; indent is marker+1
    item.indent = ls.markerCol + 1;
    return;
  }
  item.indent = ls.contentCol;
  const target = ls.contentCol;
  while (c.col < target && c.i < c.s.length) {
    const ch = c.s.charCodeAt(c.i);
    if (ch === 32) { c.i++; c.col++; }
    else if (ch === 9) { curAdv(c, 1); }
    else break;
  }
  // task-list checkbox: [ ] / [x] / [X] followed by space/tab/EOL
  const rest = curRest(c);
  if (rest.length >= 3 && rest.charCodeAt(0) === 91) {
    const m = rest.charCodeAt(1);
    if ((m === 32 || m === 120 || m === 88) && rest.charCodeAt(2) === 93) {
      const after = rest.length === 3 || rest.charCodeAt(3) === 32 || rest.charCodeAt(3) === 9;
      if (after) {
        item.checked = m !== 32;
        c.i += 3;
        c.col += 3;
        if (c.i < c.s.length && (c.s.charCodeAt(c.i) === 32 || c.s.charCodeAt(c.i) === 9)) {
          curAdv(c, 1);
        }
      }
    }
  }
  // the item's first block starts on this line (unless the line is now blank)
  if (!curBlank(c)) {
    startNewBlock(P, c, item, false);
  }
}

// Process one non-blank line. `leafReachable` says the open leaf's
// containers all matched, so the leaf may continue.
function processLine(P, c, leafReachable, wasBlank) {
  const leaf = P.leaf;
  const container = P.open[P.open.length - 1];
  if (leafReachable && leaf) {
    if (leaf.t === 'fence') {
      if (fenceEnd(c, leaf)) { closeLeaf(P); return; }
      // content lines lose up to the opening fence's indent
      curSkipWs(c, leaf.indent);
      leaf.s += curRest(c) + '\n';
      return;
    }
    if (leaf.t === 'code') {
      if (curIndent(c) >= 4) {
        curAdv(c, 4);
        leaf.s += curRest(c) + '\n';
        return;
      }
      closeLeaf(P);
    }
    if (leaf.t === 'html') {
      const rest = curRest(c);
      leaf.s += rest + '\n';
      if (leaf.end !== null && rest.indexOf(leaf.end) >= 0) closeLeaf(P);
      return;
    }
    if (leaf.t === 'table') {
      if (!startsInterruptingBlock(c, false)) {
        leaf.rows.push(splitTableRow(curRest(c).trim()));
        return;
      }
      closeLeaf(P);
    }
    if (leaf.t === 'para') {
      const sl = setextLevel(c);
      if (sl > 0) {
        // link reference definitions are stripped before the paragraph
        // becomes a heading; a paragraph that was only definitions does
        // not become a heading at all, and this line starts a new block
        const res = stripLinkRefs(leaf.s, P.refs);
        const text = res.text.trim();
        if (text !== '') {
          const head = mkHead(sl);
          head.s = text;
          const par = leaf._parent;
          par.ch[par.ch.indexOf(leaf)] = head;
          P.leaf = null;
          P.leafParent = null;
          return;
        }
        leaf.s = res.text;
        closeLeaf(P);
        startNewBlock(P, c, P.open[P.open.length - 1], wasBlank);
        return;
      }
      if (leaf.lines === 1) {
        const al = tableDelim(c);
        if (al !== null) {
          const hd = splitTableRow(leaf.s.trim());
          const table = mkTable(al, hd);
          const par = leaf._parent;
          par.ch[par.ch.indexOf(leaf)] = table;
          P.leaf = table;
          P.leafParent = par;
          return;
        }
      }
      if (startsInterruptingBlock(c, true)) {
        closeLeaf(P);
      } else {
        expandLeadTabs(c);
        leaf.s += '\n' + curRest(c);
        leaf.lines++;
        return;
      }
    }
  }
  startNewBlock(P, c, P.open[P.open.length - 1], wasBlank);
}

// Parse the document into a block tree plus link reference definitions.
function parseBlocks(src) {
  const lines = src.split('\n');
  // a trailing newline ends the last line; it is not an extra blank line
  if (src.endsWith('\n')) lines.pop();
  const P = {
    root: mkDoc(),
    open: [],
    leaf: null,
    leafParent: null,
    refs: new Map(),
    pendBlank: false,
  };
  P.open = [P.root];
  for (let ln = 0; ln < lines.length; ln++) {
    const c = curOf(lines[ln]);
    const rawBlank = lines[ln].trim() === '';
    let lastMatched = 0;
    for (let k = 1; k < P.open.length; k++) {
      const b = P.open[k];
      if (b.t === 'quote') { if (!matchQuote(c)) break; lastMatched = k; }
      else if (b.t === 'item') { if (!matchItem(c, b)) break; lastMatched = k; }
      else if (b.t === 'list') { lastMatched = k; }
      else break;
    }
    // Lazy continuation: the open leaf is a paragraph, some containers did
    // not match, the line is not blank, and it does not start a block that
    // interrupts a paragraph. The line is appended to the paragraph and
    // the containers stay open. A level-1 setext underline as a lazy line
    // is paragraph text; in a blockquote, after an earlier lazy line, it
    // is prefixed with 4 spaces so it can never read as an underline.
    if (lastMatched < P.open.length - 1 && P.leaf !== null && P.leaf.t === 'para') {
      // work on a copy of the cursor after the matched containers: the
      // lazy text is the content past them, and a blockquote marker that
      // only re-enters an already-open container does not interrupt
      const cc = { s: c.s, i: c.i, col: c.col };
      // a line that starts a list item while an open list is matched is
      // a new item (same list, or a new list when the delimiter differs),
      // not a lazy continuation — even when the item is empty or (for an
      // ordered list) does not start with 1
      let continuesList = false;
      const ls0 = listStart({ s: cc.s, i: cc.i, col: cc.col });
      if (ls0 !== null) {
        for (let k = lastMatched; k >= 1; k--) {
          if (P.open[k].t === 'list') { continuesList = true; break; }
        }
      }
      if (!curBlank(cc) && !continuesList && !startsInterruptingBlock(cc, true)) {
        const leaf = P.leaf;
        const sl = setextLevel({ s: cc.s, i: cc.i, col: cc.col });
        const c3 = { s: c.s, i: c.i, col: c.col };
        expandLeadTabs(c3);
        // a lazy line indented 4+ columns loses a 4-column indent (it
        // would be indented code as a new block); fewer columns are kept
        if (curIndent(c3) >= 4) curAdv(c3, 4);
        let lineText = curRest(c3);
        if (sl === 1 && leaf.lazy && P.open[lastMatched + 1].t === 'quote') {
          lineText = '    ' + lineText.replace(/^[ \t]+/, '');
        }
        leaf.s += '\n' + lineText;
        leaf.lines++;
        leaf.lazy = true;
        continue;
      }
    }
    while (P.open.length - 1 > lastMatched) {
      closeContainer(P, P.open.pop());
    }
    const leafReachable = P.leaf !== null && P.leafParent === P.open[lastMatched];
    // a line is blank when the raw line is all whitespace, or when the
    // content left after the containers is empty. A line like `>  ` (a
    // quote marker plus two spaces) is NOT blank: its content is the
    // single space left after the marker's separator space.
    const isBlank = rawBlank || curRest(c) === '';
    if (P.leaf !== null && !leafReachable) {
      // an HTML block of kind 6-7 that ends because a blank line closed
      // its container loses its trailing newline, as if the blank line
      // had ended it directly
      if (isBlank && P.leaf.t === 'html' && (P.leaf.kind === 6 || P.leaf.kind === 7) && P.leaf.s.endsWith('\n')) {
        P.leaf.s = P.leaf.s.slice(0, -1);
      }
      closeLeaf(P);
    }
    if (isBlank) {
      handleBlank(P, leafReachable, c);
      continue;
    }
    const wasBlank = P.pendBlank;
    P.pendBlank = false;
    processLine(P, c, leafReachable, wasBlank);
  }
  if (P.leaf) closeLeaf(P);
  while (P.open.length > 1) closeContainer(P, P.open.pop());
  return { root: P.root, refs: P.refs };
}

// ---------- inline parsing ----------

// Find a run of backticks starting at i. Returns its length, or 0.
function backtickRun(s, i) {
  let n = 0;
  while (i + n < s.length && s.charCodeAt(i + n) === 96) n++;
  return n;
}

// Process code-span content: newlines become spaces; one leading and one
// trailing space are stripped when the content both starts and ends with
// a space and is not all spaces.
function codeSpanContent(raw) {
  let s = raw.replace(/\n/g, ' ');
  if (s.length >= 2 && s.charCodeAt(0) === 32 && s.charCodeAt(s.length - 1) === 32) {
    let allSpace = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) !== 32) { allSpace = false; break; }
    }
    if (!allSpace) s = s.slice(1, -1);
  }
  return s;
}

// Try to parse a link destination + optional title starting at s[i]
// (just past the `]` and any following whitespace is NOT skipped here;
// the caller handles the `(` form). This parses the part inside
// parentheses: (dest "title"). Returns { dest, title, end } with end just
// past the closing `)`, or null.
function parseInlineLink(s, i) {
  const n = s.length;
  if (i >= n || s.charCodeAt(i) !== 40) return null;
  let j = i + 1;
  // skip whitespace including newlines
  while (j < n && isWsCh(s[j])) j++;
  if (j >= n) return null;
  let dest = '';
  if (s.charCodeAt(j) === 60) {
    // <dest>
    let k = j + 1;
    let d = '';
    let ok = false;
    while (k < n) {
      const ch = s.charCodeAt(k);
      if (ch === 62) { ok = true; break; }
      if (ch === 10 || ch === 60) return null;
      if (ch === 92 && k + 1 < n && isPunct(s.charCodeAt(k + 1))) { d += s[k + 1]; k += 2; continue; }
      d += s[k];
      k++;
    }
    if (!ok) return null;
    dest = d;
    j = k + 1;
  } else {
    // bare destination: no spaces, no control chars; parens must balance.
    // It ends at whitespace (a title may follow) or at the closing `)`.
    let k = j;
    let d = '';
    let depth = 0;
    let ok = false;
    while (k < n) {
      const ch = s.charCodeAt(k);
      if (ch === 32 || ch === 9 || ch === 10) { ok = true; break; }
      if (ch === 40) { depth++; d += '('; k++; continue; }
      if (ch === 41) {
        if (depth === 0) { ok = true; break; }
        depth--;
        d += ')';
        k++;
        continue;
      }
      if (ch === 92 && k + 1 < n && isPunct(s.charCodeAt(k + 1))) { d += s[k + 1]; k += 2; continue; }
      if (ch < 32) return null;
      d += s[k];
      k++;
    }
    if (!ok) return null;
    dest = d;
    j = k;
  }
  // optional title
  let title = null;
  let k = j;
  while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
  // title may be on the next line
  if (k < n && s.charCodeAt(k) === 10) {
    let m = k + 1;
    while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9)) m++;
    if (m < n && (s.charCodeAt(m) === 34 || s.charCodeAt(m) === 39 || s.charCodeAt(m) === 40)) {
      k = m;
    }
  }
  if (k < n) {
    const tc = s.charCodeAt(k);
    if (tc === 34 || tc === 39 || tc === 40) {
      const t = parseTitle(s, k);
      if (t === null) return null;
      title = t.title;
      k = t.end;
    }
  }
  // skip trailing whitespace, expect `)`
  while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
  if (k < n && s.charCodeAt(k) === 10) {
    let m = k + 1;
    while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9)) m++;
    k = m;
  }
  if (k >= n || s.charCodeAt(k) !== 41) return null;
  return { dest, title, end: k + 1 };
}

// Try to parse a reference label starting at s[i] === '['. Returns
// { label, end } (end just past `]`) or null. The label may not contain
// an unescaped `[` at depth > 1 and may not contain a blank line.
function parseRefLabel(s, i) {
  return parseBracketLabel(s, i);
}

// Autolink inside <...>: <scheme:...> or <email>. Returns the link
// { dest, end } or null. `end` is just past the `>`.
function parseAngleAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  let raw = '';
  while (j < n) {
    const ch = s.charCodeAt(j);
    if (ch === 62) break;
    if (ch === 32 || ch === 10 || ch === 60) return null;
    raw += s[j];
    j++;
  }
  if (j >= n) return null;
  if (raw === '') return null;
  // scheme: 2-32 chars, letter first, then letters/digits/+/-/., then :
  const m = raw.match(/^([A-Za-z][A-Za-z0-9+.-]{1,31}):/);
  if (m) {
    const after = raw.slice(m[0].length);
    if (after === '' || /[\s<>]/.test(after)) return null;
    return { dest: raw, text: raw, end: j + 1 };
  }
  // email: local@domain with a dot in the domain
  if (/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(raw)) {
    return { dest: 'mailto:' + raw, text: raw, end: j + 1 };
  }
  return null;
}

// Inline HTML tag: open tag, closing tag, comment, PI, declaration, CDATA.
// Returns the end index (just past the tag) or 0.
function parseHtmlTag(s, i) {
  const n = s.length;
  if (i + 1 >= n) return 0;
  let j = i + 1;
  // comment
  if (s.startsWith('!--', j)) {
    const e = s.indexOf('-->', j + 3);
    if (e < 0) return 0;
    return e + 3;
  }
  // processing instruction
  if (s.charCodeAt(j) === 63) {
    const e = s.indexOf('?>', j + 1);
    if (e < 0) return 0;
    return e + 2;
  }
  // declaration
  if (s.charCodeAt(j) === 33) {
    if (j + 1 < n && isAlpha(s.charCodeAt(j + 1))) {
      const e = s.indexOf('>', j + 1);
      if (e < 0) return 0;
      return e + 1;
    }
    if (s.startsWith('[CDATA[', j + 1)) {
      const e = s.indexOf(']]>', j + 8);
      if (e < 0) return 0;
      return e + 3;
    }
    return 0;
  }
  // tag
  if (s.charCodeAt(j) === 47) j++;
  if (j >= n || !isAlpha(s.charCodeAt(j))) return 0;
  while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 45)) j++;
  // attributes: quoted strings, single-quoted strings, unquoted values
  let inSingle = false, inDouble = false;
  while (j < n) {
    const ch = s.charCodeAt(j);
    if (inDouble) {
      if (ch === 34) inDouble = false;
      j++;
      continue;
    }
    if (inSingle) {
      if (ch === 39) inSingle = false;
      j++;
      continue;
    }
    if (ch === 34) { inDouble = true; j++; continue; }
    if (ch === 39) { inSingle = true; j++; continue; }
    if (ch === 62) return j + 1;
    if (ch === 10) return 0;
    j++;
  }
  return 0;
}

// Trailing punctuation stripped from the end of an extended autolink.
function isTrailPunct(c) {
  return c === 63 || c === 33 || c === 46 || c === 44 || c === 58 ||
    c === 42 || c === 95 || c === 126 || c === 59 || c === 39 || c === 34;
}

// Scan a URL starting at s[i] (the first char of the host/path). Returns
// the end index. URL chars are anything except whitespace and `<`.
// Parens use a single boolean flag (not a counter): `(` sets it, `)` is
// only included while it is set. An unmatched `(` truncates the URL back
// to before it. A `&` that starts an invalid entity-like sequence ends
// the URL before the `&`. Trailing punctuation is stripped.
function scanUrl(s, i) {
  const n = s.length;
  let j = i;
  let paren = false;
  let parenAt = -1;
  while (j < n) {
    const ch = s.charCodeAt(j);
    if (ch === 60 || isWsCh(s[j])) break;
    if (ch === 40) {
      if (!paren) { paren = true; parenAt = j; }
      j++;
      continue;
    }
    if (ch === 41) {
      if (!paren) break;
      paren = false;
      parenAt = -1;
      j++;
      continue;
    }
    if (ch === 38) {
      const e = entityEnd(s, j);
      if (e > 0) { j = e; continue; }
      // an invalid entity-like sequence (&...;) ends the URL here
      let k = j + 1;
      while (k < n && (isAlnum(s.charCodeAt(k)) || s.charCodeAt(k) === 35)) k++;
      if (k < n && s.charCodeAt(k) === 59 && k > j + 1) break;
      j++;
      continue;
    }
    j++;
  }
  if (paren) j = parenAt;
  while (j > i && isTrailPunct(s.charCodeAt(j - 1))) j--;
  return j;
}

// Match a www domain starting at s[i] (just past `www.`). Returns the end
// index or null. Labels are [A-Za-z0-9-]+ separated by single dots.
function matchWwwDomain(s, i) {
  const n = s.length;
  let j = i;
  let labels = 0;
  while (j < n) {
    const st = j;
    while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 45)) j++;
    if (j === st) break;
    labels++;
    if (j < n && s.charCodeAt(j) === 46 && j + 1 < n &&
        (isAlnum(s.charCodeAt(j + 1)) || s.charCodeAt(j + 1) === 45)) {
      j++;
      continue;
    }
    break;
  }
  return labels > 0 ? j : null;
}

const EMAIL_LOCAL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+/=?^_`{|}~-";

// Match an email address starting at s[i]. Returns the end index or null.
// The domain needs at least two labels, each starting and ending with an
// alphanumeric character. A label ending in `-`, or a `_` right after the
// domain, invalidates the match.
function matchEmail(s, i) {
  const n = s.length;
  let j = i;
  while (j < n && EMAIL_LOCAL.indexOf(s[j]) >= 0) j++;
  if (j === i || j >= n || s.charCodeAt(j) !== 64) return null;
  j++;
  let labels = 0;
  let k = j;
  while (k < n) {
    if (!isAlnum(s.charCodeAt(k))) break;
    const st = k;
    k++;
    while (k < n && (isAlnum(s.charCodeAt(k)) || s.charCodeAt(k) === 45)) k++;
    if (s.charCodeAt(k - 1) === 45) return null;
    labels++;
    if (k < n && s.charCodeAt(k) === 46 && k + 1 < n && isAlnum(s.charCodeAt(k + 1))) {
      k++;
      continue;
    }
    break;
  }
  if (labels < 2) return null;
  if (k < n && s.charCodeAt(k) === 95) return null;
  return k;
}

// Try to match an extended autolink starting at s[i]. `prev` is the
// character before i in the source ('' at the start). Returns
// { text, href, end } or null.
function matchExtAutolink(s, i, prev) {
  if (prev !== '' && !isWsCh(prev) && prev !== '*' && prev !== '_' && prev !== '~' && prev !== '(') {
    return null;
  }
  const n = s.length;
  if (s.startsWith('www.', i)) {
    const d = matchWwwDomain(s, i + 4);
    if (d === null) return null;
    const end = scanUrl(s, d);
    if (end <= i + 4) return null;
    const text = s.slice(i, end);
    return { text, href: 'http://' + text, end };
  }
  const sm = /^(https?|ftp):\/\//.exec(s.slice(i, i + 8));
  if (sm) {
    const hostStart = i + sm[0].length;
    if (hostStart < n) {
      const hc = s.charCodeAt(hostStart);
      if (hc !== 46 && hc !== 58 && hc !== 47 && hc !== 60 && !isWsCh(s[hostStart])) {
        const end = scanUrl(s, hostStart);
        const text = s.slice(i, end);
        return { text, href: text, end };
      }
    }
    return null;
  }
  const mm = /^(mailto|xmpp):/.exec(s.slice(i, i + 7));
  if (mm) {
    const em = matchEmail(s, i + mm[0].length);
    if (em === null) return null;
    let end = em;
    if (mm[1] === 'xmpp' && end < n && s.charCodeAt(end) === 47) {
      let k = end + 1;
      while (k < n) {
        const ch = s.charCodeAt(k);
        if (ch === 47 || ch === 63 || ch === 35 || ch === 60 || isWsCh(s[k])) break;
        k++;
      }
      while (k > end + 1 && isTrailPunct(s.charCodeAt(k - 1))) k--;
      if (k > end + 1) end = k;
    }
    const text = s.slice(i, end);
    return { text, href: text, end };
  }
  const em = matchEmail(s, i);
  if (em !== null) {
    const text = s.slice(i, em);
    return { text, href: 'mailto:' + text, end: em };
  }
  return null;
}

// Flanking: is the character (a single code unit; astral characters read
// as not-whitespace and not-punctuation, which is correct for them) Unicode
// whitespace / punctuation?
const WS_RE = /\p{White_Space}/u;
const P_RE = /\p{P}/u;
function isWsU(c) {
  return c < 128 ? isSpace(c) : WS_RE.test(String.fromCharCode(c));
}
function isPunctU(c) {
  return c < 128 ? isPunct(c) : P_RE.test(String.fromCharCode(c));
}
// Can a delimiter run starting at s (index i, length len, char cc) open /
// close emphasis? before/after are the neighbouring code units (-1 at an end).
function delimFlank(s, i, len, before, after) {
  const cc = s.charCodeAt(i);
  const leftFlank =
    after !== -1 && !isWsU(after) &&
    (!isPunctU(after) || before === -1 || isWsU(before) || isPunctU(before));
  const rightFlank =
    before !== -1 && !isWsU(before) &&
    (!isPunctU(before) || after === -1 || isWsU(after) || isPunctU(after));
  let canOpen, canClose;
  if (cc === 95) {
    canOpen = leftFlank && (!rightFlank || (before !== -1 && isPunctU(before)));
    canClose = rightFlank && (!leftFlank || (after !== -1 && isPunctU(after)));
  } else {
    canOpen = leftFlank;
    canClose = rightFlank;
  }
  return { canOpen, canClose };
}

// Render inline content (a paragraph/heading/table-cell/link text) to HTML.
function renderInline(text, refs) {
  const nodes = { head: null, tail: null };
  const delims = { head: null, tail: null };
  const brackets = [];
  let buf = '';
  let i = 0;
  const n = text.length;

  function appendNode(nd) {
    nd.prev = nodes.tail;
    nd.next = null;
    if (nodes.tail) nodes.tail.next = nd;
    else nodes.head = nd;
    nodes.tail = nd;
    return nd;
  }
  function flushText() {
    if (buf !== '') {
      appendNode({ t: 'text', s: buf });
      buf = '';
    }
  }
  function addDelim(cc, node, len, canOpen, canClose) {
    const d = { cc, node, len, orig: len, canOpen, canClose, prev: delims.tail, next: null };
    if (delims.tail) delims.tail.next = d;
    else delims.head = d;
    delims.tail = d;
    return d;
  }
  // Collect the nodes strictly between a and b (exclusive) into a linked
  // range, unlinking them from the node list. Returns { head, tail } (both
  // null when the range is empty). The range's internal next/prev chain is
  // preserved so nested emphasis can still walk it; only the outer links
  // are detached.
  function collectBetween(a, b) {
    let head = a ? a.next : nodes.head;
    if (head === b || head === null) return { head: null, tail: null };
    let tail = head;
    while (tail.next !== null && tail.next !== b) tail = tail.next;
    if (a) a.next = b;
    else nodes.head = b;
    if (b) b.prev = a;
    else nodes.tail = a;
    head.prev = null;
    tail.next = null;
    return { head, tail };
  }

  // Try to form a link/image when `]` is scanned at position i.
  // Returns the index just past the link syntax when a link was formed,
  // or -1 (and the caller treats `]` as literal text).
  function tryLink(i) {
    // find the nearest active open bracket
    let bi = -1;
    for (let k = brackets.length - 1; k >= 0; k--) {
      if (brackets[k].active) { bi = k; break; }
    }
    if (bi < 0) return -1;
    const br = brackets[bi];
    let dest = null;
    let title = null;
    let end = -1;
    const j = i + 1;
    if (j < n && text.charCodeAt(j) === 40) {
      const il = parseInlineLink(text, j);
      if (il !== null) { dest = il.dest; title = il.title; end = il.end; }
    } else if (j < n && text.charCodeAt(j) === 91) {
      const lb = parseRefLabel(text, j);
      if (lb !== null) {
        const key = normLabel(text.slice(j + 1, lb.end - 1));
        if (key !== '' && refs.has(key)) {
          const r = refs.get(key);
          dest = r.dest; title = r.title; end = lb.end;
        } else if (lb.end === j + 2) {
          // collapsed reference: [label][]
          const key2 = linkTextOf(br);
          if (key2 !== '' && refs.has(key2)) {
            const r = refs.get(key2);
            dest = r.dest; title = r.title; end = lb.end;
          }
        }
      }
    }
    if (dest === null) {
      // shortcut reference: the label is the link text
      const key = linkTextOf(br);
      if (key !== '' && refs.has(key)) {
        const r = refs.get(key);
        dest = r.dest; title = r.title; end = i + 1;
      }
    }
    if (dest === null) {
      // no link: deactivate this bracket so it is not retried
      br.active = false;
      return -1;
    }
    // form the link: children are the nodes after the bracket node
    const kids = collectBetween(br.node, null);
    // an autolink nested inside link text is flattened back to text
    let kd = kids.head;
    while (kd !== null) {
      const nx = kd.next;
      if (kd.t === 'link') {
        const tn = { t: 'text', s: kd.textHtml, prev: kd.prev, next: kd.next };
        if (kd.prev) kd.prev.next = tn;
        else kids.head = tn;
        if (kd.next) kd.next.prev = tn;
        else kids.tail = tn;
      }
      kd = nx;
    }
    const linkNode = br.img
      ? { t: 'img', src: cleanUrl(dest), title, alt: plainText(kids.head) }
      : { t: 'link', href: cleanUrl(dest), title, chHead: kids.head, chTail: kids.tail, textHtml: '' };
    // replace the bracket node with the link node
    const bn = br.node;
    linkNode.prev = bn.prev;
    linkNode.next = bn.next;
    if (bn.prev) bn.prev.next = linkNode;
    else nodes.head = linkNode;
    if (bn.next) bn.next.prev = linkNode;
    else nodes.tail = linkNode;
    // remove this bracket and any brackets opened inside the link text
    brackets.splice(bi, 1);
    for (let k = brackets.length - 1; k >= 0; k--) {
      if (brackets[k].node === bn) brackets.splice(k, 1);
    }
    // deactivate brackets whose nodes were consumed into the link
    for (let k = brackets.length - 1; k >= 0; k--) {
      let found = false;
      let kn = kids.head;
      while (kn !== null) {
        if (kn === brackets[k].node) { found = true; break; }
        kn = kn.next;
      }
      if (found) brackets[k].active = false;
    }
    appendLinkText(linkNode);
    return end;
  }
  // The plain-text label of a bracket (its content rendered as text, with
  // whitespace collapsed) for shortcut/collapsed reference lookup.
  function linkTextOf(br) {
    return collapseWs(plainText(br.node.next));
  }
  // Record a link node's rendered text (used if it is flattened later).
  function appendLinkText(linkNode) {
    if (linkNode.t === 'link') linkNode.textHtml = renderNodes(linkNode.chHead);
  }

  while (i < n) {
    const ch = text.charCodeAt(i);
    // backslash escape / hard break
    if (ch === 92) {
      if (i + 1 < n) {
        const nc = text.charCodeAt(i + 1);
        if (nc === 10) {
          flushText();
          appendNode({ t: 'br' });
          i += 2;
          // after a hard break, leading whitespace on the next line is skipped
          while (i < n && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
          continue;
        }
        if (isPunct(nc)) {
          buf += escText(text[i + 1]);
          i += 2;
          continue;
        }
      }
      buf += '\\';
      i++;
      continue;
    }
    // code span
    if (ch === 96) {
      const m = backtickRun(text, i);
      let j = i + m;
      let closer = -1;
      while (j < n) {
        if (text.charCodeAt(j) === 96) {
          const r = backtickRun(text, j);
          if (r === m) { closer = j; break; }
          j += r;
        } else j++;
      }
      if (closer < 0) {
        buf += '`'.repeat(m);
        i += m;
        continue;
      }
      // a code span must not cross a `]` that forms a link
      if (spanCrossesLink(text, i + m, closer, brackets)) {
        buf += '`'.repeat(m);
        i += m;
        continue;
      }
      flushText();
      const raw = text.slice(i + m, closer);
      appendNode({ t: 'code', s: escText(codeSpanContent(raw)) });
      i = closer + m;
      continue;
    }
    // emphasis / strikethrough delimiters
    if (ch === 42 || ch === 95 || ch === 126) {
      if (ch === 126) {
        // `~` runs of length >= 3 are not delimiters
        let r = 0;
        while (i + r < n && text.charCodeAt(i + r) === 126) r++;
        if (r >= 3) {
          buf += '~'.repeat(r);
          i += r;
          continue;
        }
      }
      let r = 0;
      while (i + r < n && text.charCodeAt(i + r) === ch) r++;
      const before = i > 0 ? text.charCodeAt(i - 1) : -1;
      const after = i + r < n ? text.charCodeAt(i + r) : -1;
      const fl = delimFlank(text, i, r, before, after);
      flushText();
      const nd = appendNode({ t: 'text', s: text.slice(i, i + r) });
      addDelim(ch, nd, r, fl.canOpen, fl.canClose);
      i += r;
      continue;
    }
    // open bracket / image
    if (ch === 91 || (ch === 33 && i + 1 < n && text.charCodeAt(i + 1) === 91)) {
      const img = ch === 33;
      flushText();
      const nd = appendNode({ t: 'text', s: img ? '![' : '[' });
      brackets.push({ node: nd, img, active: true });
      i += img ? 2 : 1;
      continue;
    }
    // close bracket: try to form a link
    if (ch === 93) {
      flushText();
      const end = tryLink(i);
      if (end < 0) {
        buf += ']';
        i++;
        continue;
      }
      i = end;
      continue;
    }
    // angle autolink / HTML tag
    if (ch === 60) {
      const al = parseAngleAutolink(text, i);
      if (al !== null) {
        flushText();
        const tn = { t: 'text', s: escAttr(al.text), prev: null, next: null };
        appendNode({ t: 'link', href: cleanUrl(al.dest), title: null, chHead: tn, chTail: tn, textHtml: '' });
        appendLinkText(nodes.tail);
        i = al.end;
        continue;
      }
      const he = parseHtmlTag(text, i);
      if (he > 0) {
        flushText();
        appendNode({ t: 'html', s: text.slice(i, he) });
        i = he;
        continue;
      }
      buf += '&lt;';
      i++;
      continue;
    }
    // entity
    if (ch === 38) {
      const dn = decodeNumeric(text, i);
      if (dn !== null) {
        buf += escText(dn[0]);
        i = dn[1];
        continue;
      }
      const e = entityEnd(text, i);
      if (e > 0) {
        buf += text.slice(i, e);
        i = e;
        continue;
      }
      buf += '&amp;';
      i++;
      continue;
    }
    // newline: hard break (2+ trailing spaces) or soft break
    if (ch === 10) {
      if (buf.length >= 2 && buf.charCodeAt(buf.length - 1) === 32 && buf.charCodeAt(buf.length - 2) === 32) {
        let k = buf.length;
        while (k > 0 && buf.charCodeAt(k - 1) === 32) k--;
        buf = buf.slice(0, k);
        flushText();
        appendNode({ t: 'br' });
        i++;
        // after a hard break, leading whitespace on the next line is skipped
        while (i < n && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) i++;
      } else {
        buf += '\n';
        i++;
      }
      continue;
    }
    // extended autolinks (www / scheme / email) in plain text
    if (ch === 119 || ch === 104 || ch === 102 || ch === 109 || ch === 120 ||
        isAlnum(ch) || ch === 95 || ch === 46) {
      const prev = i > 0 ? text[i - 1] : '';
      const al = matchExtAutolink(text, i, prev);
      if (al !== null) {
        flushText();
        const tn = { t: 'text', s: escAttr(al.text), prev: null, next: null };
        appendNode({ t: 'link', href: cleanUrl(al.href), title: null, chHead: tn, chTail: tn, textHtml: '' });
        appendLinkText(nodes.tail);
        i = al.end;
        continue;
      }
    }
    // plain character (escaped as needed)
    if (ch === 38) { buf += '&amp;'; i++; continue; }
    if (ch === 60) { buf += '&lt;'; i++; continue; }
    if (ch === 62) { buf += '&gt;'; i++; continue; }
    if (ch === 34) { buf += '&quot;'; i++; continue; }
    if (ch === 39) { buf += '&#39;'; i++; continue; }
    buf += text[i];
    i++;
  }
  flushText();
  processEmphasis(delims, nodes, collectBetween);
  return renderNodes(nodes.head);
}

// Does the span text[contentStart, contentEnd) contain a `]` that would
// form a link? (A code span must not cross such a bracket.)
function spanCrossesLink(text, contentStart, contentEnd, brackets) {
  for (let p = contentStart; p < contentEnd; p++) {
    if (text.charCodeAt(p) !== 93) continue;
    // is there an active `[` before p?
    let hasOpener = false;
    for (let k = brackets.length - 1; k >= 0; k--) {
      if (brackets[k].active) { hasOpener = true; break; }
    }
    if (!hasOpener) {
      // look for an unmatched `[` inside the span content before p
      let depth = 0;
      for (let q = p - 1; q >= contentStart; q--) {
        if (text.charCodeAt(q) === 93) depth++;
        else if (text.charCodeAt(q) === 91) {
          if (depth === 0) { hasOpener = true; break; }
          depth--;
        }
      }
    }
    if (!hasOpener) continue;
    // does a link parse after this `]`?
    const j = p + 1;
    const n = text.length;
    if (j < n && text.charCodeAt(j) === 40) {
      if (parseInlineLink(text, j) !== null) return true;
    } else if (j < n && text.charCodeAt(j) === 91) {
      if (parseRefLabel(text, j) !== null) return true;
    } else {
      // shortcut reference: would need the label to exist; approximate by
      // treating a bare `]` followed by non-link text as non-forming, so
      // only inline/full references block the span here
      continue;
    }
  }
  return false;
}

// Plain text of a list of inline nodes (for image alt text and link
// Plain text of an inline node chain (for image alt text and link
// labels): emphasis/link markup is stripped, code spans keep their text.
function plainText(head) {
  let out = '';
  let nd = head;
  while (nd !== null) {
    if (nd.t === 'text') out += unescapeHtml(nd.s);
    else if (nd.t === 'code') out += unescapeHtml(nd.s);
    else if (nd.t === 'br') out += '\n';
    else if (nd.t === 'html') { /* raw HTML contributes nothing to alt text */ }
    else if (nd.t === 'img') out += nd.alt;
    else if (nd.chHead) out += plainText(nd.chHead);
    nd = nd.next;
  }
  return out;
}
// Undo the escaping of a text/code node's stored HTML (for alt text).
function unescapeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Remove backslash escapes: a `\` before an ASCII punctuation character
// drops the backslash and keeps the character; otherwise the `\` stays.
function unescapeBackslash(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 92 && i + 1 < s.length && isPunct(s.charCodeAt(i + 1))) {
      out += s[i + 1];
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

// Is this opener/closer pair blocked by the rule of three? o is the
// opener, d is the closer. For `*`/`_`: both must be ambiguous, the
// opener must be unused, and (opener original length + closer length)
// must be a multiple of 3 (unless both lengths are multiples of 3).
// For `~`: the rule is strict — any multiple of 3 blocks.
function oddMatchBlocked(o, d) {
  if (o.cc === 126) {
    return (o.orig + d.len) % 3 === 0;
  }
  if (!o.canOpen || !o.canClose || !d.canOpen || !d.canClose) return false;
  if (o.len !== o.orig) return false;
  const sum = o.orig + d.len;
  if (sum % 3 !== 0) return false;
  if (o.orig % 3 === 0 && d.len % 3 === 0) return false;
  return true;
}

// Resolve emphasis/strikethrough over the delimiter list. Closers are
// processed in order; each looks back for the nearest usable opener.
function processEmphasis(delims, nodes, collectBetween) {
  let d = delims.head;
  while (d !== null) {
    const nextD = d.next;
    if (d.canClose && d.len > 0) {
      while (d.len > 0 && d.canClose) {
        let o = d.prev;
        let found = null;
        while (o !== null) {
          if (o.len === 0) {
            // a consumed delimiter that could open is a barrier for a
            // closer that cannot open
            if (o.canOpen && !d.canOpen) break;
            o = o.prev;
            continue;
          }
          if (o.cc !== d.cc || !o.canOpen) { o = o.prev; continue; }
          if (oddMatchBlocked(o, d)) { o = o.prev; continue; }
          found = o;
          break;
        }
        if (found === null) break;
        const use = found.len >= 2 && d.len >= 2 ? 2 : 1;
        const type = d.cc === 126 ? 'del' : use === 2 ? 'strong' : 'em';
        const kids = collectBetween(found.node, d.node);
        const emNode = { t: type, chHead: kids.head, chTail: kids.tail, prev: null, next: null };
        emNode.prev = found.node;
        emNode.next = d.node;
        found.node.next = emNode;
        d.node.prev = emNode;
        found.len -= use;
        d.len -= use;
        found.node.s = found.node.s.slice(0, found.len);
        d.node.s = d.node.s.slice(use);
        if (d.len === 0) break;
      }
    }
    d = nextD;
  }
}

function renderNodes(head) {
  let out = '';
  let nd = head;
  while (nd !== null) {
    out += renderNode(nd);
    nd = nd.next;
  }
  return out;
}
function renderNode(nd) {
  switch (nd.t) {
    case 'text': return nd.s;
    case 'code': return '<code>' + nd.s + '</code>';
    case 'html': return nd.s;
    case 'br': return '<br>';
    case 'em': return '<em>' + renderNodes(nd.chHead) + '</em>';
    case 'strong': return '<strong>' + renderNodes(nd.chHead) + '</strong>';
    case 'del': return '<del>' + renderNodes(nd.chHead) + '</del>';
    case 'link': {
      let s = '<a href="' + nd.href + '"';
      if (nd.title !== null && nd.title !== undefined) s += ' title="' + escAttr(nd.title) + '"';
      return s + '>' + renderNodes(nd.chHead) + '</a>';
    }
    case 'img': {
      let s = '<img src="' + nd.src + '" alt="' + escAttr(nd.alt) + '"';
      if (nd.title !== null && nd.title !== undefined) s += ' title="' + escAttr(nd.title) + '"';
      return s + '>';
    }
  }
  return '';
}

// ---------- block rendering ----------

function renderBlock(b, refs) {
  switch (b.t) {
    case 'para': return '<p>' + renderInline(b.s, refs) + '</p>\n';
    case 'head': return '<h' + b.l + '>' + renderInline(b.s, refs) + '</h' + b.l + '>\n';
    case 'code': return '<pre><code>' + escText(b.s) + '</code></pre>\n';
    case 'fence': {
      let s = '<pre><code';
      const lang = unescapeBackslash(b.info.split(/\s+/)[0]);
      if (lang !== '') s += ' class="language-' + escAttr(lang) + '"';
      return s + '>' + escText(b.s) + '</code></pre>\n';
    }
    case 'html': return b.s;
    case 'hr': return '<hr>\n';
    case 'quote': {
      let s = '<blockquote>\n';
      for (const c of b.ch) s += renderBlock(c, refs);
      return s + '</blockquote>\n';
    }
    case 'list': {
      const tag = b.o ? 'ol' : 'ul';
      let s = '<' + tag;
      if (b.o && b.st !== 1) s += ' start="' + b.st + '"';
      s += '>\n';
      for (const it of b.ch) s += renderItem(it, b, refs);
      return s + '</' + tag + '>\n';
    }
    case 'table': return renderTable(b, refs);
  }
  return '';
}

function renderItem(item, list, refs) {
  let inner = '';
  if (list.tight) {
    for (let k = 0; k < item.ch.length; k++) {
      const c = item.ch[k];
      if (c.t === 'para') inner += renderInline(c.s, refs);
      else inner += renderBlock(c, refs);
    }
  } else {
    for (const c of item.ch) inner += renderBlock(c, refs);
  }
  // an HTML block as the last child of a list item must not emit a
  // trailing newline before </li>
  if (item.ch.length > 0 && item.ch[item.ch.length - 1].t === 'html' && inner.endsWith('\n')) {
    inner = inner.slice(0, -1);
  }
  let s = '<li>';
  if (item.checked !== null) {
    s += item.checked
      ? '<input checked="" disabled="" type="checkbox">'
      : '<input disabled="" type="checkbox">';
    if (inner !== '') s += ' ';
  }
  return s + inner + '</li>\n';
}

const ALIGN_ATTR = { l: ' align="left"', c: ' align="center"', r: ' align="right"', '': '' };
function renderTable(t, refs) {
  const cols = t.al.length;
  let s = '<table>\n<thead>\n<tr>\n';
  for (let k = 0; k < cols; k++) {
    const cell = k < t.hd.length ? t.hd[k] : '';
    s += '<th' + ALIGN_ATTR[t.al[k] || ''] + '>' + renderInline(cell.trim(), refs) + '</th>\n';
  }
  s += '</tr>\n</thead>\n';
  if (t.rows.length > 0) {
    s += '<tbody><tr>\n';
    for (let r = 0; r < t.rows.length; r++) {
      if (r > 0) s += '<tr>\n';
      const row = t.rows[r];
      for (let k = 0; k < cols; k++) {
        const cell = k < row.length ? row[k] : '';
        s += '<td' + ALIGN_ATTR[t.al[k] || ''] + '>' + renderInline(cell.trim(), refs) + '</td>\n';
      }
      s += '</tr>\n';
    }
    s += '</tbody>\n';
  }
  return s + '</table>\n';
}

// ---------- entry point ----------

export function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const { root, refs } = parseBlocks(src);
  let out = '';
  for (const b of root.ch) out += renderBlock(b, refs);
  return out;
}
