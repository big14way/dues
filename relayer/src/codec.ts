import { createHash } from 'node:crypto';
import { deserialize } from 'borsh';
import { KeyType, PublicKey, SCHEMA, base64Decode, encodeDelegateAction } from 'near-api-js';

/** A NEP-366 SignedDelegate as borsh decodes it (plain objects, bigint numbers). */
export interface FunctionCallAction {
  methodName: string;
  args: number[] | Uint8Array;
  gas: bigint;
  deposit: bigint;
}

export type DecodedAction = { functionCall: FunctionCallAction } | Record<string, unknown>;

export interface DecodedDelegate {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: DecodedAction[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: { ed25519Key?: { data: number[] } } & Record<string, unknown>;
  };
  signature: { ed25519Signature?: { data: number[] } } & Record<string, unknown>;
}

export class DecodeError extends Error {}

const MAX_BYTES = 16 * 1024;

export function decodeSignedDelegate(base64: string): DecodedDelegate {
  if (typeof base64 !== 'string' || base64.length === 0) throw new DecodeError('signedDelegate must be a base64 string');
  if (base64.length > (MAX_BYTES * 4) / 3 + 4) throw new DecodeError('signedDelegate is too large');
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(base64);
  } catch {
    throw new DecodeError('signedDelegate is not valid base64');
  }
  try {
    return deserialize(SCHEMA.SignedDelegate, bytes) as unknown as DecodedDelegate;
  } catch (e) {
    throw new DecodeError(`not a SignedDelegate: ${(e as Error).message}`);
  }
}

/** Checks the ed25519 signature over sha256(NEP-461 prefix || borsh(DelegateAction)). */
export function verifyDelegateSignature(d: DecodedDelegate): boolean {
  const pk = d.delegateAction.publicKey.ed25519Key?.data;
  const sig = d.signature.ed25519Signature?.data;
  if (!pk || !sig) return false;
  const publicKey = new PublicKey({ keyType: KeyType.ED25519, data: Uint8Array.from(pk) });
  // encodeDelegateAction only reads fields, so the decoded plain object is enough.
  const payload = encodeDelegateAction(d.delegateAction as unknown as Parameters<typeof encodeDelegateAction>[0]);
  const hash = createHash('sha256').update(payload).digest();
  return publicKey.verify(new Uint8Array(hash), Uint8Array.from(sig));
}

export function publicKeyString(d: DecodedDelegate): string | undefined {
  const pk = d.delegateAction.publicKey.ed25519Key?.data;
  return pk ? new PublicKey({ keyType: KeyType.ED25519, data: Uint8Array.from(pk) }).toString() : undefined;
}

export function argsJson(fc: FunctionCallAction): unknown {
  return JSON.parse(Buffer.from(Uint8Array.from(fc.args)).toString('utf8'));
}
