import SwiftUI
import CoreData

struct SettingsView: View {
    @Environment(\.managedObjectContext) private var context

    @State private var displayCurrency: String = "USD"
    @State private var isLoading = true

    let commonCurrencies = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "MXN"]

    var body: some View {
        NavigationStack {
            Form {
                // Display Currency Section
                Section(header: Text("Display Settings")) {
                    Picker("Currency", selection: $displayCurrency) {
                        ForEach(commonCurrencies, id: \.self) { currency in
                            Text(currency).tag(currency)
                        }
                    }
                    .onChange(of: displayCurrency) { _, newValue in
                        updateDisplayCurrency(newValue)
                    }
                }

                // About Section
                Section(header: Text("About")) {
                    HStack {
                        Text("App Name")
                        Spacer()
                        Text(appName)
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Text("Version")
                        Spacer()
                        Text(appVersion)
                            .foregroundStyle(.secondary)
                    }

                    if let buildNumber = appBuildNumber {
                        HStack {
                            Text("Build")
                            Spacer()
                            Text(buildNumber)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                loadDisplayCurrency()
            }
        }
    }

    // MARK: - Private Methods

    private func loadDisplayCurrency() {
        let request = NSFetchRequest<CDAppSetting>(entityName: "CDAppSetting")
        request.predicate = NSPredicate(format: "key == %@", "displayCurrency")
        request.fetchLimit = 1

        do {
            let results = try context.fetch(request)
            if let setting = results.first, let value = setting.value {
                displayCurrency = value
            } else {
                displayCurrency = "USD"
            }
        } catch {
            print("Failed to fetch displayCurrency setting: \(error)")
            displayCurrency = "USD"
        }
        isLoading = false
    }

    private func updateDisplayCurrency(_ newValue: String) {
        let request = NSFetchRequest<CDAppSetting>(entityName: "CDAppSetting")
        request.predicate = NSPredicate(format: "key == %@", "displayCurrency")
        request.fetchLimit = 1

        do {
            let results = try context.fetch(request)
            let setting: CDAppSetting
            if let existingSetting = results.first {
                setting = existingSetting
            } else {
                setting = CDAppSetting(context: context)
                setting.key = "displayCurrency"
            }
            setting.value = newValue
            try context.save()
        } catch {
            print("Failed to update displayCurrency setting: \(error)")
        }
    }

    private var appName: String {
        Bundle.main.infoDictionary?["CFBundleDisplayName"] as? String
            ?? Bundle.main.infoDictionary?["CFBundleName"] as? String
            ?? "Budgetr"
    }

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    private var appBuildNumber: String? {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String
    }
}

#Preview {
    let container = NSPersistentContainer(name: "Model")
    container.loadPersistentStores { _, error in
        if let error = error {
            print("Failed to load persistent stores: \(error)")
        }
    }

    return SettingsView()
        .environment(\.managedObjectContext, container.viewContext)
}
