import CoreData
import SwiftUI

/// Turns a file-picker result into an import and a message.
///
/// Shared by both shells: the Mac sidebar and the phone's More tab run the same
/// import, so a fix to one is a fix to both.
enum ImportRunner {
    static func handle(_ result: Result<URL, Error>, context: NSManagedObjectContext) -> ImportAlert {
        switch result {
        case .success(let url):
            // A file chosen through the picker lives outside the sandbox, so it
            // has to be opened under a security scope — without this the import
            // fails on iOS with a permissions error that reads like a corrupt
            // database.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }

            do {
                try ImportController.run(url: url, context: context)
                return ImportAlert(title: "Import complete", message: "Your ledger is loaded.")
            } catch ImportError.cannotOpenDatabase {
                return ImportAlert(
                    title: "Import failed",
                    message: "Could not open that database file."
                )
            } catch {
                return ImportAlert(title: "Import failed", message: error.localizedDescription)
            }
        case .failure(let error):
            return ImportAlert(title: "Could not open file", message: error.localizedDescription)
        }
    }
}
