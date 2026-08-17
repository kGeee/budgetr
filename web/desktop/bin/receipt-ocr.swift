// On-device receipt OCR.
//
// Reads an image and prints one JSON array of recognized text runs with their
// normalized boxes. Apple's Vision framework does the recognition entirely on
// this machine — no network, no API key, nothing uploaded. That is the whole
// reason this helper exists instead of a hosted vision model: budgetr's promise
// is that your financial data stays on your Mac, and a photographed receipt is
// about as personal as that data gets.
//
// Built on demand by lib/receipt/ocr.ts (swiftc -O) and cached; see that file.
//
//   usage: receipt-ocr <image-path>
//   stdout: [{"text":"KARA-AGE AKA","x":0.05,"y":0.61,"w":0.38,"h":0.02}, …]
//
// Exit codes: 2 = bad usage, 3 = unreadable image, 4 = recognition failed.

import Foundation
import Vision

#if canImport(AppKit)
  import AppKit
#endif

let args = CommandLine.arguments
guard args.count > 1 else {
  FileHandle.standardError.write("usage: receipt-ocr <image-path>\n".data(using: .utf8)!)
  exit(2)
}

let url = URL(fileURLWithPath: args[1])

guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
  let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  FileHandle.standardError.write("could not read image at \(url.path)\n".data(using: .utf8)!)
  exit(3)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
// Receipts are not prose. Language correction "fixes" AKAMARU into a real word
// and mangles prices, so it stays off.
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

do {
  let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
  try handler.perform([request])
} catch {
  FileHandle.standardError.write("recognition failed: \(error)\n".data(using: .utf8)!)
  exit(4)
}

var lines: [[String: Any]] = []
for observation in request.results ?? [] {
  guard let candidate = observation.topCandidates(1).first else { continue }
  let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { continue }

  // Vision's origin is bottom-left; flip to top-left so y grows downward and the
  // TypeScript side can reason about rows the way CSS does.
  let box = observation.boundingBox
  lines.append([
    "text": text,
    "x": box.origin.x,
    "y": 1 - box.origin.y - box.height,
    "w": box.width,
    "h": box.height,
  ])
}

let data = try JSONSerialization.data(withJSONObject: lines, options: [])
FileHandle.standardOutput.write(data)
