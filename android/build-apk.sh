#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v java >/dev/null || ! command -v keytool >/dev/null; then
    echo 'A JDK (17 or 21) with java and keytool on PATH is required.' >&2
    exit 1
fi
if command -v node >/dev/null; then
    node tests/codec.test.cjs
fi
microimgKeystore="${MICROIMG_KEYSTORE:-$PWD/signing/microimg-release.jks}"
if [[ ! -f "$microimgKeystore" ]]; then
    mkdir -p -- "$(dirname -- "$microimgKeystore")"
    keytool -genkeypair -keystore "$microimgKeystore" -storepass "${MICROIMG_STORE_PASSWORD:-microimg-local}" -keypass "${MICROIMG_KEY_PASSWORD:-microimg-local}" -alias microimg -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=MicroIMG Local Build, O=LEDFlighter, C=DE'
fi
export MICROIMG_KEYSTORE="$microimgKeystore"
./gradlew --no-daemon :app:assembleRelease :app:lintRelease
mkdir -p ../dist
microimgVersion=$(awk -F"'" '/versionName/{print $2; exit}' app/build.gradle)
microimgApk="MicroIMG-${microimgVersion}.apk"
cp app/build/outputs/apk/release/app-release.apk "../dist/$microimgApk"
cd ../dist
sha256sum "$microimgApk" > "$microimgApk.sha256"
echo "APK: $PWD/$microimgApk"
