import SwiftUI
import CoreData

struct RulesView: View {
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "createdAt", ascending: false)],
        animation: .default
    )
    private var rules: FetchedResults<CDTagRule>

    var body: some View {
        List {
            ForEach(rules, id: \.objectID) { rule in
                VStack(alignment: .leading, spacing: 4) {
                    Text(rule.pattern ?? "—")
                        .font(.body)
                        .lineLimit(1)
                    HStack(spacing: 4) {
                        Text(rule.label ?? "")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        if let tag = rule.tag {
                            Spacer()
                            HStack(spacing: 6) {
                                if let colorHex = tag.color, !colorHex.isEmpty {
                                    Circle()
                                        .fill(hexToColor(colorHex))
                                        .frame(width: 12, height: 12)
                                }
                                Text(tag.name ?? "—")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .navigationTitle("Auto-Tagging Rules")
        .overlay {
            if rules.isEmpty {
                ContentUnavailableView(
                    "No rules yet",
                    systemImage: "tag",
                    description: Text("Create your first auto-tagging rule from the web app.")
                )
            }
        }
    }

    private func hexToColor(_ hex: String) -> Color {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let scanner = Scanner(string: hex)
        var rgb: UInt64 = 0
        scanner.scanHexInt64(&rgb)

        let r = Double((rgb & 0xFF0000) >> 16) / 255.0
        let g = Double((rgb & 0x00FF00) >> 8) / 255.0
        let b = Double(rgb & 0x0000FF) / 255.0

        return Color(red: r, green: g, blue: b)
    }
}
