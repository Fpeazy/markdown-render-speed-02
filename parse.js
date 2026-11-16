// parse.js — a fast, dependency-free Markdown renderer.
// Returns exactly the HTML marked 18.1.3 returns (default options) for
// CommonMark 0.31.2 + GFM 0.29 input. Written from scratch against the
// CommonMark spec algorithm; the practice set is the correctness oracle.
// Design: line-based block parser (container stack) + delimiter-stack
// inline parser. Hot paths scan with charCodeAt and an index cursor,
// build output with +=, keep fixed-shape records, and avoid allocations
// inside the scan loops wherever the algorithm allows it.

// Whether an unclosed inline <a> tag has been seen (marked's inline
// tokenizer state): while set, EXTENDED autolinks (www./email/scheme)
// are suppressed — a link cannot contain a link. Markdown links and
// <...> autolinks are NOT suppressed. Set by an inline <a> open tag
// whose HTML contains a literal space ('<a href="x">', '<a />'),
// cleared by an inline '</a>' exactly. Persists across paragraphs
// within one document; reset per parse() call. HTML blocks do not
// touch it.
let inLink = false;

export function parse(markdown) {
  inLink = false;
  return renderBlocks(parseBlocks(markdown));
}

// ---------------------------------------------------------------------------
// Character helpers (ASCII fast paths; Unicode only where the spec needs it)
// ---------------------------------------------------------------------------

function isSpace(cc) {
  return cc === 32 || cc === 9 || cc === 10 || cc === 11 || cc === 12 || cc === 13;
}
function isBlankStr(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 11 && c !== 12 && c !== 13) return false;
  }
  return true;
}
// ASCII punctuation (CommonMark's definition) — the common case. Non-ASCII
// punctuation is handled by isPunctCh below via a small regex fallback.
function isAsciiPunct(cc) {
  return (cc >= 33 && cc <= 47) || (cc >= 58 && cc <= 64) ||
    (cc >= 91 && cc <= 96) || (cc >= 123 && cc <= 126);
}
const PUNCT_RE = /^\p{P}$/u;
const SYMBOL_RE = /^\p{S}$/u;
function isPunctCh(ch) {
  const cc = ch.charCodeAt(0);
  if (cc < 128) return isAsciiPunct(cc);
  return PUNCT_RE.test(ch) || SYMBOL_RE.test(ch);
}
function isWhitespaceCh(ch) {
  const cc = ch.charCodeAt(0);
  if (cc < 128) return isSpace(cc);
  return /^\s$/.test(ch);
}

// ---------------------------------------------------------------------------
// HTML named entities (HTML5). Unknown names stay literal, as marked does.
// ---------------------------------------------------------------------------

const ENT = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ',
  iexcl: '¡', cent: '¢', pound: '£', curren: '¤', yen: '¥', brvbar: '¦',
  sect: '§', uml: '¨', copy: '©', ordf: 'ª', laquo: '«', not: '¬',
  shy: '­', reg: '®', macr: '¯', deg: '°', plusmn: '±', sup2: '²',
  sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·', cedil: '¸',
  sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾',
  iquest: '¿', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã',
  Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Ouml: 'Ö', times: '×', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û',
  Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á',
  acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í',
  icirc: 'î', iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', divide: '÷', oslash: 'ø', ugrave: 'ù',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  Amacr: 'Ā', amacr: 'ā', Abreve: 'Ă', abreve: 'ă', Aogon: 'Ą', aogon: 'ą',
  Cacute: 'Ć', cacute: 'ć', Ccaron: 'Č', ccaron: 'č', Dcaron: 'Ď',
  dcaron: 'ď', Ecaron: 'Ě', ecaron: 'ě', Emacr: 'Ē', emacr: 'ē',
  Eogon: 'Ę', eogon: 'ę', Gbreve: 'Ğ', gbreve: 'ğ', Gdot: 'Ġ', gdot: 'ġ',
  Hcirc: 'Ĥ', hcirc: 'ĥ', Hstrok: 'Ħ', hstrok: 'ħ', Idot: 'İ', Imacr: 'Ī',
  imacr: 'ī', Iogon: 'Į', iogon: 'į', inodot: 'ı', Jcirc: 'Ĵ', jcirc: 'ĵ',
  Lacute: 'Ĺ', lacute: 'ĺ', Lcaron: 'Ľ', lcaron: 'ľ', Nacute: 'Ń',
  nacute: 'ń', Ncaron: 'Ň', ncaron: 'ň', Ncedil: 'Ņ', ncedil: 'ņ',
  OElig: 'Œ', oelig: 'œ', Odblac: 'Ő', odblac: 'ő', Omacr: 'Ō', omacr: 'ō',
  Racute: 'Ŕ', racute: 'ŕ', Rcaron: 'Ř', rcaron: 'ř', Sacute: 'Ś',
  sacute: 'ś', Scaron: 'Š', scaron: 'š', Scedil: 'Ş', scedil: 'ş',
  Tcaron: 'Ť', tcaron: 'ť', Tcedil: 'Ţ', tcedil: 'ţ', Udblac: 'Ű',
  udblac: 'ű', Umacr: 'Ū', umacr: 'ū', Uring: 'Ů', uring: 'ů', Yuml: 'Ÿ',
  Zacute: 'Ź', zacute: 'ź', Zcaron: 'Ž', zcaron: 'ž', Zdot: 'Ż', zdot: 'ż',
  fnof: 'ƒ', circ: 'ˆ', tilde: '˜', ensp: ' ', emsp: ' ', thinsp: ' ',
  zwnj: '‌', zwj: '‍', lrm: '‎', rlm: '‏', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  dagger: '†', Dagger: '‡', permil: '‰', lsaquo: '‹', rsaquo: '›',
  euro: '€', bull: '•', hellip: '…', prime: '′', Prime: '″', oline: '‾',
  frasl: '⁄', weierp: '℘', image: 'ℑ', real: 'ℜ', trade: '™',
  alefsym: 'ℵ', larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔',
  forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇', isin: '∈',
  notin: '∉', ni: '∋', prod: '∏', sum: '∑', minus: '−', lowast: '∗',
  radic: '√', prop: '∝', infin: '∞', ang: '∠', and: '∧', or: '∨',
  cap: '∩', cup: '∪', int: '∫', there4: '∴', sim: '∼', cong: '≅',
  asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥', sub: '⊂', sup: '⊃',
  nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗', perp: '⊥',
  sdot: '⋅', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
  lang: '⟨', rang: '⟩', loz: '◊', spades: '♠', clubs: '♣', hearts: '♥',
  diams: '♦', Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε',
  Zeta: 'Ζ', Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ',
  Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ',
  Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigmaf: 'ς',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ',
  ClockwiseContourIntegral: '∲', DifferentialD: 'ⅆ', HilbertSpace: 'ℋ',
  ngE: '≧', nge: '≱', ngt: '≯', nle: '≰', nlt: '≮', lne: '⪇', gne: '⪈',
  colon: ':', comma: ',', period: '.', semi: ';', sol: '/', bsol: '\\',
  lpar: '(', rpar: ')', lsqb: '[', rsqb: ']', lcub: '{', rcub: '}',
  plus: '+', equals: '=', quest: '?', commat: '@', dollar: '$',
  percnt: '%', num: '#', ast: '*', lowbar: '_', grave: '`', Hat: '^',
  vert: '|', Tab: '\t', NewLine: '\n', fjlig: 'fj', ffilig: 'ffi',
  fflig: 'ff', filig: 'fi', fllig: 'fl', check: '✓', cross: '✗',
  star: '☆', phone: '☎', female: '♀', male: '♂', mldr: '…',
  horbar: '―', caret: '⁁', hybull: '⁃', caret2: '‸',
};

// ---------------------------------------------------------------------------
// Escaping and URLs
// ---------------------------------------------------------------------------

// Escape text content: & < > " ' — but leave a valid entity reference
// (&name; &#123; &#xAB;) untouched, as marked does for hrefs/titles.
function escText(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 38) { // &
      const ent = tryEntity(s, i);
      if (ent) { out += ent.val; i = ent.end; continue; }
      out += '&amp;'; i++;
    } else if (c === 60) { out += '&lt;'; i++; }
    else if (c === 62) { out += '&gt;'; i++; }
    else if (c === 34) { out += '&quot;'; i++; }
    else if (c === 39) { out += '&#39;'; i++; }
    else {
      let j = i + 1;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (d === 38 || d === 60 || d === 62 || d === 34 || d === 39) break;
        j++;
      }
      out += s.slice(i, j);
      i = j;
    }
  }
  return out;
}

// Escape for code spans / code blocks / attribute values that must escape
// every & (no entity preservation): & < > " '
function escRaw(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 38) { out += '&amp;'; i++; }
    else if (c === 60) { out += '&lt;'; i++; }
    else if (c === 62) { out += '&gt;'; i++; }
    else if (c === 34) { out += '&quot;'; i++; }
    else if (c === 39) { out += '&#39;'; i++; }
    else {
      let j = i + 1;
      while (j < n) {
        const d = s.charCodeAt(j);
        if (d === 38 || d === 60 || d === 62 || d === 34 || d === 39) break;
        j++;
      }
      out += s.slice(i, j);
      i = j;
    }
  }
  return out;
}

// Try to read an entity reference at s[i] (s[i] === '&').
// Returns {end, val} with val the replacement string, or null.
function tryEntity(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  const c1 = s.charCodeAt(i + 1);
  if (c1 === 35) { // # numeric
    let j = i + 2;
    let hex = false;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
    const start = j;
    while (j < n) {
      const d = s.charCodeAt(j);
      if (hex ? ((d >= 48 && d <= 57) || (d >= 65 && d <= 70) || (d >= 97 && d <= 102))
              : (d >= 48 && d <= 57)) j++;
      else break;
    }
    if (j === start || j >= n || s.charCodeAt(j) !== 59) return null; // no ; or empty
    const cp = parseInt(s.slice(start, j), hex ? 16 : 10);
    // out of range (>0x10FFFF) is not an entity at all: the '&' is escaped
    // (cm-028 &#87654321; -> &amp;#87654321;). 0 and surrogates -> U+FFFD.
    if (cp > 0x10FFFF) return null;
    const val = (!cp || (cp >= 0xD800 && cp <= 0xDFFF)) ? 0xFFFD : cp;
    return { end: j + 1, val: String.fromCodePoint(val), named: false };
  }
  // named: [A-Za-z0-9]{1,31} ; — marked preserves ANY alphanumeric name
  // as-is in the output (even MadeUpEntity / ThisIsNotDefined); it is NOT
  // decoded to a Unicode character. val is the literal reference.
  let j = i + 1;
  while (j < n && j - i <= 32) {
    const d = s.charCodeAt(j);
    if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57)) j++;
    else break;
  }
  if (j >= n || s.charCodeAt(j) !== 59) return null;
  if (j === i + 1) return null;
  return { end: j + 1, val: s.slice(i, j + 1), named: true };
}

// Does a line contain the type-1 HTML end tag </name> (case-insensitive,
// optional whitespace before '>')? Type-1 blocks (script/pre/style/
// textarea) end at the first line containing their end tag.
function htmlType1Ends(text, name) {
  const low = text.toLowerCase();
  const needle = '</' + name;
  let idx = low.indexOf(needle);
  while (idx >= 0) {
    let j = idx + needle.length;
    while (j < low.length && (low.charCodeAt(j) === 32 || low.charCodeAt(j) === 9)) j++;
    if (j < low.length && low.charCodeAt(j) === 62) return true;
    idx = low.indexOf(needle, idx + 1);
  }
  return false;
}

// marked's cleanUrl: percent-encode the destination (leaving already-encoded
// sequences alone), or null when it cannot be encoded.
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch (e) {
    return null;
  }
}

// Resolve backslash escapes (\X -> X for ASCII punctuation X).
// Resolve backslash escapes ONLY for \, [ and ] (label matching): a label
// '[foo\!]' does NOT match a def '[foo!]' (cm-545), but '[Foo*bar\]]'
// DOES match '[Foo*bar]' (cm-194) and '[bar\\]' matches '[bar\\]'
// (cm-550) — the backslash and bracket escapes are resolved because they
// delimit the label, other escapes stay literal.
function unescapeLabel(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 92 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d === 92 || d === 91 || d === 93) { out += s[i + 1]; i++; continue; }
    }
    out += s[i];
  }
  return out;
}

function unescapeStr(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 92 && i + 1 < s.length && isAsciiPunct(s.charCodeAt(i + 1))) { out += s[i + 1]; i++; }
    else out += s[i];
  }
  return out;
}

// Normalise a link label: collapse whitespace runs to one space, trim,
// case-fold.
function normalizeLabel(label) {
  let out = '';
  let ws = true;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (isWhitespaceCh(ch)) {
      if (!ws) { out += ' '; ws = true; }
    } else {
      out += ch;
      ws = false;
    }
  }
  if (ws && out.length > 0) out = out.slice(0, -1);
  // Unicode case folding: ß and ẞ both fold to "ss" (cm-540: [ẞ] == [SS])
  return out.replace(/ß/g, 'ss').replace(/ẞ/g, 'ss').toLowerCase();
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

// Block types
const T_DOC = 0, T_PARA = 1, T_HEAD = 2, T_CODE = 3, T_HTML = 4,
  T_QUOTE = 5, T_LIST = 6, T_ITEM = 7, T_TABLE = 8, T_HR = 9;

// One fixed-shape record for every block (V8 hidden-class discipline).
function blk(t) {
  return {
    t: t, level: 0, info: '', start: 0, delim: '', tight: true,
    indent: 0, marker: '', fence: '', fenceLen: 0, fenceInd: 0,
    htmlType: 0, endTag: '', trailNl: false, blankBefore: false, lines: null, children: null,
    aligns: null, head: null, rows: null,
  };
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param section source summary table tbody td tfoot th thead title tr track ul').split(' '));

// A line cursor: s = line string, i = char index, c = column, p = remaining
// width of a partially consumed tab (0 when none).
function ccur(cur) {
  if (cur.p > 0) return 32;
  return cur.i < cur.s.length ? cur.s.charCodeAt(cur.i) : -1;
}
// Advance n columns over whitespace (stops at a non-space char).
function adv(cur, n) {
  const s = cur.s;
  while (n > 0) {
    if (cur.p > 0) {
      // A partially consumed tab: consuming exactly the remainder must
      // also move past the tab char (doc-14: a tab split by a list-item
      // indent left pcur on the tab, so the fence check saw a tab instead
      // of the backtick). advOne already does this; adv must too.
      if (n <= cur.p) { cur.p -= n; cur.c += n; if (cur.p === 0) cur.i++; return; }
      n -= cur.p; cur.c += cur.p; cur.p = 0; cur.i++;
    } else if (cur.i >= s.length) {
      cur.c += n; return;
    } else {
      const ch = s.charCodeAt(cur.i);
      if (ch === 32) { cur.i++; cur.c++; n--; }
      else if (ch === 9) {
        const w = 4 - (cur.c & 3);
        if (n < w) { cur.p = w - n; cur.c += n; return; }
        cur.i++; cur.c += w; n -= w;
      } else return;
    }
  }
}
// Advance past the current character (a non-space marker such as '>' or a
// fence char). adv() only moves over whitespace, so markers need this.
function advOne(cur) {
  if (cur.p > 0) {
    cur.p--;
    cur.c++;
    if (cur.p === 0) cur.i++;
    return;
  }
  cur.i++;
  cur.c++;
}
// Columns of whitespace available from the cursor (no mutation).
function wsCols(cur, col) {
  const s = cur.s;
  let i = cur.i, c = col === undefined ? cur.c : col, p = cur.p, n = 0;
  if (p > 0) { n += p; i++; c += p; p = 0; }
  while (i < s.length) {
    const ch = s.charCodeAt(i);
    if (ch === 32) { n++; c++; i++; }
    else if (ch === 9) { const w = 4 - (c & 3); n += w; c += w; i++; }
    else break;
  }
  return n;
}
function isBlankAt(cur) {
  const s = cur.s;
  for (let i = cur.i; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch !== 32 && ch !== 9) return false;
  }
  return true;
}
// Remaining line content from the cursor; a partially consumed tab becomes
// spaces.
function rest(cur) {
  if (cur.p > 0) return ' '.repeat(cur.p) + cur.s.slice(cur.i + 1);
  return cur.s.slice(cur.i);
}
// Skip up to max columns of spaces/tabs; returns columns skipped.
function skipSpaces(cur, max) {
  let n = 0;
  while (n < max) {
    const ch = ccur(cur);
    if (ch === 32 || ch === 9) { adv(cur, 1); n++; }
    else break;
  }
  return n;
}

// Read a tag name starting at cur.i (cur.s[cur.i] === '<' or '</' prefix
// already consumed by caller). Returns the lowercased name or ''.
function readTagName(s, i) {
  let j = i;
  while (j < s.length) {
    const d = s.charCodeAt(j);
    if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 45) j++;
    else break;
  }
  return s.slice(i, j).toLowerCase();
}

// Classify an HTML block start at the cursor (cur.s[cur.i] === '<').
// Returns the HTML block type (1..7) or 0.
function htmlBlockType(cur) {
  const s = cur.s;
  let i = cur.i;
  if (s.charCodeAt(i) !== 60) return 0;
  i++;
  if (i >= s.length) return 0;
  const c = s.charCodeAt(i);
  if (c === 33) { // !
    if (s.startsWith('<!--', i - 1)) return 2;
    if (s.startsWith('<![CDATA[', i - 1)) return 5;
    if (i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if ((d >= 65 && d <= 90) || (d >= 97 && d <= 122)) return 4;
    }
    return 0;
  }
  if (c === 63) return 3; // <?
  if (c === 47) { // </
    const name = readTagName(s, i + 1);
    if (name === '') return 0;
    const after = i + 1 + name.length;
    const ac = after < s.length ? s.charCodeAt(after) : -1;
    if (ac === 32 || ac === 9 || ac === -1 || ac === 62 || (ac === 47 && s.charCodeAt(after + 1) === 62)) {
      if (BLOCK_TAGS.has(name)) return 6;
      // a closing tag is type 7 only when it is the whole line (cm-623)
      // and has no attributes (cm-624, via parseHtmlTag). Pass i (the
      // '/' position) so parseHtmlTag receives the '<'.
      if (isCompleteTagAlone(s, i)) return 7;
      return 0;
    }
    return 0;
  }
  if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
    const name = readTagName(s, i);
    const after = i + name.length;
    const ac = after < s.length ? s.charCodeAt(after) : -1;
    if (name === 'script' || name === 'pre' || name === 'style' || name === 'textarea') {
      if (ac === 32 || ac === 9 || ac === -1 || ac === 62) return 1;
      return 0;
    }
    if (ac === 32 || ac === 9 || ac === -1 || ac === 62 || (ac === 47 && s.charCodeAt(after + 1) === 62)) {
      if (BLOCK_TAGS.has(name)) return 6;
      // type 7: complete tag alone on the line
      if (isCompleteTagAlone(s, i)) return 7;
      return 0;
    }
    return 0;
  }
  return 0;
}
// A complete open tag (or close tag) alone on the line, only whitespace
// after its closing '>'. The tag itself must be valid (attribute names
// included, cm-619: <a h*#ref="hi"> is not a tag), so this delegates to
// parseHtmlTag and checks that only whitespace follows the tag.
function isCompleteTagAlone(s, i) {
  const tag = parseHtmlTag(s, i - 1);
  if (!tag || tag.name === '') return false;
  for (let k = tag.end; k < s.length; k++) {
    const d = s.charCodeAt(k);
    if (d !== 32 && d !== 9) return false;
  }
  return true;
}

