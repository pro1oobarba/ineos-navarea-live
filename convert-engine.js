// NAVAREA text -> ECDIS (JRC CSV / Furuno XML) converter, in-browser.
//
// Direct JS port of navarea-agent/navarea_engine.py from the toolkit repo -
// keep the two in sync if the parsing logic changes there. Runs entirely
// client-side (no backend, no data leaves the browser) since this site is
// static GitHub Pages.

const CRLF = '\r\n';

// ---------- coordinate parsing (supports DD-MM.mmmH, DD-MMH, DD-MM-SSH) ----------

const COORD_TOKEN = /(\d{1,3})-(\d{1,2})(?:([.\-])(\d{1,3}))?\s*([NSEW])/g;

function parseToken(m) {
  const deg = parseInt(m[1], 10);
  const mn = m[2];
  const sep = m[3];
  const frac = m[4];
  const hemi = m[5];
  let minute;
  if (sep === '.' && frac !== undefined) {
    minute = parseFloat(`${mn}.${frac}`);
  } else if (sep === '-' && frac !== undefined) {
    minute = parseInt(mn, 10) + parseInt(frac, 10) / 60.0;
  } else {
    minute = parseFloat(mn);
  }
  return [deg, minute, hemi];
}

function findCoordPairs(text) {
  const toks = [];
  let m;
  COORD_TOKEN.lastIndex = 0;
  while ((m = COORD_TOKEN.exec(text)) !== null) {
    toks.push({ tok: parseToken(m), index: m.index, length: m[0].length });
  }
  const pairs = [];
  let i = 0;
  while (i < toks.length - 1) {
    const [d1, m1, h1] = toks[i].tok;
    const [d2, m2, h2] = toks[i + 1].tok;
    if ('NS'.includes(h1) && 'EW'.includes(h2)) {
      pairs.push({ pair: [d1, m1, h1, d2, m2, h2], start: toks[i].index, end: toks[i + 1].index + toks[i + 1].length });
      i += 2;
    } else {
      i += 1;
    }
  }
  return pairs.map((p) => p.pair);
}

function findCoordPairsWithSpans(text) {
  const toks = [];
  let m;
  COORD_TOKEN.lastIndex = 0;
  while ((m = COORD_TOKEN.exec(text)) !== null) {
    toks.push({ tok: parseToken(m), index: m.index, length: m[0].length });
  }
  const pairs = [];
  let i = 0;
  while (i < toks.length - 1) {
    const [d1, m1, h1] = toks[i].tok;
    const [d2, m2, h2] = toks[i + 1].tok;
    if ('NS'.includes(h1) && 'EW'.includes(h2)) {
      pairs.push({ pair: [d1, m1, h1, d2, m2, h2], start: toks[i].index, end: toks[i + 1].index + toks[i + 1].length });
      i += 2;
    } else {
      i += 1;
    }
  }
  return pairs;
}

function findCoordPairsPerLine(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const pairsInLine = findCoordPairsWithSpans(line);
    if (pairsInLine.length === 1) {
      const { pair, start, end } = pairsInLine[0];
      let label = line.slice(0, start).replace(/^[ \t.,:;-]+|[ \t.,:;-]+$/g, '');
      label = label.replace(/^[A-Z0-9]{1,2}[.)]\s*/, '');
      const trailing = line.slice(end).replace(/^[ \t.,:;-]+|[ \t.,:;-]+$/g, '');
      out.push({ label, pair, trailing });
    }
  }
  return out;
}

function fmtCoordPair(latDeg, latMin, latH, lonDeg, lonMin, lonH) {
  const pad2 = (n) => String(Math.trunc(n)).padStart(2, '0');
  const pad3 = (n) => String(Math.trunc(n)).padStart(3, '0');
  const min = (n) => n.toFixed(3).padStart(6, '0');
  return `${pad2(latDeg)},${min(latMin)},${latH},${pad3(lonDeg)},${min(lonMin)},${lonH}`;
}

// ---------- ECDIS block writers (JRC) ----------

