import { describe, expect, test } from 'bun:test'
import { checkCountry, checkLanguage } from './config'
import { getDictionary, getStaticPathsI18n } from './index'

describe('checkLanguage', () => {
	test('defaults to fr when not a string', () => {
		expect(checkLanguage(undefined)).toBe('fr')
	})

	test('defaults to fr when unsupported', () => {
		expect(checkLanguage('de')).toBe('fr')
	})

	test('returns supported locales', () => {
		expect(checkLanguage('en')).toBe('en')
		expect(checkLanguage('fr')).toBe('fr')
		expect(checkLanguage('es')).toBe('es')
		expect(checkLanguage('pt')).toBe('pt')
	})
})

describe('checkCountry', () => {
	test('defaults to FR', () => {
		expect(checkCountry(undefined)).toBe('FR')
		expect(checkCountry('US')).toBe('FR')
	})

	test('returns supported countries', () => {
		expect(checkCountry('FR')).toBe('FR')
	})
})

describe('getDictionary', () => {
	test('resolves a page for a supported locale', async () => {
		const dict = await getDictionary('en', 'auth')
		expect(dict.login.title).toBe('Sign in')
		const esDict = await getDictionary('es', 'auth')
		expect(esDict.login.title).toBe('Iniciar sesión')
		const esApp = await getDictionary('es', 'app')
		expect(esApp.nav.settings).toBe('Ajustes')
		const ptDict = await getDictionary('pt', 'auth')
		expect(ptDict.login.title).toBe('Entrar')
		const ptApp = await getDictionary('pt', 'app')
		expect(ptApp.nav.settings).toBe('Configurações')
	})

	test('falls back to the default locale', async () => {
		const dict = await getDictionary('de', 'auth')
		expect(dict.login.title).toBe('Connexion')
	})

	test('static paths cover every locale', () => {
		expect(getStaticPathsI18n()).toEqual([
			{ params: { lang: 'en' } },
			{ params: { lang: 'fr' } },
			{ params: { lang: 'es' } },
			{ params: { lang: 'pt' } }
		])
	})
})