// Expand tabs in a code-block content line to spaces, by absolute
// column (a tab advances to the next multiple of 4). The first char of
// str is at column startCol. Only applied when the code block sits
// inside a container (list/blockquote): at the top level a tab in code
// content is kept literally (probed), but inside a container a leading
// tab expands by absolute column (doc-01/03: tab at col 13 -> 3 spaces,
// col 5 -> 3 spaces, col 2 -> 2 spaces). Fast path: no tab, as-is.
function expandTabs(str, startCol) {
  if (str.indexOf('\t') < 0) return str;
  let out = '';
  let col = startCol;
  for (let k = 0; k < str.length; k++) {
    const ch = str.charCodeAt(k);
    if (ch === 9) {
      const spaces = 4 - (col % 4);
      out += '    '.slice(0, spaces);
      col += spaces;
    } else {
      out += str[k];
      col++;
    }
  }
  return out;
}

// Expand tabs in the LEADING whitespace of s to spaces, based on absolute
// columns starting at startCol. Tabs after the first non-whitespace char
// stay literal (marked quirk: 'x\tb' keeps its tab, but a leading tab in a
// container is expanded — doc-09/13/17/29/32/40).
function expandLeadTabs(s, startCol) {
  let i = 0;
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  if (i === 0) return s;
  const lead = s.slice(0, i);
  if (lead.indexOf('\t') < 0) return s;
  return expandTabs(lead, startCol) + s.slice(i);
}

// Does the line (from cur, after up to 3 spaces) look like a table
// delimiter row? Returns the alignments array or null.
function tableDelimiter(cur) {
  const s = cur.s;
  let i = cur.i;
  // skip leading spaces (up to 3 already handled by caller positioning)
  while (i < s.length && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
  const cells = [];
  let cellStart = i;
  let hasPipe = false;
  // Split on unescaped | ; a leading/trailing | makes an empty edge cell.
  let j = i;
  let cell = '';
  while (j <= s.length) {
    const ch = j < s.length ? s.charCodeAt(j) : -1;
    if (ch === 92 && j + 1 < s.length) { cell += s[j] + s[j + 1]; j += 2; continue; }
    if (ch === 124 || ch === -1) {
      cells.push(cell);
      cell = '';
      if (ch === 124) hasPipe = true;
      j++;
      continue;
    }
    cell += s[j];
    j++;
  }
  if (!hasPipe) return null;
  // Drop empty edge cells from leading/trailing pipes.
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  if (cells.length === 0) return null;
  const aligns = [];
  for (let k = 0; k < cells.length; k++) {
    const t = cells[k].trim();
    const m = /^:?-+:?$/.exec(t);
    if (!m) return null;
    const left = t.charCodeAt(0) === 58;
    const right = t.charCodeAt(t.length - 1) === 58;
    aligns.push(left && right ? 'center' : right ? 'right' : left ? 'left' : null);
  }
  return aligns;
}

// Split a table row line into cells (raw strings, unescaped \| kept).
function splitRow(line) {
  const cells = [];
  let cell = '';
  let j = 0;
  const n = line.length;
  while (j < n) {
    const ch = line.charCodeAt(j);
    if (ch === 92 && j + 1 < n && line.charCodeAt(j + 1) === 124) { cell += '|'; j += 2; continue; }
    if (ch === 92 && j + 1 < n) { cell += line[j] + line[j + 1]; j += 2; continue; }
    if (ch === 124) { cells.push(cell); cell = ''; j++; continue; }
    cell += line[j];
    j++;
  }
  cells.push(cell);
  // Drop empty edge cells from leading/trailing pipes.
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

// ---------------------------------------------------------------------------
// Link reference definitions (parsed from the start of a paragraph)
// ---------------------------------------------------------------------------

// Parse a link title at s[j] ('"' or '\'' or '('). Returns {title, end}
// or null. The title may not contain a line ending.
function parseTitleAt(s, j) {
  const n = s.length;
  const tc = s.charCodeAt(j);
  const closer = tc === 40 ? 41 : tc;
  let k = j + 1;
  let t = '';
  let td = 0;
  while (k < n) {
    const ch = s.charCodeAt(k);
    if (ch === 92 && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) { t += s[k + 1]; k += 2; continue; }
    if (tc === 40 && ch === 40) { td++; t += s[k]; k++; continue; }
    if (ch === closer) {
      if (tc === 40 && td > 0) { td--; t += s[k]; k++; continue; }
      return { title: t, end: k + 1 };
    }
    // a title may span lines, but not a blank line (cm-196)
    if (ch === 10) {
      let m = k + 1;
      while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9)) m++;
      if (m < n && s.charCodeAt(m) === 10) return null;
      if (m >= n) return null;
    }
    t += s[k];
    k++;
  }
  return null;
}

// Parse one definition at s[pos..]. Returns {end, label, href, title} or
// null. The definition must end at a line end (only spaces/tabs after the
// title, or after the destination when there is no title).
function parseDef(s, pos) {
  const n = s.length;
  let i = pos;
  // up to 3 spaces of indent
  let ind = 0;
  while (i < n && s.charCodeAt(i) === 32 && ind < 3) { i++; ind++; }
  if (i >= n || s.charCodeAt(i) !== 91) return null; // [
  i++;
  // label: no unescaped [ or ], 1..999 chars (newlines allowed: they are
  // collapsed by normalisation). Only \\, \[ and \] resolve here — the
  // same rule as unescapeLabel (cm-545, cm-550, cm-194).
  let label = '';
  let closed = false;
  while (i < n) {
    const ch = s.charCodeAt(i);
    if (ch === 92 && i + 1 < n) {
      const d = s.charCodeAt(i + 1);
      if (d === 92 || d === 91 || d === 93) { label += s[i + 1]; i += 2; continue; }
    }
    if (ch === 93) { closed = true; i++; break; }
    if (ch === 91) return null;
    label += s[i];
    i++;
    if (label.length > 999) return null;
  }
  // the label must be non-empty AFTER normalisation (cm-550: "[\n ]" is empty)
  if (!closed || normalizeLabel(label) === '') return null;
  if (i >= n || s.charCodeAt(i) !== 58) return null; // :
  i++;
  // whitespace (incl. newlines) before the destination
  while (i < n && isSpace(s.charCodeAt(i))) i++;
  if (i >= n) return null;
  // destination (backslash escapes resolved)
  let href = '';
  if (s.charCodeAt(i) === 60) { // <...>
    i++;
    while (i < n) {
      const ch = s.charCodeAt(i);
      if (ch === 62) break;
      if (ch === 60 || ch === 10) return null;
      if (ch === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) { href += s[i + 1]; i += 2; continue; }
      href += s[i];
      i++;
    }
    if (i >= n || s.charCodeAt(i) !== 62) return null;
    i++;
  } else {
    // bare destination: no spaces/control, balanced parens, escapes ok
    let depth = 0;
    const start = i;
    while (i < n) {
      const ch = s.charCodeAt(i);
      if (isSpace(ch)) break;
      if (ch === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) { href += s[i + 1]; i += 2; continue; }
      if (ch === 40) depth++;
      else if (ch === 41) {
        if (depth === 0) break;
        depth--;
      } else if (ch < 32) return null;
      href += s[i];
      i++;
    }
    if (i === start && href === '') return null;
  }
  // After the destination: spaces/tabs on this line, then optionally a
  // title. A title must be preceded by whitespace.
  let j = i;
  while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
  // title on the same line
  if (j > i && j < n && (s.charCodeAt(j) === 34 || s.charCodeAt(j) === 39 || s.charCodeAt(j) === 40)) {
    const t = parseTitleAt(s, j);
    if (!t) return null; // malformed title on the destination line: no def
    j = t.end;
    while (j < n && (s.charCodeAt(j) === 32 || s.charCodeAt(j) === 9)) j++;
    if (j < n && s.charCodeAt(j) !== 10) return null;
    return { end: j < n ? j + 1 : j, label, href, title: t.title };
  }
  // no title on this line: the definition ends at the line end; a title
  // may follow on the next line, but a malformed one there only drops the
  // title (the definition itself still stands)
  if (j < n && s.charCodeAt(j) === 10) {
    let k = j + 1;
    while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9)) k++;
    if (k < n && (s.charCodeAt(k) === 34 || s.charCodeAt(k) === 39 || s.charCodeAt(k) === 40)) {
      const t = parseTitleAt(s, k);
      if (t) {
        let m = t.end;
        while (m < n && (s.charCodeAt(m) === 32 || s.charCodeAt(m) === 9)) m++;
        if (m >= n || s.charCodeAt(m) === 10) {
          return { end: m < n ? m + 1 : m, label, href, title: t.title };
        }
      }
      // malformed / junk-followed title on the next line: no title
    }
    return { end: j + 1, label, href, title: null };
  }
  if (j >= n) return { end: j, label, href, title: null };
  return null;
}

// ---------------------------------------------------------------------------
// The block parser
// ---------------------------------------------------------------------------