const MAX_COMMENT = 64; // confirmed hard limit on JRC ECDIS Comment field

function cap(comment) {
  return comment.slice(0, MAX_COMMENT);
}

function blockSymbol(comment, pair, danger = false) {
  comment = cap(comment);
  const [d1, m1, h1, d2, m2, h2] = pair;
  const tag = danger ? 'DANGER_SYMBOL' : 'CAUTION_SYMBOL';
  return `// ${tag},InstName${CRLF}// Comment${CRLF}// Lat,,,Lon${CRLF}` +
    `${tag},~WARNSY0,***,***${CRLF}${comment}${CRLF}` +
    `${fmtCoordPair(d1, m1, h1, d2, m2, h2)}${CRLF}`;
}

function blockCircle(comment, pair, radiusNm) {
  comment = cap(comment);
  const [d1, m1, h1, d2, m2, h2] = pair;
  return `// CIRCLE${CRLF}// Comment${CRLF}// Base Point-Lat,,,Base Point-Lon,,,Radius[nm]${CRLF}` +
    `CIRCLE${CRLF}${comment}${CRLF}` +
    `${fmtCoordPair(d1, m1, h1, d2, m2, h2)},${radiusNm}${CRLF}`;
}

function blockPolygon(comment, pairs) {
  comment = cap(comment);
  let out = `// POLYGON${CRLF}// Comment${CRLF}// Lat,,,Lon,Add "END" to the end of vertex.${CRLF}` +
    `POLYGON${CRLF}${comment}${CRLF}`;
  const verts = pairs.slice();
  if (verts.length && verts[0].join() !== verts[verts.length - 1].join()) {
    verts.push(verts[0]);
  }
  for (const p of verts) {
    out += fmtCoordPair(...p) + CRLF;
  }
  out += `END${CRLF}`;
  return out;
}

function blockLineAggregate(comment, pairs, lineType = 2, width = 2, color = 9) {
  comment = cap(comment);
  let out = `// LINE_AGGREGATE${CRLF}// Comment${CRLF}// Lat,,,Lon,,,Type,Width,ColorNo,Comment${CRLF}` +
    `// Add "END" to the end of vertex.${CRLF}LINE_AGGREGATE${CRLF}${comment}${CRLF}`;
  for (const p of pairs) {
    out += `${fmtCoordPair(...p)},${lineType},${width},${color},${comment}${CRLF}`;
  }
  out += `END${CRLF}`;
  return out;
}

// ---------- segmentation ----------

const NUM_MARK = /^[ \t]*(\d{1,2})\.\s+/gm;
const LET_MARK = /^[ \t]*([A-Z]{1,3})\.\s+/gm;

function splitByMarker(text, markerRe) {
  markerRe.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = markerRe.exec(text)) !== null) {
    matches.push({ label: m[1], index: m.index, end: m.index + m[0].length });
  }
  if (!matches.length) return [[null, text]];
  const parts = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    parts.push([matches[i].label, text.slice(start, end)]);
  }
  return parts;
}

function clean(text, limit = 160) {
  return text.split(/\s+/).filter(Boolean).join(' ').slice(0, limit);
}

function classifyLeaf(ref, preamble, leafText, letter = null) {
  const full = (preamble + ' ' + leafText).trim();
  const upper = full.toUpperCase();
  const pairs = findCoordPairs(full);
  const tag = ref + (letter ? ` Zone ${letter}:` : '');
  const comment = `${tag} ${clean(full)}`.trim();

  if ((upper.includes('BOUND BY') || upper.includes('BOUNDED BY')) && pairs.length >= 3) {
    return [['polygon', comment, pairs, false]];
  }
  if ((upper.includes('JOINING') || upper.includes('TRACKLINE')) && pairs.length >= 2) {
    return [['line', comment, pairs, false]];
  }
  if (pairs.length === 1) {
    return [['point', comment, pairs[0], false]];
  }
  if (pairs.length === 0) {
    return [];
  }
  const perLine = findCoordPairsPerLine(leafText);
  if (perLine.length >= 2) {
    return perLine.map(({ label, pair, trailing }) => {
      const name = (trailing || label).trim();
      const c = name ? `${tag} ${name}`.trim() : comment;
      return ['point', c, pair, false];
    });
  }
  return pairs.map((p) => ['point', comment, p, true]);
}

