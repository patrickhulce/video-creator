// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import {oauth2Client} from '@/shared/google-oauth'
import type {NextApiRequest, NextApiResponse} from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.query.error) {
    // An error response e.g. error=access_denied
    console.log('Error:' + req.query.error)
    res.status(500).send(req.query.error)
  } else {
    // Get access and refresh tokens (if access_type is offline)
    let {tokens} = await oauth2Client.getToken(String(req.query.code))
    oauth2Client.setCredentials(tokens)
    console.log(`export GOOGLE_PHOTOS_REFRESH_TOKEN="${tokens.refresh_token}"`)
    res.send({tokens})
  }
}
