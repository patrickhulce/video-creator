/**
 * A media item from Google Photos API
 * @see https://developers.google.com/photos/library/reference/rest/v1/mediaItems
 */
export interface GoogleMediaItem {
  id: string
  productUrl: string
  /** The fully qualified URL to the file. */
  baseUrl: string
  mimeType: string
  filename: string
  mediaMetadata: {
    /** Time file was created in ISO 8601 format (YYYY-MM-DDTHH:MM:SS). */
    creationTime?: string
    /** Width in pixels. */
    width?: string
    /** Height in pixels. */
    height?: string
    /** Video-specific data such as frames per second. */
    video?: {fps?: number; status?: 'READY' | 'PROCESSING'}
  }
}
