// Model → the bytes of a .pptx (§9 Phase 11 task 2). Pure: no DOM, no
// `node:*`, and no colours of its own (every colour comes from the model).
// A .pptx is a ZIP of XML parts; the parts and their strictness are listed in
// PLAN.md §2 "Verified in a spike on 2026-11-13".
//
// Units: 1 stage pixel = 9525 EMU = 0.75pt. Font sizes, letter-spacing and
// line spacing are hundredths of a point: pixels × 75.

import type { PptxCell, PptxDeck, PptxFill, PptxItem, PptxPalette, PptxParagraph, PptxRun, PptxStroke } from './model';
import { zip, type ZipEntry } from './zip';

const EMU = 9525;
// Rounded away from zero, so a hanging indent of -n is exactly minus a margin of n.
const emu = (px: number): number => Math.sign(px) * Math.round(Math.abs(px) * EMU) || 0;
/** An extent: never negative. */
const ext = (px: number): number => Math.max(0, emu(px));
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n) || 0));

/** Text and attribute values: escape `& < > "` and drop what XML 1.0 forbids. */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    // A surrogate without its partner cannot be encoded.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS = `${NS_A} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`;
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument';
export const PPTX_MIME = `${CT}.presentationml.presentation`;

type Rel = [id: string, type: string, target: string];

const rels = (list: Rel[]): string =>
  `${XML}<Relationships xmlns="${PKG_REL}">${list
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.startsWith('http') ? type : `${REL}/${type}`}" Target="${target}"/>`)
    .join('')}</Relationships>`;

// The root group every shape tree starts with; its id is 1.
const GROUP =
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const CLRMAP =
  'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';

const SANS = 'DM Sans';
// What a viewer without the font uses to pick a substitute (§2).
const HINT_SANS = 'panose="020B0604020202020204" pitchFamily="34" charset="0"';
const HINT_MONO = 'panose="020B0509040201040103" pitchFamily="49" charset="0"';

const srgb = (c: string): string => `<a:srgbClr val="${escapeXml(c)}"/>`;

/** The theme part. Its colour scheme is the deck's palette: text on `dk1`, the page on `lt1`. */
function theme(name: string, p: PptxPalette): string {
  const phClr = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w: number) => `<a:ln w="${w}">${phClr}</a:ln>`;
  const effect = '<a:effectStyle><a:effectLst/></a:effectStyle>';
  const font = `<a:latin typeface="${SANS}"/><a:ea typeface=""/><a:cs typeface=""/>`;
  return `${XML}<a:theme ${NS_A} name="${name}"><a:themeElements><a:clrScheme name="dex"><a:dk1>${srgb(p.ink)}</a:dk1><a:lt1>${srgb(p.bg)}</a:lt1><a:dk2>${srgb(p.ink2)}</a:dk2><a:lt2>${srgb(p.line)}</a:lt2><a:accent1>${srgb(p.red)}</a:accent1><a:accent2>${srgb(p.blue)}</a:accent2><a:accent3>${srgb(p.marker)}</a:accent3><a:accent4>${srgb(p.ink3)}</a:accent4><a:accent5>${srgb(p.ink2)}</a:accent5><a:accent6>${srgb(p.line)}</a:accent6><a:hlink>${srgb(p.ink)}</a:hlink><a:folHlink>${srgb(p.ink2)}</a:folHlink></a:clrScheme><a:fontScheme name="dex"><a:majorFont>${font}</a:majorFont><a:minorFont>${font}</a:minorFont></a:fontScheme><a:fmtScheme name="dex"><a:fillStyleLst>${phClr}${phClr}${phClr}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst><a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst><a:bgFillStyleLst>${phClr}${phClr}${phClr}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function solid(fill: PptxFill): string {
  const alpha = fill.alpha ?? 1;
  const a = alpha < 1 ? `<a:alpha val="${clamp(alpha * 100000, 0, 100000)}"/>` : '';
  return `<a:solidFill><a:srgbClr val="${escapeXml(fill.color)}">${a}</a:srgbClr></a:solidFill>`;
}
const fillOf = (fill: PptxFill | undefined): string => (fill ? solid(fill) : '<a:noFill/>');
const NO_LINE = '<a:ln><a:noFill/></a:ln>';

