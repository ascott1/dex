import { describe, expect, it } from 'vitest';
import type { PptxDeck, PptxItem, PptxParagraph, PptxRun, PptxSlide } from './model';
import { escapeXml, writePptx } from './write';

const decoder = new TextDecoder();

/** The archive's entries in order (it is store-only, so the bytes follow each local header). */
function read(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = new Map<string, Uint8Array>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const start = at + 30 + nameLength + view.getUint16(at + 28, true);
    parts.set(decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength)), bytes.subarray(start, start + size));
    at = start + size;
  }
  return parts;
}

function open(deck: PptxDeck) {
  const parts = read(writePptx(deck));
  const text = (name: string): string => {
    const part = parts.get(name);
    if (!part) throw new Error(`no part ${name}; have ${[...parts.keys()].join(', ')}`);
    return decoder.decode(part);
  };
  return { parts, names: [...parts.keys()], text };
}

/** Where a relationship target points, from the part that owns the .rels file. */
function resolve(relsName: string, target: string): string {
  const dir = relsName.replace(/_rels\/[^/]+$/, '').split('/').filter(Boolean);
  for (const step of target.split('/')) {
    if (step === '..') dir.pop();
    else dir.push(step);
  }
  return dir.join('/');
}

const palette = { bg: 'EBF6F4', ink: '0F1413', ink2: '485653', ink3: '6E7B78', line: 'D8E3E1', red: 'E04E2B', blue: '2B62E3', marker: 'FFD84A' };
const run = (text: string, more: Partial<Exclude<PptxRun, { break: true }>> = {}): PptxRun => ({
  text,
  font: 'DM Sans',
  size: 26,
  bold: false,
  italic: false,
  color: { color: '0F1413' },
  ...more,
});
const para = (runs: PptxRun[], more: Partial<PptxParagraph> = {}): PptxParagraph => ({ runs, align: 'l', lineHeight: 37.7, ...more });
const slide = (items: PptxItem[] = [], notes: string[] = []): PptxSlide => ({ bg: 'EBF6F4', items, notes });
const deck = (slides: PptxSlide[], more: Partial<PptxDeck> = {}): PptxDeck => ({ title: 'Test', lang: 'en', w: 1600, h: 900, palette, slides, ...more });
const textBox = (paragraphs: PptxParagraph[], more: Partial<PptxItem & { kind: 'text' }> = {}): PptxItem => ({
  kind: 'text',
  x: 128,
  y: 112,
  w: 800,
  h: 100,
  wrap: true,
  paragraphs,
  ...more,
});
const pixel = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const picture = (key: string, more: Partial<PptxItem & { kind: 'picture' }> = {}): PptxItem => ({
  kind: 'picture',
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  key,
  type: 'png',
  data: pixel,
  alt: '',
  ...more,
});

