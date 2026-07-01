import CoreData

/// Owns the Core Data stack (local-only for now).
///
/// Built with `NSPersistentContainer` so it builds with a free Apple Developer account.
/// To restore iCloud sync, swap `NSPersistentContainer` back to `NSPersistentCloudKitContainer`,
/// re-add the CloudKit entitlements in Support/Budgetr.entitlements, and restore the
/// NSPersistentHistoryTrackingKey / cloudKitContainerOptions setup below.
final class PersistenceController {
    static let shared = PersistenceController()

    /// In-memory stack for SwiftUI previews and unit tests.
    static var preview: PersistenceController = {
        PersistenceController(inMemory: true)
    }()

    let container: NSPersistentContainer

    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "Model")

        if inMemory {
            container.persistentStoreDescriptions.first?.url = URL(fileURLWithPath: "/dev/null")
        }

        container.loadPersistentStores { _, error in
            if let error = error as NSError? {
                fatalError("Unresolved Core Data error \(error), \(error.userInfo)")
            }
        }

        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        container.viewContext.name = "viewContext"
        container.viewContext.transactionAuthor = "app"
    }

    func newBackgroundContext() -> NSManagedObjectContext {
        let ctx = container.newBackgroundContext()
        ctx.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        ctx.transactionAuthor = "sync"
        return ctx
    }
}
