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
        streams.filter { !($0.predictedNextDate ?? "").isEmpty && ($0.predictedNextDate ?? "") < today }
    }

    private var upcoming: [CDRecurringStream] {
        streams.filter { ($0.predictedNextDate ?? "") >= today }
    }

    /// Due in the next seven days — the part of "upcoming" worth a glance.
    private var thisWeek: [CDRecurringStream] {
        let cutoff = MonthSummary.dayKey(Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date())
        return upcoming.filter { ($0.predictedNextDate ?? "") <= cutoff }
    }

    private var monthly: Double {
        streams.reduce(0) { $0 + abs($1.averageAmount?.doubleValue ?? 0) }
    }

    var body: some View {
        BScreen("Recurring", eyebrow: "\(streams.count) streams · roughly per cycle") {
            if streams.isEmpty {
                Card {
                    EmptyState(
                        symbol: "arrow.triangle.2.circlepath",
                        title: "No recurring streams",
                        message: "They're detected during sync on the desktop app."
                    )
                }
                .rise(0)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    AnimatedMoney(value: monthly, font: F.display(42))
                    HStack(spacing: 8) {
                        StatTile(label: "Due this week", value: thisWeek.reduce(0) { $0 + abs($1.averageAmount?.doubleValue ?? 0) }.moneyCompact(), note: "\(thisWeek.count) bills")
                        StatTile(label: "Overdue", value: "\(overdue.count)", tint: overdue.isEmpty ? T.jade : T.coral, note: overdue.isEmpty ? "all on time" : "check these")
                    }
                }
                .rise(0)

                if !overdue.isEmpty {
                    TitledCard("Overdue", trailing: "\(overdue.count)") {
                        rows(overdue, late: true)
                    }
                    .rise(1)
                }
                if !upcoming.isEmpty {
                    TitledCard("Upcoming", trailing: "\(upcoming.count)") {
                        rows(upcoming, late: false)
                    }
                    .rise(2)
                }
            }
        }
    }

    private func rows(_ list: [CDRecurringStream], late: Bool) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(list.enumerated()), id: \.element.objectID) { i, s in
                row(s, late: late)
                    .overlay(alignment: .top) { if i > 0 { Hairline() } }
            }
        }
        .padding(.vertical, -10)
    }

    private func row(_ s: CDRecurringStream, late: Bool) -> some View {
        HStack(spacing: 12) {
            DueBadge(date: s.predictedNextDate, late: late)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.merchantName ?? s.streamDescription ?? "—")
                    .font(F.medium(14))
                    .foregroundStyle(T.paper)
                    .lineLimit(1)
                Text([s.frequency.map(Self.frequencyLabel), s.predictedNextDate.map { late ? "was due \(Self.relative($0))" : "next \(Self.relative($0))" }]
                        .compactMap { $0 }.joined(separator: " · "))
                    .font(F.body(11.5))
                    .foregroundStyle(late ? T.coral : T.faint)
            }
            Spacer()
            Text(abs(s.averageAmount?.doubleValue ?? 0).money())
                .font(F.mono(13))
                .foregroundStyle(T.paper)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    static func frequencyLabel(_ raw: String) -> String {
        switch raw.uppercased() {
        case "WEEKLY": return "Weekly"
        case "BIWEEKLY": return "Every 2 weeks"
        case "SEMI_MONTHLY": return "Twice a month"
        case "MONTHLY": return "Monthly"
        case "ANNUALLY": return "Yearly"
        default: return CategoryMapping.humanise(raw)
        }
    }

    /// `2026-10-19` → `in 2 days` / `today` / `3 days ago`.
    static func relative(_ raw: String) -> String {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: raw) else { return raw }
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: date)).day ?? 0
        switch days {
        case 0: return "today"
        case 1: return "tomorrow"
        case -1: return "yesterday"
        case 2...: return "in \(days) days"
        default: return "\(-days) days ago"
        }
    }
}

/// A tear-off calendar leaf: the month above the day.
private struct DueBadge: View {
    let date: String?
    let late: Bool

    private var parts: (month: String, day: String) {
        guard let date, date.count >= 10 else { return ("—", "—") }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let d = parser.date(from: date) else { return ("—", "—") }
        return (d.formatted(.dateTime.month(.abbreviated)).uppercased(), d.formatted(.dateTime.day()))
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(parts.month)
                .font(F.semibold(8.5))
                .tracking(0.8)
                .foregroundStyle(late ? T.ink : T.brass)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 2)
                .background(late ? T.coral : T.brass.opacity(0.14))
            Text(parts.day)
                .font(F.monoSemibold(14))
                .foregroundStyle(T.paper)
                .frame(maxHeight: .infinity)
        }
        .frame(width: 36, height: 38)
        .background(T.panel2)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(late ? T.coral.opacity(0.6) : T.line, lineWidth: 0.75))
        .accessibilityHidden(true)
    }
}