function processBody(ref, body, riglistTag = '- RIG:') {
  const upper = body.toUpperCase();
  const results = [];
  if (upper.includes('RIGLIST') || upper.includes('MOBILE OFFSHORE DRILLING') || upper.includes('MODU')) {
    for (const { label, pair, trailing } of findCoordPairsPerLine(body)) {
      const cleanLabel = label.replace(/^[A-Z0-9]{1,3}[.)]\s*/, '').trim();
      const name = trailing.trim() || cleanLabel;
      if (name) {
        results.push(['rig', `${ref} ${riglistTag} ${name}`, pair, false]);
      }
    }
    return results;
  }

  for (const [, seg] of splitByMarker(body, NUM_MARK)) {
    LET_MARK.lastIndex = 0;
    const letMatches = [];
    let m;
    while ((m = LET_MARK.exec(seg)) !== null) letMatches.push(m);
    if (letMatches.length) {
      const preamble = seg.slice(0, letMatches[0].index);
      for (const [letter, leaf] of splitByMarker(seg, LET_MARK)) {
        results.push(...classifyLeaf(ref, preamble, leaf, letter));
      }
    } else {
      results.push(...classifyLeaf(ref, '', seg, null));
    }
  }
  return results;
}

const RIG_SAFETY_ZONE_NM = 0.27; // 500m, precise conversion (500 / 1852)

function resultsToBlocks(results) {
  const blocks = [];
  for (const [kind, comment, geom, flagged] of results) {
    if (kind === 'rig') {
      blocks.push(blockSymbol(comment, geom, true));
      blocks.push(blockCircle(`${comment} - 500m safety zone`, geom, RIG_SAFETY_ZONE_NM));
    } else if (kind === 'point') {
      blocks.push(blockSymbol(comment, geom, false));
    } else if (kind === 'polygon') {
      blocks.push(blockPolygon(comment, geom));
    } else if (kind === 'line') {
      blocks.push(blockLineAggregate(comment, geom));
    }
  }
  return blocks;
}

function buildJrcUsermap(blocks, title) {
  let out = `// USER CHART SHEET exported by JRC ECDIS.${CRLF}`;
  out += `// <<NOTE>>This strings // indicate comment column/cells. You can edit freely.${CRLF}`;
  out += `// ${title}${CRLF}`;
  for (const b of blocks) out += b;
  return out;
}

// ---------- Furuno userchart XML writer ----------
// Schema mirrors navarea_engine.py's results_to_furuno_xml() exactly - see
// that file for the real-sample provenance notes.

const REF_RE = /^(NAV \S+ \d+\/\S+)/;

function refFromComment(comment) {
  const m = REF_RE.exec(comment);
  return m ? m[1] : comment.slice(0, 32);
}

function escapeXmlAttr(s) {
  return '"' + String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '"';
}

function escapeXmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decimal(deg, minute, hemi) {
  const val = deg + minute / 60.0;
  return hemi === 'S' || hemi === 'W' ? -val : val;
}

function pairToLatLon(pair) {
  const [d1, m1, h1, d2, m2, h2] = pair;
  return [decimal(d1, m1, h1), decimal(d2, m2, h2)];
}

function verticesXml(latlons) {
  return latlons.map(([lat, lon], i) =>
    `        <vertex id="${i + 1}" latitude="${lat.toFixed(6)}" longitude="${lon.toFixed(6)}"/>`
  ).join('\n');
}

function furunoLine(name, pairs) {
  const latlons = pairs.map(pairToLatLon);
  return `    <line name=${escapeXmlAttr(name)} description="">\n` +
    `      <position>\n${verticesXml(latlons)}\n      </position>\n` +
    `      <attribute lineType="2"/>\n` +
    `      <type checkDanger="1" displayRadar="0" hasNotes="0" rangeOfNotes="1.000000"/>\n` +
    `    </line>`;
}

