import Foundation
import SwiftUI
#if os(iOS)
import BackgroundTasks
#endif

/// The one companion store the whole process shares.
///
/// The shell renders from it and the background refresh below writes to it, so
/// a summary fetched while the app was in the background is already on screen
/// when it comes forward — and two stores never race to send the same edits.
@MainActor
enum CompanionRuntime {
    static let store = CompanionStore()
}

/// Keeping the phone current on a schedule.
///
/// Three cadences, each as often as its situation allows:
///  - **On screen**: every minute (`foregroundInterval`). The relay answers
///    "not modified" with an ETag when the Mac has published nothing new, so
///    an idle check costs one small request.
///  - **In the background**: iOS's app-refresh task, asked for every half hour.
///    The system decides when it actually runs — more often for an app that is
///    opened often, rarely or never in Low Power Mode or when Background App
///    Refresh is off. It is a best effort, not a clock.
///  - **Coming forward**: always, straight away (AppShell).
enum BackgroundRefresh {
    static let identifier = "com.budgetr.app.refresh"
    static let foregroundInterval: Duration = .seconds(60)
    private static let backgroundInterval: TimeInterval = 30 * 60

    /// Ask iOS for the next background refresh. Called when the app leaves the
    /// screen and again from each refresh, so the chain never ends.
    static func schedule() {
        #if os(iOS)
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: backgroundInterval)
        // Fails on the simulator and when the user has turned Background App
        // Refresh off; either way there is nothing to do but carry on.
        try? BGTaskScheduler.shared.submit(request)
        #endif
    }

    /// The background refresh itself: send any waiting edits, fetch the Mac's
    /// latest summary, and cache it — the same refresh the foreground runs.
    @MainActor
    static func run() async {
        schedule()
        let store = CompanionRuntime.store
        guard store.isPaired else { return }
        await store.refresh()
    }
}
