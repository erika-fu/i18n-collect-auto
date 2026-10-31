import Vue from 'vue'
import VueI18n from 'vue-i18n'
import { demoLocaleMessages } from './resolve'

Vue.use(VueI18n)

const locale = 'zh'
const hashDictionary = require('/lang/zh_hash.json')
const catalogs = {
    zh: require('/lang/catalog/zh.json'),
    en: require('/lang/catalog/en.json')
}

const i18n = new VueI18n({
    locale,
    messages: {
        zh: demoLocaleMessages(catalogs.zh, hashDictionary),
        en: demoLocaleMessages(catalogs.en, hashDictionary)
    }
})

export default i18n
