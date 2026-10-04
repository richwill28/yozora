import { expect, test } from '@playwright/test';

interface KeyboardHarnessWindow extends Window {
  __messages: { type: string }[];
  __printCalls: number;
}

test('command palette shortcuts reach the host without printing', async ({ page }) => {
  await page.goto('/?paper=equality-saturation.pdf');
  await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');

  await page.evaluate(() => {
    const viewerWindow = window as unknown as KeyboardHarnessWindow;
    viewerWindow.__printCalls = 0;
    window.print = () => viewerWindow.__printCalls++;
  });

  let paletteRequests = 0;
  for (const target of ['#viewerContainer', '#pageNumber']) {
    for (const modifier of ['Control', 'Meta']) {
      await page.locator(target).focus();
      await page.keyboard.press(`${modifier}+Shift+P`);
      paletteRequests++;

      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as KeyboardHarnessWindow).__messages.filter(
                (message) => message.type === 'showCommandPalette',
              ).length,
          ),
        )
        .toBe(paletteRequests);

      await page.keyboard.press(`${modifier}+p`);
    }
  }

  expect(
    await page.evaluate(() => {
      const viewerWindow = window as unknown as KeyboardHarnessWindow;
      return {
        printCalls: viewerWindow.__printCalls,
        paletteRequests: viewerWindow.__messages.filter(
          (message) => message.type === 'showCommandPalette',
        ).length,
      };
    }),
  ).toEqual({ printCalls: 0, paletteRequests });
});
