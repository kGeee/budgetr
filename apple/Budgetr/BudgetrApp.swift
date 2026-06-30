import SwiftUI

@main
struct BudgetrApp: App {
    private let persistence = PersistenceController.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(\.managedObjectContext, persistence.container.viewContext)
        }
        #if os(macOS)
        .defaultSize(width: 1100, height: 720)
        .windowToolbarStyle(.unified)
        #endif
    }
}
