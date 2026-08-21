import CoreText
import Foundation

/// Registers the bundled typefaces at launch.
///
/// Done in code rather than through Info.plist because the two platforms want it
/// declared differently — iOS reads `UIAppFonts`, macOS reads
/// `ATSApplicationFontsPath` — and getting either subtly wrong fails silently:
/// the app runs, `Font.custom` finds nothing, and every label quietly falls back
/// to the system face. One code path registers both.
enum FontLoader {
    private static let files = [
        "Fraunces_600SemiBold",
        "Fraunces_700Bold",
        "HankenGrotesk_400Regular",
        "HankenGrotesk_500Medium",
        "HankenGrotesk_600SemiBold",
        "SplineSansMono_500Medium",
        "SplineSansMono_600SemiBold",
    ]

    /// Idempotent — re-registering an already-registered font is not an error
    /// worth surfacing, and SwiftUI previews will call this repeatedly.
    static func registerAll() {
        for name in files {
            guard let url = Bundle.main.url(forResource: name, withExtension: "ttf") else {
                assertionFailure("missing bundled font: \(name).ttf")
                continue
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }

    /// The PostScript names `Font.custom` needs, for checking the registration
    /// actually took. Useful in a debugger when everything renders as San
    /// Francisco and you want to know why.
    static var registeredNames: [String] {
        ["Fraunces-SemiBold", "Fraunces-Bold",
         "HankenGrotesk-Regular", "HankenGrotesk-Medium", "HankenGrotesk-SemiBold",
         "SplineSansMono-Medium", "SplineSansMono-SemiBold"]
    }
}