function parseBlocks(src) {
  const refs = new Map();
  const srcNl = src.replace(/\r\n?/g, '\n');
  const srcEndsWithNl = srcNl.length > 0 && srcNl.charCodeAt(srcNl.length - 1) === 10;
  const lines = srcNl.split('\n');
  // A trailing newline does not create an extra (empty) line: "a\n" is
  // one line, not ["a", ""]. Without this, fenced/indented code blocks
  // gain a phantom trailing blank line (cm-126/127/137/139).
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const doc = blk(T_DOC);
  doc.children = [];
  const stack = [doc]; // open containers (doc, quote, list, item)
  let leaf = null; // open leaf block (para/code/html/table) or null
  // True when the last paragraph line added was an indented (4+ cols
  // beyond the item content) continuation inside a list item. The next
  // line then cannot lazily continue the paragraph (doc-08/probe26:
  // '* a' + '      b' + 'c' ends the list; 'c' is a top-level paragraph).
  // Cleared whenever a non-indented paragraph line is added or a new
  // paragraph starts.
  let lastParaIndented = false;
  // True when a blank line just closed an EMPTY list item (cm-280). A
  // second consecutive blank line then also closes the list itself, so
  // a following list marker starts a NEW list (probe33/doc-13: '+\n\n\n+'
  // is two <ul>s; '+\n\n+' is one). Cleared on any non-blank line.
  let closedEmptyItem = false;
  let pendingBlank = false;
  let pendingBlankDepth = 0; // container depth at which the blank occurred

  function addChild(parent, b) {
    // a blank line applies only if this block's parent is at least as
    // deep as the blank's parent level: a blank inside a blockquote in
    // an item does not loosen the list (cm-320), but a blank between
    // items at the list's level does (cm-317)
    b.blankBefore = pendingBlank && (stack.length >= pendingBlankDepth);
    b.blankDepth = pendingBlankDepth;
    pendingBlank = false;
    pendingBlankDepth = 0;
    parent.children.push(b);
    return b;
  }
  function top() { return stack[stack.length - 1]; }
  // A block that is not a list item cannot be a direct child of a list
  // (a list holds only items): a thematic break / heading / fence / HTML
  // block / paragraph at the list's level closes the list first (cm-057).
  // Does the line at cursor c start a block that can interrupt a paragraph
  // (thematic break, ATX, fenced code, HTML block, list item, blockquote)?
  // Used for lazy continuation: such a line is NOT a lazy paragraph line.
  function startsInterrupt(c) {
    const p = { s: c.s, i: c.i, c: c.c, p: c.p };
    let ind = 0;
    while (ind < 3) {
      const ch = ccur(p);
      if (ch === 32) { adv(p, 1); ind++; }
      else if (ch === 9) { const w = 4 - (p.c % 4); adv(p, w); ind += w; }
      else break;
    }
    if (ind >= 4) return false;
    const ch = ccur(p);
    if (ch === -1) return false;
    if (ch === 62) return true; // blockquote
    if (ch === 42 || ch === 45 || ch === 95) { // thematic break
      let j = p.i, n = 0, ok = true;
      while (j < p.s.length) {
        const d = p.s.charCodeAt(j);
        if (d === ch) { n++; j++; }
        else if (d === 32 || d === 9) j++;
        else { ok = false; break; }
      }
      if (ok && n >= 3) return true;
    }
    if (ch === 35) { // ATX
      let j = p.i, n = 0;
      while (j < p.s.length && p.s.charCodeAt(j) === 35) { n++; j++; }
      if (n >= 1 && n <= 6) {
        const after = j < p.s.length ? p.s.charCodeAt(j) : -1;
        if (after === -1 || after === 32 || after === 9) return true;
      }
    }
    if (ch === 96 || ch === 126) { // fenced code
      let j = p.i, n = 0;
      while (j < p.s.length && p.s.charCodeAt(j) === ch) { n++; j++; }
      if (n >= 3) {
        if (ch === 96 && p.s.slice(j).indexOf('`') >= 0) return false;
        return true;
      }
    }
    if (ch === 60) return htmlBlockType(p) !== 0; // HTML block
    // list item (bullet, or ordered starting at 1) — an empty item
    // interrupts too (cm-281: '- foo\n-\n- bar' is three items)
    if (ch === 42 || ch === 43 || ch === 45) {
      let j = p.i + 1;
      if (j >= p.s.length) return true; // empty bullet item
      if (p.s.charCodeAt(j) === 32 || p.s.charCodeAt(j) === 9) {
        j++;
        while (j < p.s.length && (p.s.charCodeAt(j) === 32 || p.s.charCodeAt(j) === 9)) j++;
        return true; // content, or an empty item with trailing spaces
      }
    }
    if (ch >= 48 && ch <= 57) {
      let j = p.i;
      while (j < p.s.length && p.s.charCodeAt(j) >= 48 && p.s.charCodeAt(j) <= 57) j++;
      if (j - p.i >= 1 && j - p.i <= 9) {
        if (j >= p.s.length) return false; // bare number, no delimiter
        const d = p.s.charCodeAt(j);
        if (d === 46 || d === 41) {
          const num = parseInt(p.s.slice(p.i, j), 10);
          if (num === 1) {
            let k = j + 1;
            if (k >= p.s.length) return true; // empty ordered item '1.'
            if (p.s.charCodeAt(k) === 32 || p.s.charCodeAt(k) === 9) return true;
          }
        }
      }
    }
    return false;
  }

  // An HTML block ending at line li gets a trailing \n iff the next source
  // line is not truly empty, or it ends at EOF and the source ends with \n.
  // A whitespace-only next line does NOT suppress the newline (marked
  // quirk, doc-15/19: '<!-- -->\n\t\nbar' -> '-->\n<p>bar</p>'); only a
  // zero-length next line does.
  function htmlTrailNl(li) {
    if (li + 1 < lines.length) {
      return lines[li + 1].length !== 0;
    }
    return srcEndsWithNl;
  }

  function closeListIfTop() {
    if (stack.length > 1 && top().t === T_LIST) {
      const l = stack.pop();
      finalizeContainer(l);
    }
  }

  function finalizeLeaf() {
    if (!leaf) return;
    if (leaf.t === T_PARA) {
      // Strip trailing blank lines are already excluded (blank lines close
      // paragraphs). Extract leading link reference definitions.
      const text = leaf.lines.join('\n');
      let pos = 0;
      let first = true;
      while (true) {
        const d = parseDef(text, pos);
        if (!d) break;
        const key = normalizeLabel(unescapeLabel(d.label));
        if (!refs.has(key)) refs.set(key, { href: d.href, title: d.title });
        pos = d.end;
        first = false;
      }
      if (!first) {
        const restText = text.slice(pos);
        if (isBlankStr(restText)) {
          // paragraph was only definitions: drop it. The blank line
          // before it still counts for the next block (cm-317: a blank
          // before [ref] makes the list loose), so restore pendingBlank.
          const parent = leafParent(leaf);
          if (parent) {
            const idx = parent.children.indexOf(leaf);
            if (idx >= 0) parent.children.splice(idx, 1);
          }
          // restore exactly the blank this paragraph consumed (cm-317:
          // a blank before [ref] still makes the list loose)
          pendingBlank = leaf.blankBefore;
          pendingBlankDepth = leaf.blankDepth || 0;
          leaf = null;
          return;
        }
        leaf.lines = restText.split('\n');
      }
    } else if (leaf.t === T_CODE && leaf.fence === '') {
      // indented code: strip trailing blank lines
      while (leaf.lines.length > 0 && leaf.lines[leaf.lines.length - 1] === '') {
        leaf.lines.pop();
      }
    } else if (leaf.t === T_CODE) {
      // fenced code: strip exactly ONE trailing blank line (cm-318:
      // b + 2 blanks -> 'b\n\n'; b + 1 blank -> 'b\n')
      if (leaf.lines.length > 0 && leaf.lines[leaf.lines.length - 1] === '') {
        leaf.lines.pop();
      }
    }
    leaf = null;
  }
  // The parent of a leaf is the deepest open container.
  function leafParent() { return top(); }

  // marked quirk (doc-02/09): a list strips trailing spaces/tabs from the
  // last line of its last item — the last paragraph's last line, recursing
  // into a trailing blockquote or nested list, never into code/HTML. A
  // non-last item, a middle line, a blockquote, or a top-level paragraph
  // keeps its trailing spaces ('- foo   \n- bar' keeps 'foo   ').
  function stripTrailOf(b) {
    if (b.t === T_PARA) {
      const ls = b.lines;
      if (ls && ls.length > 0) {
        const last = ls[ls.length - 1];
        let e = last.length;
        while (e > 0 && (last.charCodeAt(e - 1) === 32 || last.charCodeAt(e - 1) === 9)) e--;
        if (e < last.length) ls[ls.length - 1] = last.slice(0, e);
      }
      return;
    }
    if (b.t === T_ITEM || b.t === T_QUOTE) {
      const ch = b.children;
      if (ch && ch.length > 0) stripTrailOf(ch[ch.length - 1]);
      return;
    }
    if (b.t === T_LIST) {
      const items = b.children;
      if (items && items.length > 0) stripTrailOf(items[items.length - 1]);
      return;
    }
    // code / html / table / head / hr: no text line to strip
  }

  function finalizeContainer(b) {
    if (b.t === T_LIST) {
      // loose if any item (not the first) was preceded by a blank line, or
      // any item holds a non-first child preceded by a blank line.
      let loose = false;
      const items = b.children;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (i > 0 && it.blankBefore) loose = true;
        const ch = it.children || [];
        for (let j = 1; j < ch.length; j++) {
          if (ch[j].blankBefore) loose = true;
        }
      }
      b.tight = !loose;
      if (items.length > 0) stripTrailOf(items[items.length - 1]);
    }
  }
  function closeTo(depth) {
    finalizeLeaf();
    while (stack.length > depth) {
      const b = stack.pop();
      finalizeContainer(b);
    }
  }

  // (EOF handling is after the loop; see below.)
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const cur = { s: raw, i: 0, c: 0, p: 0 };

    // ---- Phase A: continue open containers (outer to inner) ----
    // bqExtra: columns stripped by blockquote markers OTHER than the
    // innermost. For tab expansion in fenced code, marked aligns tab stops
    // as if only the innermost '>' existed (doc-05/09/19: '> > \tX' gives
    // 2 spaces, not 4) — so the outer markers' width is subtracted from
    // the expansion column in Phase C.
    // contTotal/contLast generalize this to ALL containers (list items
    // included): contTotal is the sum of the widths of every container
    // matched on this line, contLast the innermost one's width. The
    // effective tab column is cur.c - (contTotal - contLast) — the column
    // as if only the innermost container existed (doc-08: '  > \tX'
    // inside a list item expands the tab to 2 spaces, not 4).
    let k = 1;
    let bqTotal = 0, bqLast = 0;
    let contTotal = 0, contLast = 0;
    while (k < stack.length) {
      const b = stack[k];
      const si = cur.i, sc = cur.c, sp = cur.p;
      if (b.t === T_QUOTE) {
        const bc0 = cur.c;
        skipSpaces(cur, 3);
        if (ccur(cur) === 62) {
          advOne(cur);
          const ch = ccur(cur);
          if (ch === 32) adv(cur, 1);
          else if (ch === 9) {
            // A tab after '>' is the optional single space, but its
            // width is measured at the EFFECTIVE column (as if only
            // this innermost blockquote existed), not the absolute
            // column: in a list item, '  >\tX' has the tab at absolute
            // col 3 (width 1) but effective col 1 (width 3), so
            // consuming 1 leaves 2 spaces (doc-08/doc-30). contTotal
            // here is still the OUTER containers' widths (this
            // blockquote not yet added), so the effective column is
            // cur.c - contTotal.
            const effCol = cur.c - contTotal;
            const w = 4 - (effCol & 3);
            if (w > 1) { cur.p = w - 1; cur.c += 1; }
            else { cur.i++; cur.c += 1; }
          }
          const w = cur.c - bc0;
          bqTotal += w; bqLast = w;
          contTotal += w; contLast = w;
          k++;
        } else {
          cur.i = si; cur.c = sc; cur.p = sp;
          break;
        }
      } else if (b.t === T_ITEM) {
        if (isBlankAt(cur)) {
          // A blank line inside an item still consumes the item indent
          // (up to the whitespace available), so later stages see the
          // content position, not the raw line start (doc-08: a ' '
          // blank line in a ```go fence inside an item contributes an
          // empty line, not ' ').
          const need = b.indent;
          if (need > 0) {
            const avail = wsCols(cur);
            adv(cur, Math.min(avail, need));
            contTotal += Math.min(avail, need); contLast = Math.min(avail, need);
          }
          k++; continue;
        }
        const need = b.indent;
        if (need <= 0) { k++; continue; }
        if (wsCols(cur) >= need) { adv(cur, need); contTotal += need; contLast = need; k++; }
        else {
          // A col-0 plain-text line stays inside the item when the
          // item's last child is an EMPTY block (probe39/doc-19: '+ a'
          // + '  >' + 'tab' keeps 'tab' in the item; '+ 4.' + 'tab'
          // too). An empty block does not close the item — the line
          // becomes a paragraph in it (Phase D). A block with content
          // DOES close the item ('+  > x' + 'tab' is outside; '+ 4. x'
          // + 'tab' is outside). Empty means: a quote with no children,
          // a quote holding only an empty fence, or a list with no
          // items / all items empty.
          const ch = b.children || [];
          const last = ch.length > 0 ? ch[ch.length - 1] : null;
          let lastEmpty = false;
          if (last) {
            if (last.t === T_QUOTE) {
              if (!last.children || last.children.length === 0) lastEmpty = true;
              else if (last.children.length === 1 && last.children[0].t === T_CODE && (!last.children[0].lines || last.children[0].lines.length === 0)) lastEmpty = true;
            } else if (last.t === T_LIST) {
              if (!last.children || last.children.length === 0) lastEmpty = true;
              else lastEmpty = last.children.every(it => !it.children || it.children.length === 0);
            }
          }
          if (!isBlankAt(cur) && !startsInterrupt(cur) && lastEmpty) { k++; continue; }
          break;
        }
      } else {
        k++; // list: no marker of its own
      }
    }
    // Lazy continuation: if a container didn't match but the open leaf is
    // a paragraph and the line is not blank and doesn't start an
    // interrupting block, the line continues the paragraph lazily (the
    // containers stay open; the line is appended in the lazy step below).
    // lazyIndent is the first unmatched container's indent (an item's
    // content indent; 0 for a blockquote) — the lazy step strips leading
    // whitespace against it.
    let lazyLine = false;
    let lazyIndent = 0;
    let lazyInQuote = false;
    if (k < stack.length) {
      // A line starting a list marker is not a lazy continuation when a
      // list is open: it is a sibling item (cm-283: '2.') or a new list
      // with a different delimiter (cm-302: '3)').
      let listMarkerHere = false;
      if (leaf && leaf.t === T_PARA) {
        const p2 = { s: cur.s, i: cur.i, c: cur.c, p: cur.p };
        let ind2 = 0;
        while (ind2 < 3) {
          const ch2 = ccur(p2);
          if (ch2 === 32) { adv(p2, 1); ind2++; }
          else if (ch2 === 9) { const w2 = 4 - (p2.c % 4); adv(p2, w2); ind2 += w2; }
          else break;
        }
        if (ind2 < 4) {
          // A line starting a list marker is not a lazy continuation:
          // it closes the open containers and starts a list (or a
          // sibling item). Any starting number counts ('2.' after a
          // blockquote starts <ol start="2">, doc-40) — the 'starts
          // with 1' rule only governs interrupting a paragraph at the
          // same level (cm-283 'Foo\n2. bar' is still one paragraph).
          // Verify the full marker so '2 apples' still continues lazily.
          const ch2 = ccur(p2);
          if (ch2 === 42 || ch2 === 43 || ch2 === 45) {
            const nx = p2.i + 1 < p2.s.length ? p2.s.charCodeAt(p2.i + 1) : -1;
            if (nx === -1 || nx === 32 || nx === 9) listMarkerHere = true;
          } else if (ch2 >= 48 && ch2 <= 57) {
            let j = p2.i;
            while (j < p2.s.length && p2.s.charCodeAt(j) >= 48 && p2.s.charCodeAt(j) <= 57) j++;
            if (j - p2.i >= 1 && j - p2.i <= 9 && j < p2.s.length) {
              const d = p2.s.charCodeAt(j);
              if (d === 46 || d === 41) {
                const nx = j + 1 < p2.s.length ? p2.s.charCodeAt(j + 1) : -1;
                if (nx === -1 || nx === 32 || nx === 9) listMarkerHere = true;
              }
            }
          }
        }
      }
      // A line starting with 3+ backticks whose info contains a backtick
      // is not a valid fence, but it still does NOT lazily continue a
      // list item's paragraph (marked/doc-06: '- item' + '```inner
      // backticks```' ends the list; the line becomes a top-level
      // paragraph with a code span). At top level the same line DOES
      // lazily continue ('para' + '```inner backticks```' is one
      // paragraph), so this only applies inside a list item. (A valid
      // fence opener still opens a fence inside the item; a tilde
      // fence line is unaffected — tilde info may contain tildes.)
      let badBacktickFence = false;
      if (stack[k].t === T_ITEM) {
        let j = cur.i;
        while (j < cur.s.length && (cur.s.charCodeAt(j) === 32 || cur.s.charCodeAt(j) === 9)) j++;
        let n = 0;
        while (j < cur.s.length && cur.s.charCodeAt(j) === 96) { n++; j++; }
        if (n >= 3 && cur.s.slice(j).indexOf('`') >= 0) badBacktickFence = true;
      }
      if (leaf && leaf.t === T_PARA && !isBlankAt(cur) && !startsInterrupt(cur) && !listMarkerHere && !badBacktickFence && !lastParaIndented) {
        lazyLine = true;
        const fb = stack[k];
        lazyIndent = fb.t === T_ITEM ? fb.indent : 4;
        lazyInQuote = fb.t === T_QUOTE;
      } else if (leaf && leaf.t === T_CODE && leaf.fence !== '' && stack[k].t === T_ITEM && !isBlankAt(cur) && leaf.hasContent) {
        // A list item marker at the list's level ENDS the fence and
        // starts a new item (probe34/doc-13: the '+' line after a
        // content-ful ```` fence is a sibling item, not code content).
        // Plain text lines are still fence content (doc-02).
        let lineIsListMarker = false;
        {
          const ch = ccur(cur);
          if (ch === 42 || ch === 43 || ch === 45) {
            const nx = cur.i + 1 < cur.s.length ? cur.s.charCodeAt(cur.i + 1) : -1;
            if (nx === -1 || nx === 32 || nx === 9) lineIsListMarker = true;
          } else if (ch >= 48 && ch <= 57) {
            let j = cur.i;
            while (j < cur.s.length && cur.s.charCodeAt(j) >= 48 && cur.s.charCodeAt(j) <= 57) j++;
            if (j - cur.i >= 1 && j - cur.i <= 9 && j < cur.s.length) {
              const d = cur.s.charCodeAt(j);
              if (d === 46 || d === 41) {
                const nx = j + 1 < cur.s.length ? cur.s.charCodeAt(j + 1) : -1;
                if (nx === -1 || nx === 32 || nx === 9) lineIsListMarker = true;
              }
            }
          }
        }
        if (lineIsListMarker) {
          closeTo(k);
        } else {
        // Fenced code inside a list item: once the block HAS content, a
        // non-indented line does NOT close the item — it is code content
        // (marked/doc-02: the 'function f(a, b) {' line at col 0 stays
        // inside the item's ```css block, and the ```inner backticks```
        // line after it too). The containers stay open; Phase C adds the
        // line as content (stripping up to fenceInd). An EMPTY code block
        // does NOT absorb: a non-indented line closes it (marked/doc-38:
        // 'branch deno html' after an empty ```bash block is a paragraph,
        // the block stays empty). A closing fence — even at col 0 —
        // still closes, via closeTo below (a col-0 fence closes the
        // in-list block and opens a new top-level fence). A blockquote's
        // '>' IS required: a line without it closes, unchanged.
        const sv = { i: cur.i, c: cur.c, p: cur.p };
        skipSpaces(cur, 3);
        const fc = ccur(cur);
        let closes = false;
        if (fc === leaf.fence.charCodeAt(0)) {
          let n = 0;
          while (ccur(cur) === fc) { advOne(cur); n++; }
          if (n >= leaf.fenceLen && isBlankAt(cur)) closes = true;
        }
        cur.i = sv.i; cur.c = sv.c; cur.p = sv.p;
        if (closes) closeTo(k);
        // else: leave the containers open; Phase C handles the line.
        } // end else (not a list marker)
      } else {
        // An EMPTY fence that absorbed blank lines (hasContent false,
        // but lines non-empty) — closing it leaves a blank separator
        // behind (probe34/doc-13: the blank between the empty fence
        // and the next item makes the list loose).
        if (leaf && leaf.t === T_CODE && leaf.fence !== '' && !leaf.hasContent && leaf.lines && leaf.lines.length > 0) {
          pendingBlank = true;
          pendingBlankDepth = 1;
        }
        closeTo(k);
      }
    }

    // ---- Phase B: blank line ----
    // Blankness: if a container was matched (k > 1), the line is blank
    // only when NOTHING is left after its prefix — a space left after
    // '>' is paragraph content (cm-241: '>  ' continues with ' '), while
    // '>' alone is blank. With no container matched, a whitespace-only
    // line is blank.
    const lineBlank = isBlankStr(cur.s) || ((k > 1) ? (cur.i >= cur.s.length) : isBlankAt(cur));
    // A whitespace-only line of exactly 4 columns ending in a tab is an
    // empty table row, not a blank line (marked quirk, doc-13/26/33:
    // '\t' after a table row adds an empty <tr>). It needs a body row
    // already and a terminating newline (a trailing tab line with no
    // '\n' is blank).
    if (lineBlank && leaf && leaf.t === T_TABLE && leaf.rows.length > 0) {
      if (wsCols(cur) === 4 && cur.s.length > 0 && cur.s.charCodeAt(cur.s.length - 1) === 9) {
        if (li < lines.length - 1 || srcEndsWithNl) {
          leaf.rows.push([]);
          continue;
        }
      }
    }
    // A second consecutive blank line after an empty item was closed
    // also closes the list itself (probe33/doc-13). This check runs
    // BEFORE the cm-280 close below, so the flag set by THIS blank
    // line is only acted upon by the NEXT blank line.
    if (lineBlank && closedEmptyItem && stack.length > 1 && top().t === T_LIST) {
      const lst = stack.pop();
      finalizeContainer(lst);
      closedEmptyItem = false;
    }
    // A blank line closes an EMPTY list item (cm-280: '-\n\n  foo' — the
    // foo is a separate paragraph, not item content). A non-empty item
    // stays open (its next paragraph makes the list loose).
    if (lineBlank && stack.length > 1 && top().t === T_ITEM && top().children.length === 0) {
      const it = stack.pop();
      finalizeContainer(it);
      closedEmptyItem = true;
    }
    if (lineBlank) {
      if (leaf && leaf.t === T_CODE && leaf.fence !== '') {
        // fenced code: a whitespace-only line keeps its spaces, minus the
        // fence indent (cm-129: "  " stays "  ")
        const strip = Math.min(wsCols(cur), leaf.fenceInd);
        adv(cur, strip);
        // BACKTICK fences only (tilde fences strip nothing): a tab
        // straddling the strip boundary is consumed ENTIRELY
        // (probe35/doc-14: a '\t' line in a fence indented 1 leaves an
        // empty line, not 3 spaces). Same rule as Phase C.
        if (leaf.fence.charCodeAt(0) !== 126 && cur.p > 0) { cur.c += cur.p; cur.p = 0; cur.i++; }
        leaf.lines.push(rest(cur));
      } else if (leaf && leaf.t === T_CODE) {
        // indented code: a whitespace-only line keeps the spaces beyond
        // the 4-column indent (cm-112: 6 spaces -> "  ")
        const strip = Math.min(wsCols(cur), 4);
        adv(cur, strip);
        leaf.lines.push(rest(cur));
      } else if (leaf && leaf.t === T_HTML && leaf.htmlType >= 1 && leaf.htmlType <= 5) {
        // types 1-5 continue through blank lines (type 1 ends only at its
        // end tag; types 2-5 at their own end markers)
        leaf.lines.push('');
      } else {
        // When the last paragraph line was indented (lastParaIndented),
        // a blank line does NOT close the paragraph: the next indented
        // line continues it, separated by a blank line in the output
        // (probe38/doc-19: '+ y_2_.' + '      support?' + blank +
        // '    \tindented' is one paragraph, not a code block). Keep
        // the leaf open so Phase D step 9 can continue it.
        if (!(lastParaIndented && leaf && leaf.t === T_PARA)) finalizeLeaf();
        pendingBlank = true;
        // the blank's parent level. A truly empty/whitespace-only line
        // is a blank at the outermost level (depth 1) — it separates
        // blocks at any depth (cm-325: a blank between a nested list
        // and 'baz' in the outer item makes the outer list loose). A
        // line with a container marker ('>') is a blank inside that
        // container: its parent level is k-1 (cm-320).
        pendingBlankDepth = isBlankStr(cur.s) ? 1 : Math.max(1, k - 1);
      }
      continue;
    }

    // ---- Lazy continuation step ----
    if (lazyLine) {
      // The line continues the open paragraph. It cannot be a setext
      // underline or a table delimiter. Leading whitespace is stripped
      // against the unmatched container's indent: a line with >= 4
      // leading columns loses min(lead, indent) (the indented-code
      // threshold), a shorter line loses the indent only if it has all
      // of it (cm-291: 4 spaces lost, 3 kept; '- foo' + '   bar' loses 2).
      // The strip applies ONLY to the FIRST continuation line when the
      // unmatched container is a BLOCKQUOTE (when the paragraph has
      // exactly 1 line so far). A later continuation in a blockquote
      // keeps its leading spaces as literal content (probe47/doc-40:
      // '> a' + 'x' + '    b' keeps '    b'; '> a' + '    b' strips to
      // 'b' because it is the first continuation). In other containers
      // (list items) the strip applies on every continuation (doc-22).
      const lead = wsCols(cur);
      let strip = 0;
      if (!lazyInQuote || leaf.lines.length === 1) {
        if (lead >= 4) strip = Math.min(lead, lazyIndent);
        else if (lead >= lazyIndent) strip = lazyIndent;
      }
      if (strip > 0) adv(cur, strip);
      // A lazy '=' underline is padded to 4 spaces so it can't be read
      // as a setext underline (marked's quirk, cm-093); a line already
      // at 4+ spaces or starting with a tab is kept as-is.
      const text = rest(cur);
      const m = /^[ \t]*(=+)[ \t]*$/.exec(text);
      if (m) {
        const lead = /^[ \t]*/.exec(text)[0];
        if (lead.indexOf('\t') < 0 && lead.length < 4) {
          leaf.lines.push('    ' + text.slice(lead.length));
        } else {
          leaf.lines.push(text);
        }
      } else {
        // A leading tab in a lazy continuation is expanded by absolute
        // column (doc-08: '  \tindented' inside a blockquote in a list
        // item gives '  indented', not a literal tab).
        leaf.lines.push(expandLeadTabs(text, cur.c));
        lastParaIndented = false;
      }
      continue;
    }

    // ---- Phase C: open leaf continuation ----
    // A non-blank line clears the empty-item flag (only two CONSECUTIVE
    // blank lines after an empty item close the list).
    closedEmptyItem = false;
    if (leaf && leaf.t === T_CODE && leaf.fence !== '') {
      // closing fence? up to 3 spaces, same char, >= opening length, only
      // spaces after
      const save = { i: cur.i, c: cur.c, p: cur.p };
      skipSpaces(cur, 3);
      const fc = ccur(cur);
      if (fc === leaf.fence.charCodeAt(0)) {
        let n = 0;
        while (ccur(cur) === fc) { advOne(cur); n++; }
        if (n >= leaf.fenceLen && isBlankAt(cur)) {
          finalizeLeaf();
          continue;
        }
      }
      cur.i = save.i; cur.c = save.c; cur.p = save.p;
      // content line: strip up to fenceInd columns of leading whitespace.
      // TILDE fence: marked strips NOTHING from content lines — spaces
      // and tabs are all kept literal (probe25: ' ~~~' + ' X' keeps
      // ' X'; probe22/23: tab runs are kept too).
      // BACKTICK fence: strip up to fenceInd leading whitespace
      // CHARACTERS — a tab counts as ONE character, not its column
      // width (probe37/doc-18: fenceInd=2, '\t four' strips the tab
      // AND the space, leaving 'four'; '\t  four' strips the tab and
      // one space, leaving ' four'). This replaces the column-based
      // adv() strip (which left a partial tab and a leftover space).
      if (leaf.fence.charCodeAt(0) !== 126) {
        let stripChars = leaf.fenceInd;
        while (stripChars > 0 && cur.i < cur.s.length) {
          const ch = cur.s.charCodeAt(cur.i);
          if (ch === 32) { cur.i++; cur.c++; stripChars--; }
          else if (ch === 9) { cur.c += 4 - (cur.c & 3); cur.i++; stripChars--; }
          else break;
        }
        cur.p = 0;
      }
      const codeText = rest(cur);
      // Only leading tabs are expanded (a tab after other content, e.g.
      // '> \tindented' inside a fence, stays literal — doc-08). The
      // expansion column uses the blockquote-only correction (outer '>'
      // markers subtracted); the list-item indent is NOT subtracted here.
      // (The generalised correction was tried and regressed the count
      // 710/720 -> 686/720; it is wrong for fenced-code content.)
      // Round 4: when the innermost container is a blockquote, marked
      // aligns tab stops as if only that blockquote existed, so ALL
      // outer containers (lists included) are subtracted
      // (contTotal-contLast; doc-08 '  > \tX' in a list item expands
      // the tab to 2 spaces, not 4). When the innermost container is
      // a list (or none), only outer '>' markers are subtracted
      // (bqTotal-bqLast); subtracting an outer blockquote there would
      // under-expand (doc-02 '>   \tX' in a list inside a quote
      // needs the absolute column, 4 spaces). The blanket
      // contTotal-contLast correction regressed 710/720 -> 686/720
      // because it also subtracts outer blockquotes under a list.
      const innerIsQuote = k > 1 && stack[k - 1].t === T_QUOTE;
      const tabCol = innerIsQuote ? cur.c - (contTotal - contLast) : cur.c - (bqTotal - bqLast);
      leaf.lines.push(k > 1 ? expandLeadTabs(codeText, tabCol) : codeText);
      leaf.hasContent = true;
      continue;
    }
    if (leaf && leaf.t === T_CODE) {
      // indented code: needs 4+ columns of indent from here
      if (wsCols(cur) >= 4) {
        adv(cur, 4);
        const codeText = rest(cur);
        // Only leading tabs are expanded (a tab after other content,
        // e.g. '> \tindented' inside the block, stays literal —
        // doc-14; same rule as fenced code above).
        leaf.lines.push(k > 1 ? expandLeadTabs(codeText, cur.c) : codeText);
        continue;
      }
      finalizeLeaf();
      // fall through to new block starts
    }
    if (leaf && leaf.t === T_HTML) {
      // types 1-5 end at their end marker; types 6-7 run until a blank line
      const ht = leaf.htmlType;
      const text = rest(cur);
      leaf.lines.push(text);
      if ((ht === 1 && htmlType1Ends(text, leaf.endTag)) ||
          (ht === 2 && text.indexOf('-->') >= 0) ||
          (ht === 3 && text.indexOf('?>') >= 0) ||
          (ht === 4 && text.indexOf('>') >= 0) ||
          (ht === 5 && text.indexOf(']]>') >= 0)) {
        leaf.trailNl = htmlTrailNl(li);
        finalizeLeaf();
      }
      continue;
    }

    // ---- Phase D: start new blocks (loop for containers) ----
    // baseCol: the absolute column where the container-stripped line begins.
    // A list item's stored indent is its content column minus baseCol, so a
    // continuation line inside a blockquote matches even though the markers
    // have different widths (cm-259), while a top-level item keeps its
    // absolute indent (cm-257).
    let baseCol = cur.c;
    let lineDone = false;
    while (!lineDone) {
      // after a container was opened on this line, the remainder may be
      // blank (cm-239: '>' alone must not start an empty paragraph).
      // A blank remainder must not CREATE a paragraph (cm-240), but it
      // may CONTINUE one (cm-241: '>  ' continues 'foo' with ' ').
      if (isBlankAt(cur) && (!leaf || leaf.t !== T_PARA)) { lineDone = true; break; }
      const ind = wsCols(cur, cur.c - (contTotal - contLast));
      if (ind >= 4) {
        if (!leaf) {
          // indented code block — a block at a list's level closes it
          // first (cm-257: the <pre> is outside the <ul>)
          closeListIfTop();
          const b = blk(T_CODE);
          b.lines = [];
          adv(cur, 4);
          // Inside a container, expand only LEADING tabs in the code
          // content by the effective column (doc-08: '  > \t\tX' gives
          // '  X'); a tab after other content stays literal (doc-19:
          // '> \tindented' keeps the tab). At top level the raw content
          // is kept.
          b.lines.push(stack.length > 1 ? expandLeadTabs(rest(cur), cur.c - (contTotal - contLast)) : rest(cur));
          addChild(top(), b);
          leaf = b;
          lineDone = true;
          break;
        }
        if (leaf.t === T_PARA) {
          // indented line continues the paragraph. Inside a list item the
          // 4-column indented-code indent is stripped ('- a' + '      b'
          // -> 'b'; '- a' + '  \t\t\tb' -> 6 spaces); inside a
          // blockquote the leading tabs are expanded ('> a' + '> \t\tb'
          // -> 6 spaces, no strip); at top level the raw line is kept
          // ('a' + '    b' -> '    b'). (doc-09/13/17)
          if (top().t === T_ITEM) {
            const text = expandLeadTabs(rest(cur), cur.c);
            let n = 0;
            while (n < 4 && n < text.length && text.charCodeAt(n) === 32) n++;
            // After an indented paragraph line AND a blank line, the
            // continuation is separated by a blank line in the output
            // (probe38/doc-19: '      support?' + blank +
            // '    \tindented' gives 'support?\n\n  indented').
            if (lastParaIndented && pendingBlank) { leaf.lines.push(''); pendingBlank = false; }
            leaf.lines.push(text.slice(n));
            // An indented paragraph line inside a list item blocks the
            // next line's lazy continuation (doc-08/probe26).
            lastParaIndented = true;
          } else if (top().t === T_QUOTE) {
            leaf.lines.push(expandLeadTabs(rest(cur), cur.c));
            lastParaIndented = false;
          } else {
            leaf.lines.push(rest(cur));
            lastParaIndented = false;
          }
          lineDone = true;
          break;
        }
        if (leaf.t === T_TABLE) {
          // A row indented by 4+ columns (spaces or tab) is an indented
          // code block, not a table row (doc-13/26/33: '    c | d' and
          // '\tc | d' end the table). End the table and re-examine the
          // line with its indent intact so the code-block branch takes it.
          finalizeLeaf();
          continue;
        }
        break;
      }
      // probe cursor past the line's indentation: block-start checks
      // (heading, fence, list, ...) read it, while paragraph and HTML
      // lines are taken from the original cursor so leading spaces survive
      const pcur = { s: cur.s, i: cur.i, c: cur.c, p: cur.p };
      adv(pcur, ind);
      const ch = ccur(pcur);
      // 1. blockquote
      if (ch === 62) {
        finalizeLeaf();
        closeListIfTop();
        advOne(pcur);
        const ch2 = ccur(pcur);
        if (ch2 === 32 || ch2 === 9) adv(pcur, 1);
        const b = blk(T_QUOTE);
        b.children = [];
        addChild(top(), b);
        stack.push(b);
        const w = pcur.c - cur.c;
        cur.i = pcur.i; cur.c = pcur.c; cur.p = pcur.p;
        baseCol = cur.c;
        contTotal += w; contLast = w;
        continue;
      }
      // 2. ATX heading
      if (ch === 35) {
        let n = 0;
        let j = pcur.i;
        while (j < pcur.s.length && pcur.s.charCodeAt(j) === 35) { n++; j++; }
        if (n >= 1 && n <= 6) {
          const after = j < pcur.s.length ? pcur.s.charCodeAt(j) : -1;
          if (after === -1 || after === 32 || after === 9) {
            finalizeLeaf();
            closeListIfTop();
            let text = pcur.s.slice(j);
            // strip the closing sequence FIRST: it needs the space that
            // precedes it (### ### -> empty heading, cm-079)
            text = text.replace(/[ \t]+#+[ \t]*$/, '');
            text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
            const b = blk(T_HEAD);
            b.level = n;
            b.info = text;
            addChild(top(), b);
            lineDone = true;
            break;
          }
        }
      }
      // 3. fenced code
      if (ch === 96 || ch === 126) {
        const fch = String.fromCharCode(ch);
        let n = 0;
        let j = pcur.i;
        while (j < pcur.s.length && pcur.s.charCodeAt(j) === ch) { n++; j++; }
        if (n >= 3) {
          let info = pcur.s.slice(j);
          if (fch === '`' && info.indexOf('`') >= 0) {
            // backtick fence info must not contain backticks: not a fence
          } else {
            finalizeLeaf();
            closeListIfTop();
            const b = blk(T_CODE);
            b.fence = fch;
            b.fenceLen = n;
            b.fenceInd = ind;
            b.info = info.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
            b.lines = [];
            b.hasContent = false; // set when a non-blank content line is added (blank lines don't count; doc-08)
            addChild(top(), b);
            leaf = b;
            lineDone = true;
            break;
          }
        }
      }
      // 4. HTML block (types 1-6 can interrupt a paragraph; 7 cannot)
      if (ch === 60) {
        const ht = htmlBlockType(pcur);
        if (ht !== 0 && (ht !== 7 || !leaf)) {
          finalizeLeaf();
          closeListIfTop();
          const b = blk(T_HTML);
          b.htmlType = ht;
          const firstLine = rest(cur);
          b.lines = [firstLine];
          // types 1-5 end on the first line if it already holds the end
          // marker (cm-176/177: <!-- foo -->*bar* ends on that line)
          let endsHere = false;
          if (ht === 1) {
            b.endTag = readTagName(pcur.s, pcur.i + 1).toLowerCase();
            endsHere = htmlType1Ends(firstLine, b.endTag);
          } else if (ht === 2) endsHere = firstLine.indexOf('-->') >= 0;
          else if (ht === 3) endsHere = firstLine.indexOf('?>') >= 0;
          else if (ht === 4) endsHere = firstLine.indexOf('>') >= 0;
          else if (ht === 5) endsHere = firstLine.indexOf(']]>') >= 0;
          if (endsHere) {
            b.trailNl = htmlTrailNl(li);
            addChild(top(), b);
            leaf = null;
            lineDone = true;
            break;
          }
          addChild(top(), b);
          leaf = b;
          lineDone = true;
          break;
        }
      }
      // 5. setext heading (paragraph must be open)
      if (leaf && leaf.t === T_PARA) {
        const m = /^[ \t]*(=+|-+)[ \t]*$/.exec(rest(cur));
        if (m) {
          // strip leading link reference definitions from the paragraph
          // text first: they belong to the document, not the heading
          const text = leaf.lines.join('\n');
          let pos = 0;
          while (true) {
            const d = parseDef(text, pos);
            if (!d) break;
            const key = normalizeLabel(unescapeLabel(d.label));
            if (!refs.has(key)) refs.set(key, { href: d.href, title: d.title });
            pos = d.end;
          }
          // a setext heading's text is trimmed (leading spaces of the
          // first line, trailing spaces/tabs of the last line)
          const headText = text.slice(pos).replace(/^\s+/, '').replace(/\s+$/, '');
          if (isBlankStr(headText)) {
            // paragraph was only definitions: drop it; the setext line
            // starts a fresh paragraph below
            const parent = top();
            const idx = parent.children.indexOf(leaf);
            if (idx >= 0) parent.children.splice(idx, 1);
            leaf = null;
            continue;
          }
          const b = blk(T_HEAD);
          b.level = m[1].charCodeAt(0) === 61 ? 1 : 2;
          b.info = headText;
          // replace the paragraph block in its parent
          const parent = top();
          const idx = parent.children.indexOf(leaf);
          if (idx >= 0) parent.children[idx] = b;
          b.blankBefore = leaf.blankBefore;
          leaf = null;
          lineDone = true;
          break;
        }
        // table delimiter row (paragraph must have exactly one line)
        if (leaf.lines.length === 1) {
          const aligns = tableDelimiter(cur);
          // the delimiter's cell count must match the header's (gfm-203)
          if (aligns && aligns.length === splitRow(leaf.lines[0]).length) {
            const tb = blk(T_TABLE);
            tb.head = splitRow(leaf.lines[0]);
            tb.aligns = aligns;
            tb.rows = [];
            const parent = top();
            const idx = parent.children.indexOf(leaf);
            if (idx >= 0) parent.children[idx] = tb;
            tb.blankBefore = leaf.blankBefore;
            leaf = tb;
            lineDone = true;
            break;
          }
        }
      }
      // 6. thematic break
      if (ch === 42 || ch === 45 || ch === 95) {
        const s2 = pcur.s;
        let j = pcur.i;
        let n = 0;
        let ok = true;
        while (j < s2.length) {
          const d = s2.charCodeAt(j);
          if (d === ch) { n++; j++; }
          else if (d === 32 || d === 9) j++;
          else { ok = false; break; }
        }
        if (ok && n >= 3) {
          finalizeLeaf();
          closeListIfTop();
          addChild(top(), blk(T_HR));
          lineDone = true;
          break;
        }
      }
      // 7. list item
      const listStart = tryListItem(pcur, baseCol, leaf, stack, top(), addChild, finalizeLeaf, finalizeContainer);
      if (listStart) {
        // listStart: {item, empty, list, isNewList} — the list is a
        // container too, so a new one goes on the stack under its item
        if (listStart.isNewList) stack.push(listStart.list);
        stack.push(listStart.item);
        const w = pcur.c - cur.c;
        cur.i = pcur.i; cur.c = pcur.c; cur.p = pcur.p;
        baseCol = cur.c;
        contTotal += w; contLast = w;
        if (listStart.empty) { lineDone = true; break; }
        continue;
      }
      // 8. table body row (a table leaf is open) — a line without pipes
      // is a single-cell row (gfm-202: 'bar' is a row)
      if (leaf && leaf.t === T_TABLE) {
        const text = rest(cur);
        leaf.rows.push(splitRow(text));
        lineDone = true;
        break;
      }
      // 9. paragraph
      if (leaf && leaf.t === T_PARA) {
        // continuation line: the leading spaces are part of the paragraph
        // text (cm-222: " bbb" keeps its space). A leading tab after a
        // matched container marker is expanded by the effective column
        // (doc-08: '  > \tindented' gives '  indented'); tabs after
        // content stay literal.
        // After an indented (4+) paragraph line in a list item, the next
        // continuation is separated by a blank line in the output
        // (doc-08/probe27: '* a' + '      b' + '\tindented' gives
        // 'b\n\n  indented').
        if (lastParaIndented) leaf.lines.push('');
        leaf.lines.push(expandLeadTabs(rest(cur), cur.c - (contTotal - contLast)));
        lastParaIndented = false;
        lineDone = true;
        break;
      }
      if (!leaf) {
        const b = blk(T_PARA);
        // A leading tab is expanded by the effective column — as if only
        // the innermost container existed (doc-08: '> \tindented' ->
        // '  indented'); at top level a leading tab would be indented
        // code, so this only matters inside a container.
        b.lines = [expandLeadTabs(rest(cur), cur.c - (contTotal - contLast))];
        lastParaIndented = false;
        closeListIfTop();
        addChild(top(), b);
        leaf = b;
        lineDone = true;
        break;
      }
      // unreachable
      lineDone = true;
    }
  }

  // EOF: an HTML block left open trails \n iff the source ends with \n.
  if (leaf && leaf.t === T_HTML) leaf.trailNl = srcEndsWithNl;
  closeTo(1);
  return { doc, refs };
}

