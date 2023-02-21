import {getPhotosAuthToken} from '../shared/google-oauth'
import * as fs from 'fs'
import * as path from 'path'
import fetch, {Response} from 'node-fetch'
import {GoogleMediaItem} from '../shared/models'
import pLimit from 'p-limit'

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

  googlePhotosAuthToken: string
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

const concurrently = pLimit(10)

export async function main() {
  console.log('Gathering options...')
  // Gather all options necessary to build.
  const syncOptions = await buildSyncOptions()

  console.log('Building file manifest...')
  // Build a manifest from directory (existing files)
  const manifest = await buildManifestFromDisk(syncOptions)
  console.log(`Detected ${manifest.files.length} existing files.`)

  console.log('Querying Google Photos API...')
  // Query Google Photos for matching items.
  const promises = [Promise.resolve()]
  for await (const mediaItem of queryMediaItemsFromPhotos(syncOptions)) {
    const promise = concurrently(() => processMediaItem(syncOptions, manifest, mediaItem))

    promises.push(
      promise.catch(error => {
        console.error(`Failed to process ${mediaItem.filename}: ${error.stack || error}`)
      }),
    )
  }

  await Promise.all(promises)
  console.log('Done!')
}

async function buildSyncOptions(): Promise<SyncOptions> {
  const destinationDirectory = process.env.GOOGLE_PHOTOS_DEST_DIR
  if (!destinationDirectory) throw new Error(`GOOGLE_PHOTOS_DEST_DIR not set`)

  return {
    destinationDirectory,
    organizationScheme: OrganizationScheme.BY_YEAR,

    googlePhotosAuthToken: await getPhotosAuthToken(),
    googlePhotosFilters: {
      mediaType: 'VIDEO',
      startDate: '2023-01-14',
      endDate: '2023-03-01',
    },
  }
}

async function buildManifestFromDisk(options: SyncOptions): Promise<Manifest> {
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

  return {destinationPath: path.join(destinationDirectory, 'manifest.json'), files}
}

async function* queryMediaItemsFromPhotos(
  syncOptions: SyncOptions,
): AsyncGenerator<GoogleMediaItem> {
  const {googlePhotosAuthToken, googlePhotosFilters} = syncOptions

  const startParts = googlePhotosFilters.startDate.split('-').map(x => Number(x))
  const endParts = googlePhotosFilters.endDate.split('-').map(x => Number(x))
  const startDate = {year: startParts[0], month: startParts[1], day: startParts[2]}
  const endDate = {year: endParts[0], month: endParts[1], day: endParts[2]}

  const filters = {
    mediaTypeFilter: {mediaTypes: [googlePhotosFilters.mediaType]},
    dateFilter: {ranges: [{startDate, endDate}]},
  }

  let pageToken = undefined

  const payload = {pageSize: 100, pageToken, filters}

  do {
    let response: Response = await fetch(
      `https://photoslibrary.googleapis.com/v1/mediaItems:search`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${googlePhotosAuthToken}`,
        },
        redirect: 'follow',
        body: JSON.stringify({...payload, pageToken}),
      },
    )
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

async function processMediaItem(
  syncOptions: SyncOptions,
  manifest: Manifest,
  mediaItem: GoogleMediaItem,
) {
  // Compare matching items to manifest.
  const matchingManifestItem = findMatchingManifestItem(manifest, mediaItem)

  // // Compute desired path to actual (missing or elsewhere).
  const destinationPath = buildDestinationPath(syncOptions, mediaItem)
  const folderPath = path.dirname(destinationPath)
  if (!fs.existsSync(folderPath)) await fs.promises.mkdir(folderPath, {recursive: true})

  if (matchingManifestItem) {
    // Check if already at destination, if not, move.
    if (matchingManifestItem.fullPath === destinationPath) {
      console.log(`${matchingManifestItem.basename} already up-to-date.`)
    } else {
      await fs.promises.rename(matchingManifestItem.fullPath, destinationPath)
      console.log('Moved file to', destinationPath)
    }
  } else {
    // Download to destination.
    console.log(`Downloading ${mediaItem.filename}...`)
    await downloadFile(mediaItem, destinationPath)
    console.log(`File downloaded to ${destinationPath}`)
  }
}

function findMatchingManifestItem(
  manifest: Manifest,
  mediaItem: GoogleMediaItem,
): FileOnDisk | undefined {
  return manifest.files.find(
    item => item.basename.toLowerCase() === mediaItem.filename.toLowerCase(),
  )
}

function buildDestinationPath(syncOptions: SyncOptions, mediaItem: GoogleMediaItem): string {
  const [year] = (mediaItem.mediaMetadata.creationTime || 'UNKNOWN').split('-', 2)
  return path.join(syncOptions.destinationDirectory, year, mediaItem.filename)
}

async function downloadFile(mediaItem: GoogleMediaItem, destinationPath: string): Promise<void> {
  const downloadUrl = mediaItem.mediaMetadata.video
    ? `${mediaItem.baseUrl}=dv`
    : `${mediaItem.baseUrl}=d`

  const response = await fetch(downloadUrl, {redirect: 'follow'})
  if (!response.ok) throw new Error(`Failed to fetch ${downloadUrl}: ${response.text()}`)

  const file = fs.createWriteStream(destinationPath)
  return new Promise((resolve, reject) => {
    response.body
      .pipe(file)
      .on('finish', () => {
        file.close(() => {
          resolve()
        })
      })
      .on('error', error => {
        fs.unlink(destinationPath, () => reject(error))
        reject(error)
      })
  })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
