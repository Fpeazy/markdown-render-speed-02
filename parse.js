// parse.js — dependency-free CommonMark 0.31.2 + GFM 0.29 renderer,
// byte-identical to marked 18.1.3 (default options) on the practice set.
// Written fresh in-session under recording 8. No code copied from any source.

// ---------- entities ----------
// Named HTML entities (subset covering the spec examples + common usage).
// Values are the replacement strings (may be multi-code-point).
const ENT = {
  quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', AElig: 'Æ', aelig: 'æ',
  Dcaron: 'Ď', dcaron: 'ď', frac34: '¾', frac12: '½', frac14: '¼',
  HilbertSpace: 'ℋ', DifferentialD: 'ⅆ', ClockwiseContourIntegral: '∲',
  ngE: '≧̸', Aacute: 'Á', aacute: 'á', Acirc: 'Â', acirc: 'â', Agrave: 'À',
  agrave: 'à', Aring: 'Å', aring: 'å', Atilde: 'Ã', atilde: 'ã', Auml: 'Ä',
  auml: 'ä', Ccedil: 'Ç', ccedil: 'ç', Eacute: 'É', eacute: 'é', Ecirc: 'Ê',
  ecirc: 'ê', Egrave: 'È', egrave: 'è', Euml: 'Ë', euml: 'ë', Iacute: 'Í',
  iacute: 'í', Icirc: 'Î', icirc: 'î', Igrave: 'Ì', igrave: 'ì', Iuml: 'Ï',
  iuml: 'ï', Ntilde: 'Ñ', ntilde: 'ñ', Oacute: 'Ó', oacute: 'ó', Ocirc: 'Ô',
  ocirc: 'ô', Ograve: 'Ò', ograve: 'ò', Oslash: 'Ø', oslash: 'ø', Otilde: 'Õ',
  otilde: 'õ', Ouml: 'Ö', ouml: 'ö', Uacute: 'Ú', uacute: 'ú', Ucirc: 'Û',
  ucirc: 'û', Ugrave: 'Ù', ugrave: 'ù', Uuml: 'Ü', uuml: 'ü', Yacute: 'Ý',
  yacute: 'ý', yuml: 'ÿ', THORN: 'Þ', thorn: 'þ', szlig: 'ß', eth: 'ð',
  ETH: 'Ð', yacute2: 'ý', iexcl: '¡', iquest: '¿', cent: '¢', pound: '£',
  curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨', ordf: 'ª',
  ordm: 'º', para: '¶', middot: '·', cedil: '¸', sup1: '¹', sup2: '²',
  sup3: '³', acute: '´', micro: 'µ', plusmn: '±', deg: '°', times: '×',
  divide: '÷', minus: '−', lowast: '∗', fnof: 'ƒ', Alpha: 'Α', alpha: 'α',
  Beta: 'Β', beta: 'β', Gamma: 'Γ', gamma: 'γ', Delta: 'Δ', delta: 'δ',
  Epsilon: 'Ε', epsilon: 'ε', Zeta: 'Ζ', zeta: 'ζ', Eta: 'Η', eta: 'η',
  Theta: 'Θ', theta: 'θ', Iota: 'Ι', iota: 'ι', Kappa: 'Κ', kappa: 'κ',
  Lambda: 'Λ', lambda: 'λ', Mu: 'Μ', mu: 'μ', Nu: 'Ν', nu: 'ν', Xi: 'Ξ',
  xi: 'ξ', Omicron: 'Ο', omicron: 'ο', Pi: 'Π', pi: 'π', Rho: 'Ρ', rho: 'ρ',
  Sigma: 'Σ', sigma: 'σ', sigmaf: 'ς', Tau: 'Τ', tau: 'τ', Upsilon: 'Υ',
  upsilon: 'υ', Phi: 'Φ', phi: 'φ', Chi: 'Χ', chi: 'χ', Psi: 'Ψ', psi: 'ψ',
  Omega: 'Ω', omega: 'ω', thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ',
  bull: '•', prime: '′', Prime: '″', oline: '‾', frasl: '⁄', weierp: '℘',
  image: 'ℑ', real: 'ℜ', alefsym: 'ℵ', larr: '←', uarr: '↑', rarr: '→',
  darr: '↓', harr: '↔', crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒',
  dArr: '⇓', hArr: '⇔', forall: '∀', part: '∂', exist: '∃', empty: '∅',
  nabla: '∇', isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑',
  infin: '∞', ang: '∠', and: '∧', or: '∨', cap: '∩', cup: '∪', int: '∫',
  there4: '∴', sim: '∼', cong: '≅', asymp: '≈', ne: '≠', equiv: '≡',
  le: '≤', ge: '≥', sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇',
  oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅', lceil: '⌈', rceil: '⌉',
  lfloor: '⌊', rfloor: '⌋', lang: '⟨', rang: '⟩', loz: '◊', spades: '♠',
  clubs: '♣', hearts: '♥', diams: '♦', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', sbquo: '‚', bdquo: '„',
  dagger: '†', Dagger: '‡', permil: '‰', lsaquo: '‹', rsaquo: '›',
  euro: '€', apos: "'", Tab: '\t', NewLine: '\n', colon: ':', comma: ',',
  sol: '/', bsol: '\\', semi: ';', equals: '=', quest: '?', period: '.',
  excl: '!', num: '#', dollar: '$', percnt: '%', plus: '+', comma2: ',',
 fjlig: 'fj', ff: 'ﬀ', fi: 'ﬁ', fl: 'ﬂ', ffi: 'ﬃ', ffl: 'ﬄ',
  // entities used by spec examples
  Aopf: '𝔸', Bopf: '𝔹', Copf: 'ℂ', Dopf: '𝔻', Eopf: '𝔼', Fopf: '𝔽',
  Gopf: '𝔾', Hopf: 'ℍ', Iopf: '𝕀', Jopf: '𝕁', Kopf: '𝕂', Lopf: '𝕃',
  Mopf: '𝕄', Nopf: 'ℕ', Oopf: '𝕆', Popf: 'ℙ', Qopf: 'ℚ', Ropf: 'ℝ',
  Sopf: '𝕊', Topf: '𝕋', Uopf: '𝕌', Vopf: '𝕍', Wopf: '𝕎', Xopf: '𝕏',
  Yopf: '𝕐', Zopf: 'ℤ', aopf: '𝕒', bopf: '𝕓', copf: '𝕔', dopf: '𝕕',
  eopf: '𝕖', fopf: '𝕗', gopf: '𝕘', hopf: '𝕙', iopf: '𝕚', jopf: '𝕛',
  kopf: '𝕜', lopf: '𝕝', mopf: '𝕞', nopf: '𝕟', oopf: '𝕠', popf: '𝕡',
  qopf: '𝕢', ropf: '𝕣', sopf: '𝕤', topf: '𝕥', uopf: '𝕦', vopf: '𝕧',
  wopf: '𝕨', xopf: '𝕩', yopf: '𝕪', zopf: '𝕫',
};
delete ENT.yacute2; delete ENT.comma2;

