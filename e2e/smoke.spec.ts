import { expect, test, type Page } from '@playwright/test';
import { counter, current, demoDeckTests, expectSlide, open } from './navigation.ts';
import { removeTempDecks, writeDeck } from './temp-deck.ts';

test.describe('demo deck', () => demoDeckTests({ dev: true }));

// Live reload uses a temporary deck under decks/zz-e2e-*, never decks/demo.
test.describe.serial('live reload', () => {
  const slug = 'zz-e2e-live';
  const deckWith = (third: string) =>
    ['# Live deck', '---', '## Two\n\nSecond slide', '---', `## Three\n\n${third}`, '---', '## Four\n\nLast'].join('\n\n');

  test.beforeAll(() => removeTempDecks());
  test.afterAll(() => removeTempDecks());

  async function markPage(page: Page) {
    await page.evaluate(() => Object.assign(window, { __marker: 'same page' }));
  }

  async function expectSamePage(page: Page) {
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('same page');
    expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  }

  test('an edit appears without a page load, and follow-edits jumps to it', async ({ page }) => {
    writeDeck(slug, deckWith('Original text'));
    await open(page, `#/${slug}/1`);
    await expectSlide(page, 1, slug, 4);
    await markPage(page);

    writeDeck(slug, deckWith('Edited on disk'));
    await expect(current(page)).toContainText('Edited on disk', { timeout: 10_000 });
    await expectSlide(page, 3, slug, 4);
    await expectSamePage(page);
  });

  test('an update that arrives while the deck is still opening does not lose the slide in the URL', async ({ page }) => {
    writeDeck(slug, deckWith('Before'));
    // Hold every deck.json response long enough for the edit below to land mid-open.
    await page.route(`**/decks/${slug}/deck.json`, async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    const loading = page.goto(`/#/${slug}/3`);
    await page.waitForRequest(`**/decks/${slug}/deck.json`);
    writeDeck(slug, deckWith('During the open'));
    await loading;
    await expect(current(page)).toContainText('During the open', { timeout: 10_000 });
    await expectSlide(page, 3, slug, 4);
  });

  test('with follow-edits off, the current slide is kept by id', async ({ page }) => {
    writeDeck(slug, deckWith('Kept'));
    await open(page, `#/${slug}/3`);
    await page.evaluate(() => {
      (window as unknown as { __dex: { settings: { followEdits: boolean } } }).__dex.settings.followEdits = false;
    });
    await markPage(page);
    // Insert a slide before the current one.
    writeDeck(slug, deckWith('Kept').replace('## Two', '## Inserted\n\n---\n\n## Two'));
    await expectSlide(page, 4, slug, 5);
    await expect(current(page)).toContainText('Kept');
    await expectSamePage(page);
  });

  test('a compile error shows the error line and keeps the last good deck', async ({ page }) => {
    writeDeck(slug, deckWith('Still here'));
    await open(page, `#/${slug}/3`);
    await markPage(page);
    writeDeck(slug, `---\ntitle: [unclosed\n---\n\n${deckWith('Broken')}`);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText('Line');
    await expect(current(page)).toContainText('Still here');

    writeDeck(slug, deckWith('Fixed'));
    await expect(current(page)).toContainText('Fixed', { timeout: 10_000 });
    await expect(alert).toHaveCount(0);
    await expectSamePage(page);
  });

  test('compile warnings show in the bottom bar and link to their slide', async ({ page }) => {
    writeDeck(slug, deckWith('Fine').replace('## Two', '<!-- layuot: statement -->\n\n## Two'));
    await open(page, `#/${slug}/1`);
    const button = page.getByRole('button', { name: /1 warning/i });
    await expect(button).toBeVisible();
    await button.click();
    await page.getByRole('dialog', { name: 'Compile warnings' }).getByRole('button').first().click();
    await expectSlide(page, 2, slug, 4);
  });

  test('an empty deck says so, and fills in when slides are written', async ({ page }) => {
    writeDeck(slug, '');
    await page.goto(`/#/${slug}`);
    await expect(page.getByText('No slides yet')).toBeVisible();
    await expect(page.getByText(`decks/${slug}/deck.md`)).toBeVisible();
    await markPage(page);
    writeDeck(slug, '# Hello again');
    await expect(current(page)).toContainText('Hello again', { timeout: 10_000 });
    await expect(page.getByText('No slides yet')).toHaveCount(0);
    await expectSamePage(page);
  });

  test('with two decks, / lists them', async ({ page }) => {
    writeDeck(slug, deckWith('Listed'));
    await page.goto('/');
    await expect(page.locator('.index .row')).toHaveCount(2);
    await page.locator('.index .row', { hasText: 'Live deck' }).click();
    await expectSlide(page, 1, slug, 4);
  });
});
