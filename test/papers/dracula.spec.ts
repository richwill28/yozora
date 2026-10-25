import { expect, test } from '@playwright/test';

test('Dracula renders its VS Code palette and survives preview, toggle, and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?paper=equality-saturation.pdf');
  await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');

  const send = (type: string, theme?: string) =>
    page.evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
      type,
      theme,
    });
  const saved = () =>
    page.evaluate(
      () =>
        JSON.parse(
          sessionStorage.getItem('yozora-test:equality-saturation.pdf') ?? '{}',
        ) as unknown,
    );

  await send('previewTheme', 'dracula');
  await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'dracula');
  expect(await saved()).toMatchObject({ theme: 'midnight' });

  // Inspect actual composited PDF pixels, so broken SVG references or CSP failures
  // cannot silently leave us with a plain inversion or the original white page.
  const png = await page.locator('.page[data-page-number="1"]').screenshot();
  const counts = await page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let background = 0;
    let foreground = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Chromium's filter/compositor rounding can differ by one level across DPRs.
      if (
        Math.abs(data[i]! - 40) <= 1 &&
        Math.abs(data[i + 1]! - 42) <= 1 &&
        Math.abs(data[i + 2]! - 54) <= 1
      ) {
        background++;
      }
      if (
        Math.abs(data[i]! - 248) <= 1 &&
        Math.abs(data[i + 1]! - 248) <= 1 &&
        Math.abs(data[i + 2]! - 242) <= 1
      ) {
        foreground++;
      }
    }
    return { background, foreground };
  }, png.toString('base64'));
  expect(counts.background).toBeGreaterThan(1000);
  expect(counts.foreground).toBeGreaterThan(100);

  await send('cancelThemePreview');
  await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
  await send('setTheme', 'dracula');
  expect(await saved()).toMatchObject({ theme: 'dracula', mode: 'dark' });
  await send('toggleMode');
  await expect(page.locator('.page').first()).toHaveCSS('filter', 'none');
  await send('toggleMode');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'dracula');
  await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'dark');
  expect(
    await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