// ---------- small helpers ----------
const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isPunct(c) { return c !== undefined && PUNCT.indexOf(c) >= 0; }
function isAlphaNum(c) { return c !== undefined && /[A-Za-z0-9]/.test(c); }
function isBlankLine(s) { return /^[ \t]*$/.test(s); }

// Escape text content: escape ALL of & < > " ' (marked's escape).
// Entity references are separate nodes and never reach this function.
function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Escape for attribute values (href/title/alt): escape & " < > but keep valid entities.
function escapeAttr(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '&') {
      const m = /^&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|#X[0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/.exec(s.slice(i, i + 40));
      if (m) { out += m[0]; i += m[0].length; continue; }
      out += '&amp;'; i++;
    } else if (c === '<') { out += '&lt;'; i++; }
    else if (c === '>') { out += '&gt;'; i++; }
    else if (c === '"') { out += '&quot;'; i++; }
    else { out += c; i++; }
  }
  return out;
}

// Decode one entity starting at s[i] === '&'. Returns [decoded, length] or null.
function decodeEntityAt(s, i) {
  if (s[i] !== '&') return null;
  const rest = s.slice(i + 1, i + 40);
  let m = /^#([0-9]{1,7});/.exec(rest);
  if (m) {
    let cp = parseInt(m[1], 10);
    if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
    return [String.fromCodePoint(cp), m[0].length + 1];
  }
  m = /^#[xX]([0-9a-fA-F]{1,6});/.exec(rest);
  if (m) {
    let cp = parseInt(m[1], 16);
    if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
    return [String.fromCodePoint(cp), m[0].length + 1];
  }
  m = /^([A-Za-z][A-Za-z0-9]{1,31});/.exec(rest);
  if (m && Object.prototype.hasOwnProperty.call(ENT, m[1])) {
    return [ENT[m[1]], m[0].length + 1];
  }
  return null;
}

// Unescape text: backslash escapes + entity references.
function unescapeText(s) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && isPunct(s[i + 1])) { out += s[i + 1]; i += 2; }
    else if (c === '&') {
      const d = decodeEntityAt(s, i);
      if (d) { out += d[0]; i += d[1]; } else { out += c; i++; }
    } else { out += c; i++; }
  }
  return out;
}

// Expand tabs to spaces at 4-col stops, from a starting column.
function expandTabs(s, startCol) {
  let out = '', col = startCol;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\t') { const n = 4 - (col % 4); out += ' '.repeat(n); col += n; }
    else { out += s[i]; col++; }
  }
  return out;
}
// Column width of a prefix (tabs = next multiple of 4).
function colOf(s) {
  let col = 0;
  for (let i = 0; i < s.length; i++) col = s[i] === '\t' ? col + (4 - (col % 4)) : col + 1;
  return col;
}
// Indent (in columns) of a line's leading whitespace.
function indentOf(line) {
  let col = 0, i = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === ' ') col++;
    else col += 4 - (col % 4);
    i++;
  }
  return col;
}
// Strip n columns of indent from a line (partial-tab aware: a tab crossing the
// boundary leaves the remaining spaces as spaces).
function stripIndentCols(line, n) {
  let col = 0, i = 0;
  while (i < line.length && col < n) {
    if (line[i] === ' ') { col++; i++; }
    else if (line[i] === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= n) { col += w; i++; }
      else { return ' '.repeat(col + w - n) + line.slice(i + 1); }
    } else break;
  }
  return line.slice(i);
}
// Strip n whitespace CHARACTERS (fenced-code rule: a tab counts as one char).
function stripIndentChars(line, n) {
  let i = 0;
  while (i < line.length && i < n && (line[i] === ' ' || line[i] === '\t')) i++;
  return line.slice(i);
}

// ---------- URLs ----------
// Clean a URL for use in href/src: reject dangerous protocols (checked on
// the entity-decoded form), then percent-encode with encodeURI.
function cleanUrl(url, isImage) {
  const dec = unescapeText(url).toLowerCase().replace(/[\x00-\x20]+/g, '');
  if (/^javascript:/.test(dec) || /^vbscript:/.test(dec)) return null;
  if (/^data:/.test(dec)) {
    if (!isImage) return null;
    if (!/^data:image\//.test(dec)) return null;
  }
  try { return encodeURI(url); } catch { return null; }
}

// ---------- link reference definitions ----------
// Label normalization: collapse internal whitespace to one space, trim,
// casefold (lowercase).
function normalizeLabel(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Parse a link destination starting at src[i] (i points at '<' or first char).
// Returns {dest, end} or null. Angle form may not contain line endings or
// unescaped < >. Bare form: no spaces/control, balanced parens.
function parseDest(src, i) {
  if (src[i] === '<') {
    let j = i + 1;
    while (j < src.length && src[j] !== '>' && src[j] !== '\n') {
      if (src[j] === '\\' && j + 1 < src.length && isPunct(src[j + 1])) j += 2;
      else if (src[j] === '<') return null;
      else j++;
    }
    if (src[j] !== '>') return null;
    return { dest: src.slice(i + 1, j), end: j + 1 };
  }
  let j = i, depth = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32) break;
    if (c === '\\' && j + 1 < src.length && isPunct(src[j + 1])) { j += 2; continue; }
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) break; depth--; }
    j++;
  }
  if (j === i) return null;
  return { dest: src.slice(i, j), end: j };
}

// Parse a link title starting at src[i] (i at '"' or "'" or '(').
// Returns {title, end} or null. Title may span lines (no blank line inside).
// Backslash only escapes punctuation — we scan raw and unescape after.
function parseTitle(src, i) {
  const open = src[i];
  const close = open === '(' ? ')' : open;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length && isPunct(src[j + 1])) { j += 2; continue; }
    if (c === close) {
      return { title: unescapeBackslash(src.slice(i + 1, j)), end: j + 1 };
    }
    if (c === '\n') {
      // blank line inside title -> fail
      let k = j + 1;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      if (src[k] === '\n' || k >= src.length) return null;
    }
    j++;
  }
  return null;
}

