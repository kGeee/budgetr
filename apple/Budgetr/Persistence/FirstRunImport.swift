import CoreData
import Foundation

/// Picks up a ledger dropped into the app's own folder.
///
/// The Mac reads `web/data/budgetr.db` off disk; a phone has no such file, so it
/// has to arrive — AirDropped, saved from Files, or copied over a cable into
/// Files → On My iPhone → Budgetr. Once it's there, making the user then hunt
/// for it through a document picker is a second step for no reason: the file is
/// already inside the app's sandbox and was put there deliberately.
///
/// So an empty store plus a `budgetr.db` in Documents means import it. It only
/// ever runs against an empty store, so it can't overwrite work, and it can't
/// loop — after the first success there are transactions and the check fails.
enum FirstRunImport {
    static var candidateURL: URL? {
        guard let docs = try? FileManager.default.url(
            for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: false
        ) else { return nil }
        let url = docs.appendingPathComponent("budgetr.db")
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    static func storeIsEmpty(_ context: NSManagedObjectContext) -> Bool {
        let request = NSFetchRequest<NSNumber>(entityName: "CDTransaction")
        request.resultType = .countResultType
        return ((try? context.count(for: request)) ?? 0) == 0
    }

    /// Returns what happened, or nil when there was nothing to do.
    @discardableResult
    static func run(context: NSManagedObjectContext) -> ImportAlert? {
        guard storeIsEmpty(context), let url = candidateURL else { return nil }
        do {
            try ImportController.run(url: url, context: context)
            return ImportAlert(
                title: "Ledger loaded",
                message: "Imported budgetr.db from this app's folder."
            )
        } catch {
            return ImportAlert(
                title: "Couldn't read budgetr.db",
                message: error.localizedDescription
            )
        }
    }
}
