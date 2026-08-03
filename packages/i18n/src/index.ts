import { i18n, checkLanguage } from './config'

export { i18n, checkLanguage, checkCountry } from './config'
export type { Locale } from './config'

type DefaultLang = typeof i18n.defaultLocale

export const dictionaries = {
	en: {
		auth: () => import('./dictionary/auth/en.json').then((module) => module.default),
		app: () => import('./dictionary/app/en.json').then((module) => module.default)
	},
	fr: {
		auth: () => import('./dictionary/auth/fr.json').then((module) => module.default),
		app: () => import('./dictionary/app/fr.json').then((module) => module.default)
	}
}

export type Pages = keyof (typeof dictionaries)[DefaultLang]

export const getStaticPathsI18n = () =>
	i18n.locales.map((locale) => ({
		params: { lang: locale }
	}))

export const getDictionary = async <K extends Pages>(locale: string | undefined, page: K) => {
	const lang = checkLanguage(locale) as DefaultLang
	return dictionaries[lang][page]() as Promise<
		(typeof dictionaries.en)[K] extends () => Promise<infer R> ? R : never
	>
}

export type Dictionary = {
	[K in Pages]: ReturnType<(typeof dictionaries)[DefaultLang][K]> extends Promise<infer R>
		? R
		: never
}

export type PageKey<P extends keyof Dictionary> = keyof Dictionary[P]