// Parse a link reference definition starting at src[i] where src[i] === '['.
// The caller guarantees indent <= 3 spaces and i is at the '['.
// Returns {end, label, dest, title} or null. end is the index just past the
// definition (at a newline or EOF). Implements the failed-title rule:
// title on a different line that fails -> def stands without title (end =
// position right after the dest); title failing on the same line -> null.
function parseRefDef(src, i) {
  // label: balanced brackets, may span lines, no blank line, <= 999 chars
  let j = i + 1, depth = 1, labelEnd = -1;
  let blank = false;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length && (src[j + 1] === '[' || src[j + 1] === ']')) { j += 2; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { labelEnd = j; break; } }
    else if (c === '\n') {
      let k = j + 1;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      if (src[k] === '\n' || k >= src.length) { blank = true; break; }
    }
    j++;
  }
  if (labelEnd < 0 || blank) return null;
  const rawLabel = src.slice(i + 1, labelEnd);
  if (rawLabel.length === 0 || rawLabel.length > 999) return null;
  const label = normalizeLabel(rawLabel);
  if (label.length === 0) return null;
  j = labelEnd + 1;
  if (src[j] !== ':') return null;
  j++;
  // skip spaces/tabs/newlines (but not across a blank line)
  let k = j;
  while (k < src.length && (src[k] === ' ' || src[k] === '\t' || src[k] === '\n')) {
    if (src[k] === '\n') {
      let m = k + 1;
      while (m < src.length && (src[m] === ' ' || src[m] === '\t')) m++;
      if (src[m] === '\n' || m >= src.length) return null; // blank line stops def
    }
    k++;
  }
  if (k >= src.length) return null;
  const destRes = parseDest(src, k);
  if (!destRes) return null;
  const dest = destRes.dest;
  let end = destRes.end;
  // After dest: same-line spaces, then either EOL/EOF (no title) or title.
  let p = end;
  let sameLineWs = false;
  while (p < src.length && (src[p] === ' ' || src[p] === '\t')) { p++; sameLineWs = true; }
  const destLineEnd = src.indexOf('\n', end);
  if (p >= src.length || src[p] === '\n') {
    // no title on this line; maybe title on following line(s)
    if (p >= src.length) return { end: p, label, dest, title: null };
    // look at next line: title opener?
    let q = p + 1;
    while (q < src.length && (src[q] === ' ' || src[q] === '\t')) q++;
    if (q >= src.length || src[q] === '\n') return { end: p, label, dest, title: null };
    if (src[q] === '"' || src[q] === "'" || src[q] === '(') {
      const t = parseTitle(src, q);
      if (t) {
        let r = t.end;
        while (r < src.length && (src[r] === ' ' || src[r] === '\t')) r++;
        if (r >= src.length || src[r] === '\n') return { end: t.end, label, dest, title: t.title };
        // garbage after title on a different line -> def stands, title line
        // becomes paragraph: end right after dest
        return { end, label, dest, title: null };
      }
      // title failed on a different line -> def stands without title
      return { end, label, dest, title: null };
    }
    // next line is not a title -> def without title, end after dest
    return { end, label, dest, title: null };
  }
  // something else on the same line after dest
  if (!sameLineWs) return null; // whitespace required between dest and title
  if (src[p] === '"' || src[p] === "'" || src[p] === '(') {
    const t = parseTitle(src, p);
    if (!t) return null; // title fails on same line -> whole def invalid
    let r = t.end;
    while (r < src.length && (src[r] === ' ' || src[r] === '\t')) r++;
    if (r < src.length && src[r] !== '\n') return null; // junk after title
    return { end: t.end, label, dest, title: t.title };
  }
  return null;
}

// ---------- block parsing ----------
// Node types: p, h, hr, code (indented), fence, html, quote, list, table.
// parseBlocks(text, ctx) -> {nodes, hadInterBlockBlank}
// ctx: {refs: Map, lazy: Set<number>, endsWithNL: boolean}
//   lazy = indexes (in text's line array) of lazy-continuation lines.

// HTML block start conditions (CommonMark types 1-7).
const HTML_BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section summary table tbody td tfoot th thead title tr track ul').split(' '));
function htmlBlockStart(line) {
  // returns {type, endRe} or null; line already has indent <= 3
  const s = line.replace(/^[ \t]*/, '');
  if (/^<(?:pre|script|style|textarea)(?:[ \t>]|\/>)/i.test(s)) return { type: 1 };
  if (/^<!--/.test(s)) return { type: 2 };
  if (/^<\?/.test(s)) return { type: 3 };
  if (/^<![A-Za-z]/.test(s)) return { type: 4 };
  if (/^<!\[CDATA\[/.test(s)) return { type: 5 };
  const m = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[ \t>\\\/]|$)/.exec(s);
  if (m && HTML_BLOCK_TAGS.has(m[1].toLowerCase())) return { type: 6 };
  // type 7: any complete open/closing tag alone on the line
  if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>[ \t]*$/.test(s)) return { type: 7 };
  return null;
}
function htmlBlockEnds(type, line) {
  if (type === 1) return /<\/(?:pre|script|style|textarea)>/i.test(line);
  if (type === 2) return /-->/.test(line);
  if (type === 3) return /\?>/.test(line);
  if (type === 4) return />/.test(line);
  if (type === 5) return /\]\]>/.test(line);
  return false; // types 6,7 end at blank line
}

function atxHeading(line) {
  const m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(line);
  if (!m) return null;
  let content = m[2] === undefined ? '' : m[2];
  content = content.replace(/[ \t]+$/, '').replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '');
  return { level: m[1].length, text: content };
}
function isHr(line) {
  return /^ {0,3}(?:-[ \t]*){3,}$/.test(line) || /^ {0,3}(?:_[ \t]*){3,}$/.test(line) || /^ {0,3}(?:\*[ \t]*){3,}$/.test(line);
}
function fenceStart(line) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) return null;
  if (m[1][0] === '`' && m[2].includes('`')) return null;
  return { ch: m[1][0], len: m[1].length, info: m[2], indent: indentOf(line) };
}
function fenceEnd(line, fence) {
  const m = new RegExp(`^ {0,3}${fence.ch}{${fence.len},}[ \\t]*$`).exec(line);
  return !!m;
}
function isSetext(line) {
  const m = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
  return m ? (m[1][0] === '=' ? 1 : 2) : 0;
}
function listMarker(line) {
  // Column-tracked list marker scan. Returns null or
  // {ordered, bullet|start, delim, contentIndent, empty, markerEndCol}.
  let i = 0, col = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === ' ') col++;
    else col += 4 - (col % 4);
    i++;
    if (col > 3) return null;
  }
  if (i >= line.length) return null;
  let ordered = false, bullet = null, start = 0, delim = null;
  const c = line[i];
  if (c === '*' || c === '+' || c === '-') {
    bullet = c; i++; col++;
  } else if (c >= '0' && c <= '9') {
    let num = '';
    while (i < line.length && line[i] >= '0' && line[i] <= '9' && num.length < 9) { num += line[i]; i++; col++; }
    if (num.length === 0) return null;
    if (i >= line.length || (line[i] !== '.' && line[i] !== ')')) return null;
    delim = line[i]; i++; col++;
    ordered = true; start = parseInt(num, 10);
  } else return null;
  const markerEndCol = col;
  if (i < line.length && line[i] !== ' ' && line[i] !== '\t') return null;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === ' ') col++;
    else col += 4 - (col % 4);
    i++;
  }
  const empty = i >= line.length;
  const spWidth = col - markerEndCol;
  let contentIndent;
  if (empty) contentIndent = markerEndCol + 1;
  else if (spWidth >= 5) contentIndent = markerEndCol + 1;
  else contentIndent = col;
  return { ordered, bullet, start, delim, contentIndent, empty, markerEndCol };
}

