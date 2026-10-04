import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

import type { DarkTheme } from '../../src/shared/appearance';

interface Sample {
  page: number;
  text: string;
  features: string[];
  // Fractions of the page rectangle, measured from the top left. These regions
  // focus on neutral ink; colored references and illustrations are excluded.
  neutralRegion?: [number, number, number, number];
}

interface Paper {
  id: string;
  file: string;
  sha256: string;
  pages: number;
  searchTerm: string;
  samples: Sample[];
}

interface HarnessWindow extends Window {
  __messages: { type: string; status?: { worker: boolean } }[];
  __violations: string[];
  PDFViewerApplication: {
    page: number;
    pagesCount: number;
    findController: { pageMatches: number[][] };
    pdfViewer: {
      _location: unknown;
      currentScaleValue: string;
      getPageView(index: number): {
        scale: number;
        renderingState: number;
        canvas?: HTMLCanvasElement;
        viewport: { width: number; height: number };
      };
    };
  };
}

interface RestorationSnapshot {
  saved: unknown;
  scrollTop: number;
  location: unknown;
}

const { papers } = JSON.parse(readFileSync('test/corpus/manifest.json', 'utf8')) as {
  papers: Paper[];
};
const pdfjsVersion = (JSON.parse(readFileSync('pdfjs.lock.json', 'utf8')) as { version: string })
  .version;
const visual = process.env.YOZORA_PAPER_VISUAL === '1';
// Reference images use 100% zoom. The regular benchmark covers the full zoom matrix.
const zooms = visual ? [1] : [0.25, 0.33, 0.5, 0.67, 1, 2];

async function waitForPageRender(page: Page, number: number, zoom: number): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ number, zoom }) => {
            const view = (
              window as unknown as HarnessWindow
            ).PDFViewerApplication.pdfViewer.getPageView(number - 1);
            return {
              renderingState: view?.renderingState,
              scale: view?.scale,
              expectedScale: zoom,
              canvasWidth: view?.canvas?.width ?? 0,
              canvasHeight: view?.canvas?.height ?? 0,
              correctResolution:
                !!view?.canvas &&
                Math.abs(view.canvas.width - view.viewport.width * devicePixelRatio) <= 2 &&
                Math.abs(view.canvas.height - view.viewport.height * devicePixelRatio) <= 2,
            };
          },
          { number, zoom },
        ),
      { message: `Page ${number} must finish rasterizing at ${zoom * 100}%` },
    )
    .toMatchObject({
      renderingState: 3,
      scale: zoom,
      correctResolution: true,
    });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function navigateToPage(page: Page, number: number, zoom: number): Promise<void> {
  const current = await page.evaluate((zoom) => {
    const application = (window as unknown as HarnessWindow).PDFViewerApplication;
    application.pdfViewer.currentScaleValue = String(zoom);
    return application.page;
  }, zoom);
  // Wait for the zoom's actual render to finish before navigating away. Two
  // animation frames do not ensure that the renderer has caught up at high DPI.
  await waitForPageRender(page, current, zoom);
  await page.locator('#pageNumber').fill(String(number));
  await page.locator('#pageNumber').press('Enter');
  await waitForPageRender(page, number, zoom);
}

async function inspectPageCanvas(rendered: Locator) {
  const drawing = await rendered
    .locator('canvas')
    .first()
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const probe = document.createElement('canvas');
      probe.width = probe.height = 128;
      const context = probe.getContext('2d')!;
      context.drawImage(canvas, 0, 0, 128, 128);
      const { data } = context.getImageData(0, 0, 128, 128);
      let nonwhite = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3]! > 0 && Math.min(data[i]!, data[i + 1]!, data[i + 2]!) < 240) {
          nonwhite++;
        }
      }
      return { nonwhite };
    });
  // PDF.js may copy the render into an opaque display canvas. Its alpha flag
  // does not describe text antialiasing; check neutral pixels in the theme tests.
  expect(
    drawing.nonwhite,
    'Canvas must contain visible ink, not just a text overlay',
  ).toBeGreaterThan(100);
  return drawing;
}

