// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type {NextApiRequest, NextApiResponse} from 'next'
import {authorizationUrl} from '@/shared/google-oauth'

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.redirect(authorizationUrl)
}
