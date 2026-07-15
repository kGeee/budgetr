import SwiftUI
import CoreData

struct RecurringView: View {
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "predictedNextDate", ascending: true)],
        animation: .default
    )
    private var recurringStreams: FetchedResults<CDRecurringStream>

    @State private var showInactiveOnly = false

    private var filtered: [CDRecurringStream] {
        recurringStreams.filter { stream in
            if showInactiveOnly {
                return !stream.isActive
            }
            return stream.isActive
        }
    }

    var body: some View {
        List {
            ForEach(filtered, id: \.objectID) { stream in
                HStack(spacing: 12) {
                    // Direction indicator
                    Image(systemName: stream.direction == "inflow" ? "arrow.down.left" : "arrow.up.right")
                        .foregroundStyle(stream.direction == "inflow" ? Color.green : Color.secondary)
                        .font(.body)

                    // Main content
                    VStack(alignment: .leading, spacing: 2) {
                        Text(stream.merchantName ?? stream.streamDescription ?? "—")
                            .font(.body)
                        HStack(spacing: 4) {
                            Text(frequencyLabel(stream.frequency))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let accountName = stream.account?.name {
                                Text("·")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(accountName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Spacer()

                    // Right side: next date and amount
                    VStack(alignment: .trailing, spacing: 2) {
                        if let nextDate = stream.predictedNextDate {
                            Text(formatDate(nextDate))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        let avgAmount = stream.averageAmount?.doubleValue ?? 0
                        Text(amountString(avgAmount, isInflow: stream.direction == "inflow"))
                            .font(.body)
                            .foregroundStyle(stream.direction == "inflow" ? Color.green : Color.primary)
                            .monospacedDigit()
                    }
                }
            }
        }
        .navigationTitle("Recurring")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Toggle(isOn: $showInactiveOnly) {
                    Label("Inactive", systemImage: "eye.slash")
                }
                .toggleStyle(.button)
            }
        }
        .overlay {
            if filtered.isEmpty {
                ContentUnavailableView(
                    showInactiveOnly ? "No inactive recurring streams" : "No recurring streams yet",
                    systemImage: showInactiveOnly ? "eye.slash" : "calendar",
                    description: Text(showInactiveOnly
                        ? "Show active recurring streams to see upcoming transactions."
                        : "Recurring subscriptions, bills, and income will appear here once detected.")
                )
            }
        }
    }

    private func frequencyLabel(_ frequency: String?) -> String {
        guard let freq = frequency else { return "Recurring" }
        switch freq.uppercased() {
        case "WEEKLY":
            return "Weekly"
        case "BIWEEKLY":
            return "Every 2 weeks"
        case "SEMI_MONTHLY":
            return "Twice a month"
        case "MONTHLY":
            return "Monthly"
        case "ANNUALLY":
            return "Yearly"
        default:
            return freq
        }
    }

    private func formatDate(_ dateString: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateString) else { return dateString }

        let displayFormatter = DateFormatter()
        displayFormatter.dateFormat = "MMM d"
        return displayFormatter.string(from: date)
    }

    private func amountString(_ amount: Double, isInflow: Bool) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        let displayAmount = isInflow ? amount : abs(amount)
        return formatter.string(from: NSNumber(value: displayAmount)) ?? "\(displayAmount)"
    }
}