async function monitorViewer(page: Page) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
    if (message.type() === 'warning') {
      warnings.push(message.text());
    }
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== 'http://127.0.0.1:4173') {
      external.push(url.href);
      await route.abort();
    } else {
      await route.continue();
    }
  });
  return { errors, warnings, external };
}

async function expectHealthyViewer(
  page: Page,
  messages: Awaited<ReturnType<typeof monitorViewer>>,
) {
  const diagnostics = await page.evaluate(() => {
    const viewerWindow = window as unknown as HarnessWindow;
    return {
      worker: viewerWindow.__messages.some((message) => message.status?.worker),
      violations: viewerWindow.__violations,
    };
  });
  expect(diagnostics.worker).toBe(true);
  expect(diagnostics.violations).toEqual([]);
  expect(messages.external).toEqual([]);
  expect(messages.errors).toEqual([]);
  expect(messages.warnings).toEqual([]);
}

async function setColorMode(page: Page, desired: 'dark' | 'original'): Promise<void> {
  if ((await page.locator('html').getAttribute('data-yozora-mode')) !== desired) {
    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'toggleMode' } })),
    );
  }
  await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', desired);
}

async function setDarkTheme(page: Page, desired: DarkTheme): Promise<void> {
  await page.evaluate(
    (theme) =>
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'setTheme', theme } })),
    desired,
  );
  await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', desired);
  await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'dark');
}

async function capturePageRegion(
  page: Page,
  number: number,
  region: NonNullable<Sample['neutralRegion']>,
  screenshotPath?: string,
) {
  const box = await page.locator(`.page[data-page-number="${number}"]`).boundingBox();
  if (!box) {
    throw new Error('Missing rendered page');
  }

  const [x, y, width, height] = region;
  return page.screenshot({
    path: screenshotPath,
    clip: {
      x: box.x + box.width * x,
      y: box.y + box.height * y,
      width: box.width * width,
      height: box.height * height,
    },
  });
}

async function measureNeutralPixels(page: Page, png: Buffer, original: Buffer) {
  // Inspect the final composition, including CSS filters and display scaling.
  // The Drosophila table contains subtly blue fills/rules: use the original to
  // identify truly neutral pixels rather than treating those colors as artifacts.
  return page.evaluate(
    async ({ encoded, reference }) => {
      async function decodePixels(base64: string): Promise<ImageData> {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      }

      const [filtered, source] = await Promise.all([
        decodePixels(encoded),
        decodePixels(reference),
      ]);
      if (filtered.width !== source.width || filtered.height !== source.height) {
        throw new Error('Original and dark crops must cover the same pixels.');
      }

      const { data } = filtered;
      let chromatic = 0;
      let ink = 0;
      let minimum = 255;
      let maximum = 0;
      let maximumChannelSpread = 0;
      let maximumOriginalChannelSpread = 0;
      let neutralPixels = 0;

      for (let i = 0; i < data.length; i += 4) {
        const sourceSpread =
          Math.max(source.data[i]!, source.data[i + 1]!, source.data[i + 2]!) -
          Math.min(source.data[i]!, source.data[i + 1]!, source.data[i + 2]!);
        maximumOriginalChannelSpread = Math.max(maximumOriginalChannelSpread, sourceSpread);
        if (sourceSpread !== 0) {
          continue;
        }
        neutralPixels++;

        const high = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
        const low = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
        const channelSpread = high - low;
        maximumChannelSpread = Math.max(maximumChannelSpread, channelSpread);
        // Allow only one 8-bit level for filter rounding; larger differences tint neutral ink.
        if (channelSpread > 1) {
          chromatic++;
        }
        if (high > 100) {
          ink++;
        }
        minimum = Math.min(minimum, low);
        maximum = Math.max(maximum, high);
      }

      return {
        chromatic,
        ink,
        contrast: maximum - minimum,
        minimum,
        maximum,
        maximumChannelSpread,
        maximumOriginalChannelSpread,
        neutralPixels,
      };
    },
    { encoded: png.toString('base64'), reference: original.toString('base64') },
  );
}