// Try to start a list item at the cursor. Returns {item, empty} or null.
// leaf is the currently open leaf (a paragraph may block interruption).
function tryListItem(cur, baseCol, leaf, stack, parent, addChild, finalizeLeaf, finalizeContainer) {
  const s = cur.s;
  let i = cur.i;
  const ch = s.charCodeAt(i);
  let bullet = false;
  let ordered = false;
  let marker = '';
  let num = 0;
  let delim = '';
  if (ch === 42 || ch === 43 || ch === 45) {
    bullet = true;
    marker = s[i];
    i++;
  } else if (ch >= 48 && ch <= 57) {
    let j = i;
    let val = 0;
    while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57 && j - i < 9) {
      val = val * 10 + (s.charCodeAt(j) - 48);
      j++;
    }
    if (j < s.length && (s.charCodeAt(j) === 46 || s.charCodeAt(j) === 41) && j - i <= 9) {
      ordered = true;
      num = val;
      delim = s[j];
      marker = String(val);
      i = j + 1;
    } else {
      return null;
    }
  } else {
    return null;
  }
  // The marker must be followed by 1+ spaces/tabs or end of line.
  const after = i < s.length ? s.charCodeAt(i) : -1;
  if (after !== -1 && after !== 32 && after !== 9) return null;
  // Interruption rules: a list can interrupt a paragraph only if it is a
  // bullet list, or an ordered list starting with 1. An empty item cannot
  // interrupt a paragraph. Exception: when the open paragraph sits
  // inside a list item, a nested ordered list may start with any number
  // (doc-01/04: '382900.' inside an item starts a nested list).
  const paraOpen = leaf && leaf.t === T_PARA;
  if (paraOpen) {
    if (ordered && num !== 1 && parent.t !== T_ITEM) return null;
    // empty item check below
  }
  // Count the whitespace columns after the marker.
  const markEndCol = cur.c + (i - cur.i);
  let j = i;
  let col = markEndCol;
  let w = 0;
  while (j < s.length) {
    const d = s.charCodeAt(j);
    if (d === 32) { w++; col++; j++; }
    else if (d === 9) { const tw = 4 - (col & 3); w += tw; col += tw; j++; }
    else break;
  }
  const empty = j >= s.length;
  // An empty item cannot interrupt a paragraph — except when the open
  // paragraph sits inside a list item, where a nested (possibly empty)
  // list may start (probe40/doc-19: '+ a' + '  4.' starts a nested
  // empty ordered list; the same exception as the number rule above).
  if (paraOpen && empty && parent.t !== T_ITEM) return null;
  // A table body row wins over an EMPTY list marker (doc-07: a lone '*'
  // after a table is a single-cell row, not a list item). A non-empty
  // list item ends the table instead (see the finalize below).
  if (leaf && leaf.t === T_TABLE && empty) return null;
  let contentIndent;
  if (empty) {
    contentIndent = markEndCol + 1;
  } else if (w >= 1 && w <= 4) {
    contentIndent = markEndCol + w;
  } else {
    contentIndent = markEndCol + 1;
  }
  // Find or create the list container.
  let list = null;
  let isNewList = false;
  if (parent.t === T_LIST) {
    const same = bullet ? (parent.marker === marker && parent.delim === '')
      : (!bullet && parent.delim === delim);
    // A bullet list continues only with the same bullet char; an ordered
    // list only with the same delimiter. A different marker closes the old
    // list: the new list is a sibling, not a child of it.
    if (same) {
      list = parent;
    } else {
      const old = stack.pop();
      finalizeContainer(old);
      parent = stack[stack.length - 1];
    }
  }
  if (!list) {
    // A list item ends an open paragraph OR an open table: finalize the
    // leaf first, or the item's content would land in both (doc-07:
    // '- item' after a table gave a '<td>item</td>' row AND an empty
    // '<li></li>'). finalizeLeaf() just nulls the leaf for a table.
    if (paraOpen || (leaf && leaf.t === T_TABLE)) finalizeLeaf();
    list = blk(T_LIST);
    list.marker = bullet ? marker : '';
    list.delim = ordered ? delim : '';
    list.start = ordered ? num : 0;
    list.children = [];
    addChild(parent, list);
    isNewList = true;
  } else if (paraOpen || (leaf && leaf.t === T_TABLE)) {
    finalizeLeaf();
  }
  const item = blk(T_ITEM);
  // indent is the content column in the container-stripped line:
  // contentIndent minus the absolute column where the stripped line
  // begins (baseCol). A continuation line inside a blockquote (whose
  // markers have a different width) then matches correctly, while a
  // top-level item keeps its absolute indent (cm-257 vs cm-259).
  item.indent = contentIndent - baseCol;
  item.children = [];
  addChild(list, item);
  // Position the cursor at the content start.
  cur.i = j;
  cur.c = col;
  cur.p = 0;
  // If w >= 5, the content starts after marker+1 column: back the cursor up
  // to the position one column after the marker end, with a partial tab if
  // the whitespace was a tab.
  if (!empty && w >= 5) {
    // re-walk from the marker end to markEndCol+1
    let ii = i;
    let cc = markEndCol;
    let pp = 0;
    while (cc < markEndCol + 1) {
      const d = s.charCodeAt(ii);
      if (d === 32) { ii++; cc++; }
      else if (d === 9) {
        const tw = 4 - (cc & 3);
        if (cc + tw > markEndCol + 1) { pp = tw - (markEndCol + 1 - cc); cc = markEndCol + 1; }
        else { ii++; cc += tw; }
      } else break;
    }
    cur.i = ii; cur.c = cc; cur.p = pp;
  }
  return { item, empty, list, isNewList };
}

