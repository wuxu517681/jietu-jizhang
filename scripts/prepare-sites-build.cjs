const { copyFile, mkdir, rm } = require('node:fs/promises')
const { resolve } = require('node:path')

async function main() {
  const root = resolve(__dirname, '..')
  const outputDirectory = resolve(root, 'dist', 'server')

  await rm(resolve(root, 'dist', '.DS_Store'), { force: true })
  await mkdir(outputDirectory, { recursive: true })
  await copyFile(
    resolve(root, 'sites', 'worker.js'),
    resolve(outputDirectory, 'index.js'),
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
