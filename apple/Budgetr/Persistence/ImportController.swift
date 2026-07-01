import CoreData
import SQLite3

enum ImportError: Error {
    case cannotOpenDatabase
    case saveFailed(Error)
}

final class ImportController {

    static func run(url: URL, context: NSManagedObjectContext) throws {
        let importer = ImportController(context: context)
        try importer.importAll(from: url)
    }

    private let ctx: NSManagedObjectContext

    private init(context: NSManagedObjectContext) {
        self.ctx = context
    }

    // MARK: - Entry point

    private func importAll(from url: URL) throws {
        var db: OpaquePointer?
        // Must gain access on iOS; on macOS dev builds this is a no-op but harmless.
        let secured = url.startAccessingSecurityScopedResource()
        defer {
            if secured { url.stopAccessingSecurityScopedResource() }
        }

        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            throw ImportError.cannotOpenDatabase
        }
        defer { sqlite3_close(db) }

        try importCategories(db: db)
        try importTags(db: db)
        try importItems(db: db)
        try importAccounts(db: db)
        try importTransactions(db: db)
        try importTransactionTags(db: db)
        try importBudgets(db: db)
        try importTagBudgets(db: db)
        try importTagRules(db: db)
        try importRecurringStreams(db: db)
        try importVendorGroups(db: db)
        try importVendorGroupMembers(db: db)