// ---------------------------------------------------------------------------
// Inline parsing (delimiter-stack algorithm, CommonMark appendix B)
// ---------------------------------------------------------------------------

// Inline node types
const N_TEXT = 0, N_CODE = 1, N_EM = 2, N_STRONG = 3, N_LINK = 4,
  N_IMAGE = 5, N_HTML = 6, N_BR = 7, N_DEL = 8;

const DISALLOWED_TAGS = new Set(['title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'script', 'plaintext']);

function mkNode(t, s, h, ti) {
  return { t: t, s: s, h: h, ti: ti, ch: null, nx: null, pv: null, pa: null, al: 0 };
}
function mkDelim(c, n, o, l, node, ix, im) {
  // after: char code right after this delimiter run (-1 at end of string);
  // set by scanInline after creation. sc: true once this delimiter was
  // used as a strong (**) closer. op/ul: when this delimiter is used as
  // a closer, op is the opener delimiter it matched and ul is how many
  // delimiter chars were used (1 for em, 2 for strong) — used by the
  // marked emphasis quirk (inner emphasis blocking an outer one). bl:
  // true once this closer has blocked an outer emphasis (it blocks only
  // the first closer after it). on: the ORIGINAL run length; n shrinks
  // as the run is consumed, but the odd-match rule reads the original
  // lengths ('**foo***bar**': the leftover '*' of the '***' closer
  // pairs with a later '**' — (3+2)%3 != 0, so it is not blocked).
  return { c: c, n: n, on: n, o: o, l: l, a: true, nd: node, ix: ix, im: im, after: -1, sc: false, op: null, ul: 0, bl: false };
}

// native-scanner fast path (technique 2): a single regex test replaces
// the char-by-char loop over the whole string
const HAS_SPECIAL_RE = /[\\`*_\[\]!<&~@]/;
// global regex: next inline special char (\ ` * _ [ ] ! < & ~ newline)
const INLINE_SPECIAL_RE = /[\\`*_\[\]!<&~\n]/g;
function hasSpecial(s) {
  if (HAS_SPECIAL_RE.test(s)) return true;
  // a hard break (2+ spaces before a newline) needs the full inline scan;
  // without it the fast path would return the spaces + newline literally
  if (s.indexOf('  \n') >= 0) return true;
  return s.indexOf('www.') >= 0 || s.indexOf('://') >= 0;
}

function isAsciiLetter(cc) {
  return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122);
}
function isAlnum(cc) {
  return (cc >= 48 && cc <= 57) || isAsciiLetter(cc);
}

// 128-entry character-class tables (technique 1): one array read replaces
// a long OR-chain in the hot autolink check. SCHEME_CHAR: letters, digits,
// '+', '-', '.'. EMAIL_LOCAL: the GFM email local-part set (alnum plus
// . ! # $ % & ' * + / = ? ^ _ ` { | } ~ -).
const SCHEME_CHAR = new Uint8Array(128);
const EMAIL_LOCAL = new Uint8Array(128);
for (let c = 48; c <= 57; c++) { SCHEME_CHAR[c] = 1; EMAIL_LOCAL[c] = 1; }
for (let c = 65; c <= 90; c++) { SCHEME_CHAR[c] = 1; EMAIL_LOCAL[c] = 1; }
for (let c = 97; c <= 122; c++) { SCHEME_CHAR[c] = 1; EMAIL_LOCAL[c] = 1; }
SCHEME_CHAR[43] = 1; SCHEME_CHAR[45] = 1; SCHEME_CHAR[46] = 1;
for (const c of [46, 33, 35, 36, 37, 38, 39, 42, 43, 47, 61, 63, 94, 95, 96, 123, 124, 125, 126, 45]) EMAIL_LOCAL[c] = 1;

function flanking(s, i, len) {
  const before = i > 0 ? s[i - 1] : '';
  const after = i + len < s.length ? s[i + len] : '';
  const beforeWs = before === '' || isWhitespaceCh(before);
  const afterWs = after === '' || isWhitespaceCh(after);
  const beforePunct = before !== '' && isPunctCh(before);
  const afterPunct = after !== '' && isPunctCh(after);
  return {
    left: !afterWs && (!afterPunct || beforeWs || beforePunct),
    right: !beforeWs && (!beforePunct || afterWs || afterPunct),
    beforePunct, afterPunct,
  };
}

// Parse an inline link's (destination "title") starting at s[pos] === '('.
// Returns {href, title, end} or null.
function parseInlineLink(s, pos) {
  const n = s.length;
  let i = pos + 1;
  while (i < n && isSpace(s.charCodeAt(i))) i++;
  if (i >= n) return null;
  let href = '';
  if (s.charCodeAt(i) === 60) { // <...>
    i++;
    while (i < n) {
      const ch = s.charCodeAt(i);
      if (ch === 62) break;
      if (ch === 60 || ch === 10) return null;
      if (ch === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) { href += s[i + 1]; i += 2; continue; }
      href += s[i];
      i++;
    }
    if (i >= n || s.charCodeAt(i) !== 62) return null;
    i++;
  } else if (s.charCodeAt(i) === 41) {
    href = ''; // empty destination: [foo]()
  } else {
    let depth = 0;
    const start = i;
    while (i < n) {
      const ch = s.charCodeAt(i);
      if (isSpace(ch)) break;
      if (ch === 92 && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) { href += s[i + 1]; i += 2; continue; }
      if (ch === 40) depth++;
      else if (ch === 41) { if (depth === 0) break; depth--; }
      else if (ch < 32) return null;
      href += s[i];
      i++;
    }
    if (i === start && href === '') return null;
  }
  while (i < n && isSpace(s.charCodeAt(i))) i++;
  let title = null;
  if (i < n) {
    const tc = s.charCodeAt(i);
    if (tc === 34 || tc === 39 || tc === 40) {
      const closer = tc === 40 ? 41 : tc;
      let k = i + 1;
      let t = '';
      let ok = false;
      let td = 0;
      while (k < n) {
        const ch = s.charCodeAt(k);
        if (ch === 92 && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) { t += s[k + 1]; k += 2; continue; }
        if (tc === 40 && ch === 40) { td++; t += s[k]; k++; continue; }
        if (ch === closer) {
          if (tc === 40 && td > 0) { td--; t += s[k]; k++; continue; }
          ok = true; k++; break;
        }
        if (ch === 10) return null;
        t += s[k];
        k++;
      }
      if (!ok) return null;
      title = t;
      i = k;
      while (i < n && isSpace(s.charCodeAt(i))) i++;
    }
  }
  if (i >= n || s.charCodeAt(i) !== 41) return null;
  return { href, title, end: i + 1 };
}

// Parse a reference label at s[pos] === '['. Returns {label, end} or null.
function parseRefLabel(s, pos) {
  const n = s.length;
  let i = pos + 1;
  let label = '';
  while (i < n) {
    const ch = s.charCodeAt(i);
    if (ch === 92 && i + 1 < n) {
      const d = s.charCodeAt(i + 1);
      if (d === 92 || d === 91 || d === 93) { label += s[i + 1]; i += 2; continue; }
    }
    if (ch === 93) return { label, end: i + 1 };
    if (ch === 91) return null;
    label += s[i];
    i++;
    if (label.length > 999) return null;
  }
  return null;
}

// <...> autolink (scheme or email). Returns {href, text, end} or null.
function parseAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  if (j < n && isAsciiLetter(s.charCodeAt(j))) {
    let k = j;
    while (k < n) {
      const d = s.charCodeAt(k);
      if (isAlnum(d) || d === 43 || d === 45 || d === 46) k++;
      else break;
    }
    if (k - j >= 2 && k - j <= 32 && k < n && s.charCodeAt(k) === 58) {
      let m = k + 1;
      while (m < n) {
        const d = s.charCodeAt(m);
        if (d === 62) return { href: s.slice(i + 1, m), text: s.slice(i + 1, m), end: m + 1 };
        if (d === 32 || d === 60 || d < 32) return null;
        m++;
      }
      return null;
    }
  }
  // email: local@domain
  let k = j;
  while (k < n) {
    const d = s.charCodeAt(k);
    if (isAlnum(d) || d === 46 || d === 33 || d === 35 || d === 36 || d === 37 ||
        d === 38 || d === 39 || d === 42 || d === 43 || d === 47 || d === 61 ||
        d === 63 || d === 94 || d === 95 || d === 96 || d === 123 || d === 124 ||
        d === 125 || d === 126 || d === 45) k++;
    else break;
  }
  if (k > j && k < n && s.charCodeAt(k) === 64) {
    let m = k + 1;
    let labels = 0;
    let ok = true;
    while (m < n) {
      const start = m;
      if (!isAlnum(s.charCodeAt(m))) { ok = false; break; }
      m++;
      while (m < n && (isAlnum(s.charCodeAt(m)) || s.charCodeAt(m) === 45)) m++;
      if (s.charCodeAt(m - 1) === 45 || m - start > 63) { ok = false; break; }
      labels++;
      if (m < n && s.charCodeAt(m) === 46) { m++; continue; }
      break;
    }
    if (ok && labels > 0 && m < n && s.charCodeAt(m) === 62) {
      const text = s.slice(i + 1, m);
      return { href: 'mailto:' + text, text, end: m + 1 };
    }
  }
  return null;
}

// Inline HTML tag at s[i] === '<'. Returns {html, end, name, closing} or null.
function parseHtmlTag(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  const c = s.charCodeAt(i + 1);
  if (c === 33) {
    if (s.startsWith('<!--', i)) {
      // '<!-->' and '<!--->' are complete empty comments (cm-626)
      if (s.charCodeAt(i + 4) === 62) return { html: s.slice(i, i + 5), end: i + 5, name: '', closing: false };
      if (s.charCodeAt(i + 4) === 45 && s.charCodeAt(i + 5) === 62) return { html: s.slice(i, i + 6), end: i + 6, name: '', closing: false };
      const end = s.indexOf('-->', i + 4);
      if (end < 0) return null;
      // '--' inside the comment does not invalidate it (cm-625)
      return { html: s.slice(i, end + 3), end: end + 3, name: '', closing: false };
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) return null;
      return { html: s.slice(i, end + 3), end: end + 3, name: '', closing: false };
    }
    if (i + 2 < n) {
      const d = s.charCodeAt(i + 2);
      if (isAsciiLetter(d)) {
        let k = i + 2;
        while (k < n && s.charCodeAt(k) !== 62) k++;
        if (k >= n) return null;
        return { html: s.slice(i, k + 1), end: k + 1, name: '', closing: false };
      }
    }
    return null;
  }
  if (c === 63) {
    const end = s.indexOf('?>', i + 2);
    if (end < 0) return null;
    return { html: s.slice(i, end + 2), end: end + 2, name: '', closing: false };
  }
  let k = i + 1;
  let closing = false;
  if (s.charCodeAt(k) === 47) { closing = true; k++; }
  const nameStart = k;
  // a tag name must start with an ASCII letter (cm-618: <33> is not a tag)
  if (k >= n || !isAsciiLetter(s.charCodeAt(k))) return null;
  while (k < n) {
    const d = s.charCodeAt(k);
    if (isAlnum(d) || d === 45) k++;
    else break;
  }
  if (k === nameStart) return null;
  const name = s.slice(nameStart, k).toLowerCase();
  while (k < n) {
    const d = s.charCodeAt(k);
    if (d === 32 || d === 9 || d === 10) { k++; continue; }
    if (d === 62) return { html: s.slice(i, k + 1), end: k + 1, name, closing };
    // a self-closing '/>' is opening-only: '</a/>' is not a tag at all
    // (marked: '&lt;/a/&gt;'), so a closing tag must not take this branch
    if (d === 47 && !closing && k + 1 < n && s.charCodeAt(k + 1) === 62) {
      return { html: s.slice(i, k + 2), end: k + 2, name, closing };
    }
    // a closing tag takes no attributes (cm-624: </a href="foo">)
    if (closing) return null;
    // an attribute name starts with a letter, '_' or a digit — not ':'
    // (cm-609: <m:abc> is not a tag; xml:lang IS, ':' inside the name)
    // and attributes must be separated by whitespace (cm-622:
    // href='bar'title= is not a tag)
    if (isAsciiLetter(d) || d === 95 || (d >= 48 && d <= 57)) {
      // attributes must be separated by whitespace: the char before this
      // attribute must be whitespace (or the tag name just ended, k is
      // right after it). If the previous char is a quote or a value char,
      // the attribute runs on without a separator (cm-622).
      const prev = k - 1 >= 0 ? s.charCodeAt(k - 1) : -1;
      const atNameEnd = (k === nameStart + name.length);
      if (!atNameEnd && prev !== 32 && prev !== 9 && prev !== 10) return null;
      while (k < n) {
        const e = s.charCodeAt(k);
        if (isAlnum(e) || e === 95 || e === 58 || e === 45 || e === 46) k++;
        else break;
      }
      while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9 || s.charCodeAt(k) === 10)) k++;
      if (k < n && s.charCodeAt(k) === 61) {
        k++;
        while (k < n && (s.charCodeAt(k) === 32 || s.charCodeAt(k) === 9 || s.charCodeAt(k) === 10)) k++;
        if (k < n && (s.charCodeAt(k) === 34 || s.charCodeAt(k) === 39)) {
          const q = s.charCodeAt(k);
          k++;
          while (k < n && s.charCodeAt(k) !== q) k++;
          if (k >= n) return null;
          k++;
        } else {
          while (k < n) {
            const e = s.charCodeAt(k);
            if (e === 32 || e === 9 || e === 10 || e === 62) break;
            if (e === 34 || e === 39 || e === 60 || e === 61) return null;
            k++;
          }
        }
      }
      continue;
    }
    return null;
  }
  return null;
}

// Extended (GFM) autolink at s[i]: www. / scheme:// / email.
// The caller guarantees the preceding char is a boundary (start, whitespace
// or one of * _ ~ (). Returns {href, text, end} or null.
// A 'scheme:' extended autolink: only lowercase 'mailto' and 'xmpp' form
// one (gfm-633/634/635). mailto: takes just the email; xmpp: takes the
// email plus ONE path segment ('/txt' in '/txt/bin', '/bin' stays literal).
// Other schemes (ftp:, custom-scheme:, MAILTO:) do not link — the email
// inside them is still recognised separately.
function scanSchemeEmail(s, i) {
  const n = s.length;
  let schemeLen = 0;
  let isXmpp = false;
  if (s.startsWith('mailto:', i)) { schemeLen = 7; }
  else if (s.startsWith('xmpp:', i)) { schemeLen = 5; isXmpp = true; }
  else return null;
  let k = i + schemeLen;
  const localStart = k;
  while (k < n) {
    const d = s.charCodeAt(k);
    if (isAlnum(d) || d === 46 || d === 33 || d === 35 || d === 36 || d === 37 ||
        d === 38 || d === 39 || d === 42 || d === 43 || d === 47 || d === 61 ||
        d === 63 || d === 94 || d === 95 || d === 96 || d === 123 || d === 124 ||
        d === 125 || d === 126 || d === 45) { k++; continue; }
    break;
  }
  if (k === localStart || k >= n || s.charCodeAt(k) !== 64) return null;
  // domain: labels of alnum/hyphen separated by dots (same as scanExtDomain)
  let j = k + 1;
  let labels = 0;
  let lastLabelStart = -1, lastLabelEnd = -1;
  while (j < n) {
    const start = j;
    if (!isAlnum(s.charCodeAt(j))) break;
    j++;
    while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 45)) j++;
    if (s.charCodeAt(j - 1) === 45 || j - start > 63) return null;
    labels++;
    lastLabelStart = start; lastLabelEnd = j;
    if (j < n && s.charCodeAt(j) === 46) {
      if (j + 1 < n && isAlnum(s.charCodeAt(j + 1))) { j++; continue; }
      break;
    }
    break;
  }
  if (labels < 2) return null;
  // a trailing '_' right after the domain invalidates the whole
  // mailto:/xmpp: link (gfm-633: 'mailto:a.b-c_d@a.b_' is not a link)
  if (j < n && s.charCodeAt(j) === 95) return null;
  for (let t = lastLabelStart; t < lastLabelEnd; t++) {
    if (!isAsciiLetter(s.charCodeAt(t))) return null;
  }
  let end = j;
  // xmpp: one path segment ('/' + chars up to the next '/', whitespace,
  // control, '<' or '>')
  if (isXmpp && end < n && s.charCodeAt(end) === 47) {
    let p = end + 1;
    while (p < n) {
      const d = s.charCodeAt(p);
      if (d === 32 || d === 9 || d === 10 || d === 60 || d === 62 || d < 32 || d === 47) break;
      p++;
    }
    if (p > end + 1) end = p;
  }
  // trailing punctuation + unbalanced parens: repeat until stable, since
  // stripping a ')' can expose trailing punctuation (doc-10: '...nova).)')
  let text = s.slice(i, end);
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    while (text.length > 0) {
      const last = text.charCodeAt(text.length - 1);
      if (last === 63 || last === 33 || last === 46 || last === 44 || last === 58 ||
          last === 59 || last === 42 || last === 95 || last === 126) {
        text = text.slice(0, -1);
        trimmed = true;
      } else break;
    }
    let open = 0, close = 0;
    for (let t = 0; t < text.length; t++) {
      if (text.charCodeAt(t) === 40) open++;
      else if (text.charCodeAt(t) === 41) close++;
    }
    while (close > open && text.endsWith(')')) {
      text = text.slice(0, -1);
      close--;
      trimmed = true;
    }
  }
  end = i + text.length;
  if (text.length === 0) return null;
  return { href: text, text, end };
}