function outline(line: PptxStroke | undefined, cap?: 'flat' | 'round', arrow = false): string {
  if (!line) return NO_LINE;
  const capAttr = cap ? ` cap="${cap === 'round' ? 'rnd' : 'flat'}"` : '';
  return `<a:ln w="${ext(line.width)}"${capAttr}>${solid(line)}<a:round/>${arrow ? '<a:tailEnd type="arrow"/>' : ''}</a:ln>`;
}

function xfrm(x: number, y: number, w: number, h: number, flip = ''): string {
  return `<a:xfrm${flip}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${ext(w)}" cy="${ext(h)}"/></a:xfrm>`;
}
const RECT_GEOM = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';

const fontSize = (px: number): number => clamp(px * 75, 100, 400000);

/**
 * One run. A line break carries the size of the text around it (`size`), as
 * PowerPoint writes it: Quick Look adds about a quarter of the font size to
 * the line pitch after a bare `<a:br/>`.
 */
function runXml(run: PptxRun, lang: string, size: number): string {
  if ('break' in run) return `<a:br><a:rPr lang="${lang}" sz="${fontSize(size)}" dirty="0"/></a:br>`;
  const attrs = [`lang="${lang}"`, `sz="${fontSize(run.size)}"`, `b="${run.bold ? 1 : 0}"`, `i="${run.italic ? 1 : 0}"`];
  if (run.underline) attrs.push('u="sng"');
  if (run.strike) attrs.push('strike="sngStrike"');
  if (run.superscript) attrs.push('baseline="30000"');
  if (run.spacing) attrs.push(`spc="${clamp(run.spacing * 75, -400000, 400000)}"`);
  attrs.push('dirty="0"');
  const face = `typeface="${escapeXml(run.font)}" ${/mono/i.test(run.font) ? HINT_MONO : HINT_SANS}`;
  const highlight = run.highlight ? `<a:highlight>${srgb(run.highlight)}</a:highlight>` : '';
  return `<a:r><a:rPr ${attrs.join(' ')}>${solid(run.color)}${highlight}<a:latin ${face}/><a:ea ${face}/><a:cs ${face}/></a:rPr><a:t>${escapeXml(run.text)}</a:t></a:r>`;
}

/**
 * The paragraphs of one text body. Every paragraph ends with an `a:endParaRPr`
 * carrying its size (its first run's, or the size before it for an empty
 * line), so an empty line keeps its height.
 */
function parasXml(paragraphs: PptxParagraph[], lang: string): string {
  let size = 0;
  const firstSize = (p: PptxParagraph): number => {
    for (const run of p.runs) if (!('break' in run)) return run.size;
    return 0;
  };
  // An empty paragraph before any text takes the size of the first text after it.
  const fallback = paragraphs.map(firstSize).find((s) => s > 0) ?? 0;
  const list = paragraphs.length > 0 ? paragraphs : [{ runs: [], align: 'l' as const, lineHeight: 0 }];
  return list
    .map((p) => {
      size = firstSize(p) || size || fallback || p.lineHeight / 1.2 || 18;
      const attrs: string[] = [];
      if (p.marginLeft !== undefined || p.indent !== undefined) {
        // marL cannot be negative.
        attrs.push(`marL="${ext(p.marginLeft ?? 0)}"`, `indent="${emu(p.indent ?? 0)}"`);
      }
      attrs.push(`algn="${p.align}"`);
      // A break takes the size of the text before it, or of the paragraph when it comes first.
      let around = size;
      const runs = p.runs
        .map((r) => {
          if (!('break' in r)) around = r.size;
          return runXml(r, lang, around);
        })
        .join('');
      const spacing = p.lineHeight > 0 ? `<a:lnSpc><a:spcPts val="${clamp(p.lineHeight * 75, 0, 158400)}"/></a:lnSpc>` : '';
      const before = p.spaceBefore && p.spaceBefore > 0 ? `<a:spcBef><a:spcPts val="${clamp(p.spaceBefore * 75, 0, 158400)}"/></a:spcBef>` : '';
      const tabs = p.tab !== undefined && p.tab > 0 ? `<a:tabLst><a:tab pos="${ext(p.tab)}" algn="l"/></a:tabLst>` : '';
      return `<a:p><a:pPr ${attrs.join(' ')}>${spacing}${before}<a:buNone/>${tabs}</a:pPr>${runs}<a:endParaRPr lang="${lang}" sz="${fontSize(size)}" dirty="0"/></a:p>`;
    })
    .join('');
}

