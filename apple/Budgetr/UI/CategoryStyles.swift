import CoreData
import SwiftUI

/// Category id → the glyph and colour it wears everywhere.
///
/// The stored colour wins when the web app has one; otherwise a category takes
/// its slot in the chart palette by sort order, so it is the same colour on the
/// donut, its tile and its ledger rows rather than whatever position it happens
/// to land in on one chart.
struct CategoryStyles {
    private let icons: [String: String]
    private let colors: [String: Color]

    init(categories: [CDCategory]) {
        var icons: [String: String] = [:]
        var colors: [String: Color] = [:]
        let ordered = categories.sorted { ($0.sortOrder, $0.name ?? "") < ($1.sortOrder, $1.name ?? "") }
        for (i, c) in ordered.enumerated() {
            guard let id = c.id else { continue }
            if let icon = c.icon { icons[id] = icon }
            colors[id] = Color(hexString: c.color) ?? T.chart[i % T.chart.count]
        }
        self.icons = icons
        self.colors = colors
    }

    func icon(_ id: String?) -> String? { id.flatMap { icons[$0] } }

    func color(_ id: String?) -> Color { id.flatMap { colors[$0] } ?? T.muted }
}