function parseExtAutolink(s, i, openUnd) {
  const n = s.length;
  let start = i;
  let prefix = '';
  // 'mailto:' / 'xmpp:' + email (no '//')
  const se = scanSchemeEmail(s, i);
  if (se) return se;
  if (s.startsWith('www.', i)) {
    prefix = 'http://';
  } else {
    // scheme:// — find :// within the next 32 chars
    let k = i;
    while (k < n && k - i <= 32) {
      const d = s.charCodeAt(k);
      if (isAlnum(d) || d === 43 || d === 45 || d === 46) k++;
      else break;
    }
    if (k - i >= 2 && s.startsWith('://', k)) {
      start = i;
    } else {
      // email: local@domain — scan the local part first
      let k2 = i;
      while (k2 < n) {
        const d = s.charCodeAt(k2);
        if (isAlnum(d) || d === 46 || d === 33 || d === 35 || d === 36 || d === 37 ||
            d === 38 || d === 39 || d === 42 || d === 43 || d === 47 || d === 61 ||
            d === 63 || d === 94 || d === 95 || d === 96 || d === 123 || d === 124 ||
            d === 125 || d === 126 || d === 45) k2++;
        else break;
      }
      if (k2 > i && k2 < n && s.charCodeAt(k2) === 64) {
        return scanExtDomain(s, i, k2 + 1, 'mailto:', openUnd);
      }
      return null;
    }
  }
  // www. or scheme:// — scan the domain, then the path
  let j = start;
  if (prefix === 'http://') j = i + 4;
  else {
    // skip past ://
    while (j < n && s.charCodeAt(j) !== 58) j++;
    j += 3;
  }
  return scanExtDomain(s, start, j, prefix, openUnd);
}

// Scan a domain + optional path for an extended autolink.
// textStart = where the link text begins, domStart = where the domain begins.
// Returns {href, text, end} or null.
function scanExtDomain(s, textStart, domStart, prefix, openUnd) {
  const n = s.length;
  // domain: labels of alnum/hyphen separated by dots
  let j = domStart;
  let labels = 0;
  let lastLabelStart = -1, lastLabelEnd = -1;
  while (j < n) {
    const start = j;
    if (!isAlnum(s.charCodeAt(j))) break;
    j++;
    while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 45)) j++;
    if (s.charCodeAt(j - 1) === 45 || j - start > 63) return null;
    labels++;
    lastLabelStart = start; lastLabelEnd = j;
    if (j < n && s.charCodeAt(j) === 46) {
      // a dot: must be followed by another label char, else the domain ends
      if (j + 1 < n && isAlnum(s.charCodeAt(j + 1))) { j++; continue; }
      break;
    }
    break;
  }
  if (labels === 0) return null;
  // www. and email need a dot; the last label must be 2+ letters
  const needDot = prefix === 'http://' || prefix === 'mailto:';
  if (needDot) {
    if (labels < 2) return null;
    // the TLD must be letters (a 1-letter TLD is fine: gfm-632 a.b links)
    for (let k = lastLabelStart; k < lastLabelEnd; k++) {
      if (!isAsciiLetter(s.charCodeAt(k))) return null;
    }
  }
  // path: everything up to whitespace / control / < > — but NOT for an
  // email: an email has no path, so '?\' after the domain must not be
  // consumed (doc-21: 'modern@cinder.example.com?\' ends at .com, and the
  // '?' + hard-break stay outside). A scheme/www link keeps its path,
  // including a trailing '\' (doc-37/40).
  let end = j;
  if (prefix !== 'mailto:') {
    while (end < n) {
      const d = s.charCodeAt(end);
      if (d === 32 || d === 9 || d === 10 || d === 60 || d === 62 || d < 32) break;
      end++;
    }
  }
  if (end === j && labels === 0) return null;
  // trailing rules, in order: entity, punctuation, unbalanced parens
  let text = s.slice(textStart, end);
  // (1) entity: ends with ; and the part after the last & is word+;
  if (text.endsWith(';')) {
    const amp = text.lastIndexOf('&');
    if (amp >= 0) {
      const tail = text.slice(amp + 1, -1);
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(tail)) {
        text = text.slice(0, amp);
        end = textStart + text.length;
      }
    }
  }
  // (2) trailing punctuation + (3) unbalanced closing parens, repeated
  // until stable: stripping a ')' can expose trailing punctuation
  // (doc-10: '...nova).)' -> '...nova')
  let trimmed = true;
  while (trimmed) {
    trimmed = false;
    while (text.length > 0) {
      const last = text.charCodeAt(text.length - 1);
      if (last === 63 || last === 33 || last === 46 || last === 44 || last === 58 ||
          last === 59 || last === 42 || last === 95 || last === 126) {
        text = text.slice(0, -1);
        trimmed = true;
      } else break;
    }
    // (3) unbalanced closing parens: a trailing ')' is trimmed only
    // when it has no matching '(' before it in the text. A ')' in the
    // middle is always kept, even if it makes the total count
    // unbalanced (doc-12:
    // 'https://img.shields.io?q=stable&page=4)](./docs/create.md)'
    // keeps both ')' — the first is mid-URL, the last matches the
    // '(' before './docs'). Count unmatched '(' before the trailing
    // ')' with a depth counter (a mid-URL ')' at depth 0 is ignored).
    while (text.endsWith(')')) {
      let depth = 0;
      for (let k = 0; k < text.length - 1; k++) {
        if (text.charCodeAt(k) === 40) depth++;
        else if (text.charCodeAt(k) === 41 && depth > 0) depth--;
      }
      if (depth === 0) {
        text = text.slice(0, -1);
        trimmed = true;
      } else break;
    }
    // Unclosed '(': a '(' with no matching ')' AFTER it ends the URL
    // (doc-08: 'https://sub.domain.example.io)](https://npmjs.com/heading'
    // stops before the '(' — the ')' BEFORE it does not balance it, so a
    // plain open/close count is not enough). Track a stack of '('
    // positions; a ')' pops the most recent one, and any '(' left on the
    // stack at the end is unclosed — truncate at the first of them.
    const openStack = [];
    for (let k = 0; k < text.length; k++) {
      const ch = text.charCodeAt(k);
      if (ch === 40) openStack.push(k);
      else if (ch === 41 && openStack.length > 0) openStack.pop();
    }
    if (openStack.length > 0) {
      text = text.slice(0, openStack[0]);
      trimmed = true;
    }
  }
  end = textStart + text.length;
  if (text.length === 0) return null;
  // an email must not be followed by a word character: 'a.b@a.b_' is not
  // a link (gfm-632) — the '_' would extend the domain. But when an '_'
  // delimiter is open, a trailing '_' is that delimiter's closer (it closes
  // the emphasis), not part of the domain, so the email still links
  // (doc-04/34/37/38: '_foo bar@baz.com_' links the email).
  if (prefix === 'mailto:' && end < n) {
    const nx = s.charCodeAt(end);
    if (isAlnum(nx)) return null;
    if (nx === 95 && !openUnd) return null;
  }
  // the domain must still be intact after trimming
  if (prefix === 'mailto:') {
    return { href: 'mailto:' + text, text, end };
  }
  return { href: prefix + text, text, end };
}

// ---------------------------------------------------------------------------
// The inline scanner
// ---------------------------------------------------------------------------

function renderInline(s, refs) {
  if (!hasSpecial(s)) return escText(s);
  const st = scanInline(s, refs);
  processEmphasis(st.delims, s);
  return renderNodes(st.head);
}

function scanInline(s, refs) {
  const n = s.length;
  let head = null;
  let tail = null;
  const delims = [];
  let buf = '';
  let i = 0;
  // Round 4: after a link whose text holds an unmatched backtick run,
  // emphasis delimiters are suppressed when a backtick follows them
  // (doc-28/09/35: '__a b__' before '`c`' is literal, but '__d e__'
  // with no backtick after it forms; '_issue table_' before '``' is
  // literal). Set in tryLink when such a link forms; cleared on '['
  // (emphasis inside a link's own text is not suppressed, doc-35).
  let suppressEmphUntilTick = false;
  // Round 4: position of the last backtick in this paragraph, computed
  // lazily (only when the post-link suppression flag is set) so the
  // common no-unmatched-link path pays no scan.
  let lastTick = -2;
  // Round 4: bracket depth — emphasis inside a link's own text is not
  // suppressed by an outer unmatched-backtick link (doc-35: '*fast*'
  // inside '[default run*fast*](...)' forms). Track '[' / ']' so the
  // suppression applies only at depth 0.
  let bracketDepth = 0;

  function append(nn) {
    nn.pv = tail; nn.nx = null; nn.pa = null;
    if (tail) tail.nx = nn; else head = nn;
    tail = nn;
    return nn;
  }
  function flushText() {
    if (buf !== '') { append(mkNode(N_TEXT, buf, '', '')); buf = ''; }
  }
  // Move the nodes from `first` to `tail` into parent's children.
  function adoptChildren(parent, first) {
    parent.ch = first;
    let nd = first;
    while (nd) { nd.pa = parent; nd = nd.nx; }
  }
  // The plain-text content of a node subtree (for image alt text).
  // Does the node subtree (from `first`, following .nx) contain a link node?
  // A link's text cannot contain a link (cm-518/519/532/533/520); an image
  // CAN contain one, so this is only checked for links.
  function containsLink(first) {
    let nd = first;
    while (nd) {
      // only a markdown link blocks an outer link; an autolink <...>
      // inside link text does not (doc-03)
      if (nd.t === N_LINK && !nd.al) return true;
      if (nd.ch && containsLink(nd.ch)) return true;
      nd = nd.nx;
    }
    return false;
  }

  // marked quirk: a link whose text contains a code span delimited by 2+
  // backticks that itself contains a backtick does NOT form a link
  // (doc-18: [empty test `` a ` b `` output][all-40] stays literal; the
  // [all-40] then links on its own). A single-backtick span, or a 2+ span
  // with no backtick inside, forms normally.
  // Returns the index just past the closer of the first 2+ backtick code
  // span whose content contains a backtick, or -1 if there is none.
  // A span like `` a ` b `` in link text is a marked quirk: it blocks
  // the link — but for an INLINE link only when something follows the
  // span before ']' ('[a `` b ` c ``](url)' forms, '[a `` b ` c `` d]'
  // and '[a `` b ` c ``_]' do not). A REFERENCE link is blocked by any
  // such span, wherever it sits (doc-18).
  // Try to form a link/image at the ']' at s[closeIdx]. Returns the index
  // to continue scanning from, or -1 when no link was formed.
  function tryLink(closeIdx) {
    // nearest active '[' delimiter
    let di = -1;
    for (let k = delims.length - 1; k >= 0; k--) {
      if (delims[k].c === 91 && delims[k].a) { di = k; break; }
    }
    if (di < 0) return -1;
    const open = delims[di];
    let href = null;
    let title = null;
    let end = -1;
    const next = closeIdx + 1 < n ? s.charCodeAt(closeIdx + 1) : -1;
    let fullRefTried = false;
    if (next === 40) { // inline link: ](...
      const r = parseInlineLink(s, closeIdx + 1);
      if (r) { href = r.href; title = r.title; end = r.end; }
    } else if (next === 91) { // reference link: ][...]
      const r = parseRefLabel(s, closeIdx + 1);
      if (r) {
        fullRefTried = true;
        const rawLabel = r.label === '' ? s.slice(open.ix, closeIdx) : r.label;
        // labels are normalised AFTER resolving bracket escapes only
        // (cm-194: [Foo*bar\]] matches the def [Foo*bar]; cm-545:
        // [foo\!] does NOT match [foo!])
        const ref = refs.get(normalizeLabel(unescapeLabel(rawLabel)));
        if (ref) { href = ref.href; title = ref.title; end = r.end; }
      }
    }
    if (href === null && !fullRefTried) {
      // shortcut reference: the link text itself is the label. NOT tried
      // when a full reference [label] was present but undefined (cm-571:
      // [foo][bar][baz] leaves [foo] literal, [bar][baz] links).
      const label = s.slice(open.ix, closeIdx);
      const ref = refs.get(normalizeLabel(unescapeLabel(label)));
      if (ref) { href = ref.href; title = ref.title; end = closeIdx + 1; }
    }
    if (href === null) {
      open.a = false; // not a link: this '[' can never open one
      return -1;
    }
    // A 2+ backtick code span containing a backtick in the link text
    // blocks the link only when something follows the span before ']'
    // (probe31/doc-10: '[a `` b ` c ``][29]' forms, but
    // '[a `` b ` c `` d][29]' does not; the same holds for inline links:
    // '[a `` b ` c ``](url)' forms, '[a `` b ` c `` d](url)' does not).
    {
      const linkText = s.slice(open.ix, closeIdx);
      const badEnd = linkTextHasBadCodeSpan(linkText);
      if (badEnd >= 0 && badEnd < linkText.length) {
        open.a = false;
          return -1;
      }
    }
    const clean = cleanUrl(href);
    if (clean === null) {
      open.a = false;
      return -1;
    }
    // Round 4: a link whose text holds an unmatched backtick run
    // suppresses emphasis after the link until the next backtick
    // (doc-28) — but only when such a later backtick exists; with no
    // later backtick there is no phantom span and the emphasis forms
    // normally. Record it now that the link is known to form.
    if (hasUnmatchedBacktick(s.slice(open.ix, closeIdx)) && s.indexOf('`', end) >= 0) suppressEmphUntilTick = true;
    // Build the link/image node, taking the nodes after '[' as children.
    const isImage = open.im === 1;
    const node = mkNode(isImage ? N_IMAGE : N_LINK, '', clean, title === null ? '' : title);
    const firstChild = open.nd.nx;
    // A link cannot contain a link: if the text holds a link node, this
    // '[' can never form a link (the ']' is literal text).
    if (!isImage && containsLink(firstChild)) {
      open.a = false;
      return -1;
    }
    adoptChildren(node, firstChild);
    // deactivate every '[' delimiter inside the link text
    for (let k = di + 1; k < delims.length; k++) {
      if (delims[k].c === 91) delims[k].a = false;
    }
    open.a = false;
    // splice the link node in place of the '[' node
    node.pv = open.nd.pv;
    node.nx = null;
    node.pa = open.nd.pa;
    if (open.nd.pv) open.nd.pv.nx = node;
    else head = node;
    tail = node;
    return end;
  }

  // Does an extended autolink start at s[j]? www., a scheme:// within 32
  // chars, or an email '@' within 64 chars. Cheap: only the word after a
  // boundary is scanned. The char tests use 128-entry lookup tables
  // (technique 1) instead of long OR-chains: one array read per char.
  function extAutolinkAhead(j) {
    if (s.startsWith('www.', j)) return true;
    if (s.startsWith('mailto:', j) || s.startsWith('xmpp:', j)) return true;
    const c0 = j < n ? s.charCodeAt(j) : -1;
    if (!isAsciiLetter(c0)) return false;
    // scheme: letters/digits/+/-/. then ://
    let k = j;
    while (k < n && k - j <= 32) {
      const d = s.charCodeAt(k);
      if (d < 128 && SCHEME_CHAR[d]) { k++; continue; }
      if (d === 58 && s.startsWith('://', k)) return true;
      break;
    }
    // email: local-part chars then @
    let m = j;
    while (m < n && m - j <= 64) {
      const d = s.charCodeAt(m);
      if (d < 128 && EMAIL_LOCAL[d]) { m++; continue; }
      if (d === 64) return true;
      break;
    }
    return false;
  }

  // Is the char at i a boundary for an extended autolink? (start of string,
  // whitespace, or one of * _ ~ ()
  function isExtBoundary(idx) {
    if (idx <= 0) return true;
    const c = s.charCodeAt(idx - 1);
    return c === 32 || c === 9 || c === 10 || c === 42 || c === 95 || c === 126 || c === 40 || c === 60;
  }

  // Will the '[' delimiter `open` form a link? Mirrors tryLink's decision
  // WITHOUT mutating anything. Used to decide whether an extended
  // autolink inside the brackets may form: marked autolinks inside
  // brackets when the link FAILS (the '[' stays literal — doc-01, doc-39),
  // but not when it forms (the URL stays plain text inside the link).
  // fromPos is where the URL starts; the ']' that closes this '[' is the
  // first unescaped ']' at or after fromPos (code spans skipped).
  function bracketWillFormLink(open, fromPos) {
    let closeIdx = -1;
    let k = fromPos;
    while (k < n) {
      const ch = s.charCodeAt(k);
      if (ch === 93) { closeIdx = k; break; }
      if (ch === 92 && k + 1 < n && isAsciiPunct(s.charCodeAt(k + 1))) { k += 2; continue; }
      if (ch === 96) {
        let j = k;
        while (j < n && s.charCodeAt(j) === 96) j++;
        const len = j - k;
        let m = j, found = -1;
        while (m < n) {
          if (s.charCodeAt(m) === 96) {
            let q = m;
            while (q < n && s.charCodeAt(q) === 96) q++;
            if (q - m === len) { found = m; break; }
            m = q;
          } else m++;
        }
        if (found >= 0) {
          // Round 4: a len>=2 backtick span whose content (to its
          // closer) holds another backtick is a "bad" span — it does
          // NOT protect a ']' inside it (doc-09/35: the '``' in
          // '[docs each ``url`]' pairs with a later '``', but the
          // span's content holds the single '`', so the ']' still
          // closes the link). Do not skip past it; let the scan
          // find the ']'. A len-1 span, or a len>=2 span with no
          // backtick inside, is a real code span that protects ']'
          // (cm-342: '`link](/foo`' has no backtick inside).
          if (len >= 2 && s.slice(j, found).indexOf('`') >= 0) { k++; continue; }
          k = found + len; continue;
        }
      }
      k++;
    }
    if (closeIdx < 0) return false;
    const next = closeIdx + 1 < n ? s.charCodeAt(closeIdx + 1) : -1;
    let href = null;
    let fullRefTried = false;
    if (next === 40) {
      const r = parseInlineLink(s, closeIdx + 1);
      if (r) href = r.href;
    } else if (next === 91) {
      const r = parseRefLabel(s, closeIdx + 1);
      if (r) {
        fullRefTried = true;
        const rawLabel = r.label === '' ? s.slice(open.ix, closeIdx) : r.label;
        const ref = refs.get(normalizeLabel(unescapeLabel(rawLabel)));
        if (ref) href = ref.href;
      }
    }
    if (href === null && !fullRefTried) {
      const ref = refs.get(normalizeLabel(unescapeLabel(s.slice(open.ix, closeIdx))));
      if (ref) href = ref.href;
    }
    if (href === null) return false;
    const linkText = s.slice(open.ix, closeIdx);
    const badEnd = linkTextHasBadCodeSpan(linkText);
    if (badEnd >= 0 && badEnd < linkText.length) return false;
    if (cleanUrl(href) === null) return false;
    // a link cannot contain a (markdown) link
    if (open.im !== 1 && containsLink(open.nd.nx)) return false;
    return true;
  }

  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92) { // backslash
      if (i + 1 < n) {
        const d = s.charCodeAt(i + 1);
        if (d === 10) { flushText(); append(mkNode(N_BR, '', '', '')); i += 2; while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++; continue; }
        if (isAsciiPunct(d)) {
          // an escaped '&' must be its own text node: if it merged with
          // the following text it would form an entity (\&ouml; -> &ouml;)
          if (d === 38) { flushText(); append(mkNode(N_TEXT, '&', '', '')); }
          else buf += s[i + 1];
          i += 2; continue;
        }
      }
      buf += '\\'; i++; continue;
    }
    if (c === 96) { // code span
      let j = i;
      while (j < n && s.charCodeAt(j) === 96) j++;
      const len = j - i;
      let k = j;
      let found = -1;
      while (k < n) {
        if (s.charCodeAt(k) === 96) {
          let m = k;
          while (m < n && s.charCodeAt(m) === 96) m++;
          if (m - k === len) { found = k; break; }
          k = m;
        } else if (s.charCodeAt(k) === 93) {
          // Round 4: do not cross a ']' that closes an enclosing '['
          // to form a link (doc-28: the single '`' before ']' in
          // '[x ``y`]' must not pair with a later '`' — the link
          // forms instead, and the backticks stay literal inside it).
          // But a ']' that does NOT form a link may still be crossed
          // by a code span (cm-342/525/537: '[not a `link](/foo`)'
          // forms the code span across ']' because the destination
          // is invalid, so no link forms). The check reuses
          // bracketWillFormLink on the nearest active '[' before
          // this code-span opener.
          let open = null;
          for (let d = delims.length - 1; d >= 0; d--) {
            if (delims[d].c === 91 && delims[d].a && delims[d].ix < i) { open = delims[d]; break; }
          }
          if (open && bracketWillFormLink(open, open.ix + 1)) break;
          k++;
        } else k++;
      }
      if (found >= 0) {
        flushText();
        let content = s.slice(j, found).replace(/\n/g, ' ');
        if (content.length >= 2 && content.charCodeAt(0) === 32 &&
            content.charCodeAt(content.length - 1) === 32 && !/^ +$/.test(content)) {
          content = content.slice(1, -1);
        }
        append(mkNode(N_CODE, content, '', ''));
        i = found + len;
        continue;
      }
      buf += s.slice(i, j);
      i = j;
      continue;
    }
    if (c === 42 || c === 95 || c === 126) { // * _ ~
      let j = i;
      while (j < n && s.charCodeAt(j) === c) j++;
      const len = j - i;
      // Round 4: after a link whose text holds an unmatched backtick
      // run, an emphasis run is suppressed iff a backtick follows it
      // (doc-28/09/35) — treat the run as literal text. With no
      // backtick after it, the emphasis forms normally. Only at
      // bracket depth 0 (emphasis inside a link's own text is the
      // link's content, not suppressed).
      if (suppressEmphUntilTick && bracketDepth === 0) {
        if (lastTick === -2) lastTick = s.lastIndexOf('`');
        if (j <= lastTick) { buf += s.slice(i, j); i = j; continue; }
      }
      // GFM: a ~~~ run (3+) is not a strikethrough delimiter at all
      if (c === 126 && len >= 3) { buf += s.slice(i, j); i = j; continue; }
      const fl = flanking(s, i, len);
      let canOpen, canClose;
      if (c === 95) {
        canOpen = fl.left && (!fl.right || fl.beforePunct);
        canClose = fl.right && (!fl.left || fl.afterPunct);
      } else {
        canOpen = fl.left;
        canClose = fl.right;
      }
      flushText();
      const node = append(mkNode(N_TEXT, s.slice(i, j), '', ''));
      const dm = mkDelim(c, len, canOpen, canClose, node, i, 0);
      dm.after = j < n ? s.charCodeAt(j) : -1;
      delims.push(dm);
      i = j;
      continue;
    }
    if (c === 91) { // [
      bracketDepth++;
      flushText();
      const node = append(mkNode(N_TEXT, '[', '', ''));
      delims.push(mkDelim(91, 1, false, false, node, i + 1, 0));
      i++;
      continue;
    }
    if (c === 33) { // !
      if (i + 1 < n && s.charCodeAt(i + 1) === 91) {
        bracketDepth++;
        flushText();
        const node = append(mkNode(N_TEXT, '![', '', ''));
        delims.push(mkDelim(91, 1, false, false, node, i + 2, 1));
        i += 2;
        continue;
      }
      buf += '!'; i++; continue;
    }
    if (c === 93) { // ]
      if (bracketDepth > 0) bracketDepth--;
      flushText();
      const end = tryLink(i);
      if (end >= 0) { i = end; continue; }
      buf += ']'; i++; continue;
    }
    if (c === 60) { // < autolink or HTML tag
      const al = parseAutolink(s, i);
      if (al) {
        flushText();
        append(mkNode(N_LINK, '', cleanUrl(al.href) || '', ''));
        // autolink text is a plain text child
        const linkNode = tail;
        linkNode.al = 1;
        const textNode = mkNode(N_TEXT, al.text, '', '');
        textNode.pa = linkNode;
        linkNode.ch = textNode;
        i = al.end;
        continue;
      }
      const tag = parseHtmlTag(s, i);
      if (tag) {
        // An inline <a> open tag suppresses extended autolinks until an
        // inline </a> (doc-03/06). Marked's rule is about a literal
        // SPACE in the tag: an opening <a> tag sets inLink iff its HTML
        // contains a space ('<a href="x">', '<a />', '<a >', '<a/ >'
        // all suppress; bare '<a>', self-closing '<a/>', and
        // '<a\thref="x">' (tab, not space) do not). A closing tag
        // clears inLink only when it is exactly '</a>' ('</a >' and
        // '</a/>' do not clear).
        if (tag.name === 'a') {
          if (tag.closing) {
            if (tag.html.toLowerCase() === '</a>') inLink = false;
          } else if (tag.html.indexOf(' ') >= 0) inLink = true;
        }
        flushText();
        append(mkNode(N_HTML, tag.html, '', ''));
        i = tag.end;
        continue;
      }
      buf += '<'; i++; continue;
    }
    if (c === 38) { // & entity
      const ent = tryEntity(s, i);
      if (ent) {
        // a numeric entity decoding to '&' (&#38;) must be its own node:
        // merged with following text it would form an entity
        if (!ent.named && ent.val === '&') { flushText(); append(mkNode(N_TEXT, '&', '', '')); }
        else buf += ent.val;
        i = ent.end; continue;
      }
      buf += '&'; i++; continue;
    }
    if (c === 126) { /* handled with * _ above */ }
    if (c === 10) { // newline: hard break if 2+ trailing spaces, else soft
      let k = buf.length;
      let spaces = 0;
      while (k > 0 && buf.charCodeAt(k - 1) === 32) { spaces++; k--; }
      if (spaces >= 2) {
        buf = buf.slice(0, buf.length - spaces);
        flushText();
        append(mkNode(N_BR, '', '', ''));
      } else {
        buf += '\n';
      }
      i++;
      // after a hard break the next line's leading spaces/tabs are
      // stripped entirely (cm-636: 'foo  \n     bar' -> 'foo<br>bar')
      if (spaces >= 2) {
        while (i < n && (s.charCodeAt(i) === 32 || s.charCodeAt(i) === 9)) i++;
      }
      continue;
    }
    // extended autolinks: www. / scheme:// / email (only at a boundary,
    // and not while an unclosed inline <a> is open — doc-03). Inside a
    // '[' the autolink forms only when that '[' will NOT form a link
    // (marked autolinks inside brackets when the link fails; when the
    // link forms, the URL stays plain text inside it — doc-01/39).
    let openBracket = false;
    let openUnd = false;
    if (!inLink && isExtBoundary(i) && (c === 119 || isAsciiLetter(c))) {
      for (let dk = 0; dk < delims.length; dk++) {
        if (delims[dk].c === 91 && delims[dk].a) break;
        // canOpen is .o (mkDelim .a is always true = active flag)
        if (delims[dk].c === 95 && delims[dk].o) openUnd = true;
      }
      // innermost active '[': suppress only if it will form a link
      for (let dk = delims.length - 1; dk >= 0; dk--) {
        if (delims[dk].c === 91 && delims[dk].a) {
          if (bracketWillFormLink(delims[dk], i)) openBracket = true;
          break;
        }
      }
    }
    if (!inLink && !openBracket && isExtBoundary(i) && (c === 119 || isAsciiLetter(c))) {
      if (c === 119 && s.startsWith('www.', i)) {
        const r = parseExtAutolink(s, i, openUnd);
        if (r) {
          flushText();
          const linkNode = append(mkNode(N_LINK, '', cleanUrl(r.href) || '', ''));
          linkNode.al = 1;
          const textNode = mkNode(N_TEXT, r.text, '', '');
          textNode.pa = linkNode;
          linkNode.ch = textNode;
          i = r.end;
          continue;
        }
      } else if (isAsciiLetter(c)) {
        // scheme:// or email — only try when the markers are near
        const schemeAt = s.indexOf('://', i);
        const atAt = s.indexOf('@', i);
        if ((schemeAt >= 0 && schemeAt - i <= 32) || (atAt >= 0 && atAt - i <= 64)) {
          const r = parseExtAutolink(s, i, openUnd);
          if (r) {
            flushText();
            const linkNode = append(mkNode(N_LINK, '', cleanUrl(r.href) || '', ''));
            linkNode.al = 1;
            const textNode = mkNode(N_TEXT, r.text, '', '');
            textNode.pa = linkNode;
            linkNode.ch = textNode;
            i = r.end;
            continue;
          }
        }
      }
    }
    // plain text run: copy up to the next special char (\n breaks the run
    // so the newline case below can spot a hard break). It also stops
    // before an extended autolink: when the previous char is a boundary
    // (space/tab/'(') and an autolink starts here, the main loop links it
    // (gfm-623/625/629/631).
    let j = i + 1;
    while (j < n) {
      const d = s.charCodeAt(j);
      if (d === 92 || d === 96 || d === 42 || d === 95 || d === 91 || d === 93 ||
          d === 33 || d === 60 || d === 38 || d === 126 || d === 10) break;
      const prev = s.charCodeAt(j - 1);
      if ((prev === 32 || prev === 9 || prev === 40) && extAutolinkAhead(j)) break;
      j++;
    }
    buf += s.slice(i, j);
    i = j;
  }
  flushText();
  return { head, delims };
}

