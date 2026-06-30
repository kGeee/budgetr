import CoreData

/// Owns the Core Data + CloudKit stack.
///
/// Uses `NSPersistentCloudKitContainer` against the **private** CloudKit database so
/// each iCloud account gets its own siloed copy of the data, synced across the user's
/// Macs and iOS devices. There is no server of our own in this path — Apple moves the
/// rows. (The only backend we keep is the thin Plaid/Finnhub secret proxy; see
/// `Services/ProxyClient.swift`.)
final class PersistenceController {
    static let shared = PersistenceController()

    /// In-memory stack for SwiftUI previews and unit tests (no iCloud, no disk).
    static var preview: PersistenceController = {
        let controller = PersistenceController(inMemory: true)
        // Seed a few objects here for previews if desired.
        return controller
    }()

    let container: NSPersistentCloudKitContainer

    init(inMemory: Bool = false) {
        container = NSPersistentCloudKitContainer(name: "Model")

        guard let description = container.persistentStoreDescriptions.first else {
            fatalError("Missing persistent store description")
        }

        if inMemory {
            description.url = URL(fileURLWithPath: "/dev/null")
            // No CloudKit options in memory.
            description.cloudKitContainerOptions = nil
        } else {
            // Persistent history + remote-change notifications are REQUIRED for
            // NSPersistentCloudKitContainer to merge changes arriving from CloudKit.
            description.setOption(true as NSNumber,
                                  forKey: NSPersistentHistoryTrackingKey)
            description.setOption(true as NSNumber,
                                  forKey: NSPersistentStoreRemoteChangeNotificationPostOptionKey)

            // The CloudKit container id must match the entitlement in
            // Support/Budgetr.entitlements (iCloud.com.budgetr.app).
            let options = NSPersistentCloudKitContainerOptions(
                containerIdentifier: "iCloud.com.budgetr.app"
            )
            // databaseScope defaults to `.private` (per-user, not shared) — exactly what
            // we want. Set it explicitly only if switching to `.shared`/`.public` later.
            description.cloudKitContainerOptions = options
        }

        container.loadPersistentStores { _, error in
            if let error = error as NSError? {
                // In production, surface this to the user instead of crashing.
                fatalError("Unresolved Core Data error \(error), \(error.userInfo)")
            }
        }

        // Last-writer-wins is the pragmatic default for a single-user multi-device app.
        // Revisit if specific entities need field-level merge.
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        container.viewContext.name = "viewContext"
        container.viewContext.transactionAuthor = "app"

        #if DEBUG
        // One-time: uncomment to push the model's CloudKit schema to the
        // *development* environment from a signed-in device, then re-comment.
        // try? container.initializeCloudKitSchema(options: [])
        #endif
    }

    /// Spawn a background context for sync/import work. Never block `viewContext`.
    func newBackgroundContext() -> NSManagedObjectContext {
        let ctx = container.newBackgroundContext()
        ctx.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        ctx.transactionAuthor = "sync"
        return ctx
    }
}
