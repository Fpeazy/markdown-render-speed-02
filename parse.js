// parse.js — dependency-free CommonMark 0.31.2 + GFM 0.29 renderer,
// byte-identical to marked 18.1.3 (default options) on the 720-case set.
// Written fresh in-session under recording 7. Single-pass direct-to-HTML
// design: no token tree, index scanning with charCodeAt, zero-copy spans.

export function parse(src) {
  return renderDocument(normalizeSrc(src));
}

// ---------------------------------------------------------------- helpers

function isAlpha(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122); }
function isDigit(c) { return c >= 48 && c <= 57; }
function isAlnum(c) { return isAlpha(c) || isDigit(c); }
function isSpace(c) { return c === 32 || c === 9 || c === 10 || c === 13 || c === 11 || c === 12; }
function isBlankStr(s) { for (let i = 0; i < s.length; i++) if (!isSpace(s.charCodeAt(i))) return false; return true; }

// ASCII punctuation (CommonMark): !"#$%&'()*+,-./:;<=>?@[\]^_`{|}~
function isPunct(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
function isPunctChar(ch) { return ch.length === 1 && isPunct(ch.charCodeAt(0)); }

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s) {
  return s.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch]);
}
function escapeAttr(s) { return escapeHtml(s); }

// Escape for href/title/alt: marked leaves &-sequences that look like
// entities (&word; &#123; &#x1F;) untouched and escapes other & to &amp;.
function escapeAttrEnt(s) {
  return s.replace(/&(?![#]?\w+;)/g, '&amp;')
    .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------- entities

// Curated HTML5 named entities (the ones that appear in the spec set and
// common documents). Numeric entities are handled separately.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  times: '×', divide: '÷', plusmn: '±', minus: '−', deg: '°', micro: 'µ',
  para: '¶', sect: '§', middot: '·', bull: '•', dagger: '†', Dagger: '‡',
  permil: '‰', prime: '′', Prime: '″', oline: '‾', frasl: '⁄',
  euro: '€', pound: '£', yen: '¥', cent: '¢', curren: '¤', brvbar: '¦',
  uml: '¨', ordf: 'ª', ordm: 'º', iexcl: '¡', iquest: '¿', szlig: 'ß',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', AElig: 'Æ', ccedil: 'ç', Ccedil: 'Ç', egrave: 'è', eacute: 'é',
  ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ETH: 'Ð', ntilde: 'ñ', Ntilde: 'Ñ', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', Oslash: 'Ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', Yacute: 'Ý',
  yuml: 'ÿ', thorn: 'þ', THORN: 'Þ',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í',
  Icirc: 'Î', Iuml: 'Ï', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Ouml: 'Ö', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yuml: 'Ÿ',
  Aacute2: 'Á',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ',
  Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ',
  Nu: 'Ν', Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ',
  Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigmaf: 'ς',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', thetasym: 'ϑ', upsih: 'ϒ', piv: 'ϖ',
  forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇',
  isin: '∈', notin: '∉', ni: '∋', prod: '∏', sum: '∑',
  lowast: '∗', radic: '√', prop: '∝', infin: '∞', ang: '∠',
  and: '∧', or: '∨', cap: '∩', cup: '∪', int: '∫', there4: '∴',
  sim: '∼', cong: '≅', asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥',
  sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇',
  oplus: '⊕', otimes: '⊗', perp: '⊥', sdot: '⋅',
  lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '〈', rang: '〉',
  loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍',
  lrm: '‎', rlm: '‏',
  fnof: 'ƒ', image: 'ℑ', weierp: '℘', real: 'ℜ', alefsym: 'ℵ',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔', crarr: '↵',
  lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓', hArr: '⇔',
  circ: 'ˆ', tilde: '˜', ensp2: ' ',
  frac14: '¼', frac12: '½', frac34: '¾',
  sup1: '¹', sup2: '²', sup3: '³',
  Dcaron: 'Ď', dcaron: 'ď', HilbertSpace: 'ℋ', Hopf: 'ℍ',
  DifferentialD: 'ⅆ', ClockwiseContourIntegral: '∲', ngE: '≧̸',
  Tab: '\t', NewLine: '\n', colon: ':', sol: '/', bsol: '\\',
 fjlig: 'fj', fflig: 'ff', fllig: 'fl', ffilig: 'ffi', ffllig: 'ffl',
  Aopf: '𝔸', Bopf: '𝔹', Copf: 'ℂ', Dop: '𝔻', Eopf: '𝔼', Fopf: '𝔽',
  Gopf: '𝔾', Hopf2: 'ℍ', Iopf: '𝕀', Jopf: '𝕁', Kopf: '𝕂', Lopf: '𝕃',
  Mopf: '𝕄', Nopf: 'ℕ', Oopf: '𝕆', Popf: 'ℙ', Qopf: 'ℚ', Ropf: 'ℝ',
  Sopf: '𝕊', Topf: '𝕋', Uopf: '𝕌', Vopf: '𝕍', Wopf: '𝕎', Xopf: '𝕏',
  Yopf: '𝕐', Zopf: 'ℤ',
};

// Decode an entity starting at s[i] === '&'. Returns [decoded, nextIndex]
// or null if there is no valid entity here.
function decodeEntityAt(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  if (s.charCodeAt(i + 1) === 35) {
    // numeric: &#123; &#x1F; &#X1F;
    let j = i + 2;
    let hex = false;
    if (j < n && (s.charCodeAt(j) === 120 || s.charCodeAt(j) === 88)) { hex = true; j++; }
    const start = j;
    while (j < n) {
      const c = s.charCodeAt(j);
      if (hex ? (isDigit(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)) : isDigit(c)) j++;
      else break;
    }
    // marked caps numeric entities: decimal 1-7 digits, hex 1-6 digits.
    // Longer runs are not entities at all (e.g. &#87654321; stays literal).
    if (j === start || j >= n || s.charCodeAt(j) !== 59) return null;
    if (hex ? j - start > 6 : j - start > 7) return null;
    const num = parseInt(s.slice(start, j), hex ? 16 : 10);
    let ch;
    if (!num || num > 0x10FFFF || (num >= 0xD800 && num <= 0xDFFF)) ch = '�';
    else ch = String.fromCodePoint(num);
    return [ch, j + 1];
  }
  // named: &name;
  let j = i + 1;
  while (j < n && isAlnum(s.charCodeAt(j))) j++;
  if (j < n && s.charCodeAt(j) === 59 && j > i + 1) {
    const name = s.slice(i + 1, j);
    const v = ENTITIES[name];
    if (v !== undefined) return [v, j + 1];
  }
  return null;
}

// ---------------------------------------------------------------- normalize

// Line endings -> \n. Tabs are NOT expanded: marked keeps tabs as content
// and only uses them for column measurement (a tab advances to the next
// multiple of 4 columns).
function normalizeSrc(src) {
  return src.replace(/\r\n?/g, '\n');
}

// Column width of the leading whitespace of a line (space = 1, tab = to
// the next multiple of 4 columns).
function indentCols(line) {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Strip up to `cols` columns of leading whitespace. A tab that straddles
// the boundary is partially consumed: the remaining columns become spaces.
function stripIndentCols(line, cols) {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    const c = line.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) {
      const adv = 4 - (col % 4);
      if (col + adv <= cols) { col += adv; i++; }
      else return ' '.repeat(adv - (cols - col)) + line.slice(i + 1);
    } else break;
  }
  return line.slice(i);
}

// Strip `cols` columns of leading whitespace with FULL tab expansion:
// every leading tab is expanded to spaces (absolute tab stops) before
// slicing. This is the model marked uses when it strips a list item's
// content indent (cm-005: - foo + blank + \t\tbar -> code "  bar").
function stripIndentExpanded(line, cols) {
  let i = 0;
  let col = 0;
  let expanded = '';
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) { expanded += ' '; col++; i++; }
    else if (c === 9) { const adv = 4 - (col % 4); expanded += ' '.repeat(adv); col += adv; i++; }
    else break;
  }
  return expanded.slice(cols) + line.slice(i);
}