// Resolve emphasis / strong / strikethrough over the delimiter list.
// marked quirk: a link whose text contains a code span delimited by 2+
// backticks that itself contains a backtick does NOT form a link
// (doc-18: [empty test `` a ` b `` output][all-40] stays literal; the
// [all-40] then links on its own). A single-backtick span, or a 2+ span
// with no backtick inside, forms normally. Returns the index just past
// the closer of the first 2+ backtick code span whose content contains
// a backtick, or -1 if there is none. A span like `` a ` b `` in link
// text is a marked quirk: it blocks the link — but for an INLINE link
// only when something follows the span before ']' ('[a `` b ` c ``](url)'
// forms, '[a `` b ` c `` d]' and '[a `` b ` c ``_]' do not). A REFERENCE
// link is blocked by any such span, wherever it sits (doc-18). The same
// span inside '[...]' also blocks an EMPHASIS that contains it
// (probe36/doc-16: '[at _node `` ` ``_](url)' keeps '_node ... _'
// literal; outside brackets the emphasis forms normally).
function linkTextHasBadCodeSpan(text) {
  let i = 0;
  const m = text.length;
  while (i < m) {
    if (text.charCodeAt(i) === 96) {
      let j = i;
      while (j < m && text.charCodeAt(j) === 96) j++;
      const len = j - i;
      let k = j;
      let found = -1;
      while (k < m) {
        if (text.charCodeAt(k) === 96) {
          let q = k;
          while (q < m && text.charCodeAt(q) === 96) q++;
          if (q - k === len) { found = k; break; }
          k = q;
        } else k++;
      }
      if (found >= 0) {
        if (len >= 2 && text.slice(j, found).indexOf('`') >= 0) return found + len;
        i = found + len;
      } else {
        i = j;
      }
    } else i++;
  }
  return -1;
}

// Round 4: does `text` contain a backtick run with no same-length
// closer inside `text`? Used for the marked quirk where a link whose
// text holds such an unmatched run suppresses emphasis after the link
// until the next backtick (doc-28: '[x ``y`](url) __a b__ `c`' leaves
// '__a b__' literal, while '__d e__' after the '`c`' code span forms).
function hasUnmatchedBacktick(text) {
  let i = 0;
  const m = text.length;
  while (i < m) {
    // an escaped backtick is literal text, not a code-span delimiter
    if (text.charCodeAt(i) === 92 && i + 1 < m && text.charCodeAt(i + 1) === 96) { i += 2; continue; }
    if (text.charCodeAt(i) === 96) {
      let j = i;
      while (j < m && text.charCodeAt(j) === 96) j++;
      const len = j - i;
      let k = j, found = -1;
      while (k < m) {
        if (text.charCodeAt(k) === 92 && k + 1 < m && text.charCodeAt(k + 1) === 96) { k += 2; continue; }
        if (text.charCodeAt(k) === 96) {
          let q = k;
          while (q < m && text.charCodeAt(q) === 96) q++;
          if (q - k === len) { found = k; break; }
          k = q;
        } else k++;
      }
      if (found < 0) return true;
      // matched code span: skip past its closer, not just its opener
      // (else the closer is re-read as a new unmatched opener)
      i = found + len;
    } else i++;
  }
  return false;
}

// Round 4 rescue check: whether a pure-closer same-char delimiter
// sits strictly between delimiter index xi and the closer at index di,
// with non-whitespace text between it and the closer. Such a delimiter
// rescues the outer pair from an inner emphasis's block ('**a *b*c*
// d**' and doc-01's '**public as *so*other* option html**' form the
// strong; '***a *b*c** d*' lets the later '*' close the outer em;
// without such a delimiter, or with only whitespace before the closer,
// or with a delimiter that can also open, the block stands).
function hasRescuer(delims, xi, di, d, s) {
  for (let ri = xi + 1; ri < di; ri++) {
    const r = delims[ri];
    if (r.c !== d.c || !r.a || !r.l || r.o) continue;
    for (let ci = r.ix + r.on; ci < d.ix; ci++) {
      const ch = s.charCodeAt(ci);
      if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) return true;
    }
  }
  return false;
}

