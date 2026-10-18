import SwiftUI
import Vision
#if os(iOS)
import UIKit
#endif

// Getting a receipt into the split, and a payback out of it.
//
//  · ReceiptScanner reads a photo with Apple's on-device text recogniser and
//    hands the lines to ReceiptParser. The image never leaves the phone — a
//    stronger promise than the outbox's scanReceipt op, which exists only
//    because the Expo app had no recogniser of its own.
//  · CameraPicker takes the photo; PhotosPicker (in the sheet) covers
//    screenshots of e-receipts and delivery orders.
//  · VenmoRequest opens Venmo with the request already filled in. Venmo has
//    no public API for requests, so the user always confirms in Venmo itself.

enum ReceiptScanner {
    enum Failure: Error { case unreadable, noText }

    static func scan(_ cgImage: CGImage) async throws -> ParsedReceipt {
        let lines = try await recognise(cgImage)
        guard !lines.isEmpty else { throw Failure.noText }
        return ReceiptParser.parse(lines)
    }

    /// Vision's boxes are bottom-left origin; the parser wants top-left.
    static func recognise(_ cgImage: CGImage) async throws -> [OcrLine] {
        try await withCheckedThrowingContinuation { cont in
            let request = VNRecognizeTextRequest { req, error in
                if let error { cont.resume(throwing: error); return }
                let lines = (req.results as? [VNRecognizedTextObservation] ?? []).compactMap { obs -> OcrLine? in
                    guard let text = obs.topCandidates(1).first?.string else { return nil }
                    let b = obs.boundingBox
                    return OcrLine(text: text, x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height)
                }
                cont.resume(returning: lines)
            }
            request.recognitionLevel = .accurate
            // Language correction "fixes" prices and menu words into English;
            // a receipt is better read literally.
            request.usesLanguageCorrection = false
            do {
                try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
            } catch {
                cont.resume(throwing: error)
            }
        }
    }
}

#if os(iOS)
extension UIImage {
    /// Upright pixels — a portrait photo arrives rotated in its CGImage.
    var uprightCGImage: CGImage? {
        if imageOrientation == .up { return cgImage }
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: size)) }.cgImage
    }
}

/// The system camera, for one photo.
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
#endif

// ── Venmo ────────────────────────────────────────────────────────────

enum VenmoRequest {
    /// "@maya-chen" → "maya-chen". Phones and emails pass through — Venmo's
    /// recipients field takes all three.
    static func recipient(_ handle: String) -> String? {
        var h = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        if h.hasPrefix("@") { h.removeFirst() }
        return h.isEmpty ? nil : h
    }

    private static func query(_ recipient: String, cents: Int, note: String) -> [URLQueryItem] {
        [
            URLQueryItem(name: "txn", value: "charge"),
            URLQueryItem(name: "audience", value: "private"),
            URLQueryItem(name: "recipients", value: recipient),
            URLQueryItem(name: "amount", value: String(format: "%.2f", Double(cents) / 100)),
            URLQueryItem(name: "note", value: note),
        ]
    }

    /// The app, when it's installed.
    static func appURL(handle: String, cents: Int, note: String) -> URL? {
        guard let r = recipient(handle) else { return nil }
        var c = URLComponents(string: "venmo://paycharge")
        c?.queryItems = query(r, cents: cents, note: note)
        return c?.url
    }

    /// The web, when it isn't.
    static func webURL(handle: String, cents: Int, note: String) -> URL? {
        guard let r = recipient(handle) else { return nil }
        var c = URLComponents(string: "https://venmo.com/")
        c?.queryItems = query(r, cents: cents, note: note)
        return c?.url
    }
}

/// Handles typed on the phone for people the Mac has none for. Kept on this
/// device only — there's no op for editing a person yet — and the Mac's own
/// handle wins whenever it has one.
enum LocalHandles {
    private static func key(_ personId: String) -> String { "budgetr.venmo.handle.\(personId)" }

    static func get(_ personId: String) -> String? { UserDefaults.standard.string(forKey: key(personId)) }

    static func set(_ handle: String?, for personId: String) {
        let trimmed = handle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty { UserDefaults.standard.removeObject(forKey: key(personId)) }
        else { UserDefaults.standard.set(trimmed, forKey: key(personId)) }
    }

    static func handle(for person: Summary.Person) -> String? {
        if let h = person.handle, VenmoRequest.recipient(h) != nil { return h }
        return get(person.id)
    }
}

/// "Request $12.40 on Venmo" — opens the app prefilled, or venmo.com without
/// it. Asks for a handle first when there isn't one.
struct VenmoRequestButton: View {
    let person: Summary.Person
    let cents: Int
    let note: String
    var compact = false

    @Environment(\.openURL) private var openURL
    @State private var askingHandle = false
    @State private var draft = ""
    @State private var handle: String?

    private static let venmoBlue = Color(hex: 0x3D95CE)

    var body: some View {
        Button {
            Haptics.tap()
            if let h = handle ?? LocalHandles.handle(for: person) {
                open(h)
            } else {
                draft = ""
                askingHandle = true
            }
        } label: {
            HStack(spacing: 6) {
                Text("V").font(.system(size: compact ? 11 : 13, weight: .black, design: .rounded)).italic()
                Text(compact ? "Request" : "Request \(cents.dollars.money()) on Venmo")
                    .font(F.semibold(compact ? 12 : 14))
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, compact ? 10 : 16)
            .padding(.vertical, compact ? 6 : 12)
            .frame(maxWidth: compact ? nil : .infinity)
            .background(Capsule().fill(Self.venmoBlue))
        }
        .buttonStyle(.pressScale)
        .accessibilityLabel("Request \(cents.dollars.money()) from \(person.name) on Venmo")
        .alert("\(person.name.split(separator: " ").first.map(String.init) ?? person.name)'s Venmo", isPresented: $askingHandle) {
            TextField("@username, phone or email", text: $draft)
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .autocorrectionDisabled()
            Button("Cancel", role: .cancel) {}
            Button("Request") {
                guard VenmoRequest.recipient(draft) != nil else { return }
                LocalHandles.set(draft, for: person.id)
                handle = draft
                open(draft)
            }
        } message: {
            Text("Saved on this phone for next time.")
        }
    }

    private func open(_ h: String) {
        guard let app = VenmoRequest.appURL(handle: h, cents: cents, note: note) else { return }
        openURL(app) { accepted in
            if !accepted, let web = VenmoRequest.webURL(handle: h, cents: cents, note: note) { openURL(web) }
        }
    }
}
