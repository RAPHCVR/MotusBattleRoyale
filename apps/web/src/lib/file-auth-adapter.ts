import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAdapterFactory } from "better-auth/adapters";

type AuthRecord = Record<string, any>;
type AuthDb = Record<string, AuthRecord[]>;

declare global {
  // eslint-disable-next-line no-var
  var __motusWebFileAuthDb: AuthDb | undefined;
}

const DEFAULT_AUTH_DB: AuthDb = {
  user: [],
  session: [],
  account: [],
  verification: [],
  oneTimeToken: [],
  passkey: [],
  rateLimit: []
};

function getAuthStorePath() {
  return process.env.MOTUS_LOCAL_DEV_AUTH_PATH ?? path.join(os.tmpdir(), "motus-royale-local-dev-auth.json");
}

function reviveAuthValue(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => reviveAuthValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, reviveAuthValue(entryValue, entryKey)]));
  }

  if (typeof value === "string" && key?.endsWith("At")) {
    const parsed = Date.parse(value);

    if (!Number.isNaN(parsed)) {
      return new Date(parsed);
    }
  }

  return value;
}

function loadAuthDb(): AuthDb {
  const storePath = getAuthStorePath();

  if (!existsSync(storePath)) {
    return structuredClone(DEFAULT_AUTH_DB);
  }

  try {
    const raw = readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const hydrated = reviveAuthValue(parsed) as Record<string, unknown>;
    const normalized: AuthDb = {};

    for (const [key, value] of Object.entries(hydrated)) {
      normalized[key] = Array.isArray(value) ? (value as AuthRecord[]) : [];
    }

    for (const [key, value] of Object.entries(DEFAULT_AUTH_DB)) {
      normalized[key] = normalized[key] ?? structuredClone(value);
    }

    return normalized;
  } catch {
    return structuredClone(DEFAULT_AUTH_DB);
  }
}

function persistAuthDb(db: AuthDb) {
  const storePath = getAuthStorePath();
  mkdirSync(path.dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(db, null, 2), "utf8");
}

