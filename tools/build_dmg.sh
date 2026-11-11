#!/bin/bash
# macPaint.app 을 만들고 downloads/macPaint.dmg 로 묶는다. (macOS + Xcode 명령행 도구 필요)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD; BUILD="$ROOT/build"; APP="$BUILD/macPaint.app"
rm -rf "$BUILD"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" "$ROOT/downloads"

# 1) 실행 파일 (Apple Silicon + Intel)
for arch in arm64 x86_64; do swiftc -O -target "$arch-apple-macos12.0" macos/main.swift -o "$BUILD/macPaint-$arch"; done
lipo -create "$BUILD"/macPaint-arm64 "$BUILD"/macPaint-x86_64 -output "$APP/Contents/MacOS/macPaint"

# 2) 웹 자원 (개발용 파일은 제외)
cp -R index.html src assets "$APP/Contents/Resources/web/"

# 3) 아이콘: SVG 로고 → iconset → icns
mkdir -p "$BUILD/icon.iconset"
swift tools/render_icon.swift assets/logo.svg "$BUILD/icon-1024.png"
for s in 16 32 128 256 512; do
  sips -z $s $s "$BUILD/icon-1024.png" --out "$BUILD/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$BUILD/icon-1024.png" --out "$BUILD/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$BUILD/icon.iconset" -o "$APP/Contents/Resources/macPaint.icns"

cat > "$APP/Contents/Info.plist" <<'P'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>macPaint</string>
  <key>CFBundleDisplayName</key><string>macPaint</string>
  <key>CFBundleIdentifier</key><string>com.bain.macpaint</string>
  <key>CFBundleExecutable</key><string>macPaint</string>
  <key>CFBundleIconFile</key><string>macPaint</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
</dict></plist>
P
codesign --force --deep --sign - "$APP"          # 임시(ad-hoc) 서명

# 4) dmg
STAGE="$BUILD/dmg"; mkdir -p "$STAGE"; cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
rm -f downloads/macPaint.dmg
hdiutil create -volname "macPaint" -srcfolder "$STAGE" -ov -format UDZO downloads/macPaint.dmg >/dev/null
echo "완료: downloads/macPaint.dmg ($(du -h downloads/macPaint.dmg | cut -f1))"
