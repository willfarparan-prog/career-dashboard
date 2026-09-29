import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { credentials, type FactStatus } from "@/db/schema";
import type { Credential } from "@/lib/ai/library";
import { isCredentialKind, isFactStatus, type CredentialKind } from "./labels";
import { CareerInputError, isUuid, required } from "./util";

export type CredentialInput = {
  kind: CredentialKind;
  name: string;
  issuer: string;
  date: string;
  detail: string;
  factStatus: FactStatus;
};

export function validateCredential(input: CredentialInput): CredentialInput {
  if (!isCredentialKind(input.kind)) throw new CareerInputError("Pick education, certification or award.");
  if (!isFactStatus(input.factStatus)) throw new CareerInputError("Pick a fact status.");
  return {
    kind: input.kind,
    name: required(input.name, "Add the name, like the degree or certificate."),
    issuer: input.issuer.trim(),
    date: input.date.trim(),
    detail: input.detail.trim(),
    factStatus: input.factStatus,
  };
}

export async function listCredentials(db: Database, userId: string): Promise<Credential[]> {
  return db.select().from(credentials).where(eq(credentials.userId, userId)).orderBy(asc(credentials.sort), asc(credentials.createdAt));
}

export async function createCredential(db: Database, userId: string, input: CredentialInput): Promise<Credential> {
  const values = validateCredential(input);
  const [row] = await db.insert(credentials).values({ userId, ...values }).returning();
  return row;
}

export async function updateCredential(db: Database, userId: string, id: string, input: CredentialInput): Promise<Credential> {
  const values = validateCredential(input);
  if (!isUuid(id)) throw new CareerInputError("That item no longer exists.");
  const [row] = await db
    .update(credentials)
    .set(values)
    .where(and(eq(credentials.id, id), eq(credentials.userId, userId)))
    .returning();
  if (!row) throw new CareerInputError("That item no longer exists.");
  return row;
}

export async function deleteCredential(db: Database, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.delete(credentials).where(and(eq(credentials.id, id), eq(credentials.userId, userId))).returning({ id: credentials.id });
  return deleted.length > 0;
}
