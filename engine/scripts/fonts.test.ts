import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { embedFonts, loadFaces, STYLE_ID, type FontFace } from './embed-fonts.mjs';

const SCRIPT = fileURLToPath(new URL('./fonts.mjs', import.meta.url));

const SANS = `font-family="'DM Sans', system-ui, sans-serif"`;
const MONO = `font-family="'DM Mono', Menlo, Consolas, monospace"`;
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="900" viewBox="0 0 800 900">\n<title>A test</title>\n${body}\n</svg>\n`;

// Small stand-ins for the real files, with the real subsets' shape: latin and latin-ext.
const face = (family: string, weight: string, when: FontFace['when'], subset: 'latin' | 'ext'): FontFace => ({
  family,
  weight,
  when,
  range: subset === 'latin' ? 'U+0000-00FF,U+2191' : 'U+0100-02BA',
  ranges: subset === 'latin' ? [[0x0, 0xff], [0x2191, 0x2191]] : [[0x100, 0x2ba]],
  data: `${family.replace(' ', '')}${weight.replace(' ', '')}${subset}`,
});
const FACES = [
  face('DM Sans', '100 1000', 'always', 'ext'),
  face('DM Sans', '100 1000', 'always', 'latin'),
  face('DM Mono', '400', 'always', 'ext'),
  face('DM Mono', '400', 'always', 'latin'),
  face('DM Mono', '500', 'bold', 'ext'),
  face('DM Mono', '500', 'bold', 'latin'),
];
const rules = (out: string) => [...out.matchAll(/@font-face\{font-family:'([^']+)';font-weight:([^;]+);src:url\(data:font\/woff2;base64,([^)]+)\)/g)].map((m) => m[3]);

describe('embedFonts', () => {
  it('embeds only the families the text uses, in a style after the opening tag', () => {
    const source = svg(`<text x="0" y="0" ${SANS}>deck.md</text>`);
    const { svg: out, families, missing } = embedFonts(source, FACES);
    expect(families).toEqual(['DM Sans']);
    expect(missing).toEqual([]);
    expect(rules(out)).toEqual(['DMSans1001000latin']);
    expect(out).toContain(`viewBox="0 0 800 900">\n<style id="${STYLE_ID}">@font-face{font-family:'DM Sans';font-weight:100 1000;`);
    expect(out).toContain(`unicode-range:U+0000-00FF,U+2191}</style>\n<title>A test</title>`);
    // Everything else is untouched.
    expect(out.replace(/\n<style id="dex-fonts">[^<]*<\/style>/, '')).toBe(source);
  });

  it('embeds both families when both are used, and the 500 weight of the mono only when something is bold', () => {
    const both = svg(`<text ${SANS}>compiler</text><text ${MONO}>02 COMPILE</text>`);
    expect(embedFonts(both, FACES).families).toEqual(['DM Sans', 'DM Mono']);
    expect(rules(embedFonts(both, FACES).svg)).toEqual(['DMSans1001000latin', 'DMMono400latin']);

    for (const bold of ['font-weight="500"', 'font-weight="bold"', 'style="font-weight: 700"']) {
      const out = embedFonts(svg(`<text ${MONO} ${bold}>02 COMPILE</text>`), FACES).svg;
      expect(rules(out), bold).toEqual(['DMMono400latin', 'DMMono500latin']);
    }
    expect(rules(embedFonts(svg(`<text ${MONO} font-weight="400">02</text>`), FACES).svg)).toEqual(['DMMono400latin']);
  });

  it('adds the latin-ext subset only for text that needs it, and reports characters neither subset has', () => {
    const polish = embedFonts(svg(`<text ${SANS}>Łódź &#x2192; ↑</text>`), FACES);
    expect(rules(polish.svg)).toEqual(['DMSans1001000ext', 'DMSans1001000latin']);
    expect(polish.missing).toEqual(['→']);
    // Characters in tags, comments, and attributes are not text.
    const quiet = embedFonts(svg(`<!-- Łódź → --><text ${SANS} aria-label="Ł">plain</text>`), FACES);
    expect(rules(quiet.svg)).toEqual(['DMSans1001000latin']);
    expect(quiet.missing).toEqual([]);
  });

  it('is the same after a second run, and follows an edit', () => {
    const once = embedFonts(svg(`<text ${SANS}>one</text>`), FACES).svg;
    expect(embedFonts(once, FACES).svg).toBe(once);
    const edited = once.replace(`<text ${SANS}>one</text>`, `<text ${SANS}>one</text><text ${MONO}>TWO</text>`);
    const again = embedFonts(edited, FACES);
    expect(again.families).toEqual(['DM Sans', 'DM Mono']);
    expect(again.svg.match(/<style/g)).toHaveLength(1);
  });

  it('leaves alone an SVG with no text in either font, and takes out fonts whose text has gone', () => {
    const plate = svg('<rect width="80" height="80" fill="#0f1413"/>');
    expect(embedFonts(plate, FACES)).toEqual({ svg: plate, families: [], missing: [] });
    const other = svg('<text font-family="Georgia">serif</text>');
    expect(embedFonts(other, FACES)).toEqual({ svg: other, families: [], missing: [] });
    // A font named in the file but with no <text> to use it.
    const unused = svg(`<g ${SANS}><rect width="80" height="80"/></g>`);
    expect(embedFonts(unused, FACES).svg).toBe(unused);

    const withText = embedFonts(svg(`<text ${SANS}>one</text>`), FACES).svg;
    const textGone = withText.replace(`<text ${SANS}>one</text>`, '<rect width="80" height="80"/>');
    expect(embedFonts(textGone, FACES)).toEqual({ svg: svg('<rect width="80" height="80"/>'), families: [], missing: [] });
  });

  it("uses the app's name for the variable font when that is the only name in the file", () => {
    const out = embedFonts(svg(`<text font-family="'DM Sans Variable'">x</text>`), FACES).svg;
    expect(out).toContain(`@font-face{font-family:'DM Sans Variable';`);
    const stack = embedFonts(svg(`<text font-family="'DM Sans Variable', 'DM Sans'">x</text>`), FACES).svg;
    expect(stack).toContain(`@font-face{font-family:'DM Sans';`);
  });
});

