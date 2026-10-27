# Android validation

## Version 1.2.1

Validated on 2026-10-27 using an Android 11 / API 30 x86_64 emulator with on-screen navigation enabled and the software keyboard available.

- Release, debug and instrumentation APK builds succeeded; `lintRelease` reported no errors.
- All ten codec test groups and all 65 Android NDEF/UI checks passed.
- New checks measure the actual native WebView bounds against Android system bar, cutout and keyboard insets. The WebView occupies exactly the safe area rather than drawing fixed HTML elements behind the navigation bar.
- The fixed NFC status bar and its cancel button were verified above the navigation area.
- The real Android software keyboard was opened and closed. The import dialog remained top aligned, stayed within the visible viewport, and the full viewport was restored after closing the keyboard.
- The release remains signed with the existing local identity and increments the version code to 4.

Reference: [Android system bar insets](https://developer.android.com/develop/ui/views/layout/edge-to-edge#system-bars-insets) and [software keyboard insets](https://developer.android.com/develop/ui/views/layout/sw-keyboard).

## Previous validation: version 1.2.0

Validated on 2026-10-27 using Android 11 / API 30 x86_64 in the emulator. Minimum API 26 and target API 36 remain unchanged.

- Release, debug and instrumentation APK builds succeeded; `lintRelease` reported no errors.
- All ten codec test groups passed.
- All 58 Android NDEF/UI checks passed. New checks cover the text import dialog, actual Android clipboard retrieval, invalid paste preserving the previous image, cancellation, every slider value from 2 to 16 gray levels, free PNG export factors, validation of invalid/oversized factors, the actual dimensions in a PNG generated with factor 13, and visible dialog positioning on older WebViews.
- Simulated tag callbacks verified consecutive single-tag pictures without stopping the reader or displaying reset, preserving the last picture after a damaged scan, transitioning from a single-tag picture to an unordered multi-tag series, and retaining explicit reset for completed multi-tag series.
- Export testing verified that a pending PNG export keeps its selected image snapshot while the next single-tag scan updates the main decoded image.
- The final signed release APK installed and launched successfully. `apksigner` verified the signature; `aapt` confirmed version 1.2.0, version code 3 and NFC-only permission. The signing certificate matches previous releases.
- JavaScript syntax, build script syntax and Git whitespace checks passed.

These reader tests exercise application state with simulated callbacks; they do not validate physical NFC RF communication. The hardware limitations below still apply.

## Previous validation: version 1.1.0

Version 1.1.0 was validated on 2026-10-27. The application targets API 36 and supports API 26 (Android 8.0) and later. Runtime testing used an Android 11 / API 30 x86_64 emulator.

### Completed checks

- Release, debug and instrumentation APKs built successfully with AGP 8.13.2 and Gradle 8.13.
- Android `lintRelease`: no errors; two advisory warnings concerning the pinned Gradle version and optional Android 12 backup rules.
- Ten codec test groups passed: binary compatibility with the upstream desktop packer at grayscale levels 2 through 16, independent zlib fixtures, G4 runs and Deep-PX hexadecimal values, NDEF capacity boundaries, unordered/duplicate/missing/conflicting chunks, malformed input and bounded decompression, black image rendering, and saved ZIP/G4/DP file import without re-encoding.
- Thirty-seven Android NDEF/UI checks passed: record serialization and parsing, UTF-16 and MIME text, invalid records, compression/reconstruction pixel equality, all three formats, rotation, small tags, partial collections, write confirmation, editor locking and cancellation, lossless import through capacity changes and write preparation, failed import preserving the prior image, asynchronous file import, restored raster editing, and persistent light/dark themes.
- Actual Android document-picker import of a saved MicroIMG TXT file succeeded. The saved 128 × 96 image retained its resolution with the editor previously set to 64 pixels.
- Raster import and PNG export through Android's document picker were exercised during version 1.0.0 validation. The exported 64 × 48 PNG was checked for valid dimensions and chunk CRCs.
- Release 1.1.0 installed as an update over release 1.0.0 using the same local signing identity and a higher version code. The final release APK also installed and launched successfully.
- The updated interface was visually inspected. `apksigner` verified the release signature, and `aapt` confirmed the application ID, version, supported Android versions and NFC-only permission.
- JavaScript and build script syntax checks passed.

## Hardware testing still required

No real NFC-enabled Android phone or physical tags were available. NFC RF transfers, tag formatting, antenna positioning, OEM NFC behavior and interruption during a physical write have not been tested. Emulator checks cover NDEF records and write preparation, not RF communication.

The upstream `Pn/N#` format has no image identifier. Tags from different images with the same chunk count cannot always be distinguished; reset the read collection before scanning another image.

See [README.md](README.md#tests) for commands to repeat the automated checks. Test results describe the validated environment and do not establish compatibility with every Android device or tag family.
