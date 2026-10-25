import { expect, test } from '@playwright/test';

test('the sidebar defaults closed and restores the reader’s choice across reloads', async ({
  page,
}) => {
  // This corpus PDF declares /PageMode /UseOutlines.
  await page.goto('/?paper=m87.pdf');
  await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
  await expect(page.locator('#outlinesViewMenu')).toBeEnabled();

  const sidebar = page.locator('#viewsManager');
  const toggle = page.locator('#viewsManagerToggleButton');
  await expect(sidebar).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await page.locator('#viewsManagerSelectorButton').click();
  await page.locator('#outlinesViewMenu').click();
  await expect(page.locator('#outlinesView a').first()).toBeVisible();

  const reloads = [
    {
      name: 'webview reload',
      run: async () => {
        await page.reload();
      },
    },
    {
      name: 'tab recreation',
      run: async () => {
        // Hidden VS Code webviews are destroyed. Loading another PDF and returning
        // exercises recreation with saved state and checks document isolation.
        await page.goto('/?paper=equality-saturation.pdf');
        await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
        await expect(sidebar).toBeHidden();
        await page.goto('/?paper=m87.pdf');
      },
    },
    {
      name: 'PDF file reload',
      run: async () => {
        await page.evaluate(async () => {
          const response = await fetch('/paper/m87.pdf');
          const data = await response.arrayBuffer();
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'document', data, filename: 'm87.pdf' },
            }),
          );
        });
      },
    },
  ];

  for (const open of [true, false]) {
    if (!open) {
      await toggle.click();
      await expect(sidebar).toBeHidden();
    }
    for (const reload of reloads) {
      await test.step(`${reload.name} preserves ${open ? 'open outline' : 'closed sidebar'}`, async () => {
        await reload.run();
        await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
        await expect(page.locator('#outlinesViewMenu')).toBeEnabled();
        await expect(toggle).toHaveAttribute('aria-expanded', String(open));
        if (open) {
          await expect(sidebar).toBeVisible();
          await expect(page.locator('#outlinesView a').first()).toBeVisible();
        } else {
          await expect(sidebar).toBeHidden();
        }
        expect(
          await page.evaluate(() => {
            const saved = JSON.parse(sessionStorage.getItem('yozora-test:m87.pdf') ?? '{}') as {
              sidebarView?: number;
            };
            return saved.sidebarView;
          }),
        ).toBe(open ? 2 : 0);
      });
    }
  }
});
