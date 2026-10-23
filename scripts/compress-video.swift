// Re-encode a video at an explicit bitrate.
//
// avconvert ships with macOS but only exposes quality presets, and none of
// them get a 10-second 720p clip below about 5MB. AVAssetWriter does expose
// the bitrate, which is the knob that actually matters for a file that has
// to load before anything else on a page.
//
//   swift scripts/compress-video.swift <in> <out> <kbps> [maxWidth]

import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count >= 4 else {
    FileHandle.standardError.write("usage: compress-video.swift <in> <out> <kbps> [maxWidth]\n".data(using: .utf8)!)
    exit(2)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])
let kbps = Int(args[3]) ?? 2000
let maxWidth = args.count > 4 ? Int(args[4]) ?? 1280 : 1280

let asset = AVURLAsset(url: inURL)
let semaphore = DispatchSemaphore(value: 0)

/// Holds the reader, writer and output alive.
///
/// The Task below returns as soon as it has scheduled the encode callback, at
/// which point ARC releases its locals. The reader goes with them, and the
/// next copyNextSampleBuffer throws "cannot copy next sample buffer before
/// adding this output to an instance of AVAssetReader", which names a cause
/// that is not the real one: the output was added, its reader simply no
/// longer exists.
nonisolated(unsafe) var keepAlive: [AnyObject] = []

Task {
    do {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else {
            FileHandle.standardError.write("no video track\n".data(using: .utf8)!)
            exit(1)
        }
        let naturalSize = try await track.load(.naturalSize)
        let transform = try await track.load(.preferredTransform)
        let size = naturalSize.applying(transform)
        let srcW = abs(size.width), srcH = abs(size.height)

        var outW = srcW, outH = srcH
        if Int(srcW) > maxWidth {
            let scale = CGFloat(maxWidth) / srcW
            outW = (srcW * scale).rounded(.down)
            outH = (srcH * scale).rounded(.down)
        }
        // H.264 wants even dimensions.
        outW -= outW.truncatingRemainder(dividingBy: 2)
        outH -= outH.truncatingRemainder(dividingBy: 2)

        try? FileManager.default.removeItem(at: outURL)
        let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(outW),
            AVVideoHeightKey: Int(outH),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: kbps * 1000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                AVVideoAllowFrameReorderingKey: true,
                AVVideoMaxKeyFrameIntervalKey: 60,
            ],
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        input.transform = transform
        writer.add(input)

        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(
            track: track,
            outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        )
        guard reader.canAdd(output) else {
            FileHandle.standardError.write("reader will not take the output\n".data(using: .utf8)!)
            exit(1)
        }
        reader.add(output)

        guard writer.startWriting() else {
            FileHandle.standardError.write("writer refused to start: \(writer.error.map(String.init(describing:)) ?? "no error")\n".data(using: .utf8)!)
            exit(1)
        }
        writer.startSession(atSourceTime: .zero)
        // Checked, because a silent false here surfaces much later as an
        // exception from copyNextSampleBuffer that names the wrong cause.
        guard reader.startReading() else {
            FileHandle.standardError.write("reader refused to start: \(reader.error.map(String.init(describing:)) ?? "no error")\n".data(using: .utf8)!)
            exit(1)
        }

        keepAlive.append(contentsOf: [reader, writer, input, output] as [AnyObject])

        let queue = DispatchQueue(label: "encode")
        input.requestMediaDataWhenReady(on: queue) {
            while input.isReadyForMoreMediaData {
                if let buffer = output.copyNextSampleBuffer() {
                    input.append(buffer)
                } else {
                    input.markAsFinished()
                    writer.finishWriting {
                        print("wrote \(Int(outW))x\(Int(outH)) at \(kbps)kbps")
                        semaphore.signal()
                    }
                    return
                }
            }
        }
    } catch {
        FileHandle.standardError.write("error: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

semaphore.wait()