export function fileAuthAdapter(config?: { debugLogs?: boolean }) {
  const db = globalThis.__motusWebFileAuthDb ?? loadAuthDb();
  globalThis.__motusWebFileAuthDb = db;

  let lazyOptions: any = null;
  let transactionDepth = 0;
  let dirty = false;

  const flushIfNeeded = () => {
    if (transactionDepth > 0 || !dirty) {
      return;
    }

    persistAuthDb(db);
    dirty = false;
  };

  const markDirty = () => {
    dirty = true;
    flushIfNeeded();
  };

  const adapterCreator = createAdapterFactory({
    config: {
      adapterId: "motus-file-memory",
      adapterName: "Motus File Memory Adapter",
      usePlural: false,
      debugLogs: config?.debugLogs ?? false,
      supportsArrays: true,
      customTransformInput(props: any) {
        if (props.options.advanced?.database?.generateId === "serial" && props.field === "id" && props.action === "create") {
          return db[props.model].length + 1;
        }

        return props.data;
      },
      transaction: async <R>(cb: (adapter: any) => Promise<R>): Promise<R> => {
        const clone = structuredClone(db);
        const previousDirty = dirty;
        transactionDepth += 1;

        try {
          const result = await cb(adapterCreator(lazyOptions));
          transactionDepth -= 1;
          flushIfNeeded();
          return result;
        } catch (error) {
          for (const key of Object.keys(db)) {
            db[key] = clone[key] ?? [];
          }

          dirty = previousDirty;
          transactionDepth -= 1;
          flushIfNeeded();
          throw error;
        }
      }
    },
    adapter: (({ getFieldName, getDefaultFieldName, options, getModelName }: any) => {
      const applySortToRecords = (records: AuthRecord[], sortBy: any, model: string) => {
        if (!sortBy) {
          return records;
        }

        return records.sort((left, right) => {
          const field = getFieldName({
            model,
            field: sortBy.field
          });
          const leftValue = left[field];
          const rightValue = right[field];
          let comparison = 0;

          if (leftValue == null && rightValue == null) {
            comparison = 0;
          } else if (leftValue == null) {
            comparison = -1;
          } else if (rightValue == null) {
            comparison = 1;
          } else if (typeof leftValue === "string" && typeof rightValue === "string") {
            comparison = leftValue.localeCompare(rightValue);
          } else if (leftValue instanceof Date && rightValue instanceof Date) {
            comparison = leftValue.getTime() - rightValue.getTime();
          } else if (typeof leftValue === "number" && typeof rightValue === "number") {
            comparison = leftValue - rightValue;
          } else if (typeof leftValue === "boolean" && typeof rightValue === "boolean") {
            comparison = leftValue === rightValue ? 0 : leftValue ? 1 : -1;
          } else {
            comparison = String(leftValue).localeCompare(String(rightValue));
          }

          return sortBy.direction === "asc" ? comparison : -comparison;
        });
      };

      const convertWhereClause = (where: any[], model: string, join?: Record<string, any>, select?: string[]) => {
        const table = db[model];

        if (!table) {
          throw new Error(`Model ${model} not found in auth adapter store.`);
        }

        const evalClause = (record: AuthRecord, clause: any) => {
          const { field, value, operator } = clause;

          switch (operator) {
            case "in":
              return Array.isArray(value) ? value.includes(record[field]) : false;
            case "not_in":
              return Array.isArray(value) ? !value.includes(record[field]) : true;
            case "contains":
              return typeof record[field] === "string" ? record[field].includes(value) : false;
            case "starts_with":
              return typeof record[field] === "string" ? record[field].startsWith(value) : false;
            case "ends_with":
              return typeof record[field] === "string" ? record[field].endsWith(value) : false;
            case "ne":
              return record[field] !== value;
            case "gt":
              return value != null && Boolean(record[field] > value);
            case "gte":
              return value != null && Boolean(record[field] >= value);
            case "lt":
              return value != null && Boolean(record[field] < value);
            case "lte":
              return value != null && Boolean(record[field] <= value);
            default:
              return record[field] === value;
          }
        };

        let records = table.filter((record) => {
          if (!where.length) {
            return true;
          }

          let result = evalClause(record, where[0]);

          for (const clause of where) {
            const clauseResult = evalClause(record, clause);
            result = clause.connector === "OR" ? result || clauseResult : result && clauseResult;
          }

          return result;
        });

        if (select?.length) {
          records = records.map((record) =>
            Object.fromEntries(
              Object.entries(record).filter(([key]) =>
                select.includes(
                  getDefaultFieldName({
                    model,
                    field: key
                  })
                )
              )
            )
          );
        }

        if (!join) {
          return records;
        }

        const grouped = new Map<string, AuthRecord>();
        const seenIds = new Map<string, Set<string>>();

        for (const baseRecord of records) {
          const baseId = String(baseRecord.id);

          if (!grouped.has(baseId)) {
            const nested: AuthRecord = { ...baseRecord };

            for (const [joinModel, joinAttr] of Object.entries(join)) {
              const joinModelName = getModelName(joinModel);

              if ((joinAttr as { relation: string }).relation === "one-to-one") {
                nested[joinModelName] = null;
              } else {
                nested[joinModelName] = [];
                seenIds.set(`${baseId}-${joinModel}`, new Set());
              }
            }

            grouped.set(baseId, nested);
          }

          const nestedEntry = grouped.get(baseId)!;

          for (const [joinModel, joinAttr] of Object.entries(join)) {
            const joinModelName = getModelName(joinModel);
            const joinTable = db[joinModelName];

            if (!joinTable) {
              throw new Error(`Join model ${joinModelName} not found in auth adapter store.`);
            }

            const typedJoinAttr = joinAttr as {
              relation: string;
              limit?: number;
              on: {
                from: string;
                to: string;
              };
            };
            const matchingRecords = joinTable.filter((joinRecord) => joinRecord[typedJoinAttr.on.to] === baseRecord[typedJoinAttr.on.from]);

            if (typedJoinAttr.relation === "one-to-one") {
              nestedEntry[joinModelName] = matchingRecords[0] ?? null;
              continue;
            }

            const seenSet = seenIds.get(`${baseId}-${joinModel}`)!;
            const limit = typedJoinAttr.limit ?? 100;
            let count = 0;

            for (const matchingRecord of matchingRecords) {
              if (count >= limit) {
                break;
              }

              if (!seenSet.has(String(matchingRecord.id))) {
                (nestedEntry[joinModelName] as AuthRecord[]).push(matchingRecord);
                seenSet.add(String(matchingRecord.id));
                count += 1;
              }
            }
          }
        }

        return Array.from(grouped.values());
      };

      return {
        create: async ({ model, data }: any) => {
          if (options.advanced?.database?.generateId === "serial") {
            data.id = db[getModelName(model)].length + 1;
          }

          if (!db[model]) {
            db[model] = [];
          }

          db[model].push(data);
          markDirty();
          return data;
        },
        findOne: async ({ model, where, select, join }: any) => {
          const result = convertWhereClause(where, model, join, select);
          return result[0] ?? null;
        },
        findMany: async ({ model, where, sortBy, limit, select, offset, join }: any) => {
          let result = convertWhereClause(where ?? [], model, join, select);
          result = applySortToRecords(result, sortBy, model);

          if (offset !== undefined) {
            result = result.slice(offset);
          }

          if (limit !== undefined) {
            result = result.slice(0, limit);
          }

          return result;
        },
        count: async ({ model, where }: any) => {
          if (where) {
            return convertWhereClause(where, model).length;
          }

          return db[model]?.length ?? 0;
        },
        update: async ({ model, where, update }: any) => {
          const result = convertWhereClause(where, model);
          result.forEach((record) => Object.assign(record, update));
          markDirty();
          return result[0] ?? null;
        },
        delete: async ({ model, where }: any) => {
          const table = db[model] ?? [];
          const result = convertWhereClause(where, model);
          db[model] = table.filter((record) => !result.includes(record));
          markDirty();
        },
        deleteMany: async ({ model, where }: any) => {
          const table = db[model] ?? [];
          const result = convertWhereClause(where, model);
          let count = 0;
          db[model] = table.filter((record) => {
            if (result.includes(record)) {
              count += 1;
              return false;
            }

            return true;
          });
          markDirty();
          return count;
        },
        updateMany: async ({ model, where, update }: any) => {
          const result = convertWhereClause(where, model);
          result.forEach((record) => Object.assign(record, update));
          markDirty();
          return result[0] ?? null;
        }
      } as any;
    }) as any
  } as any);

  return (options: any) => {
    lazyOptions = options;
    return adapterCreator(options);
  };
}
