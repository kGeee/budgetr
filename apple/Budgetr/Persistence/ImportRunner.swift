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
            // The security scope is claimed inside ImportController, so it
            // covers every caller rather than only this one.
            do {
                try ImportController.run(url: url, context: context)
                return ImportAlert(title: "Import complete", message: "Your ledger is loaded.")
            } catch {
                return ImportAlert(title: "Import failed", message: error.localizedDescription)
            }
        case .failure(let error):
            return ImportAlert(title: "Could not open file", message: error.localizedDescription)
        }
    }
}
