import SwiftUI
#if os(iOS)
import UIKit
#endif

@main
struct BudgetrApp: App {
    init() {
        // Registered before any view resolves a font, or every label silently falls
        // back to the system face and the app stops looking like budgetr.
        FontLoader.registerAll()
        #if os(iOS)
        Self.styleSystemChrome()
        #endif
    }

    private let persistence = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            AppShell()
                .environment(\.managedObjectContext, persistence.container.viewContext)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 720)
        .windowToolbarStyle(.unified)
        #endif
    }

    #if os(iOS)
    /// The UIKit chrome SwiftUI doesn't reach: navigation-bar titles in the
    /// app's faces (pushed screens, sheets), and search fields and pickers
    /// tinted to match, so nothing on screen falls back to San Francisco blue.
    private static func styleSystemChrome() {
        let paper = UIColor(red: 0xEC / 255, green: 0xE7 / 255, blue: 0xDA / 255, alpha: 1)
        let jade = UIColor(red: 0x6F / 255, green: 0xE3 / 255, blue: 0xA6 / 255, alpha: 1)

        let bar = UINavigationBarAppearance()
        bar.configureWithTransparentBackground()
        if let title = UIFont(name: "HankenGrotesk-SemiBold", size: 16) {
            bar.titleTextAttributes = [.font: title, .foregroundColor: paper]
        }
        if let large = UIFont(name: "Fraunces-SemiBold", size: 32) {
            bar.largeTitleTextAttributes = [.font: large, .foregroundColor: paper]
        }
        let button = UIBarButtonItemAppearance()
        if let font = UIFont(name: "HankenGrotesk-Medium", size: 16) {
            button.normal.titleTextAttributes = [.font: font, .foregroundColor: jade]
        }
        bar.buttonAppearance = button
        bar.doneButtonAppearance = button
        bar.backButtonAppearance = button

        let scrolled = bar.copy()
        scrolled.configureWithDefaultBackground()
        scrolled.backgroundEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
        scrolled.backgroundColor = UIColor(red: 0x08 / 255, green: 0x0B / 255, blue: 0x0A / 255, alpha: 0.55)
        scrolled.shadowColor = UIColor(red: 0x2B / 255, green: 0x35 / 255, blue: 0x31 / 255, alpha: 1)
        if let title = UIFont(name: "HankenGrotesk-SemiBold", size: 16) {
            scrolled.titleTextAttributes = [.font: title, .foregroundColor: paper]
        }
        scrolled.buttonAppearance = button
        scrolled.doneButtonAppearance = button
        scrolled.backButtonAppearance = button

        let nav = UINavigationBar.appearance()
        nav.standardAppearance = scrolled
        nav.compactAppearance = scrolled
        nav.scrollEdgeAppearance = bar
        nav.tintColor = jade

        UISearchBar.appearance().tintColor = jade
        UISwitch.appearance().onTintColor = jade
    }
    #endif
}
