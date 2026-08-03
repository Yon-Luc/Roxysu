export const i18n = {
	defaultLocale: 'fr',
	locales: ['en', 'fr', 'es']
} as const

export type Locale = (typeof i18n)['locales'][number]

export const countryEnable = ['FR'] as const

export function checkCountry(country: unknown): (typeof countryEnable)[number] {
	if (typeof country !== 'string') return countryEnable[0]
	const check = countryEnable.includes(country as (typeof countryEnable)[number])
	return check ? (country as (typeof countryEnable)[number]) : countryEnable[0]
}

export function checkLanguage(language: unknown): Locale {
	if (typeof language !== 'string') return i18n.defaultLocale
	const check = i18n.locales.includes(language as Locale)
	return check ? (language as Locale) : i18n.defaultLocale
}
