import * as fs from 'fs'
import * as path from 'path'

export {}

enum OrganizationScheme {
  BY_YEAR = 'by_year',
}

interface SyncOptionsGooglePhotosFilters {
  /** The type of media to sync. */
  mediaType: 'VIDEO' | 'PHOTO' | 'ALL_MEDIA'
  /** A string of the form YYYY-MM-DD */
  startDate: string
  /** A string of the form YYYY-MM-DD */
  endDate: string
}

interface SyncOptions {
  organizationScheme: OrganizationScheme
  destinationDirectory: string

  googlePhotosApiKey: string
  googlePhotosFilters: SyncOptionsGooglePhotosFilters
}

interface FileOnDisk {
  /** The relative path to the root destination directory. */
  relativePath: string
  /** The complete path on disk. */
  fullPath: string
  /** The name of the file itself without any directory structure. */
  basename: string
  /** The size of the file on disk in bytes. */
  size: number
}

interface Manifest {
  /** The destination path at which this manifest is expected to exist. */
  destinationPath: string
  /** The list of files found in all recursive directories at the destination. */
  files: FileOnDisk[]
}

async function main() {
  // Gather all options necessary to build.
  const syncOptions = buildSyncOptions()

  // Build a manifest from directory (existing files)
  const manifest = await buildManifestFromDisk(syncOptions)

  // Query Google Photos for matching items.
  for await (const mediaItems of queryMediaItemsFromPhotos(syncOptions)) {
    for (const mediaItem of mediaItems) {
      // Compare matching items to manifest.
      const matchingManifestItem = findMatchingManifestItem(manifest, mediaItem)

      // Compute desired path to actual (missing or elsewhere).
      const destinationPath = buildDestinationPath(syncOptions, mediaItem)

      if (matchingManifestItem) {
        // Check if already at destination, if not, move.
      } else {
        // Download to destination.
      }
    }
  }
}

function buildSyncOptions(): SyncOptions {
  const destinationDirectory = process.env.GOOGLE_PHOTOS_DEST_DIR
  if (!destinationDirectory) throw new Error(`GOOGLE_PHOTOS_DEST_DIR not set`)
  const googlePhotosApiKey = process.env.GOOGLE_PHOTOS_API_KEY
  if (!googlePhotosApiKey) throw new Error(`GOOGLE_PHOTOS_API_KEY not set`)

  return {
    destinationDirectory,
    organizationScheme: OrganizationScheme.BY_YEAR,

    googlePhotosApiKey,
    googlePhotosFilters: {
      mediaType: 'VIDEO',
      startDate: '2021-02-14',
      endDate: '2023-03-01',
    },
  }
}

async function buildManifestFromDisk(options: SyncOptions): Promise<Array<FileOnDisk>> {
  const {destinationDirectory} = options

  const files: Array<FileOnDisk> = []

  async function traverseDirectory(dir: string, basePath: string) {
    const entries = await fs.promises.readdir(dir, {withFileTypes: true})

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = path.relative(basePath, fullPath)

      if (entry.isDirectory()) {
        await traverseDirectory(fullPath, basePath)
      } else if (entry.isFile()) {
        const stats = await fs.promises.stat(fullPath)
        files.push({
          relativePath,
          fullPath,
          size: stats.size,
          basename: path.basename(relativePath),
        })
      }
    }
  }

  await traverseDirectory(destinationDirectory, destinationDirectory)

  return files
}

async function* queryMediaItemsFromPhotos(syncOptions: SyncOptions) {
  const {googlePhotosApiKey, googlePhotosFilters} = syncOptions

  const startParts = googlePhotosFilters.startDate.split('-')
  const endParts = googlePhotosFilters.endDate.split('-')
  const startDate = {year: startParts[0], month: startParts[1], day: startParts[2]}
  const endDate = {year: endParts[0], month: endParts[1], day: endParts[2]}

  const filters = {
    mediaTypeFilter: {mediaTypes: [googlePhotosFilters.mediaType]},
    dateFilter: {ranges: [{startDate, endDate}]},
  }

  let pageToken = undefined

  const payload = {pageSize: 100, pageToken, filters}

  do {
    const response = await fetch(`https://photoslibrary.googleapis.com/v1/mediaItems:search`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({...payload, pageToken}),
    })
    if (!response.ok) throw new Error(`Failed request: ${await response.text()}`)
    const body = await response.json()

    if (body.mediaItems) {
      for (const mediaItem of body.mediaItems) {
        yield mediaItem
      }
    }

    pageToken = body.nextPageToken
  } while (pageToken)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
