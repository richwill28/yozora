# Yozora「夜空」🌙

Bringing dark mode to PDFs in VS Code.

See the [changelog](CHANGELOG.md) for release highlights.

## Using Yozora

### Install

Download the VSIX package from the [latest release](https://github.com/richwill28/yozora/releases/latest), then install it in VS Code:

1. Open the **View** menu and select **Command Palette**.
2. Run **Extensions: Install from VSIX...** and select `yozora-<version>.vsix`.
3. Reload VS Code if prompted.

Install updates by selecting a newer VSIX the same way.

### Open a PDF

Run **Yozora: Open PDF** from the Command Palette, or right-click a PDF, choose **Open With...**, and select **Yozora PDF Viewer**.

Turn dark mode on or off using the toggle in the editor title bar.

To use Yozora by default:

1. Run **Preferences: Open Settings (UI)** from the Command Palette.
2. Select the **User** tab and search for `workbench.editorAssociations`.
3. Under **Workbench: Editor Associations**, click **Add Item**.
4. Enter `*.pdf` for **Key**, select `yozora.pdf` from the **Value** dropdown, and click **OK**. If `*.pdf` is already listed, edit its value instead.
5. Close and reopen any PDFs that are already open.

### Choose a theme

| Theme                  | Appearance                                          |
| ---------------------- | --------------------------------------------------- |
| **Midnight** (default) | Bright text against a moonless sky.                 |
| **Graphite**           | Light gray text on charcoal, with gentler contrast. |

Use the theme button in the editor title bar, or run **Yozora: Choose PDF Theme**, to change themes.

### Settings

Open VS Code Settings and search for `yozora`.

| Setting                 | Default    | Purpose                                           |
| ----------------------- | ---------- | ------------------------------------------------- |
| `yozora.defaultTheme`   | `midnight` | Set the default theme.                            |
| `yozora.defaultMode`    | `dark`     | Set the default display mode.                     |
| `yozora.maxFileSizeMiB` | `100`      | Set the maximum PDF size Yozora can open, in MiB. |

## Development

### Setup

First, [install mise and activate it in your shell](https://mise.jdx.dev/getting-started.html). Then install Node.js and npm by running:

```sh
mise install
```

Install the dependencies and compile the project:

```sh
npm ci
npm run build    # Compile and bundle source files into dist/
```

### Testing

To test manually:

1. Open the project folder in VS Code.
2. Open the **View** menu and select **Run**.
3. In the panel that opens, select **Run Yozora** from the dropdown at the top.
4. Click the green play button to the left of that dropdown. VS Code compiles the project and opens a new **Extension Development Host** window with Yozora loaded.
5. In that window, open the Command Palette and run **Yozora: Open PDF**.

Use `npm run watch` to recompile as you edit, then run **Developer: Reload Window** in the development window to load the changes.

Run the automated checks with:

```sh
npm run check
```

This checks the code and benchmark files, compiles the project, and runs unit tests.

For changes that affect rendering or VS Code integration, also run:

```sh
npx playwright install chromium    # Install the test browser
npm run test:papers                # Rendering and viewer behavior
npm run test:integration           # VS Code integration
```

See the [paper benchmark](test/corpus/README.md) for test coverage and screenshot comparisons.

### Licenses

Yozora's source code is licensed under the [MIT License](LICENSE).
