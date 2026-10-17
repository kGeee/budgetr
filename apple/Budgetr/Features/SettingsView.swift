import CoreData
import SwiftUI

/// Everything the tab bar can't hold, plus the data paths: where the ledger
/// comes from, the sample ledger for looking around, and the way back to empty.
struct SettingsView: View {
    @Environment(\.managedObjectContext) private var context
    @EnvironmentObject private var app: AppModel
    @EnvironmentObject private var companion: CompanionStore
    @AppStorage(SampleData.flagKey) private var sampleLoaded = false
    @State private var showingPairing = false

    @FetchRequest(sortDescriptors: [])
    private var transactions: FetchedResults<CDTransaction>

    @FetchRequest(sortDescriptors: [])
    private var accounts: FetchedResults<CDAccount>

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var showsLedgerLinks: Bool { sizeClass == .compact }
    #else
    private let showsLedgerLinks = false
    #endif

    private var version: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "dev"
        let b = info?["CFBundleVersion"] as? String ?? "0"
        return "\(v) (\(b))"
    }

    var body: some View {
        BScreen("More", eyebrow: "budgetr · \(version)") {
            #if os(iOS)
            group("Companion") {
                action("Pair with your Mac", "qrcode.viewfinder", tint: T.jade) {
                    showingPairing = true
                }
            } footer: {
                "Scan the code in budgetr on your Mac to see its live numbers here instead of this ledger."
            }
            .rise(0)
            #endif

            if showsLedgerLinks {
                group("Ledger") {
                    link("Accounts", "building.columns", detail: "\(accounts.count)") { AccountsView() }
                    link("Categories", "tag") { CategoriesView() }
                    link("Recurring", "arrow.triangle.2.circlepath") { RecurringView() }
                }
                .rise(0)
            }

            group("Data") {
                row("Ledger", "tray.full", value: transactions.isEmpty ? "empty" : "\(transactions.count) transactions")
                action("Import budgetr.db…", "square.and.arrow.down") {
                    app.showingImporter = true
                }
                if transactions.isEmpty {
                    action("Load sample data", "sparkles") {
                        app.loadSample(context: context)
                    }
                }
                if !transactions.isEmpty {
                    action(sampleLoaded ? "Remove sample data" : "Erase all data", "trash", tint: T.coral) {
                        Haptics.warning()
                        app.confirmingErase = true
                    }
                }
            } footer: {
                // The Mac reads budgetr.db off disk. A phone has no such file, so
                // it has to arrive — AirDropped, saved from Files, or dropped
                // into the app's folder over a cable. Saying which is the
                // difference between a usable screen and a dead end.
                "Put budgetr.db in Files → On My iPhone → Budgetr, or AirDrop it from your Mac, then import it here. A real ledger replaces the sample one."
            }
            .rise(1)

            group("About") {
                row("Version", "info.circle", value: version)
                row("Storage", "lock.shield", value: "on this device")
            } footer: {
                "Your ledger lives in this app's private storage and never leaves the device. There is no account and no server in between."
            }
            .rise(2)

            HStack {
                Spacer()
                VStack(spacing: 8) {
                    BrandMark(size: 26)
                    Text("Made for the long game.")
                        .font(F.body(11.5))
                        .foregroundStyle(T.faint)
                }
                Spacer()
            }
            .padding(.top, 10)
            .rise(3)
        }
        .sheet(isPresented: $showingPairing) {
            NavigationStack { PairingView(showsAlternatives: false) }
                .environmentObject(companion)
                .environmentObject(app)
                .environment(\.managedObjectContext, context)
                .bSheet([.large])
        }
    }

    // ── Building blocks ──────────────────────────────────────────────

    private func group<Rows: View>(
        _ title: String,
        @ViewBuilder rows: () -> Rows,
        footer: () -> String = { "" }
    ) -> some View {
        let note = footer()
        return VStack(alignment: .leading, spacing: 8) {
            Eyebrow(title).padding(.leading, 4)
            Card(padding: 0) {
                VStack(spacing: 0) {
                    rows()
                }
            }
            if !note.isEmpty {
                Text(note)
                    .font(F.body(11.5))
                    .foregroundStyle(T.faint)
                    .padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func label(_ title: String, _ symbol: String, tint: Color = T.brass) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(tint.opacity(0.12)))
            Text(title)
                .font(F.medium(14.5))
                .foregroundStyle(tint == T.coral ? T.coral : T.paper)
        }
    }

    private func row(_ title: String, _ symbol: String, value: String) -> some View {
        HStack {
            label(title, symbol)
            Spacer()
            Text(value).font(F.mono(12)).foregroundStyle(T.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .overlay(alignment: .bottom) { Hairline().padding(.leading, 56) }
    }

    private func action(_ title: String, _ symbol: String, tint: Color = T.brass, perform: @escaping () -> Void) -> some View {
        Button {
            Haptics.tap()
            perform()
        } label: {
            HStack {
                label(title, symbol, tint: tint)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(T.faint)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressScale)
        .overlay(alignment: .bottom) { Hairline().padding(.leading, 56) }
    }

    private func link<Destination: View>(
        _ title: String,
        _ symbol: String,
        detail: String? = nil,
        @ViewBuilder destination: @escaping () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack {
                label(title, symbol)
                Spacer()
                if let detail {
                    Text(detail).font(F.mono(12)).foregroundStyle(T.muted)
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(T.faint)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.pressScale)
        .simultaneousGesture(TapGesture().onEnded { Haptics.tap() })
        .overlay(alignment: .bottom) { Hairline().padding(.leading, 56) }
    }
}