async function captureRestorationSnapshot(page: Page, file: string): Promise<RestorationSnapshot> {
  return page.evaluate((file) => {
    const viewerWindow = window as unknown as HarnessWindow;
    return {
      saved: JSON.parse(sessionStorage.getItem('yozora-test:' + file) ?? '{}') as unknown,
      scrollTop: document.getElementById('viewerContainer')!.scrollTop,
      location: viewerWindow.PDFViewerApplication.pdfViewer._location,
    };
  }, file);
}

for (const paper of papers) {
  test(`${paper.id}: every page renders at 100%`, async ({ page, browser }, testInfo) => {
    test.skip(
      visual,
      'Screenshot commands cover the selected pages; the regular suite checks every page.',
    );
    const messages = await monitorViewer(page);
    const completed: { page: number; nonwhite: number; milliseconds: number }[] = [];
    try {
      await page.goto('/?paper=' + encodeURIComponent(paper.file));
      await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
      await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
      await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'dark');
      expect(
        await page.evaluate(
          () => (window as unknown as HarnessWindow).PDFViewerApplication.pagesCount,
        ),
      ).toBe(paper.pages);

      for (let number = 1; number <= paper.pages; number++) {
        await test.step(`page ${number} of ${paper.pages}`, async () => {
          const started = performance.now();
          await page.evaluate((number) => {
            const app = (window as unknown as HarnessWindow).PDFViewerApplication;
            app.pdfViewer.currentScaleValue = '1';
            app.page = number;
          }, number);
          await waitForPageRender(page, number, 1);
          const rendered = page.locator(`.page[data-page-number="${number}"]`);
          const drawing = await inspectPageCanvas(rendered);
          // Text-layer work can finish after the canvas. Wait for it separately.
          await expect(rendered.locator('.textLayer')).toContainText(/\S/);
          completed.push({
            page: number,
            nonwhite: drawing.nonwhite,
            milliseconds: Math.round(performance.now() - started),
          });
        });
      }
      expect(completed).toHaveLength(paper.pages);
      await expectHealthyViewer(page, messages);
    } finally {
      const metrics = testInfo.outputPath('coverage.json');
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(
        metrics,
        JSON.stringify(
          {
            paper: paper.id,
            sha256: paper.sha256,
            pdfjs: pdfjsVersion,
            chromium: browser.version(),
            project: testInfo.project.name,
            expectedPages: paper.pages,
            completed,
            ...messages,
          },
          null,
          2,
        ),
      );
      await testInfo.attach('page-coverage', { path: metrics, contentType: 'application/json' });
    }
  });

  test(`${paper.id}: rendering, text, colors and document lifecycle`, async ({
    page,
    browser,
  }, testInfo) => {
    // Allow time for every selected page and zoom, including composited screenshots.
    test.setTimeout(60_000 + paper.samples.length * 45_000);
    const messages = await monitorViewer(page);
    const { errors, warnings, external } = messages;
    let restoration: { before: RestorationSnapshot; after?: RestorationSnapshot } | undefined;
    const timings: { page: number; zoom: number; milliseconds: number }[] = [];
    const palettes: {
      page: number;
      zoom: number;
      theme: DarkTheme;
      pixels: Awaited<ReturnType<typeof measureNeutralPixels>>;
    }[] = [];

    try {
      await page.goto('/?paper=' + encodeURIComponent(paper.file));
      await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
      await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
      await setDarkTheme(page, 'graphite');
      expect(
        await page.evaluate(
          () => (window as unknown as HarnessWindow).PDFViewerApplication.pagesCount,
        ),
      ).toBe(paper.pages);
      if (
        (await page.locator('#viewsManagerToggleButton').getAttribute('aria-expanded')) === 'true'
      ) {
        await page.locator('#viewsManagerToggleButton').click();
      }
      await page.mouse.move(0, 0);

      for (const sample of paper.samples) {
        for (const zoom of zooms) {
          await test.step(`page ${sample.page}, ${zoom * 100}%: ${sample.features.join(', ')}`, async () => {
            const started = performance.now();
            await navigateToPage(page, sample.page, zoom);
            const rendered = page.locator(`.page[data-page-number="${sample.page}"]`);
            await expect(rendered.locator('.textLayer')).toContainText(sample.text);
            if (zoom === 1) {
              // Keep the page border clear of the sticky toolbar in full-page captures.
              await rendered.evaluate((element) =>
                element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }),
              );
            }
            timings.push({
              page: sample.page,
              zoom,
              milliseconds: Math.round(performance.now() - started),
            });

            await inspectPageCanvas(rendered);

            const snapshot = `${paper.id}-page-${sample.page}-zoom-${Math.round(zoom * 100)}-content`;
            // Capture the PDF rectangle, including overlapping text and annotation
            // layers, without the viewer's scroll-dependent outer border shadow.
            const pageContent = rendered.locator('.canvasWrapper');
            await setColorMode(page, 'original');
            // Full-page snapshots at 100%; high-zoom checks focus on actual text
            // pixels without repeatedly allocating giant composited page images.
            const original = zoom === 1 ? await pageContent.screenshot() : undefined;
            if (visual && original) {
              expect(original).toMatchSnapshot(`${snapshot}-original.png`, {
                threshold: 0.05,
                maxDiffPixels: 0,
              });
            }

            const originalRegion = sample.neutralRegion
              ? await capturePageRegion(page, sample.page, sample.neutralRegion)
              : undefined;
            await setColorMode(page, 'dark');
            if (sample.neutralRegion && originalRegion) {
              // Below 50% zoom, the sampled area shrinks with the square of the scale.
              const minimumInkPixels = 100 * Math.min(1, (zoom / 0.5) ** 2);
              const previewPath = (name: DarkTheme) =>
                zoom === 1 ? testInfo.outputPath(`page-${sample.page}-${name}.png`) : undefined;
              const pixels = await measureNeutralPixels(
                page,
                await capturePageRegion(
                  page,
                  sample.page,
                  sample.neutralRegion,
                  previewPath('graphite'),
                ),
                originalRegion,
              );
              palettes.push({ page: sample.page, zoom, theme: 'graphite', pixels });
              expect(
                pixels.maximumOriginalChannelSpread,
                'Reference crop must remain nearly neutral',
              ).toBeLessThanOrEqual(2);
              expect(
                pixels.ink,
                'Neutral region must contain text/rules, not an empty background',
              ).toBeGreaterThan(minimumInkPixels);
              expect(pixels.contrast).toBeGreaterThan(100);
              expect(
                pixels.chromatic,
                'Originally neutral ink must not develop pink/colored fringes',
              ).toBe(0);

              await setDarkTheme(page, 'midnight');
              const midnight = await measureNeutralPixels(
                page,
                await capturePageRegion(
                  page,
                  sample.page,
                  sample.neutralRegion,
                  previewPath('midnight'),
                ),
                originalRegion,
              );
              palettes.push({ page: sample.page, zoom, theme: 'midnight', pixels: midnight });
              expect(midnight.chromatic).toBe(0);
              expect(midnight.ink).toBeGreaterThan(minimumInkPixels);
              expect(midnight.minimum, 'Midnight must have a darker page background').toBeLessThan(
                pixels.minimum,
              );
              expect(
                midnight.contrast,
                'Midnight must increase the contrast of actual rendered text',
              ).toBeGreaterThan(pixels.contrast);
              await setDarkTheme(page, 'graphite');
            }

            if (original) {
              const dark = await pageContent.screenshot();
              expect(dark.equals(original), 'Dark mode must visibly change the page').toBe(false);
              if (visual) {
                expect(dark).toMatchSnapshot(`${snapshot}-dark.png`, {
                  threshold: 0.05,
                  maxDiffPixels: 0,
                });
              }
              await setDarkTheme(page, 'midnight');
              const midnight = await pageContent.screenshot();
              expect(midnight.equals(original), 'Midnight must visibly change the page').toBe(
                false,
              );
              expect(midnight.equals(dark), 'The two themes must produce distinct colors').toBe(
                false,
              );
              if (visual) {
                expect(midnight).toMatchSnapshot(`${snapshot}-midnight.png`, {
                  threshold: 0.05,
                  maxDiffPixels: 0,
                });
              }
              await setDarkTheme(page, 'graphite');
            }

            await setColorMode(page, 'original');
            if (original) {
              const restored = await pageContent.screenshot();
              expect(
                restored.equals(original),
                'Switching from original colors to dark mode and back must restore the identical display',
              ).toBe(true);
            }
          });
        }
      }

      await test.step('search, distant-page navigation and editor recreation', async () => {
        await page.locator('#viewerContainer').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press('Control+f');
        await page.locator('#findInput').fill(paper.searchTerm);
        await page.locator('#findInput').press('Enter');
        await expect
          .poll(() =>
            page.evaluate(() =>
              (
                window as unknown as HarnessWindow
              ).PDFViewerApplication.findController.pageMatches.some(
                (matches) => matches.length > 0,
              ),
            ),
          )
          .toBe(true);
        await page.locator('#findInput').fill('');
        await page.locator('#findInput').press('Escape');

        await navigateToPage(page, paper.pages, 1);
        await expect(page.locator('#pageNumber')).toHaveValue(String(paper.pages));
        await navigateToPage(page, 1, 1);

        const sample = paper.samples[0]!;
        await navigateToPage(page, sample.page, 0.67);
        await setDarkTheme(page, 'midnight');
        await expect
          .poll(() =>
            page.evaluate((file) => {
              const saved = JSON.parse(
                sessionStorage.getItem('yozora-test:' + file) ?? '{}',
              ) as Record<string, unknown>;
              return {
                page: saved.page,
                zoom: saved.zoom,
                mode: saved.mode,
                theme: saved.theme,
                documentId: saved.documentId,
              };
            }, paper.file),
          )
          .toEqual({
            page: sample.page,
            zoom: '0.67',
            mode: 'dark',
            theme: 'midnight',
            documentId: paper.file,
          });
        restoration = {
          before: await captureRestorationSnapshot(page, paper.file),
        };

        await page.reload();
        await waitForPageRender(page, sample.page, 0.67);
        restoration = {
          ...restoration,
          after: await captureRestorationSnapshot(page, paper.file),
        };
        await expect(page.locator('#pageNumber')).toHaveValue(String(sample.page));
        await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
        await setColorMode(page, 'original');
        await setColorMode(page, 'dark');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
      });

      await test.step('preview is temporary; invalid themes cannot affect appearance', async () => {
        await setColorMode(page, 'original');
        await page.evaluate(() =>
          window.dispatchEvent(
            new MessageEvent('message', { data: { type: 'previewTheme', theme: 'graphite' } }),
          ),
        );
        await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'graphite');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'dark');

        // Saving a new scroll position while previewing must not commit its colors.
        await page.locator('#viewerContainer').evaluate((el) => {
          el.scrollTop += 30;
        });
        await expect
          .poll(() =>
            page.evaluate((file) => {
              const saved = JSON.parse(sessionStorage.getItem('yozora-test:' + file)!) as Record<
                string,
                unknown
              >;
              return { mode: saved.mode, theme: saved.theme };
            }, paper.file),
          )
          .toEqual({ mode: 'original', theme: 'midnight' });
        await page.evaluate(() =>
          window.dispatchEvent(
            new MessageEvent('message', { data: { type: 'cancelThemePreview' } }),
          ),
        );
        await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'original');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');

        await page.evaluate(() => {
          for (const theme of ['soft', '__proto__', 'url(https://example.org/filter)', null]) {
            for (const type of ['setTheme', 'previewTheme']) {
              window.dispatchEvent(new MessageEvent('message', { data: { type, theme } }));
            }
          }
        });
        await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'original');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
        await page.reload();
        await expect(page.locator('body')).toHaveAttribute('data-yozora-status', 'ready');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-mode', 'original');
        await expect(page.locator('html')).toHaveAttribute('data-yozora-theme', 'midnight');
      });

      await expectHealthyViewer(page, messages);
    } finally {
      // Timings are observations from this machine, not a portable performance gate.
      const metrics = testInfo.outputPath('metrics.json');
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(
        metrics,
        JSON.stringify(
          {
            paper: paper.id,
            sha256: paper.sha256,
            pdfjs: pdfjsVersion,
            chromium: browser.version(),
            project: testInfo.project.name,
            timings,
            palettes,
            errors,
            warnings,
            external,
            restoration,
          },
          null,
          2,
        ),
      );
      await testInfo.attach('paper-metrics', {
        path: metrics,
        contentType: 'application/json',
      });
    }
  });
}