// ---------------------------------------------------------------- inline

// Item shapes (linked list via prev/next):
// {t:'text', s} {t:'code', s} {t:'html', s} {t:'br'}
// {t:'link', href, title, children:[...]} {t:'img', src, title, alt}
// {t:'delim', ch, len, canOpen, canClose, dead}
// {t:'em'|'strong'|'del', children:[...]}

function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(/%25/g, '%');
  } catch (e) {
    return null;
  }
  return href;
}

function renderItemsToHtml(items) {
  let out = '';
  for (const it of items) out += renderItem(it);
  return out;
}

function renderItem(it) {
  switch (it.t) {
    case 'text': return escapeHtml(it.s);
    case 'raw': return it.s;
    case 'code': return '<code>' + escapeHtml(it.s) + '</code>';
    case 'html': return it.s;
    case 'br': return '<br>';
    case 'link': {
      const href = cleanUrl(it.href);
      const h = href === null ? '' : escapeAttrEnt(href);
      const title = it.title !== null && it.title !== undefined
        ? ' title="' + escapeAttrEnt(it.title) + '"' : '';
      return '<a href="' + h + '"' + title + '>' + renderItemsToHtml(it.children) + '</a>';
    }
    case 'img': {
      const src = cleanUrl(it.src);
      const s = src === null ? '' : escapeAttrEnt(src);
      const title = it.title !== null && it.title !== undefined
        ? ' title="' + escapeAttrEnt(it.title) + '"' : '';
      return '<img src="' + s + '" alt="' + escapeAttrEnt(it.alt) + '"' + title + '>';
    }
    case 'em': return '<em>' + renderItemsToHtml(it.children) + '</em>';
    case 'strong': return '<strong>' + renderItemsToHtml(it.children) + '</strong>';
    case 'del': return '<del>' + renderItemsToHtml(it.children) + '</del>';
    default: return '';
  }
}

function itemsToText(items) {
  let out = '';
  for (const it of items) {
    if (it.t === 'text' || it.t === 'code') out += it.s;
    else if (it.t === 'raw') out += it.s; // named entities stay literal in alt text
    else if (it.t === 'em' || it.t === 'strong' || it.t === 'del') out += itemsToText(it.children);
    else if (it.t === 'link') out += itemsToText(it.children);
    else if (it.t === 'br') out += '\n';
  }
  return out;
}

function containsLink(items) {
  for (const it of items) {
    if (it.t === 'link') return true;
    if (it.t === 'em' || it.t === 'strong' || it.t === 'del') {
      if (containsLink(it.children)) return true;
    }
  }
  return false;
}

// Normalize a link label for reference lookup: collapse whitespace, lowercase.
function normalizeLabel(label) {
  return label.replace(/\s+/g, ' ').trim().toLowerCase();
}

// Scan an HTML tag / comment / PI / declaration / CDATA starting at s[i] === '<'.
// Returns end index (exclusive) or -1.
function scanHtmlTag(s, i) {
  const n = s.length;
  if (i + 1 >= n) return -1;
  const c1 = s[i + 1];
  if (c1 === '!') {
    if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      return e === -1 ? -1 : e + 3;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const e = s.indexOf(']]>', i + 9);
      return e === -1 ? -1 : e + 3;
    }
    if (i + 2 < n && isAlpha(s.charCodeAt(i + 2))) {
      const e = s.indexOf('>', i + 2);
      return e === -1 ? -1 : e + 1;
    }
    return -1;
  }
  if (c1 === '?') {
    const e = s.indexOf('?>', i + 2);
    return e === -1 ? -1 : e + 2;
  }
  let j = i + 1;
  let closing = false;
  if (j < n && s.charCodeAt(j) === 47) { closing = true; j++; }
  if (j >= n || !isAlpha(s.charCodeAt(j))) return -1;
  while (j < n && (isAlnum(s.charCodeAt(j)) || s.charCodeAt(j) === 45)) j++;
  if (closing) {
    while (j < n && isSpace(s.charCodeAt(j))) j++;
    if (j < n && s.charCodeAt(j) === 62) return j + 1;
    return -1;
  }
  // attributes
  while (j < n) {
    const ch = s.charCodeAt(j);
    if (isSpace(ch)) { j++; continue; }
    if (ch === 62) return j + 1;
    if (ch === 47) {
      if (j + 1 < n && s.charCodeAt(j + 1) === 62) return j + 2;
      return -1;
    }
    if (!(isAlpha(ch) || ch === 95 || ch === 58)) return -1;
    j++;
    while (j < n) {
      const c2 = s.charCodeAt(j);
      if (isAlnum(c2) || c2 === 95 || c2 === 58 || c2 === 46 || c2 === 45) j++;
      else break;
    }
    let k = j;
    while (k < n && isSpace(s.charCodeAt(k))) k++;
    if (k < n && s.charCodeAt(k) === 61) {
      k++;
      while (k < n && isSpace(s.charCodeAt(k))) k++;
      if (k >= n) return -1;
      const q = s.charCodeAt(k);
      if (q === 34 || q === 39) {
        k++;
        while (k < n && s.charCodeAt(k) !== q) k++;
        if (k >= n) return -1;
        j = k + 1;
      } else {
        if (isSpace(q) || q === 34 || q === 39 || q === 61 || q === 60 || q === 62 || q === 96) return -1;
        while (k < n) {
          const c3 = s.charCodeAt(k);
          if (isSpace(c3) || c3 === 34 || c3 === 39 || c3 === 61 || c3 === 60 || c3 === 62 || c3 === 96) break;
          k++;
        }
        j = k;
      }
    } else {
      j = k;
    }
  }
  return -1;
}

