import Foundation

/// NaCl `crypto_secretbox` — XSalsa20-Poly1305 — in pure Swift.
///
/// Everything crossing the companion relay is sealed with it
/// (`packages/sync-crypto/src/envelope.ts`). CryptoKit has no XSalsa20, and
/// the alternative is shipping libsodium for one function, so this implements
/// exactly the construction tweetnacl and libsodium do: an HSalsa20 subkey from
/// the first 16 nonce bytes, a Salsa20 keystream from the last 8, the first 32
/// keystream bytes as the one-time Poly1305 key, and `tag ‖ ciphertext` on the
/// wire. `SyncCryptoTests` holds it to the frozen libsodium vectors in
/// `packages/sync-crypto/test/vectors.json`, byte for byte.
///
/// No Core Data, no UI — pure value code, compiled into the test target too.
enum SecretBox {
    static let keyBytes = 32
    static let nonceBytes = 24
    static let tagBytes = 16

    enum Failure: Error, Equatable {
        /// Wrong key, or the ciphertext was altered. Discard the whole message.
        case authentication
        case badKeyLength
        case badNonceLength
    }

    /// Opens `tag ‖ ciphertext`. Never returns partial plaintext: the tag is
    /// checked over the whole ciphertext before a byte is decrypted.
    static func open(_ boxed: [UInt8], nonce: [UInt8], key: [UInt8]) throws -> [UInt8] {
        guard key.count == keyBytes else { throw Failure.badKeyLength }
        guard nonce.count == nonceBytes else { throw Failure.badNonceLength }
        guard boxed.count >= tagBytes else { throw Failure.authentication }

        let tag = Array(boxed[0..<tagBytes])
        let ciphertext = Array(boxed[tagBytes...])
        let stream = keystream(count: 32 + ciphertext.count, nonce: nonce, key: key)

        let expected = Poly1305.tag(ciphertext, key: Array(stream[0..<32]))
        guard constantTimeEqual(tag, expected) else { throw Failure.authentication }

        var plaintext = [UInt8](repeating: 0, count: ciphertext.count)
        for i in 0..<ciphertext.count { plaintext[i] = ciphertext[i] ^ stream[32 + i] }
        return plaintext
    }

    /// Seals with a caller-chosen nonce. Production code never seals (the phone
    /// is read-only); this exists so the tests can prove the construction
    /// reproduces libsodium's ciphertext exactly, not merely that it opens it.
    static func seal(_ message: [UInt8], nonce: [UInt8], key: [UInt8]) throws -> [UInt8] {
        guard key.count == keyBytes else { throw Failure.badKeyLength }
        guard nonce.count == nonceBytes else { throw Failure.badNonceLength }

        let stream = keystream(count: 32 + message.count, nonce: nonce, key: key)
        var ciphertext = [UInt8](repeating: 0, count: message.count)
        for i in 0..<message.count { ciphertext[i] = message[i] ^ stream[32 + i] }
        return Poly1305.tag(ciphertext, key: Array(stream[0..<32])) + ciphertext
    }

    // ── XSalsa20 ─────────────────────────────────────────────────────

    /// "expand 32-byte k"
    private static let sigma: [UInt32] = [0x6170_7865, 0x3320_646E, 0x7962_2D32, 0x6B20_6574]

    private static func keystream(count: Int, nonce: [UInt8], key: [UInt8]) -> [UInt8] {
        let subkey = hsalsa20(key: key, input: Array(nonce[0..<16]))
        let tail = Array(nonce[16..<24])

        var out = [UInt8]()
        out.reserveCapacity(count + 64)
        var counter: UInt64 = 0
        while out.count < count {
            out += salsa20Block(key: subkey, nonce: tail, counter: counter)
            counter += 1
        }
        return Array(out[0..<count])
    }

    private static func initialState(key: [UInt8], middle: [UInt32]) -> [UInt32] {
        let k = words(key)
        return [
            sigma[0], k[0], k[1], k[2],
            k[3], sigma[1], middle[0], middle[1],
            middle[2], middle[3], sigma[2], k[4],
            k[5], k[6], k[7], sigma[3],
        ]
    }

    private static func salsa20Block(key: [UInt8], nonce: [UInt8], counter: UInt64) -> [UInt8] {
        let n = words(nonce)
        let input = initialState(key: key, middle: [n[0], n[1], UInt32(truncatingIfNeeded: counter), UInt32(truncatingIfNeeded: counter >> 32)])
        var x = input
        doubleRounds(&x)
        var out = [UInt8]()
        out.reserveCapacity(64)
        for i in 0..<16 { out += bytes(x[i] &+ input[i]) }
        return out
    }