// Can this line start a block that interrupts a paragraph? (Indented code
// and HTML type 7 cannot.) Returns the block kind or null.
function interruptsParagraph(line) {
  if (indentOf(line) > 3) return null;
  if (atxHeading(line)) return 'atx';
  if (fenceStart(line)) return 'fence';
  if (isHr(line)) return 'hr';
  const h = htmlBlockStart(line);
  if (h && h.type !== 7) return 'html';
  if (/^ {0,3}>/.test(line)) return 'quote';
  const lm = listMarker(line);
  if (lm && !lm.empty) {
    if (!lm.ordered) return 'list';
    if (lm.start === 1) return 'list';
  }
  return null;
}

// Split a table row line into cells (leading/trailing | optional).
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // split on unescaped |
  const cells = [];
  let cur = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '|'; i += 2; continue; }
    if (s[i] === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += s[i]; i++;
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}
function parseDelimiterRow(line) {
  if (!line.includes('|')) return null;
  const cells = splitTableRow(line);
  const aligns = [];
  for (const c of cells) {
    const m = /^:?-+:?$/.exec(c);
    if (!m) return null;
    const left = c.startsWith(':'), right = c.endsWith(':');
    aligns.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return aligns;
}

function parseBlocks(text, ctx) {
  const lines = text.split('\n');
  const nodes = [];
  let i = 0;
  let blankPending = false, hadInterBlockBlank = false;
  const markBlock = () => { if (blankPending && nodes.length > 0) hadInterBlockBlank = true; blankPending = false; };

  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) { blankPending = true; i++; continue; }
    const ind = indentOf(line);

    // link reference definitions at block start
    {
      const wsEnd = line.search(/[^ \t]/);
      if (wsEnd >= 0 && ind <= 3) {
        const rest = lines.slice(i).join('\n');
        const def = parseRefDef(rest, wsEnd);
        if (def) {
          ctx.refs.set(def.label, { dest: def.dest, title: def.title });
          const consumed = rest.slice(0, def.end);
          const nl = (consumed.match(/\n/g) || []).length;
          i += nl + 1;
          if (i > lines.length) i = lines.length;
          continue;
        }
      }
    }

    // indented code (indent >= 4, between blocks)
    if (ind >= 4) {
      const buf = [];
      while (i < lines.length) {
        const l = lines[i];
        if (isBlankLine(l)) {
          // blank belongs only if followed by another indented line
          let j = i + 1;
          while (j < lines.length && isBlankLine(lines[j])) j++;
          if (j < lines.length && indentOf(lines[j]) >= 4) { buf.push(''); i++; continue; }
          break;
        }
        if (indentOf(l) < 4) break;
        buf.push(stripIndentCols(l, 4));
        i++;
      }
      while (buf.length && buf[buf.length - 1] === '') buf.pop();
      markBlock();
      nodes.push({ t: 'code', text: buf.join('\n') });
      continue;
    }

    // ATX heading
    const atx = atxHeading(line);
    if (atx) { markBlock(); nodes.push({ t: 'h', level: atx.level, text: atx.text }); i++; continue; }

    // fenced code
    const fs = fenceStart(line);
    if (fs) {
      const buf = [];
      i++;
      while (i < lines.length && !fenceEnd(lines[i], fs)) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++; // skip closing fence
      const content = buf.map(l => stripIndentChars(l, fs.indent)).join('\n');
      markBlock();
      nodes.push({ t: 'fence', info: fs.info, text: content });
      continue;
    }

    // HTML block
    const hb = htmlBlockStart(line);
    if (hb) {
      const buf = [line];
      i++;
      if (hb.type === 1 || hb.type === 2 || hb.type === 3 || hb.type === 4 || hb.type === 5) {
        if (!htmlBlockEnds(hb.type, line)) {
          while (i < lines.length && !htmlBlockEnds(hb.type, lines[i])) { buf.push(lines[i]); i++; }
          if (i < lines.length) { buf.push(lines[i]); i++; }
        }
      } else {
        while (i < lines.length && !isBlankLine(lines[i])) { buf.push(lines[i]); i++; }
      }
      markBlock();
      nodes.push({ t: 'html', text: buf.join('\n') });
      continue;
    }

    // thematic break (before list: '- - -' / '* * *' is an hr, not a list)
    if (isHr(line)) { markBlock(); nodes.push({ t: 'hr' }); i++; continue; }

    // blockquote
    if (/^ {0,3}>/.test(line)) {
      const res = gatherQuote(lines, i, ctx);
      markBlock();
      nodes.push({ t: 'quote', children: res.nodes });
      i = res.next;
      continue;
    }

    // list
    const lm0 = listMarker(line);
    if (lm0) {
      const res = gatherList(lines, i, ctx);
      markBlock();
      nodes.push(res.node);
      i = res.next;
      continue;
    }

    // paragraph (handles setext, table, refdef interruption)
    {
      const res = gatherParagraph(lines, i, ctx);
      if (res.node) { markBlock(); nodes.push(res.node); }
      i = res.next;
      if (res.next <= i && res.node === null) i++; // safety: always progress
      continue;
    }
  }
  return { nodes, hadInterBlockBlank };
}

// Gather a paragraph starting at lines[i]. Handles setext headings, GFM
// tables, and refdef interruption. Returns {node|null, next}.
function gatherParagraph(lines, i, ctx) {
  const pLines = [lines[i]];
  i++;
  let isTable = false, tableAligns = null, tableHeader = null;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) break;
    // ws-only last line of the text that does not end with \n is a
    // paragraph continuation, not a blank terminator (cm-241)
    if (/^[ \t]+$/.test(line)) {
      // it is the last line of the whole text and text lacks trailing \n:
      // handled by caller via ctx.endsWithNL; here treat as continuation
      // only if it is the final line and !ctx.endsWithNL
      if (i === lines.length - 1 && !ctx.endsWithNL) { pLines.push(line); i++; continue; }
      break;
    }
    // lazy lines continue the paragraph without any block checks
    // (setext/table/interrupt rules do not apply to them)
    if (ctx.lazy && ctx.lazy.has(i)) { pLines.push(line); i++; continue; }
    // setext underline (before list/hr checks: '-' is setext here)
    const sx = isSetext(line);
    if (sx) {
      const text = pLines.join('\n').trim();
      return { node: { t: 'h', level: sx, text }, next: i + 1 };
    }
    // table delimiter: only right after the first paragraph line
    if (pLines.length === 1 && line.includes('|')) {
      const al = parseDelimiterRow(line);
      if (al) {
        const header = splitTableRow(pLines[0]);
        if (header.length === al.length) {
          isTable = true; tableAligns = al; tableHeader = header;
          i++;
          const rows = [];
          while (i < lines.length && !isBlankLine(lines[i])) {
            if (interruptsParagraph(lines[i])) break;
            const cells = splitTableRow(lines[i]);
            while (cells.length < header.length) cells.push('');
            rows.push(cells.slice(0, header.length));
            i++;
          }
          return { node: { t: 'table', aligns: tableAligns, header: tableHeader, rows }, next: i };
        }
      }
    }
    // lazy lines continue the paragraph without interrupt checks
    if (ctx.lazy && ctx.lazy.has(i)) { pLines.push(line); i++; continue; }
    // interrupting blocks end the paragraph
    if (interruptsParagraph(line)) break;
    pLines.push(line);
    i++;
  }
  return { node: { t: 'p', text: pLines.join('\n') }, next: i };
}

