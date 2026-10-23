// Render a QR code to PNG, using the generator that ships with macOS.
//
// No dependency, no web service, and nothing about the URL leaves the
// machine. That last one matters: a drop code pasted into an online QR
// generator is a drop code that has been published.
//
//   swift scripts/make-qr.swift <text> <out.png> [pixels]

import CoreImage
import Foundation
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("usage: make-qr.swift <text> <out.png> [pixels]\n".data(using: .utf8)!)
    exit(2)
}
let text = args[1]
let outURL = URL(fileURLWithPath: args[2])
let pixels = args.count > 3 ? (Double(args[3]) ?? 2048) : 2048

guard let filter = CIFilter(name: "CIQRCodeGenerator") else { exit(1) }
filter.setValue(text.data(using: .utf8), forKey: "inputMessage")
// M: 15% of the code can be obscured and it still reads. Enough to survive
// a smudge, a crease and a sign in the rain, without inflating the module
// count so far that it needs a bigger print to scan.
filter.setValue("M", forKey: "inputCorrectionLevel")

guard let small = filter.outputImage else { exit(1) }
let scale = pixels / small.extent.width
let big = small.transformed(by: CGAffineTransform(scaleX: scale, y: scale))

let context = CIContext()
guard let cg = context.createCGImage(big, from: big.extent) else { exit(1) }

// A quiet zone of four modules, which is what the spec asks for and what
// most phone cameras need when the code is on a busy background.
let quiet = (pixels / small.extent.width) * 4
let side = Int(pixels + quiet * 2)
let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.white.setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: side, height: side)).fill()
NSImage(cgImage: cg, size: NSSize(width: pixels, height: pixels))
    .draw(in: NSRect(x: quiet, y: quiet, width: pixels, height: pixels))
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: outURL)
print("wrote \(side)x\(side) for \(text)")