function processEmphasis(delims, s) {
  for (let di = 0; di < delims.length; di++) {
    const d = delims[di];
    if (!d.a || !d.l) continue;
    if (d.c !== 42 && d.c !== 95 && d.c !== 126) continue;
    // marked quirk: a pure-closer '**' run (can close, cannot open)
    // prefers a pure-opener single '*' over a nearer '**' opener.
    // Measured grid ('*foo**bar**' + preceding/following char):
    // the em forms ('<em>foo**bar*</em>') iff the single '*' opener
    // is a pure opener (can open, cannot close — at the start or
    // after a space/punctuation, NOT after a word char) AND the '**'
    // closer is a pure closer (can close, cannot open — at the end
    // or before a space/punctuation, NOT before a word char).
    // Otherwise the strong forms ('*foo**bar**baz' -> strong, and
    // 'x*foo**bar**' -> strong). Two guards: the closer must be
    // exactly '**' (n == 2 — a '***' closer has enough for a strong
    // AND an em, so the strong forms first: '*foo**bar***'), and
    // there must be NO later same-char closer in this parent (if
    // the single '*' has a later closer, the '**' forms the strong
    // and the em closes later: '*(**foo**)*', '*foo **bar** baz*').
    // Pre-scan for the nearest pure-opener single '*' in this parent;
    // if one exists, a '**' opener after it is skipped so the closer
    // reaches the single '*'.
    let singlePureIdx = -1;
    if (d.c !== 126 && d.n === 2 && !d.o && d.l) {
      let hasLaterCloser = false;
      for (let xi = di + 1; xi < delims.length; xi++) {
        const x = delims[xi];
        if (x.c !== d.c || !x.a || !x.l) continue;
        if (x.nd.pa !== d.nd.pa) continue;
        hasLaterCloser = true;
        break;
      }
      if (!hasLaterCloser) {
        for (let xi = di - 1; xi >= 0; xi--) {
          const x = delims[xi];
          if (x.c !== d.c || !x.a || !x.o || x.l || x.n !== 1) continue;
          if (x.nd.pa !== d.nd.pa) continue;
          singlePureIdx = xi;
          break;
        }
      }
    }
    // Round 4: whether a later same-char closer exists in this parent
    // (used both for the strong->em fallback and for leftover
    // placement: when a later closer will wrap an outer emphasis, the
    // opener/closer leftovers must stay as delimiter text, not be
    // moved inside this emphasis).
    let laterCloser = false;
    if (d.c !== 126) {
      for (let xi = di + 1; xi < delims.length; xi++) {
        const x = delims[xi];
        if (x.c !== d.c || !x.a || !x.l) continue;
        if (x.nd.pa !== d.nd.pa) continue;
        laterCloser = true;
        break;
      }
    }
    let oi = di - 1;
    let usedSinglePure = false;
    while (oi >= 0) {
      const o = delims[oi];
      if (!o.a || o.c !== d.c || !o.o || o.nd.pa !== d.nd.pa) { oi--; continue; }
      // Skip a '**' opener only when it can BOTH open and close
      // (preceded by a word char). A pure-opener '**' (preceded by a
      // space/punctuation, can only open) is a legitimate strong
      // opener and must not be hijacked ('*first **option**_.' keeps
      // its strong; '*foo**bar**' forms the em because its inner
      // '**' sits between word chars).
      if (singlePureIdx >= 0 && o.n >= 2 && oi > singlePureIdx && o.o && o.l) { usedSinglePure = true; oi--; continue; }
      // odd-match rule (only * and _): when either side can both open and
      // close, the sum of the lengths must not be a multiple of 3 unless
      // both lengths are.
      if (d.c !== 126) {
        const bothCan = (o.o && o.l) || (d.o && d.l);
        if (bothCan && ((o.on + d.on) % 3 === 0) && !((o.on % 3 === 0) && (d.on % 3 === 0))) {
          oi--; continue;
        }
      }
      const openLen = o.n, closeLen = d.n;
      // A bad code span (2+ backticks containing a backtick) inside
      // '[...]' blocks an emphasis that contains it (probe36/doc-16:
      // '[at _node `` ` ``_](url)' keeps '_node ... _' literal; outside
      // brackets the emphasis forms normally). The content is the source
      // between the opener run and the closer run; it is inside brackets
      // when the nearest '[' before the opener has no ']' before the
      // opener and a ']' after the closer.
      let blockedByBadSpan = false;
      if (s) {
        const content = s.slice(o.ix + o.on, d.ix);
        if (linkTextHasBadCodeSpan(content) >= 0) {
          let b = -1;
          for (let k = o.ix - 1; k >= 0; k--) {
            const ch = s.charCodeAt(k);
            if (ch === 93) break;
            if (ch === 91 && (k === 0 || s.charCodeAt(k - 1) !== 92)) { b = k; break; }
          }
          if (b >= 0) {
            for (let k = d.ix; k < s.length; k++) {
              const ch = s.charCodeAt(k);
              if (ch === 93 && (k === 0 || s.charCodeAt(k - 1) !== 92)) { blockedByBadSpan = true; break; }
              if (ch === 91 && (k === 0 || s.charCodeAt(k - 1) !== 92)) break;
            }
          }
        }
      }
      if (blockedByBadSpan) { oi--; continue; }
      let use = (o.n >= 2 && d.n >= 2) ? 2 : 1;
      // marked emphasis quirk (not in the spec algorithm): an inner
      // emphasis whose closer is immediately followed by a word
      // character, and whose opener can only open (preceded by a
      // space, not a word char), blocks an outer emphasis. Measured
      // grid (inner '*b*c', opener length O, closer length C):
      //   O=1: outer always forms (em); O=2,C=3: strong forms;
      //   O=3,C=3: em forms (fallback); all other O>=2: blocked.
      // The block applies when the opener has length >= 2 and the
      // closer is exactly consumed (d.n === use) or the opener keeps
      // a leftover (o.n > use); a same-length inner (ul === use) does
      // not block when the closer keeps a leftover (d.n > use). The
      // inner closer must have matched a DIFFERENT opener than the
      // current one (x.op !== o — a strong formed from this opener
      // does not block a later em wrapping it: '***foo**bar*'), and
      // each inner closer blocks only the FIRST closer after it
      // (x.bl). A *** closer blocked from a strong can still form an
      // em when both runs have length >= 3 ('***a *b*c***').
      // hasInner records whether such an inner emphasis sits between
      // the opener and closer at all (it also decides leftover
      // placement below, even when it does not block this pair).
      let blocked = false;
      let hasInner = false;
      let hasInnerAlnum = false;
      if (d.c !== 126) {
        for (let xi = oi + 1; xi < di; xi++) {
          const x = delims[xi];
          if (x.c !== d.c || !x.op || x.op === o) continue;
          if (!(x.op.o && !x.op.l)) continue;
          if (!isAlnum(x.after)) continue;
          hasInner = true;
          break;
        }
        // Broader, for the CLOSER leftover only: an inner STRONG
        // (ul === 2, a different opener) whose closer is followed by
        // a word char pulls the closer leftover inside
        // ('*foo**bar**qux**' -> '<em>foo<strong>bar</strong>qux*</em>'),
        // even when its opener can both open and close. An inner EM
        // (ul === 1) does NOT ('*a *b*c**' ->
        // '<em>a <em>b</em>c</em>*', leftover outside), and without
        // the word char after the inner closer the leftover stays
        // outside ('*a **b** c**' -> '<em>a <strong>b</strong> c</em>*').
        // No opener-length requirement (openLen 1 is enough here).
        for (let xi = oi + 1; xi < di; xi++) {
          const x = delims[xi];
          if (x.c !== d.c || !x.op || x.op === o) continue;
          if (x.ul !== 2) continue;
          if (!isAlnum(x.after)) continue;
          hasInnerAlnum = true;
          break;
        }
        for (let attempt = 0; attempt < 2; attempt++) {
          blocked = false;
          let blockedByStar = false;
          for (let xi = oi + 1; xi < di; xi++) {
            const x = delims[xi];
            if (x.c !== d.c) continue;
            if (!x.op || x.op === o) continue;
            if (!(x.op.o && !x.op.l)) continue;
            if (!isAlnum(x.after)) continue;
            // Block rule (measured grid): an inner emphasis whose
            // closer is followed by a word char blocks the outer one
            // when it used MORE than the outer would (ul > use) and
            // the closer is exactly consumed ('*a **b**c d*' stays
            // literal); when it used FEWER (ul < use), the opener has
            // length >= 2, and the closer is exactly consumed or the
            // opener keeps a leftover ('**a *b*c d**' literal,
            // '***a *b*c***' strong blocked); or when it used the
            // SAME single delimiter (ul === use === 1), the opener
            // has length >= 2, and the closer is exactly consumed
            // ('**public *so*other*' literal). A same-length strong
            // inner blocks a strong outer ONLY when a pure-closer
            // single '*' sits between the inner closer and the outer
            // closer ('**a **b**c* d**' forms an em, not a strong;
            // '**a **b**c d**' with no such '*' forms the strong).
            let blockThis = false;
            if (x.ul > use && d.n === use) blockThis = true;
            else if (x.ul < use && o.n >= 2 && (d.n === use || o.n > use)) {
              // Round 4 rescue (see hasRescuer): a pure-closer '*'
              // between this inner em and the outer closer rescues
              // the outer strong.
              if (!hasRescuer(delims, xi, di, d, s)) blockThis = true;
            }
            else if (x.ul === 1 && use === 1 && o.n >= 2 && d.n === use) {
              // Round 4 rescue, same rule: an inner em blocking an
              // outer em is also rescued ('***a *b*c** d*': the
              // unmatched '**' after 'c' lets the later '*' close
              // the outer em).
              if (!hasRescuer(delims, xi, di, d, s)) blockThis = true;
            }
            else if (x.ul === 2 && use === 2) {
              for (let yi = xi + 1; yi < di; yi++) {
                const y = delims[yi];
                if (y.c === 42 && y.n === 1 && y.l && !y.o) {
                  // The intervening '*' blocks the strong ONLY if it
                  // has no earlier single-'*' opener to pair with.
                  // If an opener exists (doc-11: '*input' before
                  // '**parse**' pairs with the '*' after 'parse'), the
                  // '*' is handled by that pairing and the strong
                  // forms. With no opener (probe32: '**a **b**c* d**')
                  // the '*' blocks the strong and an em forms.
                  let hasOpener = false;
                  for (let zi = oi + 1; zi < yi; zi++) {
                    const z = delims[zi];
                    if (z.c === 42 && z.n === 1 && z.o && !z.l) { hasOpener = true; break; }
                  }
                  if (!hasOpener) { blockThis = true; blockedByStar = true; }
                  break;
                }
              }
            }
            // Round 4 odd-match extension: a qualifying inner STRONG
            // (ul === 2) also blocks the outer pair when the ORIGINAL
            // opener and closer lengths sum to a multiple of 3 (and not
            // both multiples of 3) — even when neither side can both
            // open and close. Measured: '*a **b**c**' (1+2=3) stays
            // literal while '*a **b**c***' (1+3=4) forms an em, and
            // doc-11's final '**' is not hijacked by the intervening
            // '*'. An inner em (ul === 1) does NOT trigger this:
            // '**a *b*c** d*' must still let the later '*' close the
            // outer em after the '**' falls back to use 1.
            // (Round 4 also dropped the x.bl one-block limit: an inner
            // closer must be able to block the same outer closer from
            // several candidate openers — doc-11's '*' is blocked from
            // both '*input' and the opening '**' — and a later closer
            // too. The bl field is no longer consulted.)
            if (!blockThis && x.ul === 2 && (o.on + d.on) % 3 === 0 && !((o.on % 3 === 0) && (d.on % 3 === 0))) blockThis = true;
            if (!blockThis) continue;
            blocked = true;
            break;
          }
          if (!blocked) break;
          if (use === 2 && (blockedByStar || (laterCloser && o.n === d.n) || (o.n >= 3 && d.n >= 3))) { use = 1; continue; }
          break;
        }
      }
      if (blocked) { oi--; continue; }
      const t = d.c === 126 ? N_DEL : (use === 2 ? N_STRONG : N_EM);
      // wrap the nodes between the opener and the closer
      const emNode = mkNode(t, '', '', '');
      const firstChild = o.nd.nx;
      emNode.pa = o.nd.pa;
      let lastChild = null;
      if (firstChild === d.nd) {
        emNode.ch = null; // empty emphasis: ** **
      } else {
        emNode.ch = firstChild;
        lastChild = d.nd.pv;
        let nd = firstChild;
        while (nd !== d.nd) { nd.pa = emNode; nd = nd.nx; }
        lastChild.nx = null; // terminate the child list
      }
      o.nd.nx = emNode;
      emNode.pv = o.nd;
      emNode.nx = d.nd;
      d.nd.pv = emNode;
      // trim the used delimiter characters
      o.nd.s = o.nd.s.slice(0, o.nd.s.length - use);
      d.nd.s = d.nd.s.slice(use);
      o.n -= use;
      d.n -= use;
      // When the closer reached a pure-opener single '*' by skipping a
      // nearer '**' opener, the closer's leftover goes literal INSIDE
      // the emphasis ('*foo**bar**' -> '<em>foo**bar*</em>'), not
      // outside as usual ('*a c**' -> '<em>a c</em>*'). The used
      // delimiter is the LAST char of the closer run, so the leftover
      // (the first chars) is already inside the em's span.
      if (usedSinglePure && d.n > 0) {
        const lt = mkNode(N_TEXT, d.nd.s, '', '');
        lt.pa = emNode;
        if (lastChild) { lastChild.nx = lt; lt.pv = lastChild; }
        else emNode.ch = lt;
        d.nd.s = '';
        d.n = 0;
      }
      // Leftover placement: when a qualifying inner emphasis sits
      // between the opener and closer and the opener had length >= 2,
      // a leftover delimiter goes literal INSIDE the emphasis
      // ('**a *b*c***' -> '<strong>a <em>b</em>c*</strong>',
      // '***a *b*c***' -> '<em>**a <em>b</em>c**</em>'); otherwise
      // it stays outside ('**a c***' -> '<strong>a c</strong>*',
      // '*a *b*c**' -> '<em>a <em>b</em>c</em>*'). Round 4: when a
      // later same-char closer exists AND the opener still has
      // delimiters left (o.n > 0), the leftovers stay OUTSIDE as
      // delimiter text — the later closer wraps them into an outer
      // emphasis ('**a *b*c** d*' -> the '**' falls back to an em
      // and the later '*' closes the outer em, so the opener's and
      // closer's leftover '*' must remain usable). When the opener
      // is fully used (o.n === 0) the placement applies as usual
      // (doc-11's '**return that *old*two***' keeps the extra '*'
      // inside the strong).
      if (hasInner && openLen >= 2 && !(o.n > 0 && laterCloser)) {
        if (o.n > 0) {
          const lt = mkNode(N_TEXT, o.nd.s, '', '');
          lt.pa = emNode;
          lt.nx = emNode.ch;
          if (emNode.ch) emNode.ch.pv = lt;
          emNode.ch = lt;
          if (!lastChild) lastChild = lt;
          o.nd.s = '';
          // The moved text is rendered already, so its delimiter
          // run is consumed: set its count to 0 or the loop below
          // would re-match it into a spurious second emphasis
          // around this one.
          o.n = 0;
        }
        if (d.n > 0) {
          const lt = mkNode(N_TEXT, d.nd.s, '', '');
          lt.pa = emNode;
          if (lastChild) { lastChild.nx = lt; lt.pv = lastChild; }
          else emNode.ch = lt;
          d.nd.s = '';
          d.n = 0;
        }
      }
      // Closer leftover: inside when any inner emphasis sits between
      // the opener and closer and its closer is followed by a word
      // char (hasInnerAlnum, broader than hasInner — the inner
      // opener need not be a pure opener, and the outer opener may
      // have length 1). Otherwise it stays outside. (Round 4: also
      // skipped when a later closer exists and the opener still has
      // delimiters left, for the same reason as the hasInner
      // placement above.)
      if (hasInnerAlnum && d.n > 0 && !(o.n > 0 && laterCloser)) {
        const lt = mkNode(N_TEXT, d.nd.s, '', '');
        lt.pa = emNode;
        if (lastChild) { lastChild.nx = lt; lt.pv = lastChild; }
        else emNode.ch = lt;
        d.nd.s = '';
        d.n = 0;
      }
      // record the match on the closer for the marked emphasis quirk
      // (see the blocking check above): the next outer closer can tell
      // this closer matched `o` with `use` delimiters.
      d.op = o;
      d.ul = use;
      if (o.n === 0) o.a = false;
      if (d.n === 0) { d.a = false; break; }
      // Closer still has length. Re-check the same opener ONLY when
      // the match just formed used 2 delimiters (a strong): '***a***'
      // forms the em around the strong, '****a****' a second strong.
      // When the match used 1 (an em — e.g. a fallback after the
      // strong was blocked), the closer must NOT re-match the same
      // opener: '**a *b*c** d*' would otherwise form a spurious
      // second em around the first, and the later '*' would never
      // close the outer em. Move on to the next opener below.
      if (use === 1) oi--;
    }
  }
}

// Render a node list to HTML.
// Plain-text content of a node's children (emphasis/code/link markup
// resolved to their text). Used for an image's alt attribute, computed at
// render time so emphasis inside the alt is already resolved.
function stringContent(nn) {
  let out = '';
  let cur = nn.ch;
  while (cur) {
    if (cur.t === N_TEXT || cur.t === N_CODE) out += cur.s;
    else if (cur.t === N_IMAGE) out += stringContent(cur);
    else if (cur.ch) out += stringContent(cur);
    cur = cur.nx;
  }
  return out;
}

function renderNodes(head) {
  let out = '';
  let nd = head;
  while (nd) {
    switch (nd.t) {
      case N_TEXT:
        out += escText(nd.s);
        break;
      case N_CODE:
        out += '<code>' + escRaw(nd.s) + '</code>';
        break;
      case N_EM:
        out += '<em>' + renderNodes(nd.ch) + '</em>';
        break;
      case N_STRONG:
        out += '<strong>' + renderNodes(nd.ch) + '</strong>';
        break;
      case N_DEL:
        out += '<del>' + renderNodes(nd.ch) + '</del>';
        break;
      case N_LINK: {
        const href = escText(nd.h);
        out += '<a href="' + href + '"';
        if (nd.ti !== '') out += ' title="' + escText(nd.ti) + '"';
        out += '>' + renderNodes(nd.ch) + '</a>';
        break;
      }
      case N_IMAGE: {
        const src = escText(nd.h);
        out += '<img src="' + src + '" alt="' + escRaw(stringContent(nd)) + '"';
        if (nd.ti !== '') out += ' title="' + escText(nd.ti) + '"';
        out += '>';
        break;
      }
      case N_HTML:
        out += nd.s;
        break;
      case N_BR:
        out += '<br>';
        break;
    }
    nd = nd.nx;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

function renderBlocks(parsed) {
  return renderChildren(parsed.doc.children, parsed.refs, null);
}

function renderChildren(children, refs, listCtx) {
  let out = '';
  // In a tight list, a paragraph AFTER a sublist is wrapped in <p>
  // even though the list is tight (probe40/doc-19: '+ a' + '  4.' +
  // 'tab' gives '<p>tab</p>'; a paragraph after a blockquote stays
  // unwrapped). Track whether a sublist has been seen among the
  // preceding siblings in this children array.
  let seenList = false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.t === T_LIST) seenList = true;
    if (child.t === T_PARA && listCtx && listCtx.tight && seenList) {
      out += '<p>' + renderInline(child.lines.join('\n'), refs) + '</p>\n';
    } else {
      out += renderBlock(child, refs, listCtx, i, children.length);
    }
  }
  return out;
}

function renderBlock(b, refs, listCtx, index, count) {
  switch (b.t) {
    case T_PARA: {
      const html = renderInline(b.lines.join('\n'), refs);
      // A paragraph in a tight list renders without <p> tags and without
      // a trailing newline (cm-009: <li>foo<ul> — no \n after foo).
      if (listCtx && listCtx.tight) {
        return html;
      }
      return '<p>' + html + '</p>\n';
    }
    case T_HEAD:
      return '<h' + b.level + '>' + renderInline(b.info, refs) + '</h' + b.level + '>\n';
    case T_CODE: {
      let lang = '';
      if (b.fence !== '' && b.info !== '') {
        const word = b.info.split(/[ \t]/, 1)[0];
        // resolve backslash escapes in the info string, then escape with
        // entity preservation (marked escapes the info the same way)
        lang = ' class="language-' + escText(unescapeStr(word)) + '"';
      }
      const content = b.lines.length ? b.lines.join('\n') + '\n' : '';
      return '<pre><code' + lang + '>' + escRaw(content) + '</code></pre>\n';
    }
    case T_HTML:
      // An HTML block is its lines joined by \n, with a trailing \n only
      // when the next source line is non-blank (or at EOF with a trailing
      // newline) — recorded as trailNl when the block ended. Round 4:
      // a trailing \n is dropped when the HTML block is the last child
      // of its list item (doc-30: '<!-- note -->' at a list-item start
      // must not put '\n' before '</li>'), tight or loose.
      return b.lines.join('\n') + (b.trailNl && !(listCtx && index === count - 1) ? '\n' : '');
    case T_QUOTE:
      // reset listCtx: a paragraph inside a blockquote is not a direct
      // child of a list item, so a tight list does not strip its <p>
      // (cm-292/293)
      return '<blockquote>\n' + renderChildren(b.children, refs, null) + '</blockquote>\n';
    case T_LIST: {
      let out;
      if (b.delim === '') out = '<ul>\n';
      else out = '<ol' + (b.start !== 1 ? ' start="' + b.start + '"' : '') + '>\n';
      out += renderChildren(b.children, refs, b);
      out += b.delim === '' ? '</ul>\n' : '</ol>\n';
      return out;
    }
    case T_ITEM: {
      // Task list: [ ] / [x] / [X] at the start of the first paragraph
      const ch = b.children;
      if (ch.length > 0 && ch[0].t === T_PARA) {
        const text = ch[0].lines.join('\n');
        const m = /^\[([ xX])\]/.exec(text);
        if (m && (text.length === 3 || text.charCodeAt(3) === 32 || text.charCodeAt(3) === 9)) {
          const checked = m[1] === 'x' || m[1] === 'X';
          const box = checked
            ? '<input checked="" disabled="" type="checkbox">'
            : '<input disabled="" type="checkbox">';
          // strip the 3-char marker; the following space stays (it
          // separates the checkbox from the text)
          const inner = box + renderInline(text.slice(3), refs);
          let out = '<li>';
          if (listCtx && listCtx.tight) out += inner;
          else out += '<p>' + inner + '</p>\n';
          // In a tight list, a paragraph AFTER a sublist is wrapped in
          // <p> even though the list is tight (probe40/doc-19: '+ a' +
          // '  4.' + 'tab' gives '<p>tab</p>'; a paragraph after a
          // blockquote stays unwrapped). Track whether a sublist has
          // been seen among the preceding siblings.
          let seenList = ch[0].t === T_LIST;
          for (let i = 1; i < ch.length; i++) {
            if (ch[i].t === T_LIST) seenList = true;
            if (ch[i].t === T_PARA && listCtx && listCtx.tight && seenList) {
              out += '<p>' + renderInline(ch[i].lines.join('\n'), refs) + '</p>\n';
            } else {
              out += renderBlock(ch[i], refs, listCtx, i, ch.length);
            }
          }
          return out + '</li>\n';
        }
      }
      return '<li>' + renderChildren(b.children, refs, listCtx) + '</li>\n';
    }
    case T_TABLE: {
      let out = '<table>\n<thead>\n<tr>\n';
      for (let i = 0; i < b.head.length; i++) {
        const al = b.aligns[i];
        out += '<th' + (al ? ' align="' + al + '"' : '') + '>' +
          renderInline(b.head[i].trim(), refs) + '</th>\n';
      }
      out += '</tr>\n</thead>\n';
      if (b.rows.length === 0) {
        // no body rows: no <tbody> at all (gfm-205)
        out += '</table>\n';
        return out;
      }
      out += '<tbody>';
      for (let r = 0; r < b.rows.length; r++) {
        out += '<tr>\n';
        const row = b.rows[r];
        for (let i = 0; i < b.head.length; i++) {
          const cell = i < row.length ? row[i].trim() : '';
          const al = b.aligns[i];
          out += '<td' + (al ? ' align="' + al + '"' : '') + '>' +
            renderInline(cell, refs) + '</td>\n';
        }
        out += '</tr>\n';
      }
      out += '</tbody></table>\n';
      return out;
    }
    case T_HR:
      return '<hr>\n';
    default:
      return '';
  }
}