// ---------- containers: blockquote & list ----------
// Strip one blockquote marker (<=3 cols indent + '>' + one optional space/tab).
// Returns the inner line or null.
function stripQuoteMarker(line) {
  // marked expands tabs while stripping container markers, so expand the
  // whole line first (absolute columns), then strip '>' + one space.
  const ex = expandTabs(line, 0);
  let i = 0;
  while (i < ex.length && ex[i] === ' ' && i < 3) i++;
  if (ex[i] !== '>') return null;
  i++;
  if (ex[i] === ' ') i++;
  return ex.slice(i);
}
// Strip quote/list markers recursively (for prev-line leaf checks).
function stripContainerMarkers(s) {
  let cur = s;
  for (let guard = 0; guard < 10; guard++) {
    const q = stripQuoteMarker(cur);
    if (q !== null) { cur = q; continue; }
    const lm = listMarker(cur);
    if (lm) { cur = stripListMarker(cur, lm); continue; }
    break;
  }
  return cur;
}
// Is this inner line a paragraph line (could the next line lazily continue it)?
function prevIsParagraphLine(innerLine) {
  if (isBlankLine(innerLine)) return false;
  const s = stripContainerMarkers(innerLine);
  if (isBlankLine(s)) return false;
  if (atxHeading(s) || fenceStart(s) || isHr(s) || htmlBlockStart(s)) return false;
  if (indentOf(s) >= 4) return false;
  return true;
}

function gatherQuote(lines, i, ctx) {
  const inner = [];
  const lazy = new Set();
  let fenceOpen = null;
  let j = i;
  while (j < lines.length) {
    const line = lines[j];
    const stripped = stripQuoteMarker(line);
    if (stripped !== null) {
      inner.push(stripped);
      if (fenceOpen) { if (fenceEnd(stripped, fenceOpen)) fenceOpen = null; }
      else { const fs = fenceStart(stripped); if (fs) fenceOpen = fs; }
      j++;
      continue;
    }
    if (isBlankLine(line)) { inner.push(''); j++; continue; }
    if (fenceOpen) break; // line without > while a fence is open ends the quote
    const prev = inner.length ? inner[inner.length - 1] : null;
    if (prev !== null && prevIsParagraphLine(prev) && !interruptsParagraph(line)) {
      const idx = inner.length;
      let il = expandTabs(line, 0);
      if (indentOf(il) >= 4) il = stripIndentCols(il, 4);
      inner.push(il);
      lazy.add(idx);
      j++;
      continue;
    }
    break;
  }
  while (inner.length && isBlankLine(inner[inner.length - 1])) inner.pop();
  const sub = parseBlocks(inner.join('\n'), { refs: ctx.refs, lazy, endsWithNL: false });
  return { nodes: sub.nodes, next: j };
}

// Strip a list marker + content indent from a line (column-tracked,
// partial-tab aware). contentIndent is in columns from the line start.
function stripListMarker(line, lm) {
  let i = 0, col = 0;
  while (i < line.length && col < lm.contentIndent) {
    const c = line[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= lm.contentIndent) { col += w; i++; }
      else return ' '.repeat(col + w - lm.contentIndent) + line.slice(i + 1);
    } else { col++; i++; }
  }
  return line.slice(i);
}
function sameListMarker(lm, ordered, delim) {
  if (!lm || lm.ordered !== ordered) return false;
  return ordered ? lm.delim === delim : lm.bullet === delim;
}

function gatherList(lines, i, ctx) {
  const first = listMarker(expandTabs(lines[i], 0));
  const ordered = first.ordered;
  const delim = ordered ? first.delim : first.bullet;
  const items = [];
  let loose = false;
  let j = i;
  while (j < lines.length) {
    if (isBlankLine(lines[j])) {
      let k = j;
      while (k < lines.length && isBlankLine(lines[k])) k++;
      if (k < lines.length) {
        const lm = listMarker(expandTabs(lines[k], 0));
        if (sameListMarker(lm, ordered, delim) && indentOf(lines[k]) <= 3) { loose = true; j = k; continue; }
      }
      break;
    }
    const lm = listMarker(expandTabs(lines[j], 0));
    if (!sameListMarker(lm, ordered, delim) || indentOf(lines[j]) > 3) break;
    const ci = lm.contentIndent;
    const itemLines = [stripListMarker(expandTabs(lines[j], 0), lm)];
    j++;
    while (j < lines.length) {
      const l = expandTabs(lines[j], 0);
      if (isBlankLine(l)) {
        let k = j;
        while (k < lines.length && isBlankLine(lines[k])) k++;
        if (k >= lines.length) { j = k; break; }
        const lm2 = listMarker(expandTabs(lines[k], 0));
        if (sameListMarker(lm2, ordered, delim) && indentOf(lines[k]) <= 3) { loose = true; j = k; break; }
        if (indentOf(lines[k]) >= ci) {
          for (let b = j; b < k; b++) itemLines.push('');
          j = k; continue;
        }
        break; // blank ends the item (paragraph closed, no lazy after blank)
      }
      if (indentOf(l) >= ci) { itemLines.push(stripIndentCols(l, ci)); j++; continue; }
      const lm2 = listMarker(l);
      if (sameListMarker(lm2, ordered, delim) && indentOf(l) <= 3) break;
      const prev = itemLines.length ? itemLines[itemLines.length - 1] : null;
      if (prev !== null && prevIsParagraphLine(prev) && !interruptsParagraph(l)) {
        itemLines.push(l);
        j++;
        continue;
      }
      break;
    }
    while (itemLines.length && isBlankLine(itemLines[itemLines.length - 1])) itemLines.pop();
    items.push(itemLines);
    if (j < lines.length && !isBlankLine(lines[j])) {
      const lm3 = listMarker(expandTabs(lines[j], 0));
      if (!sameListMarker(lm3, ordered, delim) || indentOf(lines[j]) > 3) break;
    }
  }
  const itemNodes = items.map(itemLines => {
    const sub = parseBlocks(itemLines.join('\n'), { refs: ctx.refs, lazy: new Set(), endsWithNL: false });
    if (sub.hadInterBlockBlank) loose = true;
    return sub.nodes;
  });
  return { node: { t: 'list', ordered, start: ordered ? first.start : 1, tight: !loose, items: itemNodes }, next: j };
}

