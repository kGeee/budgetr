import CoreData
import SwiftUI
#if os(iOS)
import AVFoundation
#endif

/// The front door on a phone: pair with the Mac by scanning its code.
///
/// Styled like the companion's pairing screen — the `b.` mark, a brass
/// eyebrow, a framed viewfinder — and saying the one thing worth knowing about
/// security: the key travels on-screen, never through a server. Pasting the
/// code is there for the simulator and for anyone whose camera can't focus on
/// a laptop screen. The ledger import and sample data are the quiet ways out
/// for someone with no Mac to pair.
struct PairingView: View {
    @EnvironmentObject private var companion: CompanionStore
    @EnvironmentObject private var app: AppModel
    @Environment(\.managedObjectContext) private var context
    @Environment(\.dismiss) private var dismiss

    /// First run shows the import and sample-data alternatives; the sheet
    /// opened from More doesn't need them.
    var showsAlternatives = true

    @State private var code = ""
    @State private var error: String?
    @State private var pairing = false
    @State private var scanning = true

    var body: some View {
        BScreen("Pair your Mac", eyebrow: "Companion") {
            Card(padding: 20) {
                VStack(alignment: .leading, spacing: 14) {
                    BrandMark(size: 42, showsWordmark: false)
                    Text("See your Mac's numbers here, live.")
                        .font(F.display(24))
                        .foregroundStyle(T.paper)
                        .fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 8) {
                        step(1, "Open budgetr on your Mac")
                        step(2, "Settings → Phone companion → Pair phone")
                        step(3, "Point this phone at the code")
                    }
                }
            }
            .rise(0)

            scanner.rise(1)

            if let error {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(T.coral)
                    Text(error).font(F.body(13)).foregroundStyle(T.coral)
                }
                .transition(.opacity)
            }

            VStack(alignment: .leading, spacing: 10) {
                Eyebrow("Or paste the pairing code")
                TextField("budgetr1.…", text: $code, axis: .vertical)
                    .font(F.mono(13))
                    .foregroundStyle(T.paper)
                    .lineLimit(1...3)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(T.panel))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(T.line, lineWidth: 0.75))
                PillButton(title: pairing ? "Pairing…" : "Pair", systemImage: "link", role: .primary) {
                    submit(code)
                }
                .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || pairing)
                .opacity(code.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)
            }
            .rise(2)

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "lock.shield")
                    .foregroundStyle(T.jade)
                    .font(.system(size: 14, weight: .medium))
                Text("Your devices exchange the encryption key on-screen — it never touches a server. The relay in between only ever sees ciphertext.")
                    .font(F.body(12))
                    .foregroundStyle(T.faint)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .rise(3)

            if showsAlternatives {
                VStack(spacing: 2) {
                    quietLink("No Mac? Import a budgetr.db file") { app.showingImporter = true }
                    // The quietest thing on screen on purpose: someone holding a
                    // pairing code should never take this by accident.
                    quietLink("Look around with sample data") { app.loadSample(context: context) }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 4)
                .rise(4)
            }
        }
        .animation(M.settle, value: error)
    }

    // ── Pieces ───────────────────────────────────────────────────────

    @ViewBuilder
    private var scanner: some View {
        #if os(iOS)
        CameraGate(active: scanning && !pairing) { scanned in submit(scanned) }
        #else
        EmptyView()
        #endif
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(spacing: 10) {
            Text("\(n)")
                .font(F.monoSemibold(11))
                .foregroundStyle(T.brass)
                .frame(width: 22, height: 22)
                .background(Circle().fill(T.brass.opacity(0.12)))
            Text(text).font(F.body(13.5)).foregroundStyle(T.muted)
        }
    }

    private func quietLink(_ title: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            action()
        } label: {
            Text(title)
                .font(F.body(13))
                .underline()
                .foregroundStyle(T.faint)
                .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
    }

    private func submit(_ raw: String) {
        guard !pairing else { return }
        pairing = true
        scanning = false
        Task {
            let failure = await companion.pair(raw)
            pairing = false
            if let failure {
                error = failure
                // Let the camera re-arm rather than re-reading the same bad code.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                scanning = true
            } else {
                error = nil
                dismiss()
            }
        }
    }
}

#if os(iOS)

/// The viewfinder, or what stands in for it until the camera is allowed.
private struct CameraGate: View {
    let active: Bool
    let onCode: (String) -> Void

