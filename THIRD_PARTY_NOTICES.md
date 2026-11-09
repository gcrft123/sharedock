# Third-party notices

Sharedock is licensed under the GNU Affero General Public License v3.0 (see [LICENSE](LICENSE)). The files below are included under their own licenses, which still apply to them.

## Fonts

These fonts are bundled as woff2 files and licensed under the SIL Open Font License 1.1. The license text is in [licenses/OFL-1.1.txt](licenses/OFL-1.1.txt).

| Font | Files | Copyright |
|---|---|---|
| Archivo Black | `packages/ui/src/shared/fonts/ArchivoBlack.woff2` | Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack) |
| Space Grotesk | `packages/ui/src/shared/fonts/SpaceGrotesk.woff2` | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |
| JetBrains Mono | `packages/ui/src/shared/fonts/JetBrainsMono.woff2`, `apps/site/public/brand/JetBrainsMono.woff2` | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |
| Playfair Display | `packages/ui/src/shared/fonts/PlayfairDisplay-Italic.woff2` | Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display" |
| Saira | `apps/site/public/brand/Saira.woff2` | Copyright 2020 The Saira Project Authors (https://github.com/Omnibus-Type/Saira) |

Satoshi, the marketing site's body face, is not in the repository. It's under the ITF Free Font License, which forbids redistribution through a repository. `scripts/fetch-fonts.sh` downloads it from [Fontshare](https://www.fontshare.com/fonts/satoshi).

## Icons

`packages/design-system/assets/icons/solar/` and the inline icon markup derived from it are from the [Solar Icon Set](https://github.com/480-Design/Solar-Icon-Set) by 480 Design, licensed under Creative Commons Attribution 4.0 International. The license text is in [licenses/CC-BY-4.0.txt](licenses/CC-BY-4.0.txt). The icons were recolored to `stroke="currentColor"`.

## Code

`apps/site/src/reactbits/` is vendored from [React Bits](https://github.com/DavidHDev/react-bits) by David Haz, under the MIT + Commons Clause license in [apps/site/src/reactbits/LICENSE.md](apps/site/src/reactbits/LICENSE.md). That license allows use as part of a website or product but forbids selling or redistributing the components on their own. Those files are not covered by the AGPL.

npm and Cargo dependencies keep their own licenses, listed in `pnpm-lock.yaml` and `Cargo.lock`.