// ---------- inline parsing ----------
// Nodes: text, delim, code, html, br, link, img, em, strong, del, autolink.
function isPunctU(c) {
  return c !== undefined && (PUNCT.indexOf(c) >= 0 || /\p{P}/u.test(c));
}
function isSpaceU(c) { return c === undefined || /\s/.test(c); }

function unescapeBackslash(s) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length && isPunct(s[i + 1])) { out += s[i + 1]; i += 2; }
    else { out += s[i]; i++; }
  }
  return out;
}

// Scan a label starting at src[i] === '['. Returns {label, end} or null.
// Label may span lines (no blank line), brackets balanced, <= 999 chars.
function scanLabel(src, i) {
  let j = i + 1, depth = 1;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length && (src[j + 1] === '[' || src[j + 1] === ']')) { j += 2; continue; }
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) break; }
    else if (c === '\n') {
      let k = j + 1;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      if (src[k] === '\n' || k >= src.length) return null;
    }
    j++;
  }
  if (depth !== 0) return null;
  const raw = src.slice(i + 1, j);
  if (raw.length === 0 || raw.length > 999) return null;
  return { label: raw, end: j + 1 };
}

// Skip spaces/tabs/newlines (not across a blank line). Returns index or -1.
function skipWsNoBlank(src, i) {
  let j = i;
  while (j < src.length && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) {
    if (src[j] === '\n') {
      let k = j + 1;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      if (src[k] === '\n' || k >= src.length) return -1;
    }
    j++;
  }
  return j;
}

// Try to form a link/image at text[pos] === ']' (pos is index of ']').
// nodes: current node list; openerIdx: index of the active opener node.
// Returns {node, end} (end = index just past the link syntax) or null.
function tryLink(text, pos, nodes, openerIdx, refs) {
  const opener = nodes[openerIdx];
  const linkTextEnd = pos; // ']' is at pos
  let p = pos + 1;
  // inline link: optional ws then '('
  const q = skipWsNoBlank(text, p);
  if (q >= 0 && text[q] === '(') {
    let r = skipWsNoBlank(text, q + 1);
    if (r >= 0) {
      const d = parseDest(text, r);
      if (d) {
        let s = d.end;
        const t = skipWsNoBlank(text, s);
        if (t >= 0) {
          if (text[t] === ')') {
            return { node: makeLinkNode(opener, nodes, openerIdx, d.dest, null, refs), end: t + 1 };
          }
          const ti = parseTitle(text, t);
          if (ti) {
            const u = skipWsNoBlank(text, ti.end);
            if (u >= 0 && text[u] === ')') {
              return { node: makeLinkNode(opener, nodes, openerIdx, d.dest, ti.title, refs), end: u + 1 };
            }
          }
        }
      }
    }
  }
  // reference link: [label] / [] / shortcut
  const q2 = skipWsNoBlank(text, p);
  if (q2 >= 0 && text[q2] === '[') {
    const lab = scanLabel(text, q2);
    if (lab) {
      const key = normalizeLabel(lab.label);
      if (refs.has(key)) {
        const ref = refs.get(key);
        return { node: makeLinkNode(opener, nodes, openerIdx, ref.dest, ref.title, refs), end: lab.end };
      }
      return null; // label present but undefined -> no link (no shortcut fallback)
    }
    return null;
  }
  // shortcut reference: label = link text
  const rawLabel = text.slice(opener.pos + 1, linkTextEnd);
  const key = normalizeLabel(rawLabel);
  if (refs.has(key)) {
    const ref = refs.get(key);
    return { node: makeLinkNode(opener, nodes, openerIdx, ref.dest, ref.title, refs), end: pos + 1 };
  }
  return null;
}

function makeLinkNode(opener, nodes, openerIdx, destRaw, titleRaw, refs) {
  const children = nodes.slice(openerIdx + 1);
  const dest = unescapeBackslash(destRaw);
  const title = titleRaw === null || titleRaw === undefined ? null : unescapeBackslash(titleRaw);
  if (opener.kind === 'image') {
    return { t: 'img', src: dest, title, alt: children };
  }
  return { t: 'link', href: dest, title, children };
}

// Inline HTML tag at text[i] === '<'. Returns {html, end} or null.
function scanInlineHtml(text, i) {
  const rest = text.slice(i, i + 500);
  let m = /^<!--(?:(?!-->)[\s\S])*?-->/.exec(rest);
  if (m) return { html: m[0], end: i + m[0].length };
  m = /^<\?(?:(?!\?>)[\s\S])*?\?>/.exec(rest);
  if (m) return { html: m[0], end: i + m[0].length };
  m = /^<![A-Za-z][\s\S]*?>/.exec(rest);
  if (m) return { html: m[0], end: i + m[0].length };
  m = /^<!\[CDATA\[(?:(?!\]\]>)[\s\S])*?\]\]>/.exec(rest);
  if (m) return { html: m[0], end: i + m[0].length };
  m = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>/.exec(rest);
  if (m) return { html: m[0], end: i + m[0].length };
  return null;
}