describe('the package', () => {
  const file = open(deck([slide([], ['A note.']), slide(), slide([picture('a'), picture('b', { type: 'jpeg' })], ['One.', 'Two.'])]));

  it('starts with [Content_Types].xml and the root relationships', () => {
    expect(file.names.slice(0, 2)).toEqual(['[Content_Types].xml', '_rels/.rels']);
  });

  it('gives every part a content type', () => {
    const types = file.text('[Content_Types].xml');
    const defaults = [...types.matchAll(/<Default Extension="([^"]+)"/g)].map((m) => m[1]);
    expect(defaults).toEqual(['rels', 'xml', 'png', 'jpg']);
    const overrides = new Set([...types.matchAll(/<Override PartName="\/([^"]+)"/g)].map((m) => m[1]));
    for (const name of file.names) {
      if (name === '[Content_Types].xml') continue;
      if (name.endsWith('.rels') || name.startsWith('ppt/media/')) expect(defaults).toContain(name.split('.').pop());
      else expect(overrides, name).toContain(name);
    }
    // And no content type for a part that is not there.
    for (const name of overrides) expect(file.names, name).toContain(name);
  });

  it('points every relationship at a part that exists, with ids unique in each file', () => {
    const relsFiles = file.names.filter((name) => name.endsWith('.rels'));
    expect(relsFiles.length).toBeGreaterThan(6);
    for (const name of relsFiles) {
      const rels = [...file.text(name).matchAll(/<Relationship Id="([^"]+)" Type="[^"]+" Target="([^"]+)"\/>/g)];
      expect(rels.length, name).toBeGreaterThan(0);
      expect(new Set(rels.map((m) => m[1])).size, name).toBe(rels.length);
      for (const [, , target] of rels) expect(file.names, `${name} → ${target}`).toContain(resolve(name, target!));
    }
  });

  it('counts slides and notes: a notes slide only where there are notes', () => {
    expect(file.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(3);
    expect(file.names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))).toEqual([
      'ppt/notesSlides/notesSlide1.xml',
      'ppt/notesSlides/notesSlide3.xml',
    ]);
    expect(file.text('ppt/notesSlides/notesSlide3.xml')).toContain('<a:t>One.</a:t></a:r></a:p><a:p>');
    expect(file.text('ppt/slides/_rels/slide2.xml.rels')).not.toContain('notesSlide');
    expect(file.names).toContain('ppt/notesMasters/notesMaster1.xml');
    expect(file.names).toContain('ppt/theme/theme2.xml');
  });

  it('writes the presentation part in the order the schema wants, with the fixed ids', () => {
    const xml = file.text('ppt/presentation.xml');
    const order = ['<p:sldMasterIdLst>', '<p:notesMasterIdLst>', '<p:sldIdLst>', '<p:sldSz', '<p:notesSz'].map((tag) => xml.indexOf(tag));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(xml).toContain('<p:sldMasterId id="2147483648"');
    expect([...xml.matchAll(/<p:sldId id="(\d+)"/g)].map((m) => m[1])).toEqual(['256', '257', '258']);
    expect(file.text('ppt/slideMasters/slideMaster1.xml')).toContain('<p:sldLayoutId id="2147483649"');
  });

  it('leaves out the notes master when no slide has notes', () => {
    const plain = open(deck([slide(), slide()]));
    expect(plain.names.filter((n) => n.includes('notes'))).toEqual([]);
    expect(plain.names).not.toContain('ppt/theme/theme2.xml');
    expect(plain.text('ppt/presentation.xml')).not.toContain('notesMasterIdLst');
    expect(plain.text('ppt/_rels/presentation.xml.rels')).not.toContain('notesMaster');
  });

  it('takes the slide size from the deck: 16:9 and 4:3', () => {
    expect(open(deck([slide()])).text('ppt/presentation.xml')).toContain('<p:sldSz cx="15240000" cy="8572500"/>');
    expect(open(deck([slide()], { w: 1200 })).text('ppt/presentation.xml')).toContain('<p:sldSz cx="11430000" cy="8572500"/>');
  });

  it('builds the theme from the palette and sets DM Sans', () => {
    const theme = file.text('ppt/theme/theme1.xml');
    expect(theme).toContain('<a:dk1><a:srgbClr val="0F1413"/></a:dk1><a:lt1><a:srgbClr val="EBF6F4"/></a:lt1>');
    expect(theme).toContain('<a:accent1><a:srgbClr val="E04E2B"/></a:accent1>');
    expect(theme).toContain('<a:latin typeface="DM Sans"/>');
  });

  it('puts the title and author in the core properties, escaped', () => {
    const core = open(deck([slide()], { title: 'Q&A <draft>', author: 'A "B"' })).text('docProps/core.xml');
    expect(core).toContain('<dc:title>Q&amp;A &lt;draft&gt;</dc:title><dc:creator>A &quot;B&quot;</dc:creator>');
    expect(open(deck([slide()])).text('docProps/core.xml')).not.toContain('dc:creator');
  });
});

describe('a slide', () => {
  it('has its background colour, then the items in order with ids from 2', () => {
    const xml = open(
      deck([
        {
          bg: '0D1211',
          notes: [],
          items: [
            { kind: 'rect', x: 0, y: 0, w: 10, h: 10, fill: { color: 'FFFFFF' } },
            textBox([para([run('a')])]),
            { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, line: { color: '000000', width: 1 }, cap: 'flat' },
          ],
        },
      ]),
    ).text('ppt/slides/slide1.xml');
    expect(xml).toContain('<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0D1211"></a:srgbClr></a:solidFill><a:effectLst/></p:bgPr></p:bg>');
    expect([...xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)].map((m) => [m[1], m[2]])).toEqual([
      ['1', ''],
      ['2', 'Rectangle 2'],
      ['3', 'Text 3'],
      ['4', 'Line 4'],
    ]);
  });
});