function furunoArea(name, pairs) {
  const latlons = pairs.map(pairToLatLon);
  return `    <area name=${escapeXmlAttr(name)} description="">\n` +
    `      <position>\n${verticesXml(latlons)}\n      </position>\n` +
    `      <type checkDanger="1" displayRadar="0" hasNotes="0" notesType="0"/>\n` +
    `    </area>`;
}

function furunoLabel(name, pair) {
  const [lat, lon] = pairToLatLon(pair);
  return `    <label name=${escapeXmlAttr(name)} description=${escapeXmlAttr(name)}>\n` +
    `      <position>\n` +
    `        <vertex id="1" latitude="${lat.toFixed(6)}" longitude="${lon.toFixed(6)}"/>\n` +
    `      </position>\n` +
    `      <attribute labelStyle="2" labelText="${escapeXmlText(name)}"/>\n` +
    `      <type checkDanger="0" displayRadar="0"/>\n` +
    `    </label>`;
}

function circlePolygonPairs(centerPair, radiusNm, n = 32) {
  const [latC, lonC] = pairToLatLon(centerPair);
  const dlat = radiusNm / 60.0;
  const coslat = Math.cos((latC * Math.PI) / 180) || 1e-9;
  const dlon = radiusNm / 60.0 / coslat;
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const lat = latC + dlat * Math.cos(angle);
    const lon = lonC + dlon * Math.sin(angle);
    const latDeg = Math.trunc(Math.abs(lat));
    const latMin = (Math.abs(lat) - latDeg) * 60;
    const latH = lat >= 0 ? 'N' : 'S';
    const lonDeg = Math.trunc(Math.abs(lon));
    const lonMin = (Math.abs(lon) - lonDeg) * 60;
    const lonH = lon >= 0 ? 'E' : 'W';
    pairs.push([latDeg, latMin, latH, lonDeg, lonMin, lonH]);
  }
  return pairs;
}

function resultsToFurunoXml(results, title) {
  const linesXml = [];
  const areasXml = [];
  const labelsXml = [];
  for (const [kind, comment, geom, flagged] of results) {
    const name = refFromComment(comment);
    if (kind === 'line') {
      linesXml.push(furunoLine(name, geom));
    } else if (kind === 'polygon') {
      areasXml.push(furunoArea(name, geom));
    } else if (kind === 'point') {
      labelsXml.push(furunoLabel(name, geom));
    } else if (kind === 'rig') {
      labelsXml.push(furunoLabel(name, geom));
      areasXml.push(furunoArea(`${name} 500m zone`, circlePolygonPairs(geom, RIG_SAFETY_ZONE_NM)));
    }
  }
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--userchart node-->',
    `<userchart name=${escapeXmlAttr(title)} description="" version="1.0">`,
    '  <!--userchart line-->',
    '  <lines>',
    ...linesXml,
    '  </lines>',
    '  <!--userchart area-->',
    '  <areas>',
    ...areasXml,
    '  </areas>',
    '  <!--userchart label-->',
    '  <labels>',
    ...labelsXml,
    '  </labels>',
    '</userchart>',
  ];
  return parts.join('\n') + '\n';
}

// ---------- public entry point ----------

/**
 * Converts one pasted NAVAREA-style warning message into ECDIS format.
 * @param {string} text - the message body (coordinates, "1."/"A." structure etc)
 * @param {string} reference - short reference like "NAV I 0163/26"; used as
 *   the tag prepended to every object's comment/name.
 * @returns {{results: Array, flaggedCount: number, objectCount: number}}
 */
function convertNavareaText(text, reference) {
  const results = processBody(reference, text);
  const flaggedCount = results.filter((r) => r[3]).length;
  return { results, flaggedCount, objectCount: results.length };
}

window.NavareaConvert = {
  convertNavareaText,
  buildJrcUsermap,
  resultsToBlocks,
  resultsToFurunoXml,
};
