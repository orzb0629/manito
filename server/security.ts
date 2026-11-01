import { createHmac, randomBytes, randomInt } from 'node:crypto';
import {ACCESS_CODE_ALPHABET,ACCESS_CODE_LENGTH,normalizeAccessCode} from '../src/backend/code-format.ts';
export class ApiError extends Error {
 status: number;
 code: string;
 constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}
export const COOKIE_NAME = '__Host-manito_session';
export const SESSION_SECONDS = 12 * 60 * 60;
export function hashSecret(pepper: string, purpose: 'code'|'session'|'confirmation'|'rate', value: string) {
 return createHmac('sha256', pepper).update(`${purpose}\0${value}`).digest('hex');
}
export function newCode() {
 return Array.from({length:ACCESS_CODE_LENGTH},()=>ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)]).join('');
}
export function normalizeCode(value: unknown) {
 return normalizeAccessCode(value);
}
export const newToken = () => randomBytes(32).toString('base64url');
export function sessionCookie(token: string, maxAge = SESSION_SECONDS) {
 return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function readSession(request: Request) {
 const matches = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE_NAME}=`));
 if (matches.length !== 1) throw new ApiError(401, 'unauthorized');
 const token = matches[0].slice(COOKIE_NAME.length + 1);
 if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'unauthorized');
 return token;
}
export function assertSameOrigin(request: Request, origin: string) {
 // Deny even login CSRF, missing Origin and sibling-site attacks. Never infer origin from Host.
 if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'origin_denied');
}
export function randomCycle<T>(students: readonly T[]): T[] {
 if (students.length < 3) throw new ApiError(400, 'minimum_three_students');
 const order = [...students];
 for (let i = order.length - 1; i > 0; i--) {
  const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]];
 }
 return order;
}
export function uuid(value: unknown): string {
 if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, 'invalid_input');
 return value;
}
export function confirmation(value: unknown): string {
 if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new ApiError(400, 'invalid_input');
 return value;
}
