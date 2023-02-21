import {google} from 'googleapis'

// Access scopes for read-only Photos activity.
const scopes = ['https://www.googleapis.com/auth/photoslibrary.readonly']

/**
 * To use OAuth2 authentication, we need access to a CLIENT_ID, CLIENT_SECRET, AND REDIRECT_URI.
 * To get these credentials for your application, visit
 * https://console.cloud.google.com/apis/credentials.
 */
export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_PHOTOS_CLIENT_ID,
  process.env.GOOGLE_PHOTOS_CLIENT_SECRET,
  'http://localhost:3000/api/google-auth/redirect',
)

// Generate a url that asks permissions for the Photos activity scope
export const authorizationUrl = oauth2Client.generateAuthUrl({
  // 'online' (default) or 'offline' (gets refresh_token)
  access_type: 'offline',
  /** Pass in the scopes array defined above.
   * Alternatively, if only one scope is needed, you can pass a scope URL as a string */
  scope: scopes,
  // Enable incremental authorization. Recommended as a best practice.
  include_granted_scopes: true,
})

export async function getPhotosAuthToken() {
  const refreshToken = process.env.GOOGLE_PHOTOS_REFRESH_TOKEN
  if (refreshToken) oauth2Client.setCredentials({refresh_token: refreshToken})
  const {res, token} = await oauth2Client.getAccessToken()
  if (!token) throw new Error(`Unable to acquire access token: ${res?.status} ${res?.data}`)
  return token
}
