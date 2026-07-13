const DB_NAME = 'screenshot-ledger-media'
const STORE_NAME = 'receipts'
const DB_VERSION = 1

let databasePromise: Promise<IDBDatabase> | null = null

const openDatabase = () => {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地图片库'))
  })
  return databasePromise
}

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('本地图片操作失败'))
})

export const saveReceiptImage = async (key: string, image: Blob) => {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  await requestResult(transaction.objectStore(STORE_NAME).put(image, key))
}

export const getReceiptImage = async (key: string): Promise<Blob | null> => {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const result = await requestResult(transaction.objectStore(STORE_NAME).get(key))
  return result instanceof Blob ? result : null
}

export const deleteReceiptImage = async (key: string) => {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  await requestResult(transaction.objectStore(STORE_NAME).delete(key))
}

export const clearReceiptImages = async () => {
  const database = await openDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  await requestResult(transaction.objectStore(STORE_NAME).clear())
}