// Autolink <...> at text[i] === '<'. Returns {href, text, end} or null.
function scanAutolink(text, i) {
  const rest = text.slice(i + 1, i + 1000);
  const m = /^([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*)>/.exec(rest);
  if (m) return { href: m[1], text: m[1], end: i + 1 + m[0].length };
  const e = /^([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+)>/.exec(rest);
  if (e) return { href: 'mailto:' + e[1], text: e[1], end: i + 1 + e[0].length };
  return null;
}

// GFM autolink (www. / scheme / email) starting at text[i]. prev is the
// char before i (or undefined). Returns {href, text, end} or null.
function scanGfmAutolink(text, i, prev) {
  const rest = text.slice(i);
  // email (a '/' before it is fine)
  const em = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/.exec(rest);
  if (em && (prev === undefined || isSpaceU(prev) || isPunctU(prev))) {
    return { href: 'mailto:' + em[0], text: em[0], end: i + em[0].length };
  }
  // www. / scheme: must not be preceded by '/' (or an alphanumeric)
  const canStart = prev === undefined || isSpaceU(prev) || (isPunctU(prev) && prev !== '/');
  if (!canStart) return null;
  // www.
  let m = /^www\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+(?:[^\s<>]*)?/.exec(rest);
  if (m) {
    const url = trimGfmUrl(m[0]);
    if (url) return { href: 'http://' + url, text: url, end: i + url.length };
    return null;
  }
  // scheme://
  m = /^([A-Za-z][A-Za-z0-9+.-]{1,31}):\/\/[^\s<>]*/.exec(rest);
  if (m) {
    const url = trimGfmUrl(m[0]);
    if (url) return { href: url, text: url, end: i + url.length };
  }
  return null;
}
// Trim trailing punctuation from a GFM autolink URL (balanced parens,
// entity-aware semicolons).
function trimGfmUrl(url) {
  let u = url;
  for (;;) {
    if (u.length === 0) return null;
    const c = u[u.length - 1];
    if (c === ')') {
      const open = (u.match(/\(/g) || []).length, close = (u.match(/\)/g) || []).length;
      if (close > open) { u = u.slice(0, -1); continue; }
      break;
    }
    if (c === ';') {
      const amp = u.lastIndexOf('&');
      if (amp >= 0 && /^&[A-Za-z0-9]+;$/.test(u.slice(amp))) { u = u.slice(0, -1); continue; }
      break;
    }
    if ('?!.,:*_~\'"'.includes(c)) { u = u.slice(0, -1); continue; }
    break;
  }
  // a www. URL needs a dot in the domain part
  return u;
}

function tokenizeInline(text, refs) {
  const nodes = [];
  let buf = '';
  const flush = () => { if (buf) { nodes.push({ t: 'text', s: buf }); buf = ''; } };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    // backslash escape / hard break
    if (c === '\\') {
      if (i + 1 < n && text[i + 1] === '\n') { flush(); nodes.push({ t: 'br' }); i += 2; continue; }
      if (i + 1 < n && isPunct(text[i + 1])) { buf += text[i + 1]; i += 2; continue; }
      buf += c; i++; continue;
    }
    // entity: numeric -> decode to a character; named (&name;) -> pass
    // through unchanged as an entity node; anything else -> literal '&'.
    if (c === '&') {
      const num = /^#(?:\d{1,7}|[xX][0-9a-fA-F]{1,6});/.exec(text.slice(i + 1, i + 40));
      if (num) {
        const d = decodeEntityAt(text, i);
        if (d) { buf += d[0]; i += d[1]; continue; }
      }
      const nm = /^([A-Za-z][A-Za-z0-9]{0,31});/.exec(text.slice(i + 1, i + 40));
      if (nm) { flush(); nodes.push({ t: 'entity', s: '&' + nm[1] + ';' }); i += nm[0].length + 1; continue; }
      buf += '&'; i++; continue;
    }
    // code span
    if (c === '`') {
      let j = i;
      while (j < n && text[j] === '`') j++;
      const run = j - i;
      // find a later run of exactly `run` backticks
      let k = j, found = -1;
      while (k < n) {
        if (text[k] === '`') {
          let e = k;
          while (e < n && text[e] === '`') e++;
          if (e - k === run) { found = k; break; }
          k = e;
        } else k++;
      }
      if (found >= 0) {
        let content = text.slice(j, found).replace(/\r\n?|\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && !/^[ ]+$/.test(content)) {
          content = content.slice(1, -1);
        }
        flush();
        nodes.push({ t: 'code', s: content });
        i = found + run;
        continue;
      }
      buf += '`'.repeat(run); i = j; continue;
    }
    // emphasis / strikethrough delimiters
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && text[j] === c) j++;
      const run = j - i;
      if (c === '~' && run < 2) { buf += '~'.repeat(run); i = j; continue; }
      const prev = i > 0 ? text[i - 1] : undefined;
      const next = j < n ? text[j] : undefined;
      const leftFl = !isSpaceU(next) && (!isPunctU(next) || isSpaceU(prev) || isPunctU(prev));
      const rightFl = !isSpaceU(prev) && (!isPunctU(prev) || isSpaceU(next) || isPunctU(next));
      let canOpen, canClose;
      if (c === '_') {
        canOpen = leftFl && (!rightFl || isPunctU(prev));
        canClose = rightFl && (!leftFl || isPunctU(next));
      } else {
        canOpen = leftFl; canClose = rightFl;
      }
      flush();
      nodes.push({ t: 'delim', ch: c, len: run, canOpen, canClose });
      i = j;
      continue;
    }
    // link opener
    if (c === '[') { flush(); nodes.push({ t: 'open', kind: 'link', active: true, pos: i }); i++; continue; }
    if (c === '!' && i + 1 < n && text[i + 1] === '[') {
      flush(); nodes.push({ t: 'open', kind: 'image', active: true, pos: i + 1 }); i += 2; continue;
    }
    // link close: try to form a link (flush buffered text first so the
    // link text includes it)
    if (c === ']') {
      flush();
      let oi = -1;
      for (let k = nodes.length - 1; k >= 0; k--) {
        if (nodes[k].t === 'open') { oi = k; break; }
      }
      if (oi >= 0 && nodes[oi].active) {
        const res = tryLink(text, i, nodes, oi, refs);
        if (res) {
          // deactivate all earlier openers
          for (let k = 0; k < oi; k++) if (nodes[k].t === 'open') nodes[k].active = false;
          flush();
          nodes.splice(oi, nodes.length - oi, res.node);
          i = res.end;
          continue;
        }
      }
      buf += ']'; i++; continue;
    }
    // autolink / inline html
    if (c === '<') {
      const au = scanAutolink(text, i);
      if (au) { flush(); nodes.push({ t: 'autolink', href: au.href, text: au.text }); i = au.end; continue; }
      const h = scanInlineHtml(text, i);
      if (h) { flush(); nodes.push({ t: 'html', s: h.html }); i = h.end; continue; }
      buf += '<'; i++; continue;
    }
    // GFM autolink (www. / scheme / email)
    if ((c === 'w' && text.startsWith('www.', i)) || /[A-Za-z]/.test(c)) {
      const prev = i > 0 ? text[i - 1] : undefined;
      // only attempt when at a word start-ish position
      if (prev === undefined || isSpaceU(prev) || isPunctU(prev)) {
        const g = scanGfmAutolink(text, i, prev);
        if (g) { flush(); nodes.push({ t: 'autolink', href: g.href, text: g.text }); i = g.end; continue; }
      }
    }
    // newline: hard break (2+ trailing spaces) or soft break
    if (c === '\n') {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); flush(); nodes.push({ t: 'br' }); }
      else { buf += '\n'; }
      i++; continue;
    }
    buf += c; i++;
  }
  flush();
  return nodes;
}

