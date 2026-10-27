# MicroIMG for Android

Self-contained Android port of [LEDFlighter/MicroIMG](https://github.com/LEDFlighter/MicroIMG), based on upstream commit `63e8b67`. Android 8.0 (API 26) or later. Follow the [build instructions](#build) to generate a signed APK; APK binaries are not included in the source tree.

The app works offline. Image processing runs in bundled JavaScript inside an isolated WebView; a Java bridge drives the phone's NFC hardware through Android's NDEF APIs. No Flask server, Python, Termux, USB reader, Internet permission, account, or broad storage permission is needed. The system document picker handles raster image import and file export; MicroIMG codes are pasted directly into a text field.

## Features

- Compact navy and emerald interface based on the original desktop design, with Core Settings, Batch & NFC, Recovery, format buttons and a persistent dark/light theme.
- A native container keeps the WebView viewport clear of Android system bars, display cutouts and the software keyboard. The text import dialog is top aligned and scrolls when space is limited.
- Paste MicroIMG text directly in **Bild → Text**, preview and write it without re-encoding; target capacity changes only redistribute the existing data across tags.
- Image selection, rotation, pan and pinch zoom, aspect-preserving resolution from 16 to 1024 pixels on the longest side.
- Grayscale slider with every value from 2 to 16 levels, contrast, Atkinson and Floyd-Steinberg dithering.
- ZIP-Ultra, G4 RLE and Deep-PX formats, compatible with the desktop binary header and pixel packing.
- Exact short/long NDEF record sizing and dynamic chunk headers, including multi-digit sequences.
- NDEF text records with the existing `P1/N#ZIP:...`, `P2/N#...` scheme.
- NFC read and write on background threads; write capacity and write-protection checks; readback verification before advancing to the next tag.
- A different physical tag is required for each chunk in a write batch, preventing accidental overwrite of a completed chunk.
- Formatting of tags exposed by Android as `NdefFormatable`. Such tags must be removed and presented again for verification.
- Out-of-order reads, duplicate suppression, partial read persistence, missing-tag display and conflicting-chunk rejection. Single-tag pictures can be read consecutively without resetting the collection or restarting the reader.
- PNG export with a freely entered positive integer scale factor and dimension preview, for both source previews and reconstructed images; text export/copy; manual decoding without NFC hardware.

## Usage

1. Install the APK on the phone. Allow installation from the file manager/browser when Android requests it.
2. Enable NFC. In **Bild → Text**, use **Bilddatei öffnen** for PNG, JPEG or WebP images and adjust the preview. Alternatively, select **MicroIMG importieren**, paste a complete ZIP/G4/DP code or all chunks of a picture into the text field (or use **Aus Zwischenablage**), and confirm **Importieren**. Imported codes preserve the encoded image; editing controls are hidden until you open another raster image. Select the target tag in **Batch & NFC**; NTAG216 is the default.
3. Choose **Auf NFC-Tags schreiben**, confirm the overwrite notice and hold the first tag to the NFC antenna. Keep it still until the app reports successful verification.
4. Remove that tag and present the next unused tag as prompted. Label the physical tags if helpful.
5. To reconstruct, use **Text → Bild**, start NFC reading and present all tags belonging to the image in any order. For a picture that fits on one tag, simply remove it and present the next picture's tag; reading remains active and the reset button is hidden. For multi-tag pictures, reset the collection before reading another picture.
6. **PNG speichern** and **Bild als PNG speichern** open the same export dialog. Enter any positive integer scale factor within the displayed limit; the exact output size is shown before saving. Exports use nearest-neighbor scaling and are limited to 4096 pixels per side. The dialog keeps a snapshot of the selected picture even if another NFC tag is read while it is open.

To install future builds as updates, preserve the signing key and increase the Android version code when releasing a new version. Builds signed with a different key require uninstalling the existing app first.

The app checks the actual NDEF capacity before writing. If a tag is smaller than the selected profile, cancel, select a smaller capacity and restart the whole batch. Other tag families are supported only when Android exposes standard NDEF access; proprietary layouts, password authentication, MIFARE Classic sector management and raw page writes are not implemented. NTAG21x tags with normal NDEF formatting are the primary target.

The upstream chunk format contains no image ID or checksum for the assembled image. Conflicting duplicate indices and differing totals are detected, but mixing different multi-tag pictures with the same chunk count cannot always be detected. Reset multi-tag collections before scanning another picture; completed single-tag pictures are replaced automatically by the next successful scan. Closing or backgrounding the app cancels active NFC I/O; completed tags stay written, while partial reads are retained. A cancelled write batch starts from tag 1 when restarted.

## Build

Requirements: JDK 17 or 21, Android SDK platform 36 and build tools 35.0.0, and a recent Node.js for the codec checks. Gradle 8.13 is pinned by the wrapper with its distribution checksum; AGP is pinned to 8.13.2. The first build downloads build dependencies.

Set `ANDROID_HOME` to your SDK directory, or create ignored `local.properties` containing `sdk.dir=/absolute/path/to/android-sdk`. Then:

```sh
cd android
./build-apk.sh
```

The APK and its SHA-256 checksum are written to the ignored `dist/` directory at the repository root (currently `dist/MicroIMG-1.2.1.apk`). APKs can be distributed separately as release assets.

The script creates a local release keystore on the first build. Preserve `android/signing/microimg-release.jks` for future updates of this installation; it is intentionally ignored by Git. Its local default password is `microimg-local`, alias `microimg`. To use your own signing identity, set `MICROIMG_KEYSTORE`, `MICROIMG_STORE_PASSWORD` and `MICROIMG_KEY_PASSWORD`. The keystore is not embedded in the APK.

## Tests

```sh
node tests/codec.test.cjs
./gradlew assembleDebug assembleDebugAndroidTest lintRelease
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w io.github.ledflighter.microimg.test/io.github.ledflighter.microimg.SmokeInstrumentation
```

Use an emulator with on-screen navigation (`hw.mainKeys = no`) and a software keyboard for the system-bar and keyboard regression checks. These checks measure the actual native WebView bounds and open and close the real Android keyboard.

The codec tests compare the binary output directly with the original desktop packer at every grayscale depth; check independently created zlib fixtures; and exercise capacity boundaries, multi-digit chunk headers, missing or conflicting chunks, malformed payloads and bounded decompression. The Android instrumentation tests exercise actual `NdefMessage` serialization and parsing, UTF-16 and MIME text, and the complete compression/reconstruction interface inside Android's WebView.

Physical NFC transfers require a real NFC phone and tags. The emulator cannot validate RF communication, antenna placement, tag formatting behavior or OEM NFC firmware. See [VALIDATION.md](VALIDATION.md) for the completed checks and their limits.

## Dependencies and implementation

The bundled `pako.js` 2.1.0 is copied unchanged from upstream. Its MIT license is included in `PAKO-LICENSE.txt` and in the APK's assets. The original project files are retained at the repository root.

`codec.js` owns format encoding, decoding and chunk assembly. `app.js` owns local image processing and UI state. `NfcController.java` owns foreground reader lifecycle, cancellation and serialized tag access. `NdefText.java` owns text records. `MainActivity.java` owns the isolated asset origin, JavaScript bridge, system file pickers and lifecycle.

Android API references: [NFC read/write](https://developer.android.com/develop/connectivity/nfc/advanced-nfc), [NfcAdapter reader mode](https://developer.android.com/reference/android/nfc/NfcAdapter#enableReaderMode(android.app.Activity,android.nfc.NfcAdapter.ReaderCallback,int,android.os.Bundle)), [Ndef](https://developer.android.com/reference/android/nfc/tech/Ndef).