        do {
            try ctx.save()
        } catch {
            throw ImportError.saveFailed(error)
        }
    }

    // MARK: - Table importers

    private func importCategories(db: OpaquePointer?) throws {
        let sql = """
            SELECT id, name, icon, color, "group", plaid_primary, sort_order, archived
            FROM categories
            """
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDCategory.self, id: str(stmt, 0))
            obj.id        = str(stmt, 0)
            obj.name      = str(stmt, 1)
            obj.icon      = str(stmt, 2)
            obj.color     = str(stmt, 3)
            obj.group     = str(stmt, 4)
            obj.plaidPrimary = str(stmt, 5)
            obj.sortOrder = sqlite3_column_int64(stmt, 6)
            obj.archived  = sqlite3_column_int(stmt, 7) != 0
        }
    }

    private func importTags(db: OpaquePointer?) throws {
        let sql = "SELECT id, name, color FROM tags"
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDTag.self, id: str(stmt, 0))
            obj.id    = str(stmt, 0)
            obj.name  = str(stmt, 1)
            obj.color = str(stmt, 2)
        }
    }

    private func importItems(db: OpaquePointer?) throws {
        let sql = """
            SELECT id, access_token_enc, plaid_env, institution_id, institution_name,
                   transactions_cursor, status, error, created_at, updated_at
            FROM items
            """
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDItem.self, id: str(stmt, 0))
            obj.id                  = str(stmt, 0)
            obj.accessTokenEnc      = blob(stmt, 1)
            obj.plaidEnv            = str(stmt, 2)
            obj.institutionId       = str(stmt, 3)
            obj.institutionName     = str(stmt, 4)
            obj.transactionsCursor  = str(stmt, 5)
            obj.status              = str(stmt, 6)
            obj.error               = str(stmt, 7)
            obj.createdAt           = epochDate(stmt, 8)
            obj.updatedAt           = epochDate(stmt, 9)
        }
    }

    private func importAccounts(db: OpaquePointer?) throws {
        let sql = """
            SELECT id, item_id, name, official_name, mask, type, subtype,
                   current_balance, available_balance, iso_currency_code, updated_at
            FROM accounts
            """
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDAccount.self, id: str(stmt, 0))
            obj.id                = str(stmt, 0)
            obj.name              = str(stmt, 2)
            obj.officialName      = str(stmt, 3)
            obj.mask              = str(stmt, 4)
            obj.type              = str(stmt, 5)
            obj.subtype           = str(stmt, 6)
            obj.currentBalance    = sqlite3_column_type(stmt, 7) != SQLITE_NULL
                                    ? NSNumber(value: sqlite3_column_double(stmt, 7)) : nil
            obj.availableBalance  = sqlite3_column_type(stmt, 8) != SQLITE_NULL
                                    ? NSNumber(value: sqlite3_column_double(stmt, 8)) : nil
            obj.isoCurrencyCode   = str(stmt, 9)
            obj.updatedAt         = epochDate(stmt, 10)
            if let itemId = str(stmt, 1) {
                obj.item = findOrCreate(CDItem.self, id: itemId)
            }
        }
    }

    private func importTransactions(db: OpaquePointer?) throws {
        let sql = """
            SELECT id, account_id, amount, iso_currency_code, date, name, merchant_name,
                   category, category_detailed, pending, payment_channel, reviewed, notes,
                   user_category_id
            FROM transactions
            """
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDTransaction.self, id: str(stmt, 0))
            obj.id               = str(stmt, 0)
            obj.amount           = sqlite3_column_double(stmt, 2)
            obj.isoCurrencyCode  = str(stmt, 3)
            obj.date             = str(stmt, 4)
            obj.name             = str(stmt, 5)
            obj.merchantName     = str(stmt, 6)
            obj.category         = str(stmt, 7)
            obj.categoryDetailed = str(stmt, 8)
            obj.pending          = sqlite3_column_int(stmt, 9) != 0
            obj.paymentChannel   = str(stmt, 10)
            obj.reviewed         = sqlite3_column_int(stmt, 11) != 0
            obj.notes            = str(stmt, 12)
            if let accId = str(stmt, 1) {
                obj.account = findOrCreate(CDAccount.self, id: accId)
            }
            if let catId = str(stmt, 13) {
                obj.userCategory = findOrCreate(CDCategory.self, id: catId)
            }
        }
    }

    private func importTransactionTags(db: OpaquePointer?) throws {
        let sql = "SELECT transaction_id, tag_id FROM transaction_tags"
        try query(db: db, sql: sql) { stmt in
            guard let txnId = str(stmt, 0), let tagId = str(stmt, 1) else { return }
            let txn = findOrCreate(CDTransaction.self, id: txnId)
            let tag = findOrCreate(CDTag.self, id: tagId)
            txn.addToTags(tag)
        }
    }

    private func importBudgets(db: OpaquePointer?) throws {
        let sql = "SELECT id, category_id, amount FROM budgets"
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDBudget.self, id: str(stmt, 0))
            obj.id     = str(stmt, 0)
            obj.amount = sqlite3_column_double(stmt, 2)
            if let catId = str(stmt, 1) {
                obj.category = findOrCreate(CDCategory.self, id: catId)
            }
        }
    }

    private func importTagBudgets(db: OpaquePointer?) throws {
        let sql = "SELECT id, tag_id, amount FROM tag_budgets"
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDTagBudget.self, id: str(stmt, 0))
            obj.id     = str(stmt, 0)
            obj.amount = sqlite3_column_double(stmt, 2)
            if let tagId = str(stmt, 1) {
                obj.tag = findOrCreate(CDTag.self, id: tagId)
            }
        }
    }

    private func importTagRules(db: OpaquePointer?) throws {
        let sql = "SELECT id, tag_id, pattern, label, created_at FROM tag_rules"
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDTagRule.self, id: str(stmt, 0))
            obj.id        = str(stmt, 0)
            obj.pattern   = str(stmt, 2)
            obj.label     = str(stmt, 3)
            obj.createdAt = epochDate(stmt, 4)
            if let tagId = str(stmt, 1) {
                obj.tag = findOrCreate(CDTag.self, id: tagId)
            }
        }
    }

    private func importRecurringStreams(db: OpaquePointer?) throws {
        let sql = """
            SELECT id, account_id, direction, description, merchant_name, category,
                   frequency, average_amount, last_amount, last_date, predicted_next_date,
                   iso_currency_code, is_active, status, updated_at
            FROM recurring_streams
            """
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDRecurringStream.self, id: str(stmt, 0))
            obj.id                 = str(stmt, 0)
            obj.direction          = str(stmt, 2)
            obj.streamDescription  = str(stmt, 3)
            obj.merchantName       = str(stmt, 4)
            obj.category           = str(stmt, 5)
            obj.frequency          = str(stmt, 6)
            obj.averageAmount      = sqlite3_column_type(stmt, 7) != SQLITE_NULL
                                     ? NSNumber(value: sqlite3_column_double(stmt, 7)) : nil
            obj.lastAmount         = sqlite3_column_type(stmt, 8) != SQLITE_NULL
                                     ? NSNumber(value: sqlite3_column_double(stmt, 8)) : nil
            obj.lastDate           = str(stmt, 9)
            obj.predictedNextDate  = str(stmt, 10)
            obj.isoCurrencyCode    = str(stmt, 11)
            obj.isActive           = sqlite3_column_int(stmt, 12) != 0
            obj.status             = str(stmt, 13)
            obj.updatedAt          = epochDate(stmt, 14)
            if let accId = str(stmt, 1) {
                obj.account = findOrCreate(CDAccount.self, id: accId)
            }
        }
    }

    private func importVendorGroups(db: OpaquePointer?) throws {
        let sql = "SELECT id, name, created_at FROM vendor_groups"
        try query(db: db, sql: sql) { stmt in
            let obj = findOrCreate(CDVendorGroup.self, id: str(stmt, 0))
            obj.id        = str(stmt, 0)
            obj.name      = str(stmt, 1)
            obj.createdAt = epochDate(stmt, 2)
        }
    }

    private func importVendorGroupMembers(db: OpaquePointer?) throws {
        let sql = "SELECT group_id, vendor_key FROM vendor_group_members"
        try query(db: db, sql: sql) { stmt in
            guard let groupId = str(stmt, 0), let vendorKey = str(stmt, 1) else { return }
            // vendor_group_members has no standalone id; key on groupId+vendorKey
            let req = NSFetchRequest<CDVendorGroupMember>(entityName: "CDVendorGroupMember")
            req.predicate = NSPredicate(format: "vendorKey == %@ AND group.id == %@", vendorKey, groupId)
            req.fetchLimit = 1
            let obj = (try? ctx.fetch(req).first) ?? CDVendorGroupMember(context: ctx)
            obj.vendorKey = vendorKey
            obj.group = findOrCreate(CDVendorGroup.self, id: groupId)
        }
    }

    // MARK: - Helpers

    private func findOrCreate<T: NSManagedObject>(_ type: T.Type, id: String?) -> T {
        guard let id else { return T(context: ctx) }
        let entityName = String(describing: type)
        let req = NSFetchRequest<T>(entityName: entityName)
        req.predicate = NSPredicate(format: "id == %@", id)
        req.fetchLimit = 1
        return (try? ctx.fetch(req).first) ?? T(context: ctx)
    }

    private func query(db: OpaquePointer?, sql: String, row: (OpaquePointer) throws -> Void) throws {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(stmt) }
        while sqlite3_step(stmt) == SQLITE_ROW {
            try row(stmt!)
        }
    }

    private func str(_ stmt: OpaquePointer, _ col: Int32) -> String? {
        guard sqlite3_column_type(stmt, col) != SQLITE_NULL else { return nil }
        guard let ptr = sqlite3_column_text(stmt, col) else { return nil }
        return String(cString: ptr)
    }

    private func blob(_ stmt: OpaquePointer, _ col: Int32) -> Data? {
        guard sqlite3_column_type(stmt, col) != SQLITE_NULL else { return nil }
        let bytes = sqlite3_column_bytes(stmt, col)
        guard bytes > 0, let ptr = sqlite3_column_blob(stmt, col) else { return nil }
        return Data(bytes: ptr, count: Int(bytes))
    }

    // created_at / updated_at columns are INTEGER milliseconds since epoch in the web schema.
    private func epochDate(_ stmt: OpaquePointer, _ col: Int32) -> Date? {
        guard sqlite3_column_type(stmt, col) != SQLITE_NULL else { return nil }
        let ms = sqlite3_column_int64(stmt, col)
        return Date(timeIntervalSince1970: Double(ms) / 1000)
    }
}
