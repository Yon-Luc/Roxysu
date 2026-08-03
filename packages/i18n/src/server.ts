import { Elysia, t } from 'elysia'
import { dictionaries, getDictionary } from './index'
import type { Pages } from './index'

const pageNames = new Set<Pages>(Object.keys(dictionaries.fr) as Pages[])

export const i18nRoutes = new Elysia({ prefix: '/i18n' }).get(
	'/:lang/:page',
	async ({ params }) => {
		if (!pageNames.has(params.page as Pages)) {
			return new Response(null, { status: 404 })
		}
		return getDictionary(params.lang, params.page as Pages)
	},
	{
		params: t.Object({
			lang: t.String(),
			page: t.String()
		})
	}
)
