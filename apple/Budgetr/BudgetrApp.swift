import SwiftUI

@main
struct BudgetrApp: App {
    // Registered before any view resolves a font, or every label silently falls
    // back to the system face and the app stops looking like budgetr.
    init() { FontLoader.registerAll() }

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
}