describe('loadFaces', () => {
  it('reads the faces the app uses from the font packages: DM Sans with optical sizes, DM Mono 400 and 500', () => {
    const faces = loadFaces();
    expect(faces.map((f) => `${f.family} ${f.weight} ${f.when}`).sort()).toEqual([
      'DM Mono 400 always', 'DM Mono 400 always',
      'DM Mono 500 bold', 'DM Mono 500 bold',
      'DM Sans 100 1000 always', 'DM Sans 100 1000 always',
    ]);
    for (const f of faces) {
      // woff2 files start with the signature "wOF2".
      expect(Buffer.from(f.data, 'base64').subarray(0, 4).toString('latin1'), f.family).toBe('wOF2');
      expect(f.ranges.length).toBeGreaterThan(0);
    }
    // Plain English text needs the latin subset of each and nothing else.
    const out = embedFonts(svg(`<text ${SANS}>deck.md</text><text ${MONO}>01 WRITE</text>`), faces);
    expect(out.families).toEqual(['DM Sans', 'DM Mono']);
    expect(out.svg.match(/@font-face/g)).toHaveLength(2);
    expect(out.missing).toEqual([]);
  });
});

describe('pnpm fonts', () => {
  let cwd = '';
  afterEach(() => { if (cwd) rmSync(cwd, { recursive: true, force: true }); });

  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const setup = () => {
    cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'dex-fonts-')));
    const media = path.join(cwd, 'decks', 'talk', 'media');
    mkdirSync(path.join(media, 'more'), { recursive: true });
    writeFileSync(path.join(media, 'flow.svg'), svg(`<text ${SANS}>deck.md →</text>`));
    writeFileSync(path.join(media, 'plate.svg'), svg('<rect width="80" height="80"/>'));
    writeFileSync(path.join(media, 'more', 'labels.svg'), svg(`<text ${MONO}>01 WRITE</text>`));
    writeFileSync(path.join(media, 'photo.jpg'), 'not an svg');
    return media;
  };

  it('embeds the fonts in every SVG of a deck that has text in them, and says what it did', () => {
    const media = setup();
    const plate = readFileSync(path.join(media, 'plate.svg'), 'utf8');
    const first = run('talk');
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/decks\/talk\/media\/flow\.svg: embedded DM Sans \(\d+ KB\)\n {2}not in these fonts, so drawn in another: →/);
    expect(first.stdout).toMatch(/decks\/talk\/media\/more\/labels\.svg: embedded DM Mono \(\d+ KB\)/);
    expect(first.stdout).toContain('decks/talk/media/plate.svg: no text in DM Sans or DM Mono, left as it is');
    expect(readFileSync(path.join(media, 'flow.svg'), 'utf8')).toContain(`<style id="${STYLE_ID}">@font-face{font-family:'DM Sans'`);
    expect(readFileSync(path.join(media, 'plate.svg'), 'utf8')).toBe(plate);
    expect(readFileSync(path.join(media, 'photo.jpg'), 'utf8')).toBe('not an svg');

    const flow = readFileSync(path.join(media, 'flow.svg'), 'utf8');
    const second = run('talk');
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('decks/talk/media/flow.svg: DM Sans already embedded');
    expect(readFileSync(path.join(media, 'flow.svg'), 'utf8')).toBe(flow);
  });

  it('takes file paths too', () => {
    const media = setup();
    const r = run(path.join('decks', 'talk', 'media', 'more', 'labels.svg'));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/labels\.svg: embedded DM Mono/);
    expect(readFileSync(path.join(media, 'flow.svg'), 'utf8')).not.toContain('<style');
  });

  it('fails clearly on no argument, an unknown deck, a missing file, and a bad name, and writes nothing', () => {
    const media = setup();
    const flow = readFileSync(path.join(media, 'flow.svg'), 'utf8');
    for (const [args, message] of [
      [[], 'usage: pnpm fonts <deck>'],
      [['nope'], 'decks/nope does not exist'],
      [['decks/talk/media/gone.svg'], 'gone.svg does not exist'],
      [['../talk'], 'neither a deck name nor an .svg file'],
      [['talk', 'nope'], 'decks/nope does not exist'],
    ] as const) {
      const r = run(...args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.stderr).toContain(message);
    }
    expect(readFileSync(path.join(media, 'flow.svg'), 'utf8')).toBe(flow);
  });
});