// ---------- emphasis (delimiter-stack algorithm, CommonMark appendix A) ----------
function processEmphasis(nodes) {
  for (const nd of nodes) {
    if (nd.t === 'link') processEmphasis(nd.children);
    if (nd.t === 'img') processEmphasis(nd.alt);
  }
  for (;;) {
    let found = null;
    for (let ci = 0; ci < nodes.length; ci++) {
      const cl = nodes[ci];
      if (cl.t !== 'delim' || !cl.canClose) continue;
      for (let oi = ci - 1; oi >= 0; oi--) {
        const op = nodes[oi];
        if (op.t !== 'delim' || op.ch !== cl.ch || !op.canOpen) continue;
        // odd-match rule: if both can open+close, the sum must not be a
        // multiple of 3 unless both lengths are multiples of 3.
        if (op.canOpen && op.canClose && cl.canOpen && cl.canClose) {
          if ((op.len + cl.len) % 3 === 0 && !(op.len % 3 === 0 && cl.len % 3 === 0)) continue;
        }
        found = { oi, ci, op, cl };
        break;
      }
      if (found) break;
    }
    if (!found) break;
    const { oi, ci, op, cl } = found;
    const use = (op.len >= 2 && cl.len >= 2) ? 2 : 1;
    const tag = op.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
    const emNode = { t: tag, children: nodes.slice(oi + 1, ci) };
    const rep = [];
    if (op.len > use) rep.push({ t: 'delim', ch: op.ch, len: op.len - use, canOpen: op.canOpen, canClose: op.canClose });
    rep.push(emNode);
    if (cl.len > use) rep.push({ t: 'delim', ch: cl.ch, len: cl.len - use, canOpen: cl.canOpen, canClose: cl.canClose });
    nodes.splice(oi, ci - oi + 1, ...rep);
  }
}

// Plain text of inline nodes (for image alt text).
function plainText(nodes) {
  let out = '';
  for (const nd of nodes) {
    switch (nd.t) {
      case 'text': out += nd.s; break;
      case 'entity': out += nd.s; break;
      case 'delim': out += nd.ch.repeat(nd.len); break;
      case 'code': out += nd.s; break;
      case 'open': out += nd.kind === 'image' ? '![' : '['; break;
      case 'em': case 'strong': case 'del': case 'link': out += plainText(nd.children); break;
      case 'img': out += plainText(nd.alt); break;
      case 'autolink': out += nd.text; break;
      default: break;
    }
  }
  return out;
}

function renderInline(nodes) {
  let out = '';
  for (const nd of nodes) {
    switch (nd.t) {
      case 'text': out += escapeText(nd.s); break;
      case 'entity': out += nd.s; break;
      case 'delim': out += escapeText(nd.ch.repeat(nd.len)); break;
      case 'code': out += '<code>' + escapeText(nd.s) + '</code>'; break;
      case 'html': out += nd.s; break;
      case 'br': out += '<br>'; break;
      case 'open': out += escapeText(nd.kind === 'image' ? '![' : '['); break;
      case 'link': {
        const href = cleanUrl(nd.href, false);
        if (href === null) { out += renderInline(nd.children); break; }
        out += '<a href="' + escapeAttr(href) + '"';
        if (nd.title !== null && nd.title !== undefined) out += ' title="' + escapeAttr(nd.title) + '"';
        out += '>' + renderInline(nd.children) + '</a>';
        break;
      }
      case 'img': {
        const src = cleanUrl(nd.src, true);
        const alt = plainText(nd.alt);
        out += '<img src="' + escapeAttr(src === null ? '' : src) + '" alt="' + escapeAttr(alt) + '"';
        if (nd.title !== null && nd.title !== undefined) out += ' title="' + escapeAttr(nd.title) + '"';
        out += '>';
        break;
      }
      case 'autolink': {
        const href = cleanUrl(nd.href, false);
        if (href === null) { out += escapeText(nd.text); break; }
        out += '<a href="' + escapeAttr(href) + '">' + escapeText(nd.text) + '</a>';
        break;
      }
      case 'em': out += '<em>' + renderInline(nd.children) + '</em>'; break;
      case 'strong': out += '<strong>' + renderInline(nd.children) + '</strong>'; break;
      case 'del': out += '<del>' + renderInline(nd.children) + '</del>'; break;
    }
  }
  return out;
}

function parseInline(text, refs) {
  const nodes = tokenizeInline(text, refs);
  processEmphasis(nodes);
  return renderInline(nodes);
}

// ---------- block rendering ----------
function renderListItem(itemNodes, tight, ctx) {
  if (!tight) return renderBlocks(itemNodes, ctx);
  const parts = [];
  for (const nd of itemNodes) {
    if (nd.t === 'p') parts.push(parseInline(nd.text, ctx.refs));
    else parts.push(renderBlocks([nd], ctx));
  }
  return parts.join('');
}

function renderBlocks(nodes, ctx) {
  let out = '';
  for (let bi = 0; bi < nodes.length; bi++) {
    const nd = nodes[bi];
    const isLast = bi === nodes.length - 1;
    switch (nd.t) {
      case 'p': out += '<p>' + parseInline(nd.text, ctx.refs) + '</p>\n'; break;
      case 'h': out += '<h' + nd.level + '>' + parseInline(nd.text, ctx.refs) + '</h' + nd.level + '>\n'; break;
      case 'hr': out += '<hr>\n'; break;
      case 'code': out += '<pre><code>' + escapeText(nd.text) + (nd.text ? '\n' : '') + '</code></pre>\n'; break;
      case 'fence': {
        let lang = '';
        const info = nd.info.trim();
        if (info) lang = escapeAttr(unescapeBackslash(info.split(/\s+/)[0]));
        out += '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + escapeText(nd.text) + (nd.text ? '\n' : '') + '</code></pre>\n';
        break;
      }
      case 'html': {
        out += nd.text;
        if (!isLast || ctx.endsWithNL) out += '\n';
        break;
      }
      case 'quote': out += '<blockquote>\n' + renderBlocks(nd.children, { refs: ctx.refs, lazy: new Set(), endsWithNL: false }) + '</blockquote>\n'; break;
      case 'list': {
        const tag = nd.ordered ? 'ol' : 'ul';
        out += '<' + tag + (nd.ordered && nd.start !== 1 ? ' start="' + nd.start + '"' : '') + '>\n';
        for (const item of nd.items) {
          out += '<li>' + renderListItem(item, nd.tight, ctx) + '</li>\n';
        }
        out += '</' + tag + '>\n';
        break;
      }
      case 'table': {
        out += '<table>\n<thead>\n<tr>\n';
        for (let ci = 0; ci < nd.header.length; ci++) {
          const al = nd.aligns[ci];
          out += '<th' + (al ? ' align="' + al + '"' : '') + '>' + parseInline(nd.header[ci], ctx.refs) + '</th>\n';
        }
        out += '</tr>\n</thead>\n<tbody>';
        for (const row of nd.rows) {
          out += '<tr>\n';
          for (let ci = 0; ci < row.length; ci++) {
            const al = nd.aligns[ci];
            out += '<td' + (al ? ' align="' + al + '"' : '') + '>' + parseInline(row[ci], ctx.refs) + '</td>\n';
          }
          out += '</tr>\n';
        }
        out += '</tbody></table>\n';
        break;
      }
    }
  }
  return out;
}

export function parse(src) {
  src = src.replace(/\r\n?/g, '\n');
  const refs = new Map();
  const top = { refs, lazy: new Set(), endsWithNL: src.endsWith('\n') };
  const { nodes } = parseBlocks(src, top);
  return renderBlocks(nodes, top);
}