function cellXml(cell: PptxCell, lang: string): string {
  const [l, t, r, b] = cell.padding;
  const none = (side: string) => `<a:ln${side} w="0"><a:noFill/></a:ln${side}>`;
  const bottom = cell.borderBottom
    ? `<a:lnB w="${ext(cell.borderBottom.width)}" cap="flat" cmpd="sng" algn="ctr">${solid(cell.borderBottom)}<a:prstDash val="solid"/></a:lnB>`
    : none('B');
  const fill = cell.fill ? solid({ color: cell.fill }) : '<a:noFill/>';
  return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${parasXml(cell.paragraphs, lang)}</a:txBody><a:tcPr marL="${ext(l)}" marR="${ext(r)}" marT="${ext(t)}" marB="${ext(b)}" anchor="${cell.anchor}">${none('L')}${none('R')}${none('T')}${bottom}${fill}</a:tcPr></a:tc>`;
}

/** One item as a shape. `embed` returns the relationship id of a picture's media part. */
function shapeXml(item: PptxItem, id: number, lang: string, embed: (item: PptxItem & { kind: 'picture' }) => string): string {
  const nv = (name: string, extra = '') => `<p:nvSpPr><p:cNvPr id="${id}" name="${name} ${id}"/><p:cNvSpPr${extra}/><p:nvPr/></p:nvSpPr>`;
  switch (item.kind) {
    case 'rect': {
      // Quick Look draws a rectangle's outline as a hairline, whatever its
      // width, unless the fill carries an alpha. So an unfilled rectangle with
      // an outline wider than a hairline gets a fully transparent fill in the
      // outline's colour, which looks the same everywhere else.
      const fill = !item.fill && item.line && item.line.width > 1 ? solid({ color: item.line.color, alpha: 0 }) : fillOf(item.fill);
      return `<p:sp>${nv('Rectangle')}<p:spPr>${xfrm(item.x, item.y, item.w, item.h)}${RECT_GEOM}${fill}${outline(item.line)}</p:spPr></p:sp>`;
    }
    case 'line': {
      const flip = `${item.x2 < item.x1 ? ' flipH="1"' : ''}${item.y2 < item.y1 ? ' flipV="1"' : ''}`;
      const box = xfrm(Math.min(item.x1, item.x2), Math.min(item.y1, item.y2), Math.abs(item.x2 - item.x1), Math.abs(item.y2 - item.y1), flip);
      return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${box}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${outline(item.line, item.cap, item.arrow)}</p:spPr></p:cxnSp>`;
    }
    case 'path': {
      const xs = item.points.map((p) => p[0]);
      const ys = item.points.map((p) => p[1]);
      const x0 = xs.length ? Math.min(...xs) : 0;
      const y0 = ys.length ? Math.min(...ys) : 0;
      // A path needs some extent in both directions.
      const w = Math.max(1, (xs.length ? Math.max(...xs) : 0) - x0);
      const h = Math.max(1, (ys.length ? Math.max(...ys) : 0) - y0);
      const pt = (p: [number, number]) => `<a:pt x="${ext(p[0] - x0)}" y="${ext(p[1] - y0)}"/>`;
      const path = item.points.map((p, i) => (i === 0 ? `<a:moveTo>${pt(p)}</a:moveTo>` : `<a:lnTo>${pt(p)}</a:lnTo>`)).join('');
      return `<p:sp>${nv('Freeform')}<p:spPr>${xfrm(x0, y0, w, h)}<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${ext(w)}" h="${ext(h)}">${path}<a:close/></a:path></a:pathLst></a:custGeom>${solid(item.fill)}${NO_LINE}</p:spPr></p:sp>`;
    }
    case 'picture':
      return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${escapeXml(item.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${embed(item)}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(item.x, item.y, item.w, item.h)}${RECT_GEOM}</p:spPr></p:pic>`;
    case 'text': {
      const inset = ext(item.inset ?? 0);
      const body = `<a:bodyPr wrap="${item.wrap ? 'square' : 'none'}" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr>`;
      return `<p:sp>${nv('Text', ' txBox="1"')}<p:spPr>${xfrm(item.x, item.y, item.w, item.h)}${RECT_GEOM}${fillOf(item.fill)}</p:spPr><p:txBody>${body}<a:lstStyle/>${parasXml(item.paragraphs, lang)}</p:txBody></p:sp>`;
    }
    case 'table': {
      const grid = item.columns.map((w) => `<a:gridCol w="${ext(w)}"/>`).join('');
      const rows = item.rows.map((row) => `<a:tr h="${ext(row.h)}">${row.cells.map((c) => cellXml(c, lang)).join('')}</a:tr>`).join('');
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(item.x)}" y="${emu(item.y)}"/><a:ext cx="${ext(item.w)}" cy="${ext(item.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    }
  }
}

/** A placeholder on the notes master or a notes slide. */
function notesPlaceholder(id: number, type: 'sldImg' | 'body', geometry: string, body: string): string {
  const locks = type === 'sldImg' ? '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>' : '<a:spLocks noGrp="1"/>';
  const ph = type === 'sldImg' ? '<p:ph type="sldImg"/>' : '<p:ph type="body" idx="1"/>';
  const name = type === 'sldImg' ? 'Slide Image Placeholder 1' : 'Notes Placeholder 2';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr>${locks}</p:cNvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr>${geometry}${body}</p:sp>`;
}

