import SwiftUI
import CoreData

struct CategoriesView: View {
    @FetchRequest(
        sortDescriptors: [
            NSSortDescriptor(key: "group", ascending: true),
            NSSortDescriptor(key: "sortOrder", ascending: true)
        ],
        animation: .default
    )
    private var categories: FetchedResults<CDCategory>

    @State private var showArchived = false

    private var filtered: [CDCategory] {
        categories.filter { category in
            if showArchived {
                return true
            }
            return !(category.archived)
        }
    }

    private var groupedByGroup: [String: [CDCategory]] {
        Dictionary(grouping: filtered) { $0.group ?? "spending" }
    }

    private let groupOrder = ["income", "spending", "transfer"]

    var body: some View {
        List {
            ForEach(groupOrder, id: \.self) { group in
                let categoriesInGroup = groupedByGroup[group] ?? []
                if !categoriesInGroup.isEmpty {
                    Section(header: Text(group.capitalized)) {
                        ForEach(categoriesInGroup, id: \.objectID) { category in
                            HStack {
                                HStack(spacing: 8) {
                                    // Color swatch
                                    Circle()
                                        .fill(colorFromHex(category.color ?? "#999999"))
                                        .frame(width: 12, height: 12)

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(category.name ?? "—")
                                            .font(.body)
                                        if let iconStr = category.icon, !iconStr.isEmpty {
                                            Text(iconStr)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                Spacer()

                                // Budget amount if present
                                if let budget = category.budget, budget.amount > 0 {
                                    Text(budget.amount, format: .currency(code: "USD"))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Categories")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Toggle(isOn: $showArchived) {
                    Label("Archived", systemImage: "archivebox")
                }
                .toggleStyle(.button)
            }
        }
        .overlay {
            if filtered.isEmpty {
                ContentUnavailableView(
                    "No categories yet",
                    systemImage: "folder.badge.minus",
                    description: Text("Import budgetr.db or run a sync.")
                )
            }
        }
    }

    private func colorFromHex(_ hex: String) -> Color {
        var hexStr = hex.trimmingCharacters(in: .whitespaces)
        if hexStr.hasPrefix("#") {
            hexStr.removeFirst()
        }

        guard hexStr.count == 6 else {
            return Color.gray
        }

        var rgbValue: UInt64 = 0
        Scanner(string: hexStr).scanHexInt64(&rgbValue)

        let red = Double((rgbValue & 0xFF0000) >> 16) / 255.0
        let green = Double((rgbValue & 0x00FF00) >> 8) / 255.0
        let blue = Double(rgbValue & 0x0000FF) / 255.0

        return Color(red: red, green: green, blue: blue)
    }
}