    private static func hsalsa20(key: [UInt8], input: [UInt8]) -> [UInt8] {
        var x = initialState(key: key, middle: words(input))
        doubleRounds(&x)
        var out = [UInt8]()
        out.reserveCapacity(32)
        for i in [0, 5, 10, 15, 6, 7, 8, 9] { out += bytes(x[i]) }
        return out
    }

    /// Ten double rounds (column round then row round) — Salsa20/20.
    private static func doubleRounds(_ x: inout [UInt32]) {
        @inline(__always) func rotl(_ v: UInt32, _ n: UInt32) -> UInt32 { (v << n) | (v >> (32 - n)) }
        for _ in 0..<10 {
            x[4] ^= rotl(x[0] &+ x[12], 7); x[8] ^= rotl(x[4] &+ x[0], 9)
            x[12] ^= rotl(x[8] &+ x[4], 13); x[0] ^= rotl(x[12] &+ x[8], 18)
            x[9] ^= rotl(x[5] &+ x[1], 7); x[13] ^= rotl(x[9] &+ x[5], 9)
            x[1] ^= rotl(x[13] &+ x[9], 13); x[5] ^= rotl(x[1] &+ x[13], 18)
            x[14] ^= rotl(x[10] &+ x[6], 7); x[2] ^= rotl(x[14] &+ x[10], 9)
            x[6] ^= rotl(x[2] &+ x[14], 13); x[10] ^= rotl(x[6] &+ x[2], 18)
            x[3] ^= rotl(x[15] &+ x[11], 7); x[7] ^= rotl(x[3] &+ x[15], 9)
            x[11] ^= rotl(x[7] &+ x[3], 13); x[15] ^= rotl(x[11] &+ x[7], 18)

            x[1] ^= rotl(x[0] &+ x[3], 7); x[2] ^= rotl(x[1] &+ x[0], 9)
            x[3] ^= rotl(x[2] &+ x[1], 13); x[0] ^= rotl(x[3] &+ x[2], 18)
            x[6] ^= rotl(x[5] &+ x[4], 7); x[7] ^= rotl(x[6] &+ x[5], 9)
            x[4] ^= rotl(x[7] &+ x[6], 13); x[5] ^= rotl(x[4] &+ x[7], 18)
            x[11] ^= rotl(x[10] &+ x[9], 7); x[8] ^= rotl(x[11] &+ x[10], 9)
            x[9] ^= rotl(x[8] &+ x[11], 13); x[10] ^= rotl(x[9] &+ x[8], 18)
            x[12] ^= rotl(x[15] &+ x[14], 7); x[13] ^= rotl(x[12] &+ x[15], 9)
            x[14] ^= rotl(x[13] &+ x[12], 13); x[15] ^= rotl(x[14] &+ x[13], 18)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────

    /// Little-endian 32-bit words.
    static func words(_ b: [UInt8]) -> [UInt32] {
        stride(from: 0, to: b.count, by: 4).map { load32(b, $0) }
    }

    static func load32(_ b: [UInt8], _ i: Int) -> UInt32 {
        UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24
    }

    static func bytes(_ w: UInt32) -> [UInt8] {
        [UInt8(truncatingIfNeeded: w), UInt8(truncatingIfNeeded: w >> 8),
         UInt8(truncatingIfNeeded: w >> 16), UInt8(truncatingIfNeeded: w >> 24)]
    }

    private static func constantTimeEqual(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[i] ^ b[i] }
        return diff == 0
    }
}

/// Poly1305 one-time authenticator — the 32-bit "donna" formulation: five
/// 26-bit limbs, products accumulated in 64 bits.
enum Poly1305 {
    static func tag(_ message: [UInt8], key: [UInt8]) -> [UInt8] {
        let mask: UInt32 = 0x3FF_FFFF
        let r0 = SecretBox.load32(key, 0) & 0x3FF_FFFF
        let r1 = (SecretBox.load32(key, 3) >> 2) & 0x3FF_FF03
        let r2 = (SecretBox.load32(key, 6) >> 4) & 0x3FF_C0FF
        let r3 = (SecretBox.load32(key, 9) >> 6) & 0x3F0_3FFF
        let r4 = (SecretBox.load32(key, 12) >> 8) & 0x00F_FFFF
        let s1 = r1 * 5, s2 = r2 * 5, s3 = r3 * 5, s4 = r4 * 5

        var h0: UInt32 = 0, h1: UInt32 = 0, h2: UInt32 = 0, h3: UInt32 = 0, h4: UInt32 = 0

        var offset = 0
        while offset < message.count {
            let remaining = message.count - offset
            var block = [UInt8](repeating: 0, count: 16)
            let hibit: UInt32
            if remaining >= 16 {
                for i in 0..<16 { block[i] = message[offset + i] }
                hibit = 1 << 24
            } else {
                for i in 0..<remaining { block[i] = message[offset + i] }
                block[remaining] = 1
                hibit = 0
            }
            offset += 16

            h0 &+= SecretBox.load32(block, 0) & mask
            h1 &+= (SecretBox.load32(block, 3) >> 2) & mask
            h2 &+= (SecretBox.load32(block, 6) >> 4) & mask
            h3 &+= (SecretBox.load32(block, 9) >> 6) & mask
            h4 &+= (SecretBox.load32(block, 12) >> 8) | hibit

            func m(_ a: UInt32, _ b: UInt32) -> UInt64 { UInt64(a) * UInt64(b) }
            let d0 = m(h0, r0) + m(h1, s4) + m(h2, s3) + m(h3, s2) + m(h4, s1)
            var d1 = m(h0, r1) + m(h1, r0) + m(h2, s4) + m(h3, s3) + m(h4, s2)
            var d2 = m(h0, r2) + m(h1, r1) + m(h2, r0) + m(h3, s4) + m(h4, s3)
            var d3 = m(h0, r3) + m(h1, r2) + m(h2, r1) + m(h3, r0) + m(h4, s4)
            var d4 = m(h0, r4) + m(h1, r3) + m(h2, r2) + m(h3, r1) + m(h4, r0)

            var c = d0 >> 26; h0 = UInt32(truncatingIfNeeded: d0) & mask
            d1 += c; c = d1 >> 26; h1 = UInt32(truncatingIfNeeded: d1) & mask
            d2 += c; c = d2 >> 26; h2 = UInt32(truncatingIfNeeded: d2) & mask
            d3 += c; c = d3 >> 26; h3 = UInt32(truncatingIfNeeded: d3) & mask
            d4 += c; c = d4 >> 26; h4 = UInt32(truncatingIfNeeded: d4) & mask
            h0 &+= UInt32(truncatingIfNeeded: c) &* 5
            let carry = h0 >> 26; h0 &= mask; h1 &+= carry
        }

        // Fully carry h.
        var c = h1 >> 26; h1 &= mask
        h2 &+= c; c = h2 >> 26; h2 &= mask
        h3 &+= c; c = h3 >> 26; h3 &= mask
        h4 &+= c; c = h4 >> 26; h4 &= mask
        h0 &+= c &* 5; c = h0 >> 26; h0 &= mask
        h1 &+= c

        // g = h + 5 - 2^130; pick g when h ≥ p, in constant time.
        var g0 = h0 &+ 5; c = g0 >> 26; g0 &= mask
        var g1 = h1 &+ c; c = g1 >> 26; g1 &= mask
        var g2 = h2 &+ c; c = g2 >> 26; g2 &= mask
        var g3 = h3 &+ c; c = g3 >> 26; g3 &= mask
        var g4 = h4 &+ c &- (1 << 26)

        var select = (g4 >> 31) &- 1
        g0 &= select; g1 &= select; g2 &= select; g3 &= select; g4 &= select
        select = ~select
        h0 = (h0 & select) | g0
        h1 = (h1 & select) | g1
        h2 = (h2 & select) | g2
        h3 = (h3 & select) | g3
        h4 = (h4 & select) | g4

        // h mod 2^128, then + s.
        let w0 = h0 | (h1 << 26)
        let w1 = (h1 >> 6) | (h2 << 20)
        let w2 = (h2 >> 12) | (h3 << 14)
        let w3 = (h3 >> 18) | (h4 << 8)

        var f = UInt64(w0) + UInt64(SecretBox.load32(key, 16))
        let t0 = UInt32(truncatingIfNeeded: f)
        f = UInt64(w1) + UInt64(SecretBox.load32(key, 20)) + (f >> 32)
        let t1 = UInt32(truncatingIfNeeded: f)
        f = UInt64(w2) + UInt64(SecretBox.load32(key, 24)) + (f >> 32)
        let t2 = UInt32(truncatingIfNeeded: f)
        f = UInt64(w3) + UInt64(SecretBox.load32(key, 28)) + (f >> 32)
        let t3 = UInt32(truncatingIfNeeded: f)

        return SecretBox.bytes(t0) + SecretBox.bytes(t1) + SecretBox.bytes(t2) + SecretBox.bytes(t3)
    }
}