describe('items', () => {
  const xmlOf = (...items: PptxItem[]) => open(deck([slide(items)])).text('ppt/slides/slide1.xml');

  it('rect: a filled rectangle with alpha, and no outline', () => {
    const xml = xmlOf({ kind: 'rect', x: 128, y: 112.5, w: 100, h: 50, fill: { color: '0F1413', alpha: 0.05 } });
    expect(xml).toContain('<a:xfrm><a:off x="1219200" y="1071563"/><a:ext cx="952500" cy="476250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>');
    expect(xml).toContain('<a:solidFill><a:srgbClr val="0F1413"><a:alpha val="5000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>');
  });

  it('rect: a hairline outline keeps noFill; a wider one gets a transparent fill, for Quick Look', () => {
    const hairline = xmlOf({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, line: { color: 'D8E3E1', width: 1 } });
    expect(hairline).toContain('</a:prstGeom><a:noFill/><a:ln w="9525"><a:solidFill><a:srgbClr val="D8E3E1"></a:srgbClr></a:solidFill><a:round/></a:ln>');
    const box = xmlOf({ kind: 'rect', x: 0, y: 0, w: 10, h: 10, line: { color: 'E04E2B', width: 6 } });
    expect(box).toContain('</a:prstGeom><a:solidFill><a:srgbClr val="E04E2B"><a:alpha val="0"/></a:srgbClr></a:solidFill><a:ln w="57150">');
  });

  it('rect: never a negative extent', () => {
    expect(xmlOf({ kind: 'rect', x: 5, y: 5, w: -3, h: -0.2, fill: { color: '000000' } })).toContain('<a:ext cx="0" cy="0"/>');
  });

  it('line: a connector, flipped for its direction, with its cap', () => {
    const xml = xmlOf(
      { kind: 'line', x1: 100, y1: 50, x2: 300, y2: 50, line: { color: 'D8E3E1', width: 1 }, cap: 'flat' },
      { kind: 'line', x1: 300, y1: 200, x2: 100, y2: 100, line: { color: '2B62E3', width: 6, alpha: 0.5 }, cap: 'round', arrow: true },
    );
    expect(xml).toContain('<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2" name="Line 2"/>');
    expect(xml).toContain('<a:xfrm><a:off x="952500" y="476250"/><a:ext cx="1905000" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="9525" cap="flat">');
    expect(xml).not.toMatch(/Line 2.*?<a:tailEnd.*?Line 3/s);
    expect(xml).toContain('<a:xfrm flipH="1" flipV="1"><a:off x="952500" y="952500"/><a:ext cx="1905000" cy="952500"/></a:xfrm>');
    expect(xml).toContain('<a:ln w="57150" cap="rnd"><a:solidFill><a:srgbClr val="2B62E3"><a:alpha val="50000"/></a:srgbClr></a:solidFill><a:round/><a:tailEnd type="arrow"/></a:ln>');
  });

  it('path: a closed freeform in EMU relative to its bounding box', () => {
    const xml = xmlOf({ kind: 'path', points: [[110, 220], [210, 240], [160, 320]], fill: { color: 'FFD84A', alpha: 0.45 } });
    expect(xml).toContain('<a:xfrm><a:off x="1047750" y="2095500"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:custGeom>');
    expect(xml).toContain(
      '<a:path w="952500" h="952500"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="952500" y="190500"/></a:lnTo><a:lnTo><a:pt x="476250" y="952500"/></a:lnTo><a:close/></a:path>',
    );
    expect(xml).toContain('<a:alpha val="45000"/>');
  });

  it('picture: a p:pic that stretches its blip, with the alt text', () => {
    const xml = xmlOf(picture('a', { x: 10, y: 20, w: 300, h: 200, alt: 'A "grid" & more' }));
    expect(xml).toContain('<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture 2" descr="A &quot;grid&quot; &amp; more"/>');
    expect(xml).toContain('<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>');
    expect(xml).toContain('<a:off x="95250" y="190500"/><a:ext cx="2857500" cy="1905000"/>');
  });

  it('text: a text box with zero insets, top anchor, no autofit, and its wrap', () => {
    const wrapped = xmlOf(textBox([para([run('a')])]));
    expect(wrapped).toContain('<p:cNvSpPr txBox="1"/>');
    expect(wrapped).toContain('<a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr>');
    expect(wrapped).toContain('</a:prstGeom><a:noFill/></p:spPr><p:txBody>');
    expect(xmlOf(textBox([para([run('a')])], { wrap: false }))).toContain('<a:bodyPr wrap="none"');
  });

  it('text: a fill and an inset make a filled box (a sticky note)', () => {
    const xml = xmlOf(textBox([para([run('note')])], { fill: { color: 'FFE76A' }, inset: 16 }));
    expect(xml).toContain('</a:prstGeom><a:solidFill><a:srgbClr val="FFE76A"></a:srgbClr></a:solidFill></p:spPr>');
    expect(xml).toContain('lIns="152400" tIns="152400" rIns="152400" bIns="152400"');
  });

  it('table: a graphic frame with a grid, rows, cell padding and the bottom rule', () => {
    const cell = (text: string, more = {}) => ({ paragraphs: [para([run(text)])], padding: [0, 14, 20, 14] as [number, number, number, number], anchor: 't' as const, ...more });
    const xml = xmlOf({
      kind: 'table',
      x: 128,
      y: 200,
      w: 480,
      h: 100,
      columns: [360, 120],
      rows: [
        { h: 45, cells: [cell('A', { anchor: 'b', borderBottom: { color: '0F1413', width: 1 } }), cell('B', { fill: 'E0EBE9' })] },
        { h: 58, cells: [cell('one'), cell('two')] },
      ],
    });
    expect(xml).toContain('<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table 2"/>');
    expect(xml).toContain('<p:xfrm><a:off x="1219200" y="1905000"/><a:ext cx="4572000" cy="952500"/></p:xfrm>');
    expect(xml).toContain('<a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="3429000"/><a:gridCol w="1143000"/></a:tblGrid><a:tr h="428625">');
    expect(xml.match(/<a:tr /g)).toHaveLength(2);
    expect(xml.match(/<a:tc>/g)).toHaveLength(4);
    // Lines first, in order, then the fill.
    expect(xml).toContain(
      '<a:tcPr marL="0" marR="190500" marT="133350" marB="133350" anchor="b"><a:lnL w="0"><a:noFill/></a:lnL><a:lnR w="0"><a:noFill/></a:lnR><a:lnT w="0"><a:noFill/></a:lnT><a:lnB w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="0F1413"></a:srgbClr></a:solidFill><a:prstDash val="solid"/></a:lnB><a:noFill/></a:tcPr>',
    );
    expect(xml).toContain('<a:lnB w="0"><a:noFill/></a:lnB><a:solidFill><a:srgbClr val="E0EBE9"></a:srgbClr></a:solidFill></a:tcPr>');
  });
});

