import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

// argon2id — OWASP's current top recommendation for password hashing:
// memory-hard, so GPU/ASIC cracking doesn't get the usual speedup, and the
// hybrid id variant resists both the side-channel and GPU-cracking attacks
// its di/i siblings are individually weaker against.
const HASH_OPTIONS: argon2.Options & { type: argon2.argon2id } = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB, OWASP's 2024 minimum recommendation
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, HASH_OPTIONS);
  }

  verify(hash: string, plaintext: string): Promise<boolean> {
    return argon2.verify(hash, plaintext);
  }
}