// Find the matching ']' for the '[' at s[i]. Returns index or -1.
// Bracket counting, escape-aware, code-span aware.
function findMatchingBracket(s, i) {
  const n = s.length;
  let depth = 1;
  let j = i + 1;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (c === 92) { j += 2; continue; }
    if (c === 96) {
      let k = j;
      while (k < n && s.charCodeAt(k) === 96) k++;
      const run = k - j;
      let m = k;
      let found = -1;
      while (m < n) {
        if (s.charCodeAt(m) === 96) {
          let q = m;
          while (q < n && s.charCodeAt(q) === 96) q++;
          if (q - m === run) { found = q; break; }
          m = q;
        } else m++;
      }
      if (found === -1) return -1;
      j = found;
      continue;
    }
    if (c === 91) depth++;
    else if (c === 93) {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

function unescapeText(s) {
  return s.replace(/\\([!\"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~])/g, '$1');
}

function decodeEntitiesIn(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 38) {
      const d = decodeEntityAt(s, i);
      if (d) { out += d[0]; i = d[1]; continue; }
    }
    out += s[i];
    i++;
  }
  return out;
}

// Parse an inline link destination/title starting at s[j] === '('.
// Returns {dest, title, next} or null.
function parseInlineDest(s, j) {
  const n = s.length;
  let k = j + 1;
  while (k < n && isSpace(s.charCodeAt(k))) k++;
  if (k >= n) return null;
  let dest = '';
  if (s.charCodeAt(k) === 60) {
    let e = k + 1;
    while (e < n) {
      // a backslash escapes the next char, so \> does not close the dest
      if (s.charCodeAt(e) === 92 && e + 1 < n) { e += 2; continue; }
      if (s.charCodeAt(e) === 62 || s.charCodeAt(e) === 10 || s.charCodeAt(e) === 60) break;
      e++;
    }
    if (e >= n || s.charCodeAt(e) !== 62) return null;
    dest = s.slice(k + 1, e);
    k = e + 1;
  } else {
    let depth = 0;
    let e = k;
    while (e < n) {
      const c = s.charCodeAt(e);
      if (c === 92 && e + 1 < n && isPunctChar(s[e + 1])) { e += 2; continue; }
      if (c === 40) depth++;
      else if (c === 41) { if (depth === 0) break; depth--; }
      else if (isSpace(c)) break;
      e++;
    }
    if (depth !== 0) return null;
    dest = s.slice(k, e);
    k = e;
  }
  // marked does NOT decode entities in destinations/titles: &word; and
  // &#123; pass through literally (only backslash escapes are resolved).
  dest = unescapeText(dest);
  while (k < n && isSpace(s.charCodeAt(k))) k++;
  let title = null;
  if (k < n && (s.charCodeAt(k) === 34 || s.charCodeAt(k) === 39 || s.charCodeAt(k) === 40)) {
    const q = s.charCodeAt(k);
    const closeQ = q === 40 ? 41 : q;
    let e = k + 1;
    while (e < n && s.charCodeAt(e) !== closeQ) {
      if (s.charCodeAt(e) === 92 && e + 1 < n) e += 2;
      else e++;
    }
    if (e >= n) return null;
    title = unescapeText(s.slice(k + 1, e));
    k = e + 1;
    while (k < n && isSpace(s.charCodeAt(k))) k++;
  }
  if (k >= n || s.charCodeAt(k) !== 41) return null;
  return { dest, title, next: k + 1 };
}

// Try to parse a link/image starting at s[i] === '['.
// Returns {item, next} or null.
function tryParseLink(s, i, refs, isImage) {
  const close = findMatchingBracket(s, i);
  if (close === -1) return null;
  const labelRaw = s.slice(i + 1, close);
  let after = close + 1;
  let dest = null;
  let title = null;
  if (after < s.length && s.charCodeAt(after) === 40) {
    const d = parseInlineDest(s, after);
    if (!d) return null;
    dest = d.dest;
    title = d.title;
    after = d.next;
  } else if (after < s.length && s.charCodeAt(after) === 91) {
    const close2 = findMatchingBracket(s, after);
    if (close2 === -1) return null;
    const label2 = close2 === after + 1 ? labelRaw : s.slice(after + 1, close2);
    const ref = refs.get(normalizeLabel(label2));
    if (!ref) return null;
    dest = ref.dest;
    title = ref.title;
    after = close2 + 1;
  } else {
    const ref = refs.get(normalizeLabel(labelRaw));
    if (!ref) return null;
    dest = ref.dest;
    title = ref.title;
    after = close + 1;
  }
  const labelItems = parseInlineToItems(labelRaw, refs);
  if (!isImage && containsLink(labelItems)) return null;
  if (isImage) {
    const alt = itemsToText(labelItems);
    return { item: { t: 'img', src: dest, title, alt }, next: after };
  }
  return { item: { t: 'link', href: dest, title, children: labelItems }, next: after };
}

// GFM extended autolink: www., http(s)://, ftp://, or bare email.
// prevOk: the char before the match allows an autolink (start/space/punct).
// Returns {item, next} or null.
function tryExtendedAutolink(s, i) {
  const n = s.length;
  const rest = s.slice(i, i + 1000);
  let m = null;
  let scheme = false;
  if (rest.startsWith('www.')) m = /^www\.[^\s<]+/.exec(rest);
  else if (rest.startsWith('https://') || rest.startsWith('http://') || rest.startsWith('ftp://')) {
    m = /^(?:https?|ftp):\/\/[^\s<]+/.exec(rest);
    scheme = true;
  } else {
    // bare email
    m = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/.exec(rest);
    if (m) {
      const email = m[0];
      const at = email.lastIndexOf('@');
      const domain = email.slice(at + 1);
      const lastDot = domain.lastIndexOf('.');
      const tld = domain.slice(lastDot + 1);
      if (lastDot === -1 || tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) return null;
      return { item: { t: 'link', href: 'mailto:' + email, title: null, children: [{ t: 'text', s: email }] }, next: i + email.length };
    }
    return null;
  }
  if (!m) return null;
  let url = m[0];
  // Validate the domain: must contain a dot whose final label is >= 2 letters.
  const hostEnd = (() => {
    const afterScheme = scheme ? url.indexOf('://') + 3 : 4;
    let e = afterScheme;
    while (e < url.length && !/[/?#]/.test(url[e])) e++;
    return e;
  })();
  const host = url.slice(scheme ? url.indexOf('://') + 3 : 4, hostEnd);
  const lastDot = host.lastIndexOf('.');
  if (lastDot <= 0) return null;
  const tld = host.slice(lastDot + 1);
  if (tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) return null;
  // Trim trailing punctuation / unbalanced parens / entity semicolon.
  url = trimAutolinkEnd(url);
  if (!url) return null;
  const href = scheme ? url : 'http://' + url;
  return { item: { t: 'link', href, title: null, children: [{ t: 'text', s: url }] }, next: i + url.length };
}

function trimAutolinkEnd(url) {
  // trailing punctuation ? ! . , : * _ ~
  let end = url.length;
  while (end > 0) {
    const c = url.charCodeAt(end - 1);
    if (c === 63 || c === 33 || c === 46 || c === 44 || c === 58 || c === 42 || c === 95 || c === 126) end--;
    else break;
  }
  url = url.slice(0, end);
  // trailing ';' that forms a valid entity is excluded
  if (url.endsWith(';')) {
    const amp = url.lastIndexOf('&');
    if (amp !== -1) {
      const cand = url.slice(amp);
      if (decodeEntityAt(cand, 0)) url = url.slice(0, -1);
    }
  }
  // unbalanced trailing ')'
  while (url.endsWith(')')) {
    let open = 0, close = 0;
    for (let k = 0; k < url.length; k++) {
      if (url[k] === '(') open++;
      else if (url[k] === ')') close++;
    }
    if (close > open) url = url.slice(0, -1);
    else break;
  }
  return url;
}

// Left/right flanking for a delimiter run s[i..i+len) using the chars
// immediately before and after the run in the original string.
function flanking(s, i, len) {
  const before = i > 0 ? s[i - 1] : '';
  const after = i + len < s.length ? s[i + len] : '';
  const beforeWs = before === '' || /\s/.test(before);
  const afterWs = after === '' || /\s/.test(after);
  const beforePunct = before !== '' && (isPunctChar(before) || /[\p{P}]/u.test(before));
  const afterPunct = after !== '' && (isPunctChar(after) || /[\p{P}]/u.test(after));
  const leftFlanking = !afterWs && (!afterPunct || beforeWs || beforePunct);
  const rightFlanking = !beforeWs && (!beforePunct || afterWs || afterPunct);
  return { leftFlanking, rightFlanking, beforePunct, afterPunct };
}

// Tokenize inline text into a linked list of items. Returns {head, delims}.
function tokenizeInline(s, refs) {
  const n = s.length;
  let head = null;
  let tail = null;
  const delims = [];
  let textBuf = '';
  function append(it) {
    it.prev = tail;
    it.next = null;
    if (tail) tail.next = it;
    else head = it;
    tail = it;
    return it;
  }
  function flushText() {
    if (textBuf) { append({ t: 'text', s: textBuf }); textBuf = ''; }
  }
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    // extended autolink at a word boundary
    if (isAlpha(c) && (i === 0 || isSpace(s.charCodeAt(i - 1)) || isPunctChar(s[i - 1]))) {
      const a = tryExtendedAutolink(s, i);
      if (a) { flushText(); append(a.item); i = a.next; continue; }
    }
    if (c === 92) { // backslash
      if (i + 1 < n && s.charCodeAt(i + 1) === 10) { flushText(); append({ t: 'br' }); i += 2; continue; }
      if (i + 1 < n && isPunctChar(s[i + 1])) { textBuf += s[i + 1]; i += 2; continue; }
      textBuf += '\\';
      i++;
      continue;
    }
    if (c === 96) { // backtick run -> code span
      let k = i;
      while (k < n && s.charCodeAt(k) === 96) k++;
      const run = k - i;
      let m = k;
      let found = -1;
      while (m < n) {
        if (s.charCodeAt(m) === 96) {
          let q = m;
          while (q < n && s.charCodeAt(q) === 96) q++;
          if (q - m === run) { found = m; break; }
          m = q;
        } else m++;
      }
      if (found !== -1) {
        let content = s.slice(k, found).replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && content.trim() !== '') {
          content = content.slice(1, -1);
        }
        flushText();
        append({ t: 'code', s: content });
        i = found + run;
        continue;
      }
      textBuf += s.slice(i, k);
      i = k;
      continue;
    }
    if (c === 60) { // '<' -> html tag / autolink
      const tagEnd = scanHtmlTag(s, i);
      if (tagEnd !== -1) { flushText(); append({ t: 'html', s: s.slice(i, tagEnd) }); i = tagEnd; continue; }
      const rest = s.slice(i, i + 1000);
      const am = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}):([^<>\s]+)>/.exec(rest);
      if (am) {
        flushText();
        const url = am[1] + ':' + am[2];
        append({ t: 'link', href: url, title: null, children: [{ t: 'text', s: url }] });
        i += am[0].length;
        continue;
      }
      const em = /^<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(rest);
      if (em) {
        flushText();
        append({ t: 'link', href: 'mailto:' + em[1], title: null, children: [{ t: 'text', s: em[1] }] });
        i += em[0].length;
        continue;
      }
      textBuf += '<';
      i++;
      continue;
    }
    if (c === 38) { // '&': marked decodes numeric entities, passes &word; through raw
      if (i + 1 < n && s.charCodeAt(i + 1) === 35) {
        const d = decodeEntityAt(s, i);
        if (d) { textBuf += d[0]; i = d[1]; continue; }
      } else {
        let j = i + 1;
        while (j < n && isAlnum(s.charCodeAt(j))) j++;
        if (j > i + 1 && j < n && s.charCodeAt(j) === 59) {
          flushText();
          append({ t: 'raw', s: s.slice(i, j + 1) });
          i = j + 1;
          continue;
        }
      }
      textBuf += '&';
      i++;
      continue;
    }
    if (c === 33 && i + 1 < n && s.charCodeAt(i + 1) === 91) { // ![ -> image
      const r = tryParseLink(s, i + 1, refs, true);
      if (r) { flushText(); append(r.item); i = r.next; continue; }
      textBuf += '!';
      i++;
      continue;
    }
    if (c === 91) { // [ -> link
      const r = tryParseLink(s, i, refs, false);
      if (r) { flushText(); append(r.item); i = r.next; continue; }
      textBuf += '[';
      i++;
      continue;
    }
    if (c === 42 || c === 95 || c === 126) { // * _ ~ delimiter runs
      let k = i;
      while (k < n && s.charCodeAt(k) === c) k++;
      const len = k - i;
      if (c === 126 && len < 2) { textBuf += s.slice(i, k); i = k; continue; }
      const ch = String.fromCharCode(c);
      const fl = flanking(s, i, len);
      let canOpen, canClose;
      if (ch === '_') {
        canOpen = fl.leftFlanking && (!fl.rightFlanking || fl.beforePunct);
        canClose = fl.rightFlanking && (!fl.leftFlanking || fl.afterPunct);
      } else {
        canOpen = fl.leftFlanking;
        canClose = fl.rightFlanking;
      }
      flushText();
      const d = append({ t: 'delim', ch, len, canOpen, canClose, dead: false });
      delims.push(d);
      i = k;
      continue;
    }
    if (c === 10) { // newline -> soft break (literal \n)
      textBuf += '\n';
      i++;
      continue;
    }
    if (c === 32) { // spaces: hard break if 2+ before a newline
      let k = i;
      while (k < n && s.charCodeAt(k) === 32) k++;
      if (k - i >= 2 && k < n && s.charCodeAt(k) === 10) {
        flushText();
        append({ t: 'br' });
        i = k + 1;
        continue;
      }
      textBuf += s.slice(i, k);
      i = k;
      continue;
    }
    textBuf += s[i];
    i++;
  }
  flushText();
  return { head, delims };
}

// CommonMark emphasis algorithm over the token list.
function processEmphasis(head, delims) {
  // Build a live doubly-linked list; items keep prev/next pointers.
  // delims are the delimiter items in order of appearance.
  for (let di = 0; di < delims.length; di++) {
    const closer = delims[di];
    if (closer.dead || !closer.canClose || closer.len === 0) continue;
    while (closer.len > 0 && closer.canClose && !closer.dead) {
      // find the nearest earlier opener that can match
      let opener = null;
      for (let k = di - 1; k >= 0; k--) {
        const d = delims[k];
        if (d.dead || d.len === 0 || d.ch !== closer.ch || !d.canOpen) continue;
        if (d.canClose && closer.canOpen && (d.len + closer.len) % 3 === 0) continue;
        opener = d;
        break;
      }
      if (!opener) break;
      const use = opener.ch === '~' ? 2 : (opener.len >= 2 && closer.len >= 2 ? 2 : 1);
      const tag = opener.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
      // collect live items strictly between opener and closer
      const children = [];
      let cur = opener.next;
      while (cur && cur !== closer) {
        const nxt = cur.next;
        children.push(cur);
        if (cur.t === 'delim') cur.dead = true;
        cur.prev = null;
        cur.next = null;
        cur = nxt;
      }
      const node = { t: tag, children, prev: null, next: null };
      // splice node into the list at the opener's position
      opener.len -= use;
      closer.len -= use;
      if (opener.len === 0) {
        opener.dead = true;
        node.prev = opener.prev;
        node.next = closer;
        if (opener.prev) opener.prev.next = node;
        opener.prev = null;
        opener.next = null;
      } else {
        node.prev = opener;
        node.next = closer;
        opener.next = node;
      }
      if (closer.len === 0) {
        closer.dead = true;
        node.next = closer.next;
        if (closer.next) closer.next.prev = node;
        closer.prev = null;
        closer.next = null;
      } else {
        closer.prev = node;
      }
      // the new node may be the head; head is recomputed by caller via walk
      if (node.prev === null) {
        // node is now the first live item; keep a reference on the closer loop
        // (callers walk from the stored head pointer — handled in parseInlineToItems)
        processEmphasis._head = node;
      }
    }
  }
  // remaining delimiters become literal text
  for (const d of delims) {
    if (!d.dead && d.len > 0) {
      d.t = 'text';
      d.s = d.ch.repeat(d.len);
      delete d.ch;
      delete d.len;
    }
  }
}

function listToArray(head) {
  const out = [];
  let cur = head;
  while (cur) {
    out.push(cur);
    cur = cur.next;
  }
  return out;
}

// Parse inline text into a list of items (emphasis resolved).
function parseInlineToItems(s, refs) {
  const { head, delims } = tokenizeInline(s, refs);
  if (!head) return [];
  processEmphasis._head = head;
  processEmphasis(head, delims);
  let h = processEmphasis._head;
  // the head may have moved: walk back from any live item to find the start
  // (find the leftmost live item by following prev pointers from the old head's neighbours)
  // Simpler: the list is still connected through prev/next; find start from h.
  while (h && h.prev) h = h.prev;
  // If the old head was removed and _head tracking missed it, recover:
  // scan all items reachable from h; if h is null, fall back to head.
  if (!h) h = head;
  while (h && h.prev) h = h.prev;
  return listToArray(h);
}

function parseInlineHtml(s, refs) {
  return renderItemsToHtml(parseInlineToItems(s, refs));
}

// ---------------------------------------------------------------- blocks

// Strip a blockquote marker (up to 3 columns of indent, '>', and one
// column of following whitespace) from a line. A tab after '>' is
// partially consumed (the remaining columns become spaces). Returns the
// inner content, or null if the line is not a blockquote line.
function stripQuoteMarker(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) { col += 4 - (col % 4); i++; }
    else break;
    if (col > 3) return null;
  }
  if (i >= line.length || line.charCodeAt(i) !== 62) return null;
  i++;
  col++;
  let prefix = '';
  if (i < line.length) {
    const c = line.charCodeAt(i);
    if (c === 32) { i++; col++; }
    else if (c === 9) {
      const adv = 4 - (col % 4);
      prefix = ' '.repeat(adv - 1);
      i++;
      col += adv;
    }
  }
  let rest = line.slice(i);
  if (rest.length > 0 && rest.charCodeAt(0) === 9) {
    rest = ' '.repeat(4 - (col % 4)) + rest.slice(1);
  }
  return prefix + rest;
}

