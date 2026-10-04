# Paper benchmark

These papers test Yozora's dark mode on academic documents with varied typography and figures. The benchmark checks rendering, text contrast, unwanted color tinting, and viewer behavior.

## Papers

Every page receives a basic rendering check. The 34 pages below receive additional zoom, theme, and screenshot checks. [The manifest](manifest.json) records the features tested on each selected page.

| Paper                                                                                                                     | Pages                         | Rendering features                                                                                           | License                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| [Equality Saturation](equality-saturation.pdf) by Tate et al., 2011                                                       | 5, 29, 33, 49, 66, 68, 75     | Code listings, dense program graphs, inference rules, tables, grayscale charts, and appendix axioms.         | [CC BY-ND 2.0](https://creativecommons.org/licenses/by-nd/2.0/) |
| [Logical Step-Indexed Logical Relations](logical-step-indexed-logical-relations.pdf) by Dreyer, Ahmed, and Birkedal, 2011 | 4, 8, 12, 23, 35, 36          | Language syntax, typed code, mathematical definitions, and appendix derivations with tiny subscripts.        | [CC BY-ND 2.0](https://creativecommons.org/licenses/by-nd/2.0/) |
| [An aperiodic monotile](aperiodic-monotile.pdf) by Smith et al., 2024                                                     | 10, 15, 20, 25, 33, 43, 77    | Dense vector tilings, overlapping polygons, raster artwork, pale fills, and thin colored lines.              | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)       |
| [M87](m87.pdf) by Event Horizon Telescope Collaboration, 2019                                                             | 3, 4, 5, 6, 8, 15             | Photographs, error bars, dark images, equations, scientific tables, and multilingual author names.           | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)       |
| [Drosophila connectome](drosophila-connectome.pdf) by Scheffer et al., 2020                                               | 5, 11, 16, 41, 47, 55, 70, 75 | Microscopy, neuron reconstructions, highlighted tables, small icons, mathematical notation, and dense plots. | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)       |

## Running tests

After completing the [development setup](../../README.md#setup), run:

```sh
npx playwright install chromium    # Install the test browser
npm run test:corpus                # Verify PDF files and metadata
npm run test:papers                # Test rendering and viewer behavior
npm run test:integration           # VS Code integration
```

`npm run test:papers` renders all 308 pages at 100% zoom and the 34 selected pages at 25%, 33%, 50%, 67%, 100%, and 200%. Both passes use display scale factors of 1 and 2. It checks:

- Every page renders at the expected resolution with visible content. Selected pages also contain their expected text.
- Text in eight measured regions stays neutral in both themes, with higher contrast in Midnight.

## Screenshot comparisons

These tests compare newly rendered pages with saved reference screenshots, called baselines, to detect changes in text, figures, and layout.

Before changing the rendering code, save reference screenshots:

```sh
npm run test:papers:baseline    # Save the current rendering as the baseline
```

Inspect the images in `.cache/paper-baselines/` to confirm that they look correct. They will be the reference for later runs.

After making changes, compare the new rendering against those references:

```sh
npm run test:papers:visual    # Compare new screenshots with the baseline
```

Playwright compares each new screenshot with its saved reference. It allows small color differences and ignores changes it identifies as smoothing along the edges of text and shapes. If it finds any other changed pixels, or the image size changes, the test fails. When a comparison fails, Playwright saves the reference screenshot, the new screenshot, and an image highlighting their differences in `test-results/papers/`. If the changes are intentional and look correct, rerun `npm run test:papers:baseline` to update the saved references.

## Licenses

All PDFs are unmodified and retain their own licenses and copyright notices.