export function writePptx(deck: PptxDeck): Uint8Array<ArrayBuffer> {
  const lang = escapeXml(deck.lang || 'en');
  const files: ZipEntry[] = [];
  const overrides: [name: string, type: string][] = [];
  const part = (name: string, type: string, body: string) => {
    files.push([name, body]);
    overrides.push([name, type]);
  };
  const hasNotes = deck.slides.some((s) => s.notes.length > 0);

  // A picture's bytes are stored once per key, whichever slides use it.
  const media = new Map<string, string>();
  const mediaName = (item: PptxItem & { kind: 'picture' }): string => {
    let name = media.get(item.key);
    if (!name) {
      name = `image${media.size + 1}.${item.type === 'jpeg' ? 'jpg' : 'png'}`;
      media.set(item.key, name);
      files.push([`ppt/media/${name}`, item.data]);
    }
    return name;
  };

  const presRels: Rel[] = [
    ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
    ['rId2', 'theme', 'theme/theme1.xml'],
  ];
  if (hasNotes) presRels.push(['rId3', 'notesMaster', 'notesMasters/notesMaster1.xml']);
  const slideIds: string[] = [];

  deck.slides.forEach((slide, i) => {
    const n = i + 1;
    const slideRels: Rel[] = [['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']];
    const embedded = new Map<string, string>();
    const embed = (item: PptxItem & { kind: 'picture' }): string => {
      const name = mediaName(item);
      let rid = embedded.get(name);
      if (!rid) {
        rid = `rId${slideRels.length + 1}`;
        embedded.set(name, rid);
        slideRels.push([rid, 'image', `../media/${name}`]);
      }
      return rid;
    };
    // Shape ids are unique within the slide and start at 2; 1 is the root group.
    const shapes = slide.items.map((item, j) => shapeXml(item, j + 2, lang, embed)).join('');

    if (slide.notes.length > 0) {
      slideRels.push([`rId${slideRels.length + 1}`, 'notesSlide', `../notesSlides/notesSlide${n}.xml`]);
      const paras = slide.notes.map((text) => `<a:p><a:r><a:rPr lang="${lang}" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`).join('');
      part(
        `ppt/notesSlides/notesSlide${n}.xml`,
        `${CT}.presentationml.notesSlide+xml`,
        `${XML}<p:notes ${NS}><p:cSld><p:spTree>${GROUP}${notesPlaceholder(2, 'sldImg', '<p:spPr/>', '')}${notesPlaceholder(3, 'body', '<p:spPr/>', `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody>`)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`,
      );
      files.push([
        `ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,
        rels([
          ['rId1', 'notesMaster', '../notesMasters/notesMaster1.xml'],
          ['rId2', 'slide', `../slides/slide${n}.xml`],
        ]),
      ]);
    }

    part(
      `ppt/slides/slide${n}.xml`,
      `${CT}.presentationml.slide+xml`,
      `${XML}<p:sld ${NS}><p:cSld><p:bg><p:bgPr>${solid({ color: slide.bg })}<a:effectLst/></p:bgPr></p:bg><p:spTree>${GROUP}${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    files.push([`ppt/slides/_rels/slide${n}.xml.rels`, rels(slideRels)]);
    const rid = `rId${presRels.length + 1}`;
    presRels.push([rid, 'slide', `slides/slide${n}.xml`]);
    slideIds.push(rid);
  });

  // Child order matters: masters, notes masters, slides, slide size, notes size.
  part(
    'ppt/presentation.xml',
    `${CT}.presentationml.presentation.main+xml`,
    `${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>' : ''}${slideIds.length > 0 ? `<p:sldIdLst>${slideIds.map((rid, i) => `<p:sldId id="${256 + i}" r:id="${rid}"/>`).join('')}</p:sldIdLst>` : ''}<p:sldSz cx="${ext(deck.w)}" cy="${ext(deck.h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  );
  files.push(['ppt/_rels/presentation.xml.rels', rels(presRels)]);

  const masterBg = '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>';
  part(
    'ppt/slideMasters/slideMaster1.xml',
    `${CT}.presentationml.slideMaster+xml`,
    `${XML}<p:sldMaster ${NS}><p:cSld>${masterBg}<p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMap ${CLRMAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
  );
  files.push([
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'theme', '../theme/theme1.xml'],
    ]),
  ]);
  part(
    'ppt/slideLayouts/slideLayout1.xml',
    `${CT}.presentationml.slideLayout+xml`,
    `${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GROUP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
  );
  files.push(['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])]);
  part('ppt/theme/theme1.xml', `${CT}.theme+xml`, theme('dex', deck.palette));

  if (hasNotes) {
    const at = (x: number, y: number, w: number, h: number) =>
      `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>${RECT_GEOM}</p:spPr>`;
    const emptyBody = `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="${lang}"/></a:p></p:txBody>`;
    part(
      'ppt/notesMasters/notesMaster1.xml',
      `${CT}.presentationml.notesMaster+xml`,
      `${XML}<p:notesMaster ${NS}><p:cSld>${masterBg}<p:spTree>${GROUP}${notesPlaceholder(2, 'sldImg', at(685800, 1143000, 5486400, 3086100), '')}${notesPlaceholder(3, 'body', at(685800, 4400550, 5486400, 3600450), emptyBody)}</p:spTree></p:cSld><p:clrMap ${CLRMAP}/></p:notesMaster>`,
    );
    files.push(['ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([['rId1', 'theme', '../theme/theme2.xml']])]);
    part('ppt/theme/theme2.xml', `${CT}.theme+xml`, theme('dex notes', deck.palette));
  }

  const creator = deck.author ? `<dc:creator>${escapeXml(deck.author)}</dc:creator>` : '';
  part(
    'docProps/core.xml',
    'application/vnd.openxmlformats-package.core-properties+xml',
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(deck.title)}</dc:title>${creator}</cp:coreProperties>`,
  );

  const types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${overrides
    .map(([name, type]) => `<Override PartName="/${name}" ContentType="${type}"/>`)
    .join('')}</Types>`;
  const root = rels([
    ['rId1', 'officeDocument', 'ppt/presentation.xml'],
    ['rId2', `${PKG_REL}/metadata/core-properties`, 'docProps/core.xml'],
  ]);
  // [Content_Types].xml must be the first entry.
  return zip([['[Content_Types].xml', types], ['_rels/.rels', root], ...files]);
}
