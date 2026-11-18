import SwiftUI

/// The "statement" grammar, natively.
///
/// One figure, one sentence that says what it means, then ruled rows sitting
/// directly on the canvas — the same reading order as the 0.15 web app, so the
/// phone and the Mac feel like one product. These replace the stack of cards
/// each companion screen used to open with: a screen gets one hero, and
/// everything under it is a rule, not a box.

// ── Rules ────────────────────────────────────────────────────────────

/// A full-width hairline. `strong` heads a section; the plain one separates rows.
struct Rule: View {
    var strong = false
    var body: some View {
        Rectangle()
            .fill(strong ? T.lineStrong : T.line)
            .frame(height: 1)
            .accessibilityHidden(true)
    }
}

// ── Figures ──────────────────────────────────────────────────────────

/// A money figure with its cents set one rank quieter.
struct FigureText: View {
    let cents: Int
    var font: Font = F.display(52)
    var color: Color = T.paper
    /// Prefix a `+` on positive amounts (a day's gain, money in).
    var signed = false

    var body: some View {
        let whole = (Double(abs(cents)) / 100).rounded(.down)
        let frac = abs(cents) % 100
        let sign = cents < 0 ? "−" : (signed && cents > 0 ? "+" : "")
        (Text(sign + whole.moneyWhole()).foregroundStyle(color)
            + Text(String(format: ".%02d", frac)).foregroundStyle(T.muted))
            .font(font)
            .tracking(-1.2)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .accessibilityLabel(Text((Double(cents) / 100).money()))
    }
}

/// The screen's one editorial number, with the sentence that reads it.
struct StatementHero<Verdict: View, Footer: View>: View {
    var eyebrow: String?
    let cents: Int
    var color: Color = T.paper
    var size: CGFloat = 52
    var signed = false
    @ViewBuilder var verdict: Verdict
    @ViewBuilder var footer: Footer

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let eyebrow { Eyebrow(eyebrow) }
            FigureText(cents: cents, font: F.display(size), color: color, signed: signed)
            verdict
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension StatementHero where Footer == EmptyView {
    init(eyebrow: String? = nil, cents: Int, color: Color = T.paper, size: CGFloat = 52, signed: Bool = false,
         @ViewBuilder verdict: () -> Verdict) {
        self.init(eyebrow: eyebrow, cents: cents, color: color, size: size, signed: signed, verdict: verdict, footer: { EmptyView() })
    }
}

/// One sentence in the display face. Build it from `Text` pieces so the part
/// that matters can carry a colour: `VerdictText(Text("Up ") + Text("$5").foregroundStyle(T.jade))`.
struct VerdictText: View {
    let text: Text
    init(_ text: Text) { self.text = text }
    init(_ string: String) { self.text = Text(string) }

    var body: some View {
        text
            .font(F.display(18))
            .foregroundStyle(T.paper)
            .lineSpacing(2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

extension CompanionModel.PaceVerdict.Tone {
    var color: Color {
        switch self {
        case .ok: return T.jade
        case .warn: return T.brass
        case .over: return T.coral
        }
    }
}

extension CompanionModel.PaceVerdict {
    /// The sentence, with its figure in the tone's colour.
    var text: Text {
        Text(lead + " ")
            + Text((Double(cents) / 100).money()).foregroundStyle(tone.color)
            + Text(" " + tail)
    }
}

// ── Strips ───────────────────────────────────────────────────────────

/// A single ruled line of supporting figures: cells divided by hairlines,
/// ruled above and below. Two or three cells read well on a phone.
struct StatCells: View {
    struct Cell: Identifiable {
        let id = UUID()
        let label: String
        let value: String
        var note: String?
        var valueColor: Color = T.paper
        var noteColor: Color = T.muted
        /// Display face for a headline cell, mono for a plain figure.
        var prominent = true
    }

    let cells: [Cell]

    var body: some View {
        VStack(spacing: 0) {
            Rule()
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array(cells.enumerated()), id: \.element.id) { i, cell in
                    if i > 0 {
                        Rectangle().fill(T.line).frame(width: 1).accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cell.label).font(F.body(13)).foregroundStyle(T.muted)
                        Text(cell.value)
                            .font(cell.prominent ? F.display(22) : F.mono(14))
                            .foregroundStyle(cell.valueColor)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        if let note = cell.note {
                            Text(note).font(F.mono(11.5)).foregroundStyle(cell.noteColor)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 13)
                    .padding(.leading, i == 0 ? 0 : 14)
                    .padding(.trailing, 10)
                    .accessibilityElement(children: .combine)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Rule()
        }
    }
}

// ── Sections ─────────────────────────────────────────────────────────

/// A section title in the display face over a strong rule, with a count and an
/// optional trailing action. The rows that follow sit under it, ruled.
struct StatementSection<Content: View>: View {
    let title: String
    var count: Int?
    var countColor: Color = T.muted
    var action: (label: String, run: () -> Void)?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(F.display(18)).foregroundStyle(T.paper)
                if let count {
                    Text("\(count)").font(F.mono(12)).foregroundStyle(countColor)
                }
                Spacer(minLength: 8)
                if let action {
                    Button {
                        Haptics.tap()
                        action.run()
                    } label: {
                        Text(action.label).font(F.body(13)).foregroundStyle(T.muted)
                            .frame(minHeight: 30)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.bottom, 8)
            .accessibilityAddTraits(.isHeader)
            Rule(strong: true)
            content
        }
    }
}

/// A quiet group label over a strong rule — "Fixed", "Flexible", a day.
struct RuleLabel: View {
    let leading: String
    var trailing: String?
    var mono = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(leading)
                Spacer(minLength: 8)
                if let trailing { Text(trailing) }
            }
            .font(mono ? F.mono(11) : F.body(12))
            .foregroundStyle(T.muted)
            .padding(.bottom, 6)
            Rule(strong: true)
        }
    }
}

/// One ruled row: content, then a hairline. At least 50pt tall so every row is
/// a comfortable touch target.
struct RuledRow<Content: View>: View {
    var minHeight: CGFloat = 50
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
                .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
                .contentShape(Rectangle())
            Rule()
        }
    }
}

// ── Bars ─────────────────────────────────────────────────────────────

/// A thin progress bar with an optional tick for today. Under a budget the fill
/// is how much is gone and the tick is how much of the month is; a fill short
/// of the tick is under pace at a glance.
struct TickBar: View {
    let fraction: Double
    var color: Color = T.jade
    /// 0–1 position of the today tick; nil draws none (a fixed cost has no pace).
    var tick: Double?
    var height: CGFloat = 4

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(T.panel2)
                Capsule()
                    .fill(color)
                    .frame(width: max(fraction > 0 ? 3 : 0, min(1, max(0, fraction)) * geo.size.width))
                if let tick {
                    Rectangle()
                        .fill(T.paper)
                        .frame(width: 1, height: height + 6)
                        .offset(x: min(1, max(0, tick)) * geo.size.width)
                }
            }
            .frame(height: height + 6, alignment: .center)
        }
        .frame(height: height + 6)
        .accessibilityHidden(true)
    }
}

/// A small square dot in a category's colour.
struct CategoryDot: View {
    let color: Color
    var body: some View {
        RoundedRectangle(cornerRadius: 3).fill(color).frame(width: 8, height: 8).accessibilityHidden(true)
    }
}
