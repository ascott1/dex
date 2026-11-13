// PowerPoint export (§9 Phase 11): measure the print view, write the file,
// and hand it to the browser as a download. PrintView loads this module on the
// first click, so none of it is in the bundle a presenter loads.

import type { Deck, Marks } from '$shared/types';
import { stageSize } from '../stage';
import { collectDeck } from './collect';
import { PPTX_MIME, writePptx } from './write';

export interface ExportInput {
  /** The print view's root element: what it shows is what is exported. */
  root: HTMLElement;
  deck: Deck;
  /** The deck's marks while the print view's MARKS toggle is on, else null. */
  marks: Marks | null;
}

/** The deck's title without the characters a file name cannot hold, or the slug when nothing is left. */
export function pptxFileName(title: string, slug: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '');
  return `${name || slug}.pptx`;
}

/** Everything the measurement depends on: fonts, every picture, and one frame for auto-fit to settle. */
async function settled(root: HTMLElement): Promise<void> {
  await document.fonts.ready;
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {})));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
    // A window that is not being drawn gets no frames.
    setTimeout(resolve, 250);
  });
}

function download(bytes: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: PPTX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Exports the pages the print view is showing as a .pptx and starts the download. Returns the file name. */
export async function exportPptx({ root, deck, marks }: ExportInput): Promise<string> {
  await settled(root);
  const model = await collectDeck({
    root,
    title: deck.meta.title,
    author: deck.meta.author,
    lang: deck.meta.lang,
    size: stageSize(deck.meta.aspect),
    slides: deck.slides,
    marks,
  });
  const name = pptxFileName(deck.meta.title, deck.slug);
  download(writePptx(model), name);
  return name;
}
