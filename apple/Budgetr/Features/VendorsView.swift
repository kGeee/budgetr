import SwiftUI
import CoreData

struct VendorsView: View {
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "name", ascending: true)],
        animation: .default
    )
    private var vendorGroups: FetchedResults<CDVendorGroup>

    var body: some View {
        List {
            ForEach(vendorGroups, id: \.objectID) { group in
                DisclosureGroup {
                    let members = (group.members?.allObjects as? [CDVendorGroupMember]) ?? []
                    let sortedMembers = members.sorted { ($0.vendorKey ?? "") < ($1.vendorKey ?? "") }

                    if sortedMembers.isEmpty {
                        Text("No members")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(sortedMembers, id: \.self) { member in
                            HStack {
                                Text(member.vendorKey ?? "—")
                                    .font(.subheadline)
                                    .lineLimit(1)
                                Spacer()
                            }
                        }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(group.name ?? "—")
                            .font(.body)
                        let memberCount = (group.members?.count ?? 0)
                        Text("\(group.name ?? "—") · \(memberCount) merged \(memberCount == 1 ? "name" : "names")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .navigationTitle("Vendors")
        .overlay {
            if vendorGroups.isEmpty {
                ContentUnavailableView(
                    "No vendor groups yet",
                    systemImage: "store",
                    description: Text("Vendor groups will appear once you have categorized merchants in your transactions.")
                )
            }
        }
    }
}