describe('pictures', () => {
  it('stores a repeated key once and shares it by relationship', () => {
    const other = Uint8Array.from([0xff, 0xd8, 9]);
    const file = open(deck([slide([picture('same'), picture('same'), picture('other', { type: 'jpeg', data: other })]), slide([picture('same')])]));
    expect(file.names.filter((n) => n.startsWith('ppt/media/'))).toEqual(['ppt/media/image1.png', 'ppt/media/image2.jpg']);
    expect([...file.parts.get('ppt/media/image1.png')!]).toEqual([...pixel]);
    expect([...file.parts.get('ppt/media/image2.jpg')!]).toEqual([...other]);
    const first = file.text('ppt/slides/slide1.xml');
    expect([...first.matchAll(/r:embed="(rId\d+)"/g)].map((m) => m[1])).toEqual(['rId2', 'rId2', 'rId3']);
    const rels = file.text('ppt/slides/_rels/slide1.xml.rels');
    expect(rels.match(/relationships\/image"/g)).toHaveLength(2);
    expect(rels).toContain('<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>');
    expect(file.text('ppt/slides/_rels/slide2.xml.rels')).toContain('Target="../media/image1.png"');
  });

  it('keeps the notes relationship after the pictures', () => {
    const rels = open(deck([slide([picture('a')], ['n'])])).text('ppt/slides/_rels/slide1.xml.rels');
    expect(rels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"');
    expect(rels).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"');
  });
});

describe('text', () => {
  const xmlOf = (...paragraphs: PptxParagraph[]) => open(deck([slide([textBox(paragraphs)])])).text('ppt/slides/slide1.xml');

  it('a run: its attributes, then fill, highlight, latin, ea, cs in that order', () => {
    const xml = xmlOf(
      para([
        run('Marked', {
          font: 'DM Mono',
          size: 22.88,
          bold: true,
          italic: true,
          color: { color: '485653', alpha: 0.45 },
          spacing: 1.56,
          underline: true,
          strike: true,
          superscript: true,
          highlight: 'F3E9A8',
        }),
      ]),
    );
    const mono = 'typeface="DM Mono" panose="020B0509040201040103" pitchFamily="49" charset="0"';
    expect(xml).toContain(
      `<a:r><a:rPr lang="en" sz="1716" b="1" i="1" u="sng" strike="sngStrike" baseline="30000" spc="117" dirty="0"><a:solidFill><a:srgbClr val="485653"><a:alpha val="45000"/></a:srgbClr></a:solidFill><a:highlight><a:srgbClr val="F3E9A8"/></a:highlight><a:latin ${mono}/><a:ea ${mono}/><a:cs ${mono}/></a:rPr><a:t>Marked</a:t></a:r>`,
    );
  });

  it('a plain run has only what it needs, and a sans carries the sans hints', () => {
    const xml = xmlOf(para([run('Plain')]));
    const sans = 'typeface="DM Sans" panose="020B0604020202020204" pitchFamily="34" charset="0"';
    expect(xml).toContain(
      `<a:r><a:rPr lang="en" sz="1950" b="0" i="0" dirty="0"><a:solidFill><a:srgbClr val="0F1413"></a:srgbClr></a:solidFill><a:latin ${sans}/><a:ea ${sans}/><a:cs ${sans}/></a:rPr><a:t>Plain</a:t></a:r>`,
    );
  });

  it('a paragraph: alignment, exact line spacing, no bullet, and its end size', () => {
    const xml = xmlOf(para([run('a', { size: 60 })], { align: 'ctr', lineHeight: 64.8 }));
    expect(xml).toContain('<a:p><a:pPr algn="ctr"><a:lnSpc><a:spcPts val="4860"/></a:lnSpc><a:buNone/></a:pPr><a:r>');
    expect(xml).toContain('</a:r><a:endParaRPr lang="en" sz="4500" dirty="0"/></a:p>');
  });

  it('a list paragraph: hanging indent, space before and a tab stop, in schema order', () => {
    const xml = xmlOf(para([run('▪\t', { font: 'Arial' }), run('Item')], { marginLeft: 35.1, indent: -35.1, tab: 35.1, spaceBefore: 16.9 }));
    expect(xml).toContain(
      '<a:pPr marL="334328" indent="-334328" algn="l"><a:lnSpc><a:spcPts val="2828"/></a:lnSpc><a:spcBef><a:spcPts val="1268"/></a:spcBef><a:buNone/><a:tabLst><a:tab pos="334328" algn="l"/></a:tabLst></a:pPr>',
    );
    expect(xml).toContain('<a:latin typeface="Arial" panose="020B0604020202020204"');
    expect(xml).toContain('<a:t>▪\t</a:t>');
  });

  it('a break carries the size of the text before it', () => {
    const xml = xmlOf(para([run('One', { size: 104 }), { break: true }, run('two', { size: 104 })], { lineHeight: 104 }));
    expect(xml).toContain('</a:r><a:br><a:rPr lang="en" sz="7800" dirty="0"/></a:br><a:r>');
  });

  it('an empty paragraph keeps the size of the text around it', () => {
    const xml = xmlOf(para([run('code', { size: 20 })], { lineHeight: 30 }), para([], { lineHeight: 30 }), para([run('more', { size: 20 })], { lineHeight: 30 }));
    expect(xml).toContain('<a:p><a:pPr algn="l"><a:lnSpc><a:spcPts val="2250"/></a:lnSpc><a:buNone/></a:pPr><a:endParaRPr lang="en" sz="1500" dirty="0"/></a:p>');
    expect(xml.match(/<a:endParaRPr /g)).toHaveLength(3);
  });

  it('keeps numbers inside what the schema allows', () => {
    const xml = xmlOf(para([run('tiny', { size: 0.5 }), run('huge', { size: 9000 })], { lineHeight: 5000, spaceBefore: 4000 }));
    expect(xml).toContain('sz="100"');
    expect(xml).toContain('sz="400000"');
    expect(xml.match(/<a:spcPts val="158400"\/>/g)).toHaveLength(2);
    for (const [, value] of xml.matchAll(/ (?:x|y|cx|cy|w|h|pos|marL|indent|sz|spc|val)="([^"]*)"/g)) {
      if (/^[0-9A-F]{6}$/.test(value!)) continue;   // a colour
      expect(value, value).toMatch(/^-?\d+$|^[a-z]+$/i);
    }
  });

  it('escapes text and drops the control characters XML forbids', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
    expect(escapeXml('a\u0000b\u0008c\u000Bd\u001Fe\tf\ng')).toBe('abcde\tf\ng');
    expect(escapeXml('ok 😀 \uD83D lone')).toBe('ok 😀  lone');
    const xml = xmlOf(para([run('if (a < b && c > "d") {\u0001}')]));
    expect(xml).toContain('<a:t>if (a &lt; b &amp;&amp; c &gt; &quot;d&quot;) {}</a:t>');
  });

  it('writes the deck language on every run', () => {
    const xml = open(deck([slide([textBox([para([run('a'), { break: true }])])])], { lang: 'de' })).text('ppt/slides/slide1.xml');
    expect(xml.match(/lang="de"/g)).toHaveLength(3);
    expect(xml).not.toContain('lang="en"');
  });
});
