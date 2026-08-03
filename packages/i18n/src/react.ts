import { useEffect, useRef, useState } from 'react'
import { i18n } from './config'
import type { Dictionary, Pages } from './index'

type Fetcher = <K extends Pages>(lang: string, page: K) => Promise<Dictionary[K]>

const defaultFetcher: Fetcher = async (lang, page) => {
	const res = await fetch(`/api/i18n/${lang}/${page}`)
	if (!res.ok) {
		throw new Error('Failed to fetch dictionary')
	}
	return res.json() as Promise<Dictionary[typeof page]>
}

export type UseI18nResult<T extends readonly Pages[]> = {
	data: { [K in T[number]]: Dictionary[K] | undefined }
	isLoading: boolean
	isError: boolean
	error: unknown
}

export function useI18n<const T extends readonly Pages[]>({
	pages,
	lang,
	fetcher = defaultFetcher
}: {
	pages: T
	lang: string | undefined
	fetcher?: Fetcher
}): UseI18nResult<T> {
	const [data, setData] = useState<Record<string, unknown> | null>(null)
	const [error, setError] = useState<unknown>(undefined)
	const [isLoading, setIsLoading] = useState(true)

	const fetcherRef = useRef(fetcher)
	fetcherRef.current = fetcher

	const currentLang = lang ?? i18n.defaultLocale
	const key = [currentLang, ...pages].join('\u0000')

	useEffect(() => {
		let active = true
		setIsLoading(true)
		setError(undefined)
		setData(null)

		const next: Record<string, unknown> = {}
		let settled = 0

		pages.forEach((page) => {
			fetcherRef
				.current(currentLang, page)
				.then((value) => {
					if (!active) return
					next[page] = value
					setData({ ...next })
				})
				.catch((err: unknown) => {
					if (!active) return
					setError(err)
				})
				.finally(() => {
					if (!active) return
					settled += 1
					if (settled === pages.length) setIsLoading(false)
				})
		})

		return () => {
			active = false
		}
	}, [key])

	return {
		data: (data ?? {}) as { [K in T[number]]: Dictionary[K] | undefined },
		isLoading,
		isError: error !== undefined,
		error
	}
}
