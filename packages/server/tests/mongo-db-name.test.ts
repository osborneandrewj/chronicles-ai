import { afterEach, describe, expect, it } from 'vitest'

import {
  mongoConnectionOptions,
  resolveMongoDbName,
} from '@/infrastructure/persistence/mongo/connection'

describe('resolveMongoDbName (O1)', () => {
  afterEach(() => {
    delete process.env.MONGO_DB_NAME
  })

  it('defaults to chronicles', () => {
    expect(resolveMongoDbName({})).toBe('chronicles')
    expect(mongoConnectionOptions({}).dbName).toBe('chronicles')
  })

  it('honors MONGO_DB_NAME override', () => {
    expect(resolveMongoDbName({ MONGO_DB_NAME: 'test' })).toBe('test')
    expect(resolveMongoDbName({ MONGO_DB_NAME: '  mydb  ' })).toBe('mydb')
  })

  it('treats empty override as default', () => {
    expect(resolveMongoDbName({ MONGO_DB_NAME: '   ' })).toBe('chronicles')
  })
})
