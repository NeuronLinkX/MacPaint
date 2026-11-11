// SVG 로고 → 1024px PNG (macOS 기본 SVG 렌더러 사용)
import Cocoa
let args = CommandLine.arguments
guard args.count == 3, let img = NSImage(contentsOf: URL(fileURLWithPath: args[1])) else { fputs("SVG를 읽을 수 없습니다\n", stderr); exit(1) }
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
img.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