    @State private var status = AVCaptureDevice.authorizationStatus(for: .video)
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            switch status {
            case .authorized:
                Viewfinder(active: active, onCode: onCode)
            case .notDetermined:
                placeholder(
                    symbol: "qrcode.viewfinder",
                    text: "budgetr uses the camera only to read your Mac's pairing code.",
                    button: "Allow camera"
                ) {
                    AVCaptureDevice.requestAccess(for: .video) { granted in
                        DispatchQueue.main.async {
                            status = granted ? .authorized : .denied
                        }
                    }
                }
            default:
                placeholder(
                    symbol: "video.slash",
                    text: "Camera access is off. Turn it on in Settings, or paste the code below.",
                    button: "Open Settings"
                ) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            }
        }
        .frame(height: 280)
        .clipShape(RoundedRectangle(cornerRadius: T.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: T.radius, style: .continuous).strokeBorder(T.lineStrong, lineWidth: 1))
    }

    private func placeholder(symbol: String, text: String, button: String, action: @escaping () -> Void) -> some View {
        ZStack {
            CardSurface()
            VStack(spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 34, weight: .light))
                    .foregroundStyle(T.brass)
                Text(text)
                    .font(F.body(13))
                    .foregroundStyle(T.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                Button(action: { Haptics.tap(); action() }) {
                    Text(button)
                        .font(F.semibold(13.5))
                        .foregroundStyle(T.onJade)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 9)
                        .background(Capsule().fill(T.jade))
                }
                .buttonStyle(.pressScale)
            }
        }
    }
}

/// The live camera with corner brackets and a sweeping scan line.
private struct Viewfinder: View {
    let active: Bool
    let onCode: (String) -> Void

    @State private var sweep = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            QRScanner(active: active, onCode: onCode)

            GeometryReader { geo in
                let side = min(geo.size.width, geo.size.height) * 0.62
                ZStack {
                    Brackets()
                        .stroke(T.jade, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .frame(width: side, height: side)
                    if !reduceMotion && active {
                        Capsule()
                            .fill(LinearGradient(colors: [T.jade.opacity(0), T.jade.opacity(0.85), T.jade.opacity(0)], startPoint: .leading, endPoint: .trailing))
                            .frame(width: side - 16, height: 2)
                            .offset(y: sweep ? side / 2 - 12 : -side / 2 + 12)
                    }
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            .allowsHitTesting(false)
        }
        .onAppear {
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { sweep = true }
        }
        .accessibilityLabel("Camera viewfinder for the pairing code")
    }
}

/// Four corner brackets — the viewfinder's frame.
private struct Brackets: Shape {
    func path(in rect: CGRect) -> Path {
        let l = min(rect.width, rect.height) * 0.16
        var p = Path()
        for (corner, dx, dy) in [
            (CGPoint(x: rect.minX, y: rect.minY), CGFloat(1), CGFloat(1)),
            (CGPoint(x: rect.maxX, y: rect.minY), CGFloat(-1), CGFloat(1)),
            (CGPoint(x: rect.minX, y: rect.maxY), CGFloat(1), CGFloat(-1)),
            (CGPoint(x: rect.maxX, y: rect.maxY), CGFloat(-1), CGFloat(-1)),
        ] {
            p.move(to: CGPoint(x: corner.x, y: corner.y + dy * l))
            p.addLine(to: corner)
            p.addLine(to: CGPoint(x: corner.x + dx * l, y: corner.y))
        }
        return p
    }
}

/// AVFoundation QR reader. Calls back on the main thread, once per distinct
/// code while active.
private struct QRScanner: UIViewControllerRepresentable {
    let active: Bool
    let onCode: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let c = ScannerController()
        c.onCode = onCode
        c.active = active
        return c
    }

    func updateUIViewController(_ c: ScannerController, context: Context) {
        c.onCode = onCode
        c.active = active
        if active { c.lastCode = nil }
    }
}

private final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onCode: ((String) -> Void)?
    var active = true
    var lastCode: String?

    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private let queue = DispatchQueue(label: "budgetr.qr-scanner")

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(layer)
        preview = layer
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        let session = self.session
        queue.async { if !session.isRunning { session.startRunning() } }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        let session = self.session
        queue.async { if session.isRunning { session.stopRunning() } }
    }

    nonisolated func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard let code = (metadataObjects.first as? AVMetadataMachineReadableCodeObject)?.stringValue else { return }
        // Delivered on the main queue (set above); hop explicitly so the
        // compiler can see it.
        DispatchQueue.main.async { [weak self] in
            guard let self, self.active, code != self.lastCode else { return }
            self.lastCode = code
            Haptics.tap()
            self.onCode?(code)
        }
    }
}

#endif
