import CoreData
import SwiftUI

/// Recurring streams — subscriptions and bills the sync detected.
///
/// Sorted by what's due soonest, and overdue is split out at the top rather than
/// mixed into the list. A bill whose predicted date has passed is the one thing
/// on this screen that needs you, and the web app learned to say so.
struct RecurringView: View {
    @FetchRequest(sortDescriptors: [NSSortDescriptor(key: "predictedNextDate", ascending: true)])
    private var streams: FetchedResults<CDRecurringStream>

    private var today: String { MonthSummary.dayKey(Date()) }

    private var overdue: [CDRecurringStream] {
        streams.filter { ($0.predictedNextDate ?? "") < today && ($0.predictedNextDate ?? "").isEmpty == false }
    }

    private var upcoming: [CDRecurringStream] {
        streams.filter { ($0.predictedNextDate ?? "") >= today }
    }

    private var monthly: Double {
        streams.reduce(0) { $0 + abs($1.averageAmount?.doubleValue ?? 0) }
    }

    var body: some View {
        ScrollView {
            if streams.isEmpty {
                ContentUnavailableView(
                    "No recurring streams",
                    systemImage: "arrow.trianglehead.2.clockwise",
                    description: Text("They're detected during sync on the desktop app.")
                )
                .padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 5) {
                        Eyebrow("\(streams.count) streams · roughly per cycle")
                        Text(monthly.money())
                            .font(F.display(38))
                            .foregroundStyle(T.paper)
                    }

                    if !overdue.isEmpty {
                        TitledPanel("Overdue", trailing: "\(overdue.count)") {
                            VStack(spacing: 0) { ForEach(overdue, id: \.objectID) { row($0, late: true) } }
                        }
                    }
                    if !upcoming.isEmpty {
                        TitledPanel("Upcoming") {
                            VStack(spacing: 0) { ForEach(upcoming, id: \.objectID) { row($0, late: false) } }
                        }
                    }
                }
                .padding(20)
            }
        }
        .background(T.ink)
        .navigationTitle("Recurring")
    }

    private func row(_ s: CDRecurringStream, late: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.merchantName ?? s.streamDescription ?? "—")
                    .font(F.body(13.5))
                    .foregroundStyle(T.paper)
                Text([s.frequency, s.predictedNextDate.map { late ? "was due \($0)" : "next \($0)" }]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(F.mono(10))
                    .foregroundStyle(late ? T.coral : T.faint)
            }
            Spacer()
            Text(abs(s.averageAmount?.doubleValue ?? 0).money())
                .font(F.mono(13))
                .foregroundStyle(T.paper)
        }
        .padding(.vertical, 9)
    }
}
