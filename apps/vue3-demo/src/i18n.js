import { createI18n } from 'vue-i18n'
import zh from '../lang/catalog/zh.json'
import en from '../lang/catalog/en.json'

export const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  fallbackLocale: 'zh',
  messages: { zh, en }
})

export function t (key, ...args) {
  return i18n.global.t(key, ...args)
}

export function setLocale (locale) {
  i18n.global.locale.value = locale
}

export function getLocale () {
  return i18n.global.locale.value
}