// Is this line a setext heading underline (<=3 columns indent, then a run
// of '=' or '-', then only whitespace)?
function isSetextUnderline(line) {
  const indent = indentCols(line);
  if (indent > 3) return false;
  const c = stripIndentCols(line, indent);
  return /^(?:=+|-+)[ \t]*$/.test(c);
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

// Does this line start a block that can interrupt a paragraph?
// (ATX heading, fenced code, thematic break, HTML block types 1-6,
// blockquote, or a list that may interrupt a paragraph.)
function startsInterruptBlock(line) {
  const indent = indentCols(line);
  if (indent >= 4) return false;
  const c = stripIndentCols(line, indent);
  if (c === '') return false;
  if (/^#{1,6}(?:[ \t]+|$)/.test(c)) return true;
  const fm = /^(`{3,}|~{3,})/.exec(c);
  if (fm && !(fm[1][0] === '`' && c.slice(fm[1].length).indexOf('`') !== -1)) return true;
  if (/^(?:[*\-_])(?:[ \t]*[*\-_]){2,}[ \t]*$/.test(c) && /^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(c)) return true;
  if (c[0] === '<') {
    const t = htmlBlockStartType(c);
    if (t >= 1 && t <= 6) return true;
  }
  if (c[0] === '>') return true;
  const lm = listMarker(c);
  if (lm) {
    if (lm.bullet) return true;
    if (lm.num === 1) return true;
  }
  return false;
}

// Does this line start a leaf block (non-paragraph) of any kind?
function startsLeafBlock(line) {
  if (startsInterruptBlock(line)) return true;
  const indent = indentCols(line);
  if (indent >= 4) return true;
  const c = stripIndentCols(line, indent);
  if (isSetextUnderline(line)) return true;
  if (c[0] === '<') return htmlBlockStartType(c) === 7;
  return false;
}

// Parse a list marker at the start of content c (indent already stripped).
// Returns {bullet, num, delim, markerLen} or null.
function listMarker(c) {
  if (c[0] === '*' || c[0] === '+' || c[0] === '-') {
    if (c.length === 1 || c[1] === ' ' || c[1] === '\t') {
      return { bullet: c[0], num: 0, delim: '', markerLen: 1 };
    }
    return null;
  }
  const m = /^(\d{1,9})([.)])(?:[ \t]+|$)/.exec(c);
  if (m) return { bullet: null, num: parseInt(m[1], 10), delim: m[2], markerLen: m[1].length + 1 };
  // ordered marker with no following space but EOL
  const m2 = /^(\d{1,9})([.)])$/.exec(c);
  if (m2) return { bullet: null, num: parseInt(m2[1], 10), delim: m2[2], markerLen: m2[0].length };
  return null;
}

// HTML block start type (1-7) for content c (indent stripped), or 0.
function htmlBlockStartType(c) {
  const low = c.slice(0, 20).toLowerCase();
  if (/^<(script|pre|style|textarea)(?:[\s>]|$)/i.test(c)) return 1;
  if (c.startsWith('<!--')) return 2;
  if (c.startsWith('<?')) return 3;
  if (/^<![A-Za-z]/.test(c)) return 4;
  if (c.startsWith('<![CDATA[')) return 5;
  const m6 = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?:[\s/>]|$)/.exec(c);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) return 6;
  // type 7: a complete open or close tag alone on the line
  const e = scanHtmlTag(c, 0);
  if (e !== -1 && c.slice(e).trim() === '') return 7;
  return 0;
}

// Link reference definition starting at lines[i]. Returns
// {dest, title, next} (next = first line after the definition) or null.
// Cursor-based rewrite: the destination may be on the next line and the
// title on the line after that (up to 3 lines total); bare destinations
// may contain balanced parens; a line that turns out not to be a title
// is NOT consumed. A blank line ends the definition.
function parseLinkRefDef(lines, i, end) {
  const line = lines[i];
  const indent = indentCols(line);
  if (indent >= 4) return null;
  const c = stripIndentCols(line, indent);
  if (c[0] !== '[') return null;
  const close = findMatchingBracket(c, 0);
  if (close === -1) return null;
  const label = c.slice(1, close);
  if (label.trim() === '') return null;
  let j = close + 1;
  if (j >= c.length || c[j] !== ':') return null;
  j++;
  // Cursor over segments: seg 0 is the rest of line i, seg k is lines[i+k].
  let li = i;
  let rest = c.slice(j);
  let pos = 0;
  let usedLines = 1;
  // Skip whitespace, advancing to the next line when the current one is
  // exhausted. Returns false if no non-whitespace remains (or a blank
  // line is hit: a blank line ends the definition).
  function skipWs() {
    while (true) {
      while (pos < rest.length && isSpace(rest.charCodeAt(pos))) pos++;
      if (pos < rest.length) return true;
      if (li + 1 >= end || usedLines >= 3) return false;
      if (isBlankStr(lines[li + 1])) return false;
      li++;
      usedLines++;
      rest = lines[li];
      pos = 0;
    }
  }
  if (!skipWs()) return null;
  // destination
  let dest = '';
  if (rest[pos] === '<') {
    let e = pos + 1;
    while (e < rest.length) {
      if (rest[e] === '\\' && e + 1 < rest.length) { e += 2; continue; }
      if (rest[e] === '>' || rest[e] === '<') break;
      e++;
    }
    if (e >= rest.length || rest[e] !== '>') return null;
    dest = rest.slice(pos + 1, e);
    pos = e + 1;
  } else {
    let depth = 0;
    let e = pos;
    while (e < rest.length && !isSpace(rest.charCodeAt(e))) {
      const ch = rest[e];
      if (ch === '\\' && e + 1 < rest.length && isPunctChar(rest[e + 1])) { e += 2; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') { if (depth === 0) break; depth--; }
      e++;
    }
    if (e === pos || depth !== 0) return null;
    dest = rest.slice(pos, e);
    pos = e;
  }
  // marked does NOT decode entities in destinations/titles
  dest = unescapeText(dest);
  // optional title on the same or the following line
  let title = null;
  const saveLi = li, saveRest = rest, savePos = pos, saveUsed = usedLines;
  if (skipWs() && (rest[pos] === '"' || rest[pos] === "'" || rest[pos] === '(')) {
    const q = rest[pos];
    const closeQ = q === '(' ? ')' : q;
    let e = pos + 1;
    let t = '';
    let closed = false;
    while (e < rest.length) {
      if (rest[e] === '\\' && e + 1 < rest.length) { t += rest[e + 1]; e += 2; continue; }
      if (rest[e] === closeQ) { closed = true; break; }
      t += rest[e];
      e++;
    }
    if (!closed) return null;
    title = t;
    pos = e + 1;
    while (pos < rest.length && isSpace(rest.charCodeAt(pos))) pos++;
    if (pos < rest.length) return null;
  } else {
    // no title: restore the cursor so an unconsumed line is not swallowed,
    // and require only whitespace after the destination on its own line
    li = saveLi; rest = saveRest; pos = savePos; usedLines = saveUsed;
    let p = pos;
    while (p < rest.length && isSpace(rest.charCodeAt(p))) p++;
    if (p < rest.length) return null;
  }
  return { label: normalizeLabel(label), dest, title, next: li + 1 };
}

// Split a table row line into cells (unescaped | separators).
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// Is this line a table delimiter row? Returns alignments array or null.
function tableDelimiter(line) {
  const indent = indentCols(line);
  if (indent >= 4) return null;
  const cells = splitTableRow(line);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const m = /^:?-+:?$/.exec(cell);
    if (!m) return null;
    if (cell.startsWith(':') && cell.endsWith(':')) aligns.push('center');
    else if (cell.startsWith(':')) aligns.push('left');
    else if (cell.endsWith(':')) aligns.push('right');
    else aligns.push(null);
  }
  return aligns;
}

// Gather the inner lines of a blockquote starting at lines[i].
function gatherQuoteLines(lines, i, end) {
  const inner = [];
  let j = i;
  while (j < end) {
    const line = lines[j];
    const stripped = stripQuoteMarker(line);
    if (stripped !== null) { inner.push(stripped); j++; continue; }
    if (inner.length > 0 && !isBlankStr(line) && !isBlankStr(inner[inner.length - 1]) &&
      !startsInterruptBlock(line) && !startsLeafBlock(inner[inner.length - 1])) {
      // Lazy continuation line. A setext '=' underline cannot be a lazy
      // continuation: marked keeps it as literal paragraph text, indented
      // 4 spaces (kept as-is when the line starts with a tab).
      const t = line.trim();
      if (/^=+$/.test(t)) {
        const lead = /^[ \t]*/.exec(line)[0];
        inner.push(lead.indexOf('\t') !== -1 ? line : '    ' + t);
      } else if (indentCols(line) >= 4) {
        inner.push(stripIndentCols(line, 4));
      } else {
        inner.push(line);
      }
      j++;
      continue;
    }
    break;
  }
  return { inner, next: j };
}

// Is content c (indent already stripped) a thematic break?
function isThematicBreak(c) {
  return /^(?:[*\-_])(?:[ \t]*[*\-_]){2,}[ \t]*$/.test(c) && /^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(c);
}

// Content indent (in columns) and content text for a list item's first line.
// The whitespace after the marker is 1-4 columns (counted with tabs), or
// 5+ columns, in which case the content indent is marker width + 1 and
// only one column of the whitespace is consumed (a straddling tab leaves
// the remaining columns as spaces).
function listItemContent(line, marker, markerIndent) {
  const idx = markerIndent + marker.markerLen;
  const col = markerIndent + marker.markerLen;
  if (idx >= line.length) {
    return { contentIndent: col + 1, content: '' };
  }
  // Expand the whitespace run after the marker to spaces (absolute
  // columns from the marker): -\t\tfoo -> 7 columns of whitespace.
  let j = idx;
  let wsCols = 0;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c === 32) { wsCols++; j++; }
    else if (c === 9) { wsCols += 4 - ((col + wsCols) % 4); j++; }
    else break;
  }
  if (wsCols === 0) return { contentIndent: col, content: line.slice(idx) };
  if (wsCols <= 4) {
    return { contentIndent: col + wsCols, content: line.slice(j) };
  }
  return { contentIndent: col + 1, content: ' '.repeat(wsCols - 1) + line.slice(j) };
}

// Gather a whole list starting at lines[i]. Returns items (each an array of
// inner lines), loose flag, ordered flag, start number, and next index.
function gatherList(lines, i, end) {
  const firstLine = lines[i];
  const firstIndent = indentCols(firstLine);
  const firstMarker = listMarker(stripIndentCols(firstLine, firstIndent));
  const ordered = !firstMarker.bullet;
  const bullet = firstMarker.bullet;
  const delim = firstMarker.delim;
  const startNum = firstMarker.num;
  const items = [];
  const tasks = [];
  let loose = false;
  let j = i;
  let listEnded = false;
  while (j < end && !listEnded) {
    const line = lines[j];
    const ind = indentCols(line);
    const c = stripIndentCols(line, ind);
    const mk = listMarker(c);
    if (!mk || ind !== firstIndent) break;
    if (ordered) {
      if (mk.bullet || mk.delim !== delim) break;
    } else if (!mk.bullet || mk.bullet !== bullet) {
      break;
    }
    const lic = listItemContent(line, mk, ind);
    const cIndent = lic.contentIndent;
    const itemLines = [];
    const lazySetext = new Set();
    let firstContent = lic.content;
    // task list marker at the start of the item's first paragraph
    let task = null;
    const tm = /^\[( |x|X)\](?:[ \t]+|$)/.exec(firstContent);
    if (tm) {
      task = tm[1] !== ' ';
      firstContent = firstContent.slice(tm[0].length);
    }
    itemLines.push(firstContent);
    tasks.push(task);
    j++;
    let pendingBlanks = 0;
    let itemHadBlank = false;
    while (j < end) {
      const l2 = lines[j];
      if (isBlankStr(l2)) { pendingBlanks++; j++; continue; }
      const ind2 = indentCols(l2);
      const c2 = stripIndentCols(l2, ind2);
      const mk2 = listMarker(c2);
      if (mk2 && ind2 === firstIndent &&
        ((ordered && !mk2.bullet && mk2.delim === delim) ||
          (!ordered && mk2.bullet === bullet))) {
        // A thematic-break line ends the list; it is not a new item.
        if (isThematicBreak(c2)) { listEnded = true; break; }
        if (pendingBlanks > 0) loose = true;
        pendingBlanks = 0;
        break; // next item
      }
      if (ind2 >= cIndent) {
        if (pendingBlanks > 0) {
          itemHadBlank = true;
          for (let b = 0; b < pendingBlanks; b++) itemLines.push('');
          pendingBlanks = 0;
        }
        itemLines.push(stripIndentExpanded(l2, cIndent));
        j++;
        continue;
      }
      if (itemLines.length > 0 && !isBlankStr(itemLines[itemLines.length - 1]) &&
        !startsInterruptBlock(l2) && !startsLeafBlock(itemLines[itemLines.length - 1])) {
        if (pendingBlanks > 0) {
          itemHadBlank = true;
          for (let b = 0; b < pendingBlanks; b++) itemLines.push('');
          pendingBlanks = 0;
        }
        // A setext '=' underline cannot be a lazy continuation line: it
        // stays literal paragraph text (marked in `lazy` so the inner
        // render does not turn it into a heading).
        if (isSetextUnderline(l2)) lazySetext.add(itemLines.length);
        itemLines.push(l2);
        j++;
        continue;
      }
      listEnded = true;
      break;
    }
    if (itemHadBlank) loose = true;
    while (itemLines.length > 0 && itemLines[itemLines.length - 1] === '') itemLines.pop();
    items.push({ lines: itemLines, lazy: lazySetext });
  }
  return { items, tasks, loose, ordered, startNum, next: j };
}

function renderDocument(src) {
  const lines = src.split('\n');
  // A trailing newline does not create an extra empty line.
  if (lines.length > 0 && lines[lines.length - 1] === '' && src.endsWith('\n')) lines.pop();
  const refs = new Map();
  // Two passes: link reference definitions may appear AFTER their use
  // (cm-023), so collect all of them first, then render with the full map.
  renderBlocks(lines, 0, lines.length, refs, false, null);
  return renderBlocks(lines, 0, lines.length, refs, false, null);
}

// Render blocks lines[start..end). tight: paragraphs render without <p>.
// firstParaPrefix: HTML to prepend inside the first paragraph (task checkbox).
// lazySetext: indexes (into lines) of lines that entered as lazy
// continuations and are setext underlines — they stay literal text.
function renderBlocks(lines, start, end, refs, tight, firstParaPrefix, lazySetext) {
  let out = '';
  let i = start;
  let prefix = firstParaPrefix;
  while (i < end) {
    const line = lines[i];
    if (isBlankStr(line)) { i++; continue; }
    const indent = indentCols(line);
    const content = stripIndentCols(line, indent);
    // indented code block
    if (indent >= 4) {
      const codeLines = [];
      let j = i;
      while (j < end) {
        const l2 = lines[j];
        if (isBlankStr(l2)) {
          let k = j + 1;
          while (k < end && isBlankStr(lines[k])) k++;
          if (k < end && indentCols(lines[k]) >= 4) {
            while (j < k) { codeLines.push(stripIndentCols(lines[j], 4)); j++; }
            continue;
          }
          break;
        }
        if (indentCols(l2) >= 4) { codeLines.push(stripIndentCols(l2, 4)); j++; continue; }
        break;
      }
      out += '<pre><code>' + escapeHtml(codeLines.join('\n') + (codeLines.length ? '\n' : '')) + '</code></pre>\n';
      i = j;
      prefix = null;
      continue;
    }
    // ATX heading
    const atx = /^(#{1,6})(?:[ \t]+|$)/.exec(content);
    if (atx) {
      let c = content.slice(atx[0].length).replace(/[ \t]+$/, '');
      c = c.replace(/ +#+$/, '');
      if (/^#+$/.test(c)) c = '';
      const level = atx[1].length;
      out += '<h' + level + '>' + parseInlineHtml(c.trim(), refs) + '</h' + level + '>\n';
      i++;
      prefix = null;
      continue;
    }
    // fenced code
    const fence = /^(`{3,}|~{3,})/.exec(content);
    if (fence) {
      const fenceChar = fence[1][0];
      const fenceLen = fence[1].length;
      let info = content.slice(fenceLen);
      if (!(fenceChar === '`' && info.indexOf('`') !== -1)) {
        info = info.trim();
        const lang = info.split(/\s+/)[0] || '';
        const codeLines = [];
        let j = i + 1;
        while (j < end) {
          const l2 = lines[j];
          const ind2 = indentCols(l2);
          const c2 = stripIndentCols(l2, ind2);
          if (ind2 <= 3 && c2.length > 0 && c2[0] === fenceChar) {
            let r = 0;
            while (r < c2.length && c2[r] === fenceChar) r++;
            if (r >= fenceLen && c2.slice(r).trim() === '') { j++; break; }
          }
          // Strip up to `indent` leading whitespace CHARACTERS (marked
          // removes a whole tab here, not partial columns).
          let k2 = 0;
          while (k2 < indent && k2 < l2.length && (l2.charCodeAt(k2) === 32 || l2.charCodeAt(k2) === 9)) k2++;
          codeLines.push(l2.slice(k2));
          j++;
        }
        const code = codeLines.length ? codeLines.join('\n') + '\n' : '';
        out += '<pre><code' + (lang ? ' class="language-' + escapeAttr(lang) + '"' : '') + '>' + escapeHtml(code) + '</code></pre>\n';
        i = j;
        prefix = null;
        continue;
      }
      // backtick fence whose info contains a backtick: not a fence, fall through to paragraph
    }
    // thematic break
    if (/^([*\-_])(?:[ \t]*\1){2,}[ \t]*$/.test(content)) {
      out += '<hr>\n';
      i++;
      prefix = null;
      continue;
    }
    // HTML block
    const hbType = htmlBlockStartType(content);
    if (hbType > 0) {
      const htmlLines = [];
      let j = i;
      let tagName = null;
      if (hbType === 1) {
        const m1 = /^<(script|pre|style|textarea)(?:[\s>]|$)/i.exec(content);
        tagName = m1 ? m1[1].toLowerCase() : '';
      }
      while (j < end) {
        const l2 = lines[j];
        htmlLines.push(l2);
        j++;
        if (hbType === 1) {
          if (new RegExp('</' + tagName + '>', 'i').test(l2)) break;
        } else if (hbType === 2) {
          if (l2.indexOf('-->') !== -1) break;
        } else if (hbType === 3) {
          if (l2.indexOf('?>') !== -1) break;
        } else if (hbType === 4) {
          if (l2.indexOf('>') !== -1) break;
        } else if (hbType === 5) {
          if (l2.indexOf(']]>') !== -1) break;
        } else {
          if (j < end && isBlankStr(lines[j])) break;
        }
      }
      out += htmlLines.join('\n') + (j < end && isBlankStr(lines[j]) ? '' : '\n');
      i = j;
      prefix = null;
      continue;
    }
    // blockquote
    if (content[0] === '>') {
      const g = gatherQuoteLines(lines, i, end);
      out += '<blockquote>\n' + renderBlocks(g.inner, 0, g.inner.length, refs, false, null) + '</blockquote>\n';
      i = g.next;
      prefix = null;
      continue;
    }
    // list
    if (listMarker(content)) {
      const g = gatherList(lines, i, end);
      const tag = g.ordered ? 'ol' : 'ul';
      const startAttr = g.ordered && g.startNum !== 1 ? ' start="' + g.startNum + '"' : '';
      out += '<' + tag + startAttr + '>\n';
      for (let k = 0; k < g.items.length; k++) {
        const task = g.tasks[k];
        const taskHtml = task === null ? null :
          (task ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ');
        const item = g.items[k];
        const inner = renderBlocks(item.lines, 0, item.lines.length, refs, !g.loose, taskHtml, item.lazy);
        out += '<li>' + inner + '</li>\n';
      }
      out += '</' + tag + '>\n';
      i = g.next;
      prefix = null;
      continue;
    }
    // paragraph (with link-ref defs, setext heading, table)
    let j = i;
    while (j < end) {
      const d = parseLinkRefDef(lines, j, end);
      if (!d) break;
      if (!refs.has(d.label)) refs.set(d.label, { dest: d.dest, title: d.title });
      j = d.next;
    }
    if (j >= end || isBlankStr(lines[j])) { i = j; prefix = null; continue; }
    // after defs, the next line may start a non-paragraph block
    // (only when defs were actually consumed, otherwise this line is
    // already known to be a paragraph start)
    if (j > i && (startsInterruptBlock(lines[j]) || indentCols(lines[j]) >= 4)) { i = j; prefix = null; continue; }
    // table? header = lines[j], delimiter = lines[j+1]
    // (the delimiter row must contain a pipe, or it is a setext heading;
    // and the header and delimiter must have the same number of cells)
    if (j + 1 < end && lines[j + 1].indexOf('|') !== -1) {
      const aligns = tableDelimiter(lines[j + 1]);
      if (aligns) {
        const headerCells = splitTableRow(lines[j]);
        if (headerCells.length === aligns.length) {
        const ncols = headerCells.length;
        let t = '<table>\n<thead>\n<tr>\n';
        for (let c = 0; c < ncols; c++) {
          const cell = headerCells[c] !== undefined ? headerCells[c] : '';
          const al = aligns[c];
          t += '<th' + (al ? ' align="' + al + '"' : '') + '>' + parseInlineHtml(cell, refs) + '</th>\n';
        }
        t += '</tr>\n</thead>\n<tbody>';
        let r = j + 2;
        while (r < end && !isBlankStr(lines[r])) {
          if (lines[r].indexOf('|') === -1 && ncols > 1) break;
          const cells = splitTableRow(lines[r]);
          t += '<tr>\n';
          for (let c = 0; c < ncols; c++) {
            const cell = cells[c] !== undefined ? cells[c] : '';
            const al = aligns[c];
            t += '<td' + (al ? ' align="' + al + '"' : '') + '>' + parseInlineHtml(cell, refs) + '</td>\n';
          }
          t += '</tr>\n';
          r++;
        }
        t += '</tbody></table>\n';
        out += t;
        i = r;
        prefix = null;
        continue;
        } // header/delimiter cell counts differ: not a table
      }
    }
    // collect paragraph lines
    const paraLines = [];
    let k = j;
    while (k < end) {
      const l2 = lines[k];
      if (isBlankStr(l2)) break;
      if (k > j) {
        // a lazy setext underline stays literal paragraph text
        if (isSetextUnderline(l2) && !(lazySetext && lazySetext.has(k))) break;
        if (startsInterruptBlock(l2)) break;
      }
      paraLines.push(l2);
      k++;
    }
    if (k < end && isSetextUnderline(lines[k]) && !(lazySetext && lazySetext.has(k))) {
      const level = stripIndentCols(lines[k], indentCols(lines[k]))[0] === '=' ? 1 : 2;
      const text = paraLines.join('\n').trim();
      out += '<h' + level + '>' + parseInlineHtml(text, refs) + '</h' + level + '>\n';
      i = k + 1;
      prefix = null;
      continue;
    }
    const text = paraLines.join('\n');
    const html = parseInlineHtml(text, refs);
    if (tight) out += (prefix ? prefix : '') + html;
    else out += '<p>' + (prefix ? prefix : '') + html + '</p>\n';
    prefix = null;
    i = k;
  }
  return out;
}

// __APPEND__



